const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// 주식 기본 데이터는 코드에 존재하지 않습니다.
// 모든 종목은 관리자 패널에서 stocks 테이블에 추가합니다.

async function getStocks() {
  const { rows } = await pool.query(
    "SELECT * FROM stocks ORDER BY id ASC"
  );
  return rows;
}

async function getStock(id) {
  const { rows } = await pool.query(
    "SELECT * FROM stocks WHERE id=$1 LIMIT 1",
    [id]
  );
  return rows[0] || null;
}

async function getGlobalSettings() {
  try {
    const { rows } = await pool.query(`
      SELECT global_price_floor, floor_lock_minutes
      FROM game_settings
      WHERE id=1
      LIMIT 1
    `);

    const row = rows[0] || {};

    return {
      floor:
        row.global_price_floor === null ||
        row.global_price_floor === undefined
          ? null
          : Number(row.global_price_floor),
      lockMinutes: Math.max(
        1,
        Number(row.floor_lock_minutes || 10)
      )
    };
  } catch {
    return {
      floor: null,
      lockMinutes: 10
    };
  }
}

async function getGlobalPriceFloor() {
  return (await getGlobalSettings()).floor;
}

async function getHistory(id, range = "1d") {
  const ranges = {
    "1h": 3600000,
    "1d": 86400000,
    "1w": 604800000,
    "1m": 2592000000,
    "3m": 7776000000,
    all: Infinity
  };

  const duration = ranges[range] ?? ranges["1d"];
  const since =
    duration === Infinity
      ? 0
      : Date.now() - duration;

  const { rows } = await pool.query(`
    SELECT
      time AS t,
      price AS p
    FROM price_history
    WHERE stock_id=$1
      AND time >= $2
    ORDER BY time ASC
    LIMIT 5000
  `, [id, since]);

  return rows.map(row => ({
    t: Number(row.t),
    p: Number(row.p)
  }));
}

async function setPrice(id, price) {
  const value = Math.max(
    1,
    Math.round(Number(price))
  );

  if (!Number.isFinite(value)) {
    throw new Error("가격이 올바르지 않습니다.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      UPDATE stocks
      SET
        previous=price,
        price=$1,
        high=GREATEST(high,$1),
        low=LEAST(low,$1)
      WHERE id=$2
      RETURNING *
    `, [value, id]);

    if (!result.rows.length) {
      throw new Error("주식을 찾을 수 없습니다.");
    }

    await client.query(`
      INSERT INTO price_history(stock_id,time,price)
      VALUES($1,$2,$3)
    `, [id, Date.now(), value]);

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
  let min = Math.abs(Number(stock.min_change));
  let max = Math.abs(Number(stock.max_change));

  if (!Number.isFinite(min) || min < 1) min = 1;
  if (!Number.isFinite(max) || max < min) max = min;

  min = Math.round(min);
  max = Math.round(max);

  return min + Math.floor(
    Math.random() * (max - min + 1)
  );
}

function getDirection(control) {
  // normal = 완전 중립. 상승/하락 어느 쪽도 고정하지 않고
  // 매 틱마다 반드시 + 또는 - 중 하나를 선택합니다.
  if (
    !control ||
    !["up", "down"].includes(control.direction) ||
    Number(control.until_time) <= Date.now()
  ) {
    return Math.random() < 0.5 ? 1 : -1;
  }

  const strength = Math.min(
    5,
    Math.max(1, Math.round(Number(control.strength) || 1))
  );

  // 강도 1~5는 방향 편향 확률입니다.
  // 반대 방향도 계속 나올 수 있어 자연스럽게 움직입니다.
  const wantedProbability =
    0.55 + (strength - 1) * 0.08;

  const wantedDirection =
    control.direction === "up" ? 1 : -1;

  return Math.random() < wantedProbability
    ? wantedDirection
    : -wantedDirection;
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

async function startFloorRecovery(stock, floor, now, lockMinutes) {
  const lockUntil =
    now + Math.max(1, lockMinutes) * 60000;

  await pool.query(`
    UPDATE stocks
    SET
      previous=price,
      price=$1,
      high=GREATEST(high,$1),
      low=LEAST(low,$1),
      floor_lock_until=$2,
      floor_rise_remaining=2
    WHERE id=$3
  `, [floor, lockUntil, stock.id]);

  await pool.query(`
    INSERT INTO price_history(stock_id,time,price)
    VALUES($1,$2,$3)
  `, [stock.id, now, floor]);
}

async function updateStockMarket(stock) {
  const now = Date.now();
  const settings = await getGlobalSettings();

  const stockFloor = Number(stock.price_floor);
  const floor =
    settings.floor !== null &&
    Number.isFinite(settings.floor) &&
    settings.floor > 0
      ? settings.floor
      : Number.isFinite(stockFloor) && stockFloor > 0
        ? stockFloor
        : null;

  const current = Math.max(
    1,
    Math.round(Number(stock.price) || 1)
  );

  const lockUntil = Number(stock.floor_lock_until || 0);
  const recoveryRemaining = Number(
    stock.floor_rise_remaining || 0
  );

  // -----------------------------------------------------
  // 1. 커트라인 잠금 중
  // -----------------------------------------------------
  if (floor !== null && lockUntil > now) {
    // 잠금 중에는 가격을 커트라인에 유지합니다.
    if (current !== floor) {
      await setPrice(stock.id, floor);
    }
    return floor;
  }

  // -----------------------------------------------------
  // 2. 커트라인 잠금 종료 후 2회 강제 상승
  // -----------------------------------------------------
  if (
    floor !== null &&
    lockUntil > 0 &&
    lockUntil <= now &&
    recoveryRemaining > 0
  ) {
    const next = Math.max(
      floor + 1,
      current + randomChange(stock)
    );

    await pool.query(`
      UPDATE stocks
      SET
        floor_rise_remaining=$1,
        floor_lock_until=0
      WHERE id=$2
    `, [
      Math.max(0, recoveryRemaining - 1),
      stock.id
    ]);

    const updated = await setPrice(stock.id, next);
    return updated.price;
  }

  // -----------------------------------------------------
  // 3. 일반 시장 변동
  // -----------------------------------------------------
  const control = await getMarketControl(stock.id);
  const direction = getDirection(control);
  const change = randomChange(stock);

  // min/max가 정상적으로 설정되어 있으면 change는 항상 1 이상입니다.
  // 따라서 normal 상태에서도 매 5초마다 가격이 실제로 변합니다.
  let next = current + direction * change;
  next = Math.max(1, Math.round(next));

  // -----------------------------------------------------
  // 4. 커트라인 도달
  // -----------------------------------------------------
  if (floor !== null && next <= floor) {
    await startFloorRecovery(
      stock,
      floor,
      now,
      settings.lockMinutes
    );

    return floor;
  }

  const updated = await setPrice(stock.id, next);

  // 서버 로그에서 엔진이 실제로 가격을 변경했는지 확인할 수 있도록 기록합니다.
  console.log(
    `[MARKET] ${updated.id} ${Number(stock.price).toLocaleString()} -> ${Number(updated.price).toLocaleString()} (${direction > 0 ? "+" : "-"}${change})`
  );

  return updated.price;
}

let marketTimer = null;
let updating = false;

async function updateMarket() {
  if (updating) return;

  updating = true;

  try {
    const stocks = await getStocks();

    if (!stocks.length) {
      console.log("[MARKET] 등록된 주식이 없습니다.");
      return;
    }

    for (const stock of stocks) {
      try {
        await updateStockMarket(stock);
      } catch (error) {
        console.error(
          `[MARKET] ${stock.id}:`,
          error.message
        );
      }
    }
  } finally {
    updating = false;
  }
}

function startMarketEngine(interval = 5000) {
  if (marketTimer) return;

  console.log(
    `📈 주가 엔진 시작 · ${interval / 1000}초 간격`
  );

  // 서버 시작 직후에도 한 번 즉시 가격을 갱신합니다.
  updateMarket().catch(error =>
    console.error("[MARKET] 초기 업데이트:", error)
  );

  marketTimer = setInterval(() => {
    updateMarket().catch(error =>
      console.error("[MARKET] 업데이트:", error)
    );
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
  getGlobalPriceFloor,
  getGlobalSettings,
  setPrice,
  updateMarket,
  startMarketEngine,
  stopMarketEngine
};
