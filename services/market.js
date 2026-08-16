const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const companies = [
  ["SKNX", "스카닉스하이닉스", 4250, 50, 250],
  ["SAMS", "샘숭전자", 7100, 80, 350],
  ["TWAI", "티Wai", 1850, 20, 120],
  ["NVR", "나이버", 3500, 40, 220],
  ["NFLX", "니플릭스", 5200, 60, 300],
  ["PASC", "파스코", 2800, 30, 150],
  ["LG", "알쥐", 6400, 70, 300],
  ["HYUN", "현재자동차", 8300, 80, 350],
  ["NVDO", "N비디오", 9700, 100, 500],
  ["MHD", "마이크로하드", 7600, 70, 350]
];

const FLOOR_LOCK_MIN_MS = 5 * 60 * 1000;
const FLOOR_LOCK_MAX_MS = 15 * 60 * 1000;

function randomFloorLockUntil() {
  const duration = FLOOR_LOCK_MIN_MS + Math.floor(Math.random() * (FLOOR_LOCK_MAX_MS - FLOOR_LOCK_MIN_MS + 1));
  return Date.now() + duration;
}

async function getStocks() {
  const { rows } = await pool.query("SELECT * FROM stocks ORDER BY id ASC");
  return rows;
}

async function getStock(id) {
  const { rows } = await pool.query("SELECT * FROM stocks WHERE id=$1 LIMIT 1", [id]);
  return rows[0] || null;
}

async function getHistory(id, range = "1d") {
  const ranges = { "1h": 3600000, "1d": 86400000, "1w": 604800000, "1m": 2592000000, "3m": 7776000000, all: Infinity };
  const duration = ranges[range] ?? ranges["1d"];
  const since = duration === Infinity ? 0 : Date.now() - duration;
  const { rows } = await pool.query(`SELECT time AS t,price AS p FROM price_history WHERE stock_id=$1 AND time >= $2 ORDER BY time ASC LIMIT 5000`, [id, since]);
  return rows.map(row => ({ t: Number(row.t), p: Number(row.p) }));
}

async function setPrice(id, price) {
  const value = Math.round(Number(price));
  if (!Number.isFinite(value) || value < 1) throw new Error("가격이 올바르지 않습니다.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      UPDATE stocks
      SET previous=price,
          price=$1,
          high=GREATEST(high,$1),
          low=LEAST(low,$1),
          floor_lock_until=0
      WHERE id=$2
      RETURNING *
    `, [value, id]);

    if (!result.rows.length) throw new Error("주식을 찾을 수 없습니다.");
    await client.query("INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)", [id, Date.now(), value]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function calculateNextPrice(stock, control = null) {
  const current = Math.max(1, Math.round(Number(stock.price) || 1));
  const min = Math.max(1, Math.round(Math.abs(Number(stock.min_change) || 1)));
  const max = Math.max(min, Math.round(Math.abs(Number(stock.max_change) || min)));
  const change = min + Math.floor(Math.random() * (max - min + 1));
  let direction = Math.random() < 0.5 ? -1 : 1;

  if (control && Number(control.until_time) > Date.now()) {
    if (control.direction === "up") direction = 1;
    if (control.direction === "down") direction = -1;
  }

  return Math.max(1, current + direction * change);
}

async function updateStockMarket(stock) {
  const now = Date.now();
  const floor = Number(stock.price_floor);
  const hasFloor = Number.isFinite(floor) && floor > 0;
  const lockUntil = Number(stock.floor_lock_until || 0);
  const current = Math.max(1, Math.round(Number(stock.price) || 1));

  if (hasFloor && lockUntil > now) {
    if (current !== floor) await setPrice(stock.id, floor);
    return;
  }

  const { rows } = await pool.query(`SELECT direction,until_time,strength FROM market_controls WHERE stock_id=$1`, [stock.id]);
  const control = rows[0] || null;

  // 커트라인 잠금이 끝난 직후에는 최소 한 번은 상승할 수 있도록 보장합니다.
  if (hasFloor && current <= floor && lockUntil > 0 && lockUntil <= now) {
    const min = Math.max(1, Math.round(Math.abs(Number(stock.min_change) || 1)));
    const max = Math.max(min, Math.round(Math.abs(Number(stock.max_change) || min)));
    const change = min + Math.floor(Math.random() * (max - min + 1));
    await setPrice(stock.id, current + change);
    return;
  }

  const nextPrice = calculateNextPrice(stock, control);

  if (hasFloor && nextPrice <= floor) {
    const newLockUntil = randomFloorLockUntil();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query(`
        UPDATE stocks
        SET previous=price,
            price=$1,
            high=GREATEST(high,$1),
            low=LEAST(low,$1),
            floor_lock_until=$2
        WHERE id=$3
        RETURNING *
      `, [floor, newLockUntil, stock.id]);

      if (!result.rows.length) throw new Error("주식을 찾을 수 없습니다.");
      await client.query("INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)", [stock.id, now, floor]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await setPrice(stock.id, nextPrice);
}

let marketTimer = null;
let updating = false;

async function updateMarket() {
  if (updating) return;
  updating = true;
  try {
    for (const stock of await getStocks()) {
      try {
        await updateStockMarket(stock);
      } catch (error) {
        console.error(`[MARKET] ${stock.id}:`, error.message);
      }
    }
  } finally {
    updating = false;
  }
}

function startMarketEngine(interval = 5000) {
  if (marketTimer) return;
  console.log(`📈 주가 엔진 시작 · ${interval / 1000}초 간격`);
  updateMarket().catch(error => console.error("[MARKET] 초기 업데이트:", error));
  marketTimer = setInterval(() => updateMarket().catch(error => console.error("[MARKET] 업데이트:", error)), interval);
}

function stopMarketEngine() {
  if (!marketTimer) return;
  clearInterval(marketTimer);
  marketTimer = null;
}

module.exports = {
  pool,
  companies,
  getStocks,
  getStock,
  getHistory,
  setPrice,
  calculateNextPrice,
  updateMarket,
  startMarketEngine,
  stopMarketEngine,
  FLOOR_LOCK_MIN_MS,
  FLOOR_LOCK_MAX_MS
};
