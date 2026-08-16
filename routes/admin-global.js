const express = require("express");
const { pool } = require("../services/market");

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

async function ensureSettingColumn() {
  await pool.query(`ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS global_price_floor NUMERIC`);
}

router.get("/global-floor", adminAuth, async (req, res) => {
  try {
    await ensureSettingColumn();
    const { rows } = await pool.query(`SELECT global_price_floor, updated_at FROM game_settings WHERE id=1 LIMIT 1`);
    res.json({
      ok: true,
      globalFloor: rows.length && rows[0].global_price_floor !== null ? Number(rows[0].global_price_floor) : null,
      updatedAt: rows.length ? Number(rows[0].updated_at) : 0
    });
  } catch (error) {
    console.error("GLOBAL FLOOR GET ERROR:", error);
    res.status(500).json({ ok: false, error: "전체 커트라인 설정을 불러오지 못했습니다." });
  }
});

router.patch("/global-floor", adminAuth, async (req, res) => {
  try {
    await ensureSettingColumn();

    const raw = req.body.globalFloor;
    const value = raw === "" || raw === null || raw === undefined ? null : Math.round(Number(raw));

    if (value !== null && (!Number.isFinite(value) || value < 1)) {
      return res.status(400).json({ ok: false, error: "전체 커트라인은 1원 이상 또는 0원(사용 안 함)으로 설정하세요." });
    }

    if (value !== null) {
      const { rows } = await pool.query("SELECT MIN(price) AS min_price FROM stocks");
      const minPrice = rows[0]?.min_price === null ? null : Number(rows[0]?.min_price);
      if (minPrice !== null && value > minPrice) {
        return res.status(400).json({
          ok: false,
          error: `전체 커트라인은 현재 가장 낮은 주가(${minPrice.toLocaleString()}원)보다 높게 설정할 수 없습니다.`
        });
      }
    }

    const now = Date.now();
    await pool.query(`
      INSERT INTO game_settings(id,starting_cash,global_price_floor,updated_at)
      VALUES(1,10000,$1,$2)
      ON CONFLICT(id) DO UPDATE
      SET global_price_floor=EXCLUDED.global_price_floor,
          updated_at=EXCLUDED.updated_at
    `, [value, now]);

    res.json({ ok: true, globalFloor: value, updatedAt: now });
  } catch (error) {
    console.error("GLOBAL FLOOR PATCH ERROR:", error);
    res.status(500).json({ ok: false, error: "전체 커트라인 저장에 실패했습니다." });
  }
});

module.exports = router;
