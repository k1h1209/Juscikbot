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

router.get("/stocks", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id,name,price,max_shares,available_shares,volume FROM stocks ORDER BY id ASC`);
    res.json({ ok: true, stocks: rows.map(s => ({ id:s.id, name:s.name, price:Number(s.price), maxShares:Number(s.max_shares||0), availableShares:Number(s.available_shares||0), tradedVolume:Number(s.volume||0) })) });
  } catch (error) {
    console.error("ADMIN SHARE STOCK GET ERROR:", error);
    res.status(500).json({ ok:false, error:"공유 거래량 정보를 불러오지 못했습니다." });
  }
});

router.patch("/stocks/:id/shares", adminAuth, async (req, res) => {
  try {
    const maxShares = Math.floor(Number(req.body.maxShares));
    if (!Number.isInteger(maxShares) || maxShares < 0 || maxShares > 1000000000) return res.status(400).json({ ok:false, error:"최대 공유 거래량은 0~10억주 사이여야 합니다." });

    const stockResult = await pool.query("SELECT id FROM stocks WHERE id=$1", [req.params.id]);
    if (!stockResult.rows.length) return res.status(404).json({ ok:false, error:"주식을 찾을 수 없습니다." });

    const { rows: users } = await pool.query("SELECT holdings FROM users");
    let held = 0;
    for (const user of users) held += Math.max(0, Math.floor(Number((user.holdings || {})[req.params.id] || 0)));

    if (maxShares < held) return res.status(400).json({ ok:false, error:`현재 플레이어들이 ${held.toLocaleString()}주를 보유하고 있어 ${held.toLocaleString()}주보다 적게 설정할 수 없습니다.` });

    const availableShares = maxShares - held;
    const { rows } = await pool.query(`UPDATE stocks SET max_shares=$1,available_shares=$2 WHERE id=$3 RETURNING id,name,price,max_shares,available_shares,volume`, [maxShares,availableShares,req.params.id]);
    const s = rows[0];
    res.json({ ok:true, stock:{ id:s.id,name:s.name,price:Number(s.price),maxShares:Number(s.max_shares),availableShares:Number(s.available_shares),tradedVolume:Number(s.volume) } });
  } catch (error) {
    console.error("ADMIN SHARE STOCK PATCH ERROR:", error);
    res.status(500).json({ ok:false, error:"최대 공유 거래량 저장에 실패했습니다." });
  }
});

router.get("/users/:id/detail", adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id,player_number,username,nickname,cash,holdings,transactions,banned_until,ban_reason,created_at FROM users WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok:false, error:"플레이어를 찾을 수 없습니다." });

    const user = rows[0];
    const holdings = user.holdings || {};
    const stockIds = Object.keys(holdings);
    let stocks = [];

    if (stockIds.length) {
      const result = await pool.query(`SELECT id,name,price FROM stocks WHERE id=ANY($1::text[]) ORDER BY id ASC`, [stockIds]);
      stocks = result.rows.map(s => {
        const quantity = Number(holdings[s.id] || 0);
        const price = Number(s.price);
        return { id:s.id,name:s.name,quantity,price,value:quantity*price };
      });
    }

    const bank = await pool.query(`
      SELECT bt.id,bt.sender_id,bt.receiver_id,bt.amount,bt.memo,bt.type,bt.created_at,
             su.nickname AS sender_nickname,ru.nickname AS receiver_nickname
      FROM bank_transactions bt
      LEFT JOIN users su ON su.id=bt.sender_id
      LEFT JOIN users ru ON ru.id=bt.receiver_id
      WHERE bt.sender_id=$1 OR bt.receiver_id=$1
      ORDER BY bt.created_at DESC LIMIT 100
    `, [req.params.id]);

    const stockValue = stocks.reduce((sum,s)=>sum+s.value,0);
    res.json({ ok:true, user:{
      id:user.id, playerNumber:Number(user.player_number), username:user.username, nickname:user.nickname,
      cash:Number(user.cash), stockValue, totalAssets:Number(user.cash)+stockValue, holdings:stocks,
      transactions:user.transactions||[],
      bankTransactions:bank.rows.map(b=>({ id:Number(b.id),senderId:b.sender_id,receiverId:b.receiver_id,senderNickname:b.sender_nickname,receiverNickname:b.receiver_nickname,amount:Number(b.amount),memo:b.memo||"",type:b.type,createdAt:Number(b.created_at) })),
      bannedUntil:user.banned_until===null?null:Number(user.banned_until), banReason:user.ban_reason||"", createdAt:Number(user.created_at)
    }});
  } catch (error) {
    console.error("ADMIN USER DETAIL ERROR:", error);
    res.status(500).json({ ok:false, error:"플레이어 상세정보를 불러오지 못했습니다." });
  }
});

module.exports = router;
