const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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
  const { rows } = await pool.query(`
    SELECT time AS t, price AS p
    FROM price_history
    WHERE stock_id=$1 AND time >= $2
    ORDER BY time ASC
    LIMIT 5000
  `, [id, since]);
  return rows.map(row => ({ t: Number(row.t), p: Number(row.p) }));
}

async function setPrice(id, price) {
  const value = Math.max(1, Math.round(Number(price)));
  if (!Number.isFinite(value)) throw new Error("가격이 올바르지 않습니다.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      UPDATE stocks
      SET previous=price, price=$1, high=GREATEST(high,$1), low=LEAST(low,$1)
      WHERE id=$2
      RETURNING *
    `, [value, id]);
    if (!result.rows.length) throw new Error("주식을 찾을 수 없습니다.");
    await client.query(`INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)`, [id, Date.now(), value]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function randomChange(stock) {
  let min = Math.round(Math.abs(Number(stock.min_change)));
  let max = Math.round(Math.abs(Number(stock.max_change)));
  if (!Number.isFinite(min) || min < 1) min = 1;
  if (!Number.isFinite(max) || max < min) max = min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getDirection(control) {
  if (!control || !["up", "down"].includes(control.direction) || Number(control.until_time) <= Date.now()) {
    return Math.random() < 0.5 ? 1 : -1;
  }
  const strength = Math.min(5, Math.max(1, Math.round(Number(control.strength) || 1)));
  // 1 = 55%, 2 = 63%, 3 = 71%, 4 = 79%, 5 = 87% toward the selected trend.
  const wantedProbability = 0.55 + (strength - 1) * 0.08;
  const wantedDirection = control.direction === "up" ? 1 : -1;
  return Math.random() < wantedProbability ? wantedDirection : -wantedDirection;
}

async function getMarketControl(stockId) {
  const { rows } = await pool.query(`
    SELECT direction, until_time, strength
    FROM market_controls
    WHERE stock_id=$1
    LIMIT 1
  `, [stockId]);
  return rows[0] || null;
}

function getStockFloor(stock) {
  const floor = Number(stock.price_floor);
  return Number.isFinite(floor) && floor > 0 ? Math.round(floor) : null;
}

async function startFloorRecovery(stock, floor, now) {
  const lockMinutes = Math.max(1, Math.min(1440, Math.round(Number(stock.floor_lock_minutes) || 10)));
  const lockUntil = now + lockMinutes * 60000;
  await pool.query(`
    UPDATE stocks
    SET previous=price, price=$1, high=GREATEST(high,$1), low=LEAST(low,$1),
        floor_lock_until=$2, floor_rise_remaining=2
    WHERE id=$3
  `, [floor, lockUntil, stock.id]);
  await pool.query(`INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)`, [stock.id, now, floor]);
}

async function forceRecoveryRise(stock, floor, remaining) {
  const current = Math.max(floor, Math.round(Number(stock.price) || floor));
  const change = randomChange(stock);
  const next = current + change;
  const nextRemaining = Math.max(0, remaining - 1);
  await pool.query(`UPDATE stocks SET floor_rise_remaining=$1 WHERE id=$2`, [nextRemaining, stock.id]);
  const updated = await setPrice(stock.id, next);
  return updated.price;
}

async function updateStockMarket(stock) {
  const now = Date.now();
  const floor = getStockFloor(stock);
  const current = Math.max(1, Math.round(Number(stock.price) || 1));
  const lockUntil = Number(stock.floor_lock_until || 0);
  const recoveryRemaining = Math.max(0, Math.floor(Number(stock.floor_rise_remaining) || 0));

  // 종목별 커트라인만 사용합니다. 전체 커트라인(game_settings)은 사용하지 않습니다.
  if (floor !== null && lockUntil > now) {
    if (current !== floor) await setPrice(stock.id, floor);
    return floor;
  }

  // 잠금이 끝나면 다음 두 번의 시장 틱은 무조건 상승합니다.
  if (floor !== null && recoveryRemaining > 0) {
    return forceRecoveryRise(stock, floor, recoveryRemaining);
  }

  const control = await getMarketControl(stock.id);
  const direction = getDirection(control);
  const change = randomChange(stock);
  const next = current + direction * change;

  if (floor !== null && next <= floor) {
    await startFloorRecovery(stock, floor, now);
    return floor;
  }

  const updated = await setPrice(stock.id, Math.max(1, next));
  return updated.price;
}

let marketTimer = null;
let updating = false;

async function updateMarket() {
  if (updating) return;
  updating = true;
  try {
    const stocks = await getStocks();
    for (const stock of stocks) {
      try {
        await updateStockMarket(stock);
      } catch (error) {
        console.error(`MARKET UPDATE ${stock.id}:`, error.message);
      }
    }
  } finally {
    updating = false;
  }
}

function startMarketEngine(interval = 5000) {
  if (marketTimer) return;
  console.log(`📈 주가 엔진 시작 · ${interval / 1000}초 간격`);
  updateMarket().catch(error => console.error("MARKET INITIAL UPDATE:", error));
  marketTimer = setInterval(() => {
    updateMarket().catch(error => console.error("MARKET UPDATE:", error));
  }, interval);
}

function stopMarketEngine() {
  if (!marketTimer) return;
  clearInterval(marketTimer);
  marketTimer = null;
}

module.exports = {
  pool,
  getStocks,
  getStock,
  getHistory,
  setPrice,
  updateMarket,
  startMarketEngine,
  stopMarketEngine
};
