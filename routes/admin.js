const express = require("express");
const crypto = require("crypto");
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

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString("hex");
}

router.get("/check", adminAuth, (req, res) => res.json({ ok: true }));

router.post("/site-token", adminAuth, (req, res) => {
  const timestamp = Date.now();
  const signature = crypto.createHmac("sha256", adminPassword()).update(String(timestamp)).digest("hex");
  res.json({ ok: true, token: `${timestamp}.${signature}`, expiresIn: 300000 });
});

// 플레이어
router.get("/users", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id,player_number,username,nickname,cash,holdings,transactions,banned_until,ban_reason,created_at
      FROM users ORDER BY player_number ASC
    `);
    res.json({ ok: true, users: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "플레이어 목록을 불러오지 못했습니다." });
  }
});

router.get("/users/:id", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id,player_number,username,nickname,cash,holdings,transactions,banned_until,ban_reason,created_at
      FROM users WHERE id=$1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "플레이어를 찾을 수 없습니다." });
    res.json({ ok: true, user: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "플레이어 정보를 불러오지 못했습니다." });
  }
});

router.patch("/users/:id", adminAuth, async (req, res) => {
  try {
    const { nickname, cash, playerNumber, holdings, transactions } = req.body;
    const fields = [];
    const values = [];
    let index = 1;

    if (nickname !== undefined) {
      const value = String(nickname).trim();
      if (value.length < 2) return res.status(400).json({ ok: false, error: "닉네임은 2자 이상이어야 합니다." });
      fields.push(`nickname=$${index++}`);
      values.push(value);
    }
    if (cash !== undefined) {
      const value = Number(cash);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json({ ok: false, error: "잔액이 올바르지 않습니다." });
      fields.push(`cash=$${index++}`);
      values.push(value);
    }
    if (playerNumber !== undefined) {
      const value = Number(playerNumber);
      if (!Number.isInteger(value) || value < 1) return res.status(400).json({ ok: false, error: "플레이어 번호가 올바르지 않습니다." });
      fields.push(`player_number=$${index++}`);
      values.push(value);
    }
    if (holdings !== undefined) {
      if (!holdings || typeof holdings !== "object" || Array.isArray(holdings)) return res.status(400).json({ ok: false, error: "보유주식 데이터가 올바르지 않습니다." });
      fields.push(`holdings=$${index++}::jsonb`);
      values.push(JSON.stringify(holdings));
    }
    if (transactions !== undefined) {
      if (!Array.isArray(transactions)) return res.status(400).json({ ok: false, error: "거래내역 데이터가 올바르지 않습니다." });
      fields.push(`transactions=$${index++}::jsonb`);
      values.push(JSON.stringify(transactions));
    }
    if (!fields.length) return res.status(400).json({ ok: false, error: "수정할 항목이 없습니다." });

    values.push(req.params.id);
    const { rows } = await pool.query(`
      UPDATE users SET ${fields.join(",")} WHERE id=$${index}
      RETURNING id,player_number,username,nickname,cash,holdings,transactions,banned_until,ban_reason,created_at
    `, values);

    if (!rows.length) return res.status(404).json({ ok: false, error: "플레이어를 찾을 수 없습니다." });
    res.json({ ok: true, user: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(error.code === "23505" ? 409 : 500).json({
      ok: false,
      error: error.code === "23505" ? "이미 사용 중인 값입니다." : "플레이어 수정에 실패했습니다."
    });
  }
});

router.post("/users/:id/password", adminAuth, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    if (password.length < 4 || password.length > 128) return res.status(400).json({ ok: false, error: "비밀번호는 4~128자여야 합니다." });
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = hashPassword(password, salt);
    const result = await pool.query("UPDATE users SET salt=$1,password_hash=$2 WHERE id=$3 RETURNING id", [salt, hash, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "플레이어를 찾을 수 없습니다." });
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "비밀번호 재설정에 실패했습니다." });
  }
});

router.post("/users/:id/ban", adminAuth, async (req, res) => {
  try {
    let until = null;
    if (req.body.duration !== "permanent") {
      const minutes = Number(req.body.duration);
      if (!Number.isFinite(minutes) || minutes <= 0) return res.status(400).json({ ok: false, error: "밴 기간이 올바르지 않습니다." });
      until = Date.now() + minutes * 60000;
    }
    const { rows } = await pool.query(`
      UPDATE users SET banned_until=$1,ban_reason=$2 WHERE id=$3
      RETURNING id,player_number,nickname,banned_until,ban_reason
    `, [until, String(req.body.reason || "").slice(0, 200), req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "플레이어를 찾을 수 없습니다." });
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
    res.json({ ok: true, user: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "밴 처리에 실패했습니다." });
  }
});

router.post("/users/:id/unban", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE users SET banned_until=NULL,ban_reason='' WHERE id=$1
      RETURNING id,player_number,nickname,banned_until,ban_reason
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "플레이어를 찾을 수 없습니다." });
    res.json({ ok: true, user: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "밴 해제에 실패했습니다." });
  }
});

// 주식
function normalizeStock(stock) {
  return {
    id: stock.id,
    name: stock.name,
    price: Number(stock.price),
    previous: Number(stock.previous),
    open: Number(stock.open_price),
    high: Number(stock.high),
    low: Number(stock.low),
    volume: Number(stock.volume),
    minChange: Number(stock.min_change),
    maxChange: Number(stock.max_change),
    priceFloor: stock.price_floor === null ? null : Number(stock.price_floor),
    floorLockUntil: Number(stock.floor_lock_until || 0)
  };
}

router.get("/stocks", adminAuth, async (req, res) => {
  try {
    const stocks = await getStocks();
    res.json({ ok: true, stocks: stocks.map(normalizeStock) });
  } catch (error) {
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
    const priceFloor = req.body.priceFloor === "" || req.body.priceFloor === undefined
      ? Math.max(1, Math.floor(price * 0.5))
      : Math.round(Number(req.body.priceFloor));

    if (!/^[A-Z0-9_-]{2,20}$/.test(id) || !name) return res.status(400).json({ ok: false, error: "종목 코드 또는 회사명이 올바르지 않습니다." });
    if (!Number.isFinite(price) || price < 1) return res.status(400).json({ ok: false, error: "시작 주가가 올바르지 않습니다." });
    if (!Number.isFinite(minChange) || minChange < 1 || !Number.isFinite(maxChange) || maxChange < minChange) return res.status(400).json({ ok: false, error: "최소/최대 변동금액이 올바르지 않습니다." });
    if (!Number.isFinite(priceFloor) || priceFloor < 0 || (priceFloor > 0 && priceFloor > price)) return res.status(400).json({ ok: false, error: "커트라인은 0 또는 시작 주가 이하로 설정해야 합니다." });
    if (await getStock(id)) return res.status(409).json({ ok: false, error: "이미 존재하는 종목 코드입니다." });

    await pool.query(`
      INSERT INTO stocks
      (id,name,price,previous,open_price,high,low,volume,min_change,max_change,price_floor,floor_lock_until)
      VALUES($1,$2,$3,$3,$3,$3,$3,0,$4,$5,$6,0)
    `, [id, name, price, minChange, maxChange, priceFloor || null]);

    await pool.query("INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)", [id, Date.now(), price]);
    res.status(201).json({ ok: true, stock: normalizeStock(await getStock(id)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "주식 추가에 실패했습니다." });
  }
});

router.patch("/stocks/:id", adminAuth, async (req, res) => {
  try {
    const current = await getStock(req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: "주식을 찾을 수 없습니다." });

    const nextPrice = req.body.price === undefined ? Number(current.price) : Math.round(Number(req.body.price));
    const nextFloor = req.body.priceFloor === undefined
      ? (current.price_floor === null ? null : Number(current.price_floor))
      : (req.body.priceFloor === "" || Number(req.body.priceFloor) === 0 ? null : Math.round(Number(req.body.priceFloor)));

    if (!Number.isFinite(nextPrice) || nextPrice < 1) return res.status(400).json({ ok: false, error: "주가가 올바르지 않습니다." });
    if (nextFloor !== null && (!Number.isFinite(nextFloor) || nextFloor < 1 || nextFloor > nextPrice)) return res.status(400).json({ ok: false, error: "커트라인은 현재 주가 이하로 설정해야 합니다." });

    const fields = [];
    const values = [];
    let index = 1;

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ ok: false, error: "회사명이 비어 있습니다." });
      fields.push(`name=$${index++}`);
      values.push(name);
    }

    const nextMin = req.body.minChange === undefined ? Number(current.min_change) : Math.round(Number(req.body.minChange));
    const nextMax = req.body.maxChange === undefined ? Number(current.max_change) : Math.round(Number(req.body.maxChange));

    if (!Number.isFinite(nextMin) || nextMin < 1) return res.status(400).json({ ok: false, error: "최소 변동금액이 올바르지 않습니다." });
    if (!Number.isFinite(nextMax) || nextMax < nextMin) return res.status(400).json({ ok: false, error: "최대 변동금액은 최소 변동금액보다 작을 수 없습니다." });

    if (req.body.minChange !== undefined) {
      fields.push(`min_change=$${index++}`);
      values.push(nextMin);
    }
    if (req.body.maxChange !== undefined) {
      fields.push(`max_change=$${index++}`);
      values.push(nextMax);
    }

    fields.push(`price_floor=$${index++}`);
    values.push(nextFloor);

    values.push(req.params.id);
    await pool.query(`UPDATE stocks SET ${fields.join(",")} WHERE id=$${index}`, values);

    if (req.body.price !== undefined) await setPrice(req.params.id, nextPrice);

    res.json({ ok: true, stock: normalizeStock(await getStock(req.params.id)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "주식 수정에 실패했습니다." });
  }
});

router.delete("/stocks/:id", adminAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM stocks WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "주식을 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "주식 삭제에 실패했습니다." });
  }
});

router.post("/stocks/:id/control", adminAuth, async (req, res) => {
  try {
    const direction = ["normal", "up", "down"].includes(req.body.direction) ? req.body.direction : "normal";
    const seconds = Math.max(0, Number(req.body.seconds) || 0);
    await pool.query(`
      INSERT INTO market_controls(stock_id,direction,until_time,strength)
      VALUES($1,$2,$3,1)
      ON CONFLICT(stock_id) DO UPDATE SET direction=EXCLUDED.direction,until_time=EXCLUDED.until_time,strength=1
    `, [req.params.id, direction, Date.now() + seconds * 1000]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "주가 방향 제어에 실패했습니다." });
  }
});

// 게임 설정: 이 값은 새 가입자에게만 적용됩니다.
router.get("/settings", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id,starting_cash,updated_at FROM game_settings WHERE id=1");
    res.json({
      ok: true,
      settings: rows[0]
        ? { startingCash: Number(rows[0].starting_cash), updatedAt: Number(rows[0].updated_at) }
        : { startingCash: 10000, updatedAt: 0 }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "게임 설정을 불러오지 못했습니다." });
  }
});

router.patch("/settings", adminAuth, async (req, res) => {
  try {
    const startingCash = Math.round(Number(req.body.startingCash));
    if (!Number.isFinite(startingCash) || startingCash < 0 || startingCash > 1000000000000) {
      return res.status(400).json({ ok: false, error: "시작 자금은 0원 이상 1조원 이하로 입력하세요." });
    }

    const now = Date.now();
    const { rows } = await pool.query(`
      INSERT INTO game_settings(id,starting_cash,updated_at)
      VALUES(1,$1,$2)
      ON CONFLICT(id) DO UPDATE SET starting_cash=EXCLUDED.starting_cash,updated_at=EXCLUDED.updated_at
      RETURNING id,starting_cash,updated_at
    `, [startingCash, now]);

    res.json({ ok: true, settings: { startingCash: Number(rows[0].starting_cash), updatedAt: Number(rows[0].updated_at) } });
  } catch (error) {
    res.status(500).json({ ok: false, error: "게임 설정 저장에 실패했습니다." });
  }
});

// 서버 점검
router.get("/maintenance", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM maintenance WHERE id=1");
    res.json({ ok: true, maintenance: rows[0] || { enabled: false } });
  } catch (error) {
    res.status(500).json({ ok: false, error: "점검 상태를 불러오지 못했습니다." });
  }
});

router.post("/maintenance", adminAuth, async (req, res) => {
  try {
    const enabled = Boolean(req.body.enabled);
    const endTime = enabled ? Number(req.body.endTime) || null : null;
    await pool.query(`
      UPDATE maintenance SET enabled=$1,start_time=$2,end_time=$3,updated_at=$4 WHERE id=1
    `, [enabled, enabled ? Date.now() : null, endTime, Date.now()]);
    const { rows } = await pool.query("SELECT * FROM maintenance WHERE id=1");
    res.json({ ok: true, maintenance: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "점검 상태 변경에 실패했습니다." });
  }
});

// 피드백
router.get("/feedback", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.*,u.nickname,u.username
      FROM feedback f LEFT JOIN users u ON u.id=f.user_id
      ORDER BY f.created_at DESC
    `);
    res.json({ ok: true, feedback: rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: "피드백을 불러오지 못했습니다." });
  }
});

router.patch("/feedback/:id", adminAuth, async (req, res) => {
  try {
    const allowed = ["pending", "reviewing", "resolved", "rejected"];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ ok: false, error: "상태가 올바르지 않습니다." });
    const { rows } = await pool.query(`
      UPDATE feedback SET status=$1,updated_at=$2 WHERE id=$3 RETURNING *
    `, [req.body.status, Date.now(), req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "피드백을 찾을 수 없습니다." });
    res.json({ ok: true, feedback: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "피드백 수정에 실패했습니다." });
  }
});

// 공지사항
router.get("/notices", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM notices ORDER BY created_at DESC,id DESC");
    res.json({ ok: true, notices: rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: "공지사항을 불러오지 못했습니다." });
  }
});

router.post("/notices", adminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();
    if (!title || !content) return res.status(400).json({ ok: false, error: "제목과 내용을 입력하세요." });
    const now = Date.now();
    const { rows } = await pool.query(`
      INSERT INTO notices(title,content,created_at,updated_at) VALUES($1,$2,$3,$3) RETURNING *
    `, [title, content, now]);
    res.status(201).json({ ok: true, notice: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "공지사항 등록에 실패했습니다." });
  }
});

router.patch("/notices/:id", adminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();
    if (!title || !content) return res.status(400).json({ ok: false, error: "제목과 내용을 입력하세요." });
    const { rows } = await pool.query(`
      UPDATE notices SET title=$1,content=$2,updated_at=$3 WHERE id=$4 RETURNING *
    `, [title, content, Date.now(), req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "공지사항을 찾을 수 없습니다." });
    res.json({ ok: true, notice: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "공지사항 수정에 실패했습니다." });
  }
});

router.delete("/notices/:id", adminAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM notices WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "공지사항을 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "공지사항 삭제에 실패했습니다." });
  }
});

// 변경사항
router.get("/changes", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id,title,content,feedback_id,created_at
      FROM changes ORDER BY created_at DESC,id DESC
    `);
    res.json({ ok: true, changes: rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: "변경사항을 불러오지 못했습니다." });
  }
});

router.post("/changes", adminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();
    const feedbackId = req.body.feedbackId === "" || req.body.feedbackId === undefined ? null : Number(req.body.feedbackId);
    if (!title || !content) return res.status(400).json({ ok: false, error: "제목과 내용을 입력하세요." });
    if (feedbackId !== null && (!Number.isInteger(feedbackId) || feedbackId < 1)) return res.status(400).json({ ok: false, error: "피드백 번호가 올바르지 않습니다." });
    const { rows } = await pool.query(`
      INSERT INTO changes(title,content,feedback_id,created_at) VALUES($1,$2,$3,$4) RETURNING *
    `, [title, content, feedbackId, Date.now()]);
    res.status(201).json({ ok: true, change: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "변경사항 등록에 실패했습니다." });
  }
});

router.patch("/changes/:id", adminAuth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();
    const feedbackId = req.body.feedbackId === "" || req.body.feedbackId === undefined ? null : Number(req.body.feedbackId);
    if (!title || !content) return res.status(400).json({ ok: false, error: "제목과 내용을 입력하세요." });
    const { rows } = await pool.query(`
      UPDATE changes SET title=$1,content=$2,feedback_id=$3 WHERE id=$4 RETURNING *
    `, [title, content, feedbackId, req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "변경사항을 찾을 수 없습니다." });
    res.json({ ok: true, change: rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "변경사항 수정에 실패했습니다." });
  }
});

router.delete("/changes/:id", adminAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM changes WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "변경사항을 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "변경사항 삭제에 실패했습니다." });
  }
});

router.post("/broadcast", adminAuth, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "메시지를 입력하세요." });
    const { rows } = await pool.query("SELECT id FROM users");
    for (const user of rows) {
      await pool.query(
        "INSERT INTO notifications(user_id,message,type,created_at) VALUES($1,$2,'admin',$3)",
        [user.id, message, Date.now()]
      );
    }
    res.json({ ok: true, count: rows.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: "알림 전송에 실패했습니다." });
  }
});

module.exports = router;
module.exports.adminAuth = adminAuth;
