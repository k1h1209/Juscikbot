const express = require("express");
const { pool, getStocks, getStock, setPrice } = require("../services/market");

const router = express.Router();

function adminPassword() {
  return process.env.ADMIN_PASSWORD || "admin1234";
}

function adminAuth(req, res, next) {
  if (String(req.headers["x-admin-password"] || "") !== adminPassword()) {
    return res.status(401).json({ ok: false, error: "관리자 인증이 필요합니다." });
  }
  next();
}

function normalizeStock(s) {
  return {
    id: s.id,
    name: s.name,
    price: Number(s.price),
    previous: Number(s.previous),
    open: Number(s.open_price),
    high: Number(s.high),
    low: Number(s.low),
    volume: Number(s.volume),
    minChange: Number(s.min_change),
    maxChange: Number(s.max_change),
    priceFloor: s.price_floor == null ? null : Number(s.price_floor),
    floorLockMinutes: Number(s.floor_lock_minutes || 10),
    floorLockUntil: Number(s.floor_lock_until || 0),
    floorRiseRemaining: Number(s.floor_rise_remaining || 0),
    maxShares: Number(s.max_shares || 0),
    availableShares: Number(s.available_shares || 0)
  };
}

function parseFloor(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

router.get("/stocks", adminAuth, async (req, res) => {
  try {
    const stocks = await getStocks();
    res.json({ ok: true, stocks: stocks.map(normalizeStock) });
  } catch (error) {
    console.error("ADMIN MARKET STOCK GET ERROR:", error);
    res.status(500).json({ ok: false, error: "주식 목록을 불러오지 못했습니다." });
  }
});

router.post("/stocks", adminAuth, async (req, res) => {
  try {
    const id = String(req.body.id || "").trim().toUpperCase();
    const name = String(req.body.name || "").trim();
    const price = Math.round(Number(req.body.price));
    const minChange = Math.round(Number(req.body.minChange));
    const maxChange = Math.round(Number(req.body.maxChange));
    const priceFloor = parseFloor(req.body.priceFloor);
    const floorLockMinutes = Math.round(Number(req.body.floorLockMinutes || 10));
    const maxShares = Math.floor(Number(req.body.maxShares ?? 30));

    if (!/^[A-Z0-9_-]{2,20}$/.test(id) || !name) {
      return res.status(400).json({ ok: false, error: "종목 코드 또는 회사명이 올바르지 않습니다." });
    }
    if (!Number.isFinite(price) || price < 1) {
      return res.status(400).json({ ok: false, error: "시작 주가는 1원 이상이어야 합니다." });
    }
    if (!Number.isFinite(minChange) || minChange < 1 || !Number.isFinite(maxChange) || maxChange < minChange) {
      return res.status(400).json({ ok: false, error: "최소/최대 변동금액이 올바르지 않습니다." });
    }
    if (priceFloor !== null && priceFloor >= price) {
      return res.status(400).json({ ok: false, error: "커트라인은 시작 주가보다 낮아야 합니다. 비워두면 커트라인이 없습니다." });
    }
    if (!Number.isInteger(floorLockMinutes) || floorLockMinutes < 1 || floorLockMinutes > 1440) {
      return res.status(400).json({ ok: false, error: "커트라인 잠금 시간은 1~1440분이어야 합니다." });
    }
    if (!Number.isInteger(maxShares) || maxShares < 0 || maxShares > 1000000000) {
      return res.status(400).json({ ok: false, error: "최대 공유 거래량은 0~10억주 사이여야 합니다." });
    }
    if (await getStock(id)) {
      return res.status(409).json({ ok: false, error: "이미 존재하는 종목 코드입니다." });
    }

    const result = await pool.query(`
      INSERT INTO stocks
        (id,name,price,previous,open_price,high,low,volume,
         min_change,max_change,price_floor,floor_lock_minutes,
         floor_lock_until,floor_rise_remaining,max_shares,available_shares)
      VALUES($1,$2,$3,$3,$3,$3,$3,0,$4,$5,$6,$7,0,0,$8,$8)
      RETURNING *
    `, [id, name, price, minChange, maxChange, priceFloor, floorLockMinutes, maxShares]);

    await pool.query(
      "INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)",
      [id, Date.now(), price]
    );

    res.status(201).json({ ok: true, stock: normalizeStock(result.rows[0]) });
  } catch (error) {
    console.error("ADMIN MARKET STOCK POST ERROR:", error);
    res.status(500).json({ ok: false, error: "주식 추가에 실패했습니다." });
  }
});

router.patch("/stocks/:id", adminAuth, async (req, res) => {
  try {
    const current = await getStock(req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: "주식을 찾을 수 없습니다." });

    const price = req.body.price === undefined ? Number(current.price) : Math.round(Number(req.body.price));
    const minChange = req.body.minChange === undefined ? Number(current.min_change) : Math.round(Number(req.body.minChange));
    const maxChange = req.body.maxChange === undefined ? Number(current.max_change) : Math.round(Number(req.body.maxChange));
    const priceFloor = req.body.priceFloor === undefined
      ? (current.price_floor == null ? null : Number(current.price_floor))
      : parseFloor(req.body.priceFloor);
    const floorLockMinutes = req.body.floorLockMinutes === undefined
      ? Number(current.floor_lock_minutes || 10)
      : Math.round(Number(req.body.floorLockMinutes));

    if (!Number.isFinite(price) || price < 1 || !Number.isFinite(minChange) || minChange < 1 || !Number.isFinite(maxChange) || maxChange < minChange) {
      return res.status(400).json({ ok: false, error: "주가 또는 변동금액이 올바르지 않습니다." });
    }
    if (priceFloor !== null && priceFloor >= price) {
      return res.status(400).json({ ok: false, error: "커트라인은 현재 주가보다 낮아야 합니다. 비워두면 커트라인이 없습니다." });
    }
    if (!Number.isInteger(floorLockMinutes) || floorLockMinutes < 1 || floorLockMinutes > 1440) {
      return res.status(400).json({ ok: false, error: "커트라인 잠금 시간은 1~1440분이어야 합니다." });
    }

    const fields = [];
    const values = [];
    let i = 1;
    const add = (field, value) => {
      fields.push(`${field}=$${i++}`);
      values.push(value);
    };

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ ok: false, error: "회사명이 비어 있습니다." });
      add("name", name);
    }

    add("min_change", minChange);
    add("max_change", maxChange);
    add("price_floor", priceFloor);
    add("floor_lock_minutes", floorLockMinutes);

    if (req.body.maxShares !== undefined) {
      const maxShares = Math.floor(Number(req.body.maxShares));
      if (!Number.isInteger(maxShares) || maxShares < 0 || maxShares > 1000000000) {
        return res.status(400).json({ ok: false, error: "최대 공유 거래량은 0~10억주 사이여야 합니다." });
      }

      const { rows: users } = await pool.query("SELECT holdings FROM users");
      let held = 0;
      for (const user of users) {
        held += Math.max(0, Math.floor(Number((user.holdings || {})[req.params.id] || 0)));
      }
      if (maxShares < held) {
        return res.status(400).json({ ok: false, error: `현재 ${held.toLocaleString()}주를 보유 중이라 그보다 적게 설정할 수 없습니다.` });
      }
      add("max_shares", maxShares);
      add("available_shares", maxShares - held);
    }

    values.push(req.params.id);
    await pool.query(`UPDATE stocks SET ${fields.join(",")} WHERE id=$${i}`, values);

    if (req.body.price !== undefined) {
      await setPrice(req.params.id, price);
    }

    res.json({ ok: true, stock: normalizeStock(await getStock(req.params.id)) });
  } catch (error) {
    console.error("ADMIN MARKET STOCK PATCH ERROR:", error);
    res.status(500).json({ ok: false, error: "주식 수정에 실패했습니다." });
  }
});

router.delete("/stocks/:id", adminAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM stocks WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "주식을 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (error) {
    console.error("ADMIN MARKET STOCK DELETE ERROR:", error);
    res.status(500).json({ ok: false, error: "주식 삭제에 실패했습니다." });
  }
});

router.post("/stocks/:id/control", adminAuth, async (req, res) => {
  try {
    const direction = ["normal", "up", "down"].includes(req.body.direction) ? req.body.direction : "normal";
    const seconds = Math.max(0, Number(req.body.seconds) || 0);
    const strength = Math.min(5, Math.max(1, Math.round(Number(req.body.strength) || 1)));

    if (!Number.isFinite(seconds) || seconds < 0) {
      return res.status(400).json({ ok: false, error: "제어 시간이 올바르지 않습니다." });
    }

    await pool.query(`
      INSERT INTO market_controls(stock_id,direction,until_time,strength)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(stock_id) DO UPDATE
      SET direction=EXCLUDED.direction,
          until_time=EXCLUDED.until_time,
          strength=EXCLUDED.strength
    `, [req.params.id, direction, Date.now() + seconds * 1000, strength]);

    res.json({ ok: true, direction, seconds, strength });
  } catch (error) {
    console.error("ADMIN MARKET CONTROL ERROR:", error);
    res.status(500).json({ ok: false, error: "주가 방향 제어에 실패했습니다." });
  }
});

router.get("/settings", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT starting_cash,updated_at FROM game_settings WHERE id=1 LIMIT 1");
    const s = rows[0] || {};
    res.json({ ok: true, settings: { startingCash: Number(s.starting_cash || 10000), updatedAt: Number(s.updated_at || 0) } });
  } catch (error) {
    console.error("ADMIN SETTINGS GET ERROR:", error);
    res.status(500).json({ ok: false, error: "게임 설정을 불러오지 못했습니다." });
  }
});

router.patch("/settings", adminAuth, async (req, res) => {
  try {
    const startingCash = Math.round(Number(req.body.startingCash));
    if (!Number.isFinite(startingCash) || startingCash < 0) {
      return res.status(400).json({ ok: false, error: "플레이어 시작 자금이 올바르지 않습니다." });
    }

    const now = Date.now();
    const { rows } = await pool.query(`
      INSERT INTO game_settings(id,starting_cash,global_price_floor,floor_lock_minutes,updated_at)
      VALUES(1,$1,NULL,10,$2)
      ON CONFLICT(id) DO UPDATE
      SET starting_cash=EXCLUDED.starting_cash,
          global_price_floor=NULL,
          updated_at=EXCLUDED.updated_at
      RETURNING starting_cash,updated_at
    `, [startingCash, now]);

    res.json({ ok: true, settings: { startingCash: Number(rows[0].starting_cash), updatedAt: Number(rows[0].updated_at) } });
  } catch (error) {
    console.error("ADMIN SETTINGS PATCH ERROR:", error);
    res.status(500).json({ ok: false, error: "게임 설정 저장에 실패했습니다." });
  }
});

module.exports = router;
