const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const STARTING_CASH = 10000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

const companies = [
    ["SKNX", "스카닉스하이닉스", 4250, 0.08],
    ["SAMS", "샘숭전자", 7100, 0.05],
    ["TWAI", "티Wai", 1850, 0.10],
    ["NVR", "나이버", 3500, 0.07],
    ["NFLX", "니플릭스", 5200, 0.09],
    ["PASC", "파스코", 2800, 0.06],
    ["LG", "알쥐", 6400, 0.05],
    ["HYUN", "현재자동차", 8300, 0.06],
    ["NVDO", "N비디오", 9700, 0.12],
    ["MHD", "마이크로하드", 7600, 0.07]
];

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// 공통
// =====================================================

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createToken() {
    return crypto.randomBytes(32).toString("hex");
}

function safeUser(user) {
    return {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        cash: Number(user.cash),
        holdings: user.holdings || {}
    };
}

// =====================================================
// DB 초기화
// =====================================================

async function initializeDatabase() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                nickname TEXT UNIQUE NOT NULL,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                cash NUMERIC NOT NULL DEFAULT 10000,
                holdings JSONB NOT NULL DEFAULT '{}'::jsonb,
                transactions JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at BIGINT NOT NULL
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at BIGINT NOT NULL
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS stocks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                volatility NUMERIC NOT NULL,
                price NUMERIC NOT NULL,
                previous NUMERIC NOT NULL,
                open_price NUMERIC NOT NULL,
                high NUMERIC NOT NULL,
                low NUMERIC NOT NULL,
                volume BIGINT NOT NULL DEFAULT 0
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS price_history (
                id BIGSERIAL PRIMARY KEY,
                stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
                time BIGINT NOT NULL,
                price NUMERIC NOT NULL
            )
        `);

        // 관리자 주가 제어
        await client.query(`
            CREATE TABLE IF NOT EXISTS market_controls (
                stock_id TEXT PRIMARY KEY REFERENCES stocks(id) ON DELETE CASCADE,
                direction TEXT NOT NULL DEFAULT 'normal',
                until_time BIGINT NOT NULL DEFAULT 0,
                strength NUMERIC NOT NULL DEFAULT 1
            )
        `);

        for (const [id, name, price, volatility] of companies) {
            const result = await client.query(
                `SELECT * FROM stocks WHERE id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                await client.query(`
                    INSERT INTO stocks
                    (id,name,volatility,price,previous,open_price,high,low,volume)
                    VALUES ($1,$2,$3,$4,$4,$4,$4,$4,0)
                `, [id, name, volatility, price]);

                await client.query(`
                    INSERT INTO price_history
                    (stock_id,time,price)
                    VALUES ($1,$2,$3)
                `, [id, Date.now(), price]);
            } else {
                await client.query(`
                    UPDATE stocks
                    SET name=$1, volatility=$2
                    WHERE id=$3
                `, [name, volatility, id]);
            }
        }

        await client.query("COMMIT");
        console.log("✅ PostgreSQL 초기화 완료.");

    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        throw err;
    } finally {
        client.release();
    }
}

// =====================================================
// 일반 사용자 인증
// =====================================================

async function auth(req, res, next) {
    try {
        const header = req.headers.authorization || "";
        const token = header.replace("Bearer ", "");

        if (!token) {
            return res.status(401).json({
                error: "로그인이 필요합니다."
            });
        }

        const result = await pool.query(`
            SELECT
                u.id,
                u.username,
                u.nickname,
                u.cash,
                u.holdings,
                u.transactions
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = $1
        `, [token]);

        if (!result.rows.length) {
            return res.status(401).json({
                error: "로그인이 필요합니다."
            });
        }

        req.user = result.rows[0];
        req.token = token;
        next();

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "인증 오류"
        });
    }
}

// =====================================================
// 관리자 인증
// =====================================================

function adminAuth(req, res, next) {
    const password = req.headers["x-admin-password"];

    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            error: "관리자 인증이 필요합니다."
        });
    }

    next();
}

// =====================================================
// 회원가입
// =====================================================

app.post("/api/register", async (req, res) => {
    try {
        const { username, password, nickname } = req.body;

        if (!username || !password || !nickname) {
            return res.status(400).json({
                error: "아이디, 비밀번호, 닉네임을 모두 입력하세요."
            });
        }

        if (String(username).length < 3) {
            return res.status(400).json({
                error: "아이디는 3자 이상이어야 합니다."
            });
        }

        if (String(password).length < 4) {
            return res.status(400).json({
                error: "비밀번호는 4자 이상이어야 합니다."
            });
        }

        const duplicate = await pool.query(`
            SELECT id
            FROM users
            WHERE LOWER(username)=LOWER($1)
               OR nickname=$2
        `, [username, nickname]);

        if (duplicate.rows.length) {
            return res.status(409).json({
                error: "이미 사용 중인 아이디 또는 닉네임입니다."
            });
        }

        const id = crypto.randomUUID();
        const salt = crypto.randomBytes(16).toString("hex");
        const passwordHash = hashPassword(password, salt);
        const token = createToken();

        await pool.query(`
            INSERT INTO users
            (id,username,nickname,salt,password_hash,cash,holdings,transactions,created_at)
            VALUES
            ($1,$2,$3,$4,$5,$6,'{}'::jsonb,'[]'::jsonb,$7)
        `, [
            id,
            username,
            nickname,
            salt,
            passwordHash,
            STARTING_CASH,
            Date.now()
        ]);

        await pool.query(`
            INSERT INTO sessions(token,user_id,created_at)
            VALUES($1,$2,$3)
        `, [token, id, Date.now()]);

        const result = await pool.query(`
            SELECT id,username,nickname,cash,holdings
            FROM users WHERE id=$1
        `, [id]);

        res.json({
            token,
            user: safeUser(result.rows[0])
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "회원가입 오류"
        });
    }
});

// =====================================================
// 로그인
// =====================================================

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const result = await pool.query(`
            SELECT *
            FROM users
            WHERE LOWER(username)=LOWER($1)
        `, [String(username || "")]);

        if (!result.rows.length) {
            return res.status(401).json({
                error: "아이디 또는 비밀번호가 올바르지 않습니다."
            });
        }

        const user = result.rows[0];
        const hash = hashPassword(password, user.salt);

        if (hash !== user.password_hash) {
            return res.status(401).json({
                error: "아이디 또는 비밀번호가 올바르지 않습니다."
            });
        }

        const token = createToken();

        await pool.query(`
            INSERT INTO sessions(token,user_id,created_at)
            VALUES($1,$2,$3)
        `, [token, user.id, Date.now()]);

        res.json({
            token,
            user: safeUser(user)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "로그인 오류"
        });
    }
});

// =====================================================
// 내 정보
// =====================================================

app.get("/api/me", auth, async (req, res) => {
    res.json({
        user: safeUser(req.user)
    });
});

// =====================================================
// 로그아웃
// =====================================================

app.post("/api/logout", auth, async (req, res) => {
    await pool.query(
        `DELETE FROM sessions WHERE token=$1`,
        [req.token]
    );

    res.json({ ok: true });
});

// =====================================================
// 시장 정보
// =====================================================

app.get("/api/market", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT *
            FROM stocks
            ORDER BY id
        `);

        const stocks = {};

        for (const s of result.rows) {
            stocks[s.id] = {
                price: Number(s.price),
                previous: Number(s.previous),
                open: Number(s.open_price),
                high: Number(s.high),
                low: Number(s.low),
                volume: Number(s.volume)
            };
        }

        res.json({
            companies: result.rows.map(s => ({
                id: s.id,
                name: s.name,
                price: Number(s.price),
                volatility: Number(s.volatility)
            })),
            stocks,
            serverTime: Date.now()
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "시장 정보를 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 차트
// =====================================================

app.get("/api/history/:id", async (req, res) => {
    try {
        const ranges = {
            "1d": 86400000,
            "1w": 604800000,
            "1m": 2592000000,
            "3m": 7776000000,
            "all": Infinity
        };

        const range = ranges[req.query.range || "1d"];
        const minTime =
            range === Infinity ? 0 : Date.now() - range;

        const result = await pool.query(`
            SELECT time AS t, price AS p
            FROM price_history
            WHERE stock_id=$1 AND time >= $2
            ORDER BY time ASC
            LIMIT 1000
        `, [req.params.id, minTime]);

        res.json({
            points: result.rows.map(row => ({
                t: Number(row.t),
                p: Number(row.p)
            }))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "차트 오류"
        });
    }
});

// =====================================================
// 매수 / 매도
// =====================================================

app.post("/api/trade", auth, async (req, res) => {
    const client = await pool.connect();

    try {
        const { id, side, qty } = req.body;
        const amount = Number(qty);

        if (!["buy", "sell"].includes(side)) {
            return res.status(400).json({
                error: "잘못된 거래입니다."
            });
        }

        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({
                error: "수량을 확인하세요."
            });
        }

        await client.query("BEGIN");

        const stockResult = await client.query(`
            SELECT *
            FROM stocks
            WHERE id=$1
            FOR UPDATE
        `, [id]);

        if (!stockResult.rows.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "존재하지 않는 종목입니다."
            });
        }

        const userResult = await client.query(`
            SELECT *
            FROM users
            WHERE id=$1
            FOR UPDATE
        `, [req.user.id]);

        const user = userResult.rows[0];
        const stock = stockResult.rows[0];

        const holdings = user.holdings || {};

        const holding = holdings[id] || {
            qty: 0,
            avg: 0
        };

        const price = Number(stock.price);
        const total = price * amount;

        if (side === "buy") {
            if (Number(user.cash) < total) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    error: "현금이 부족합니다."
                });
            }

            const oldQty = Number(holding.qty);
            const newQty = oldQty + amount;

            holding.avg =
                ((oldQty * Number(holding.avg)) + total)
                / newQty;

            holding.qty = newQty;
            user.cash = Number(user.cash) - total;
        }

        if (side === "sell") {
            if (Number(holding.qty) < amount) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    error: "보유 주식이 부족합니다."
                });
            }

            holding.qty = Number(holding.qty) - amount;
            user.cash = Number(user.cash) + total;

            if (holding.qty === 0) {
                holding.avg = 0;
            }
        }

        holdings[id] = holding;

        const transactions = user.transactions || [];

        transactions.unshift({
            companyId: id,
            side,
            qty: amount,
            price,
            total,
            time: Date.now()
        });

        transactions.splice(1000);

        await client.query(`
            UPDATE users
            SET cash=$1, holdings=$2::jsonb, transactions=$3::jsonb
            WHERE id=$4
        `, [
            user.cash,
            JSON.stringify(holdings),
            JSON.stringify(transactions),
            user.id
        ]);

        // 실제 플레이어 거래량만 증가
        await client.query(`
            UPDATE stocks
            SET volume=volume+$1
            WHERE id=$2
        `, [amount, id]);

        await client.query("COMMIT");

        const updated = await pool.query(`
            SELECT id,username,nickname,cash,holdings
            FROM users WHERE id=$1
        `, [user.id]);

        res.json({
            ok: true,
            user: safeUser(updated.rows[0])
        });

    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {}

        console.error(err);

        res.status(500).json({
            error: "거래 처리 중 오류가 발생했습니다."
        });

    } finally {
        client.release();
    }
});

// =====================================================
// 포트폴리오
// =====================================================

app.get("/api/portfolio", auth, async (req, res) => {
    try {
        const stocks = await pool.query(`
            SELECT id,price FROM stocks
        `);

        const prices = {};

        for (const s of stocks.rows) {
            prices[s.id] = Number(s.price);
        }

        const holdings = req.user.holdings || {};

        let stockValue = 0;
        const positions = [];

        for (const [id, h] of Object.entries(holdings)) {
            const qty = Number(h.qty);

            if (!prices[id] || qty <= 0) continue;

            const avg = Number(h.avg);
            const price = prices[id];
            const value = qty * price;
            const pnl = value - qty * avg;

            stockValue += value;

            positions.push({
                id,
                qty,
                avg,
                price,
                value,
                pnl,
                pnlPct: avg ? ((price - avg) / avg) * 100 : 0
            });
        }

        const cash = Number(req.user.cash);
        const total = cash + stockValue;

        res.json({
            cash,
            stockValue,
            total,
            totalPnl: total - STARTING_CASH,
            totalPnlPct: ((total / STARTING_CASH) - 1) * 100,
            positions
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "포트폴리오 오류"
        });
    }
});

// =====================================================
// 거래내역
// =====================================================

app.get("/api/transactions", auth, async (req, res) => {
    res.json({
        transactions: (req.user.transactions || []).slice(0, 100)
    });
});

// =====================================================
// 랭킹
// =====================================================

app.get("/api/rankings", async (req, res) => {
    try {
        const users = await pool.query(`
            SELECT nickname,cash,holdings FROM users
        `);

        const stocks = await pool.query(`
            SELECT id,price FROM stocks
        `);

        const prices = {};

        for (const s of stocks.rows) {
            prices[s.id] = Number(s.price);
        }

        const rankings = users.rows.map(user => {
            let stockValue = 0;

            for (const [id, h] of Object.entries(user.holdings || {})) {
                if (prices[id]) {
                    stockValue += prices[id] * Number(h.qty);
                }
            }

            return {
                nickname: user.nickname,
                total: Number(user.cash) + stockValue
            };
        }).sort((a, b) => b.total - a.total);

        res.json({ rankings });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "랭킹 오류"
        });
    }
});

// =====================================================
// 관리자 - 플레이어 목록
// =====================================================

app.get("/api/admin/users", adminAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                username,
                nickname,
                cash,
                holdings,
                transactions,
                created_at
            FROM users
            ORDER BY created_at DESC
        `);

        res.json({
            users: result.rows.map(u => ({
                id: u.id,
                username: u.username,
                nickname: u.nickname,
                cash: Number(u.cash),
                holdings: u.holdings || {},
                transactions: u.transactions || [],
                createdAt: Number(u.created_at)
            }))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "플레이어 정보를 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 관리자 - 플레이어 수정
// =====================================================

app.patch("/api/admin/users/:id", adminAuth, async (req, res) => {
    try {
        const { nickname, cash, password } = req.body;

        const result = await pool.query(`
            SELECT * FROM users WHERE id=$1
        `, [req.params.id]);

        if (!result.rows.length) {
            return res.status(404).json({
                error: "플레이어를 찾을 수 없습니다."
            });
        }

        const user = result.rows[0];

        let newSalt = user.salt;
        let newHash = user.password_hash;

        if (password !== undefined && password !== "") {
            newSalt = crypto.randomBytes(16).toString("hex");
            newHash = hashPassword(password, newSalt);
        }

        await pool.query(`
            UPDATE users
            SET
                nickname=$1,
                cash=$2,
                salt=$3,
                password_hash=$4
            WHERE id=$5
        `, [
            nickname ?? user.nickname,
            cash !== undefined ? Number(cash) : Number(user.cash),
            newSalt,
            newHash,
            user.id
        ]);

        res.json({
            ok: true
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "플레이어 수정 오류"
        });
    }
});

// =====================================================
// 관리자 - 플레이어 정보 초기화
// =====================================================

app.post("/api/admin/users/:id/reset", adminAuth, async (req, res) => {
    try {
        const {
            cash,
            holdings,
            transactions,
            sessions
        } = req.body;

        if (cash) {
            await pool.query(`
                UPDATE users
                SET cash=$1
                WHERE id=$2
            `, [STARTING_CASH, req.params.id]);
        }

        if (holdings) {
            await pool.query(`
                UPDATE users
                SET holdings='{}'::jsonb
                WHERE id=$1
            `, [req.params.id]);
        }

        if (transactions) {
            await pool.query(`
                UPDATE users
                SET transactions='[]'::jsonb
                WHERE id=$1
            `, [req.params.id]);
        }

        if (sessions) {
            await pool.query(`
                DELETE FROM sessions
                WHERE user_id=$1
            `, [req.params.id]);
        }

        res.json({
            ok: true
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "플레이어 초기화 오류"
        });
    }
});

// =====================================================
// 관리자 - 주식 목록
// =====================================================

app.get("/api/admin/stocks", adminAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                s.*,
                COALESCE(m.direction,'normal') AS direction,
                COALESCE(m.until_time,0) AS until_time
            FROM stocks s
            LEFT JOIN market_controls m
                ON s.id=m.stock_id
            ORDER BY s.id
        `);

        res.json({
            stocks: result.rows.map(s => ({
                id: s.id,
                name: s.name,
                price: Number(s.price),
                previous: Number(s.previous),
                high: Number(s.high),
                low: Number(s.low),
                volume: Number(s.volume),
                direction: s.direction,
                until: Number(s.until_time)
            }))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "주식 정보를 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 관리자 - 현재 주가 직접 변경
// =====================================================

app.patch("/api/admin/stocks/:id", adminAuth, async (req, res) => {
    try {
        const price = Number(req.body.price);

        if (!Number.isFinite(price) || price < 100) {
            return res.status(400).json({
                error: "가격이 올바르지 않습니다."
            });
        }

        await pool.query(`
            UPDATE stocks
            SET
                previous=price,
                price=$1,
                high=GREATEST(high,$1),
                low=LEAST(low,$1)
            WHERE id=$2
        `, [Math.round(price), req.params.id]);

        await pool.query(`
            INSERT INTO price_history(stock_id,time,price)
            VALUES($1,$2,$3)
        `, [req.params.id, Date.now(), Math.round(price)]);

        res.json({
            ok: true
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "주가 수정 오류"
        });
    }
});

// =====================================================
// 관리자 - UP / DOWN / 정상
// =====================================================

app.post("/api/admin/stocks/:id/control", adminAuth, async (req, res) => {
    try {
        const direction = req.body.direction;
        const duration = Number(req.body.duration);

        if (!["up", "down", "normal"].includes(direction)) {
            return res.status(400).json({
                error: "방향이 올바르지 않습니다."
            });
        }

        const until =
            direction === "normal"
                ? 0
                : Date.now() + Math.max(1, duration) * 1000;

        await pool.query(`
            INSERT INTO market_controls
            (stock_id,direction,until_time,strength)
            VALUES($1,$2,$3,1)
            ON CONFLICT(stock_id)
            DO UPDATE SET
                direction=EXCLUDED.direction,
                until_time=EXCLUDED.until_time
        `, [
            req.params.id,
            direction,
            until
        ]);

        res.json({
            ok: true,
            direction,
            until
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "주가 제어 오류"
        });
    }
});

// =====================================================
// 관리자 - 선택형 전체 초기화
// 거래량은 기본적으로 건드리지 않음
// =====================================================

app.post("/api/admin/reset", adminAuth, async (req, res) => {
    const client = await pool.connect();

    try {
        const {
            prices,
            playerCash,
            playerHoldings,
            transactions,
            sessions
        } = req.body;

        await client.query("BEGIN");

        if (prices) {
            for (const [id, , startingPrice] of companies) {
                await client.query(`
                    UPDATE stocks
                    SET
                        price=$1,
                        previous=$1,
                        open_price=$1,
                        high=$1,
                        low=$1
                    WHERE id=$2
                `, [startingPrice, id]);

                await client.query(`
                    INSERT INTO price_history
                    (stock_id,time,price)
                    VALUES($1,$2,$3)
                `, [id, Date.now(), startingPrice]);
            }
        }

        if (playerCash) {
            await client.query(`
                UPDATE users
                SET cash=$1
            `, [STARTING_CASH]);
        }

        if (playerHoldings) {
            await client.query(`
                UPDATE users
                SET holdings='{}'::jsonb
            `);
        }

        if (transactions) {
            await client.query(`
                UPDATE users
                SET transactions='[]'::jsonb
            `);
        }

        if (sessions) {
            await client.query(`
                DELETE FROM sessions
            `);
        }

        await client.query("COMMIT");

        res.json({
            ok: true,
            message: "선택한 항목을 초기화했습니다."
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);

        res.status(500).json({
            error: "초기화 오류"
        });

    } finally {
        client.release();
    }
});

// =====================================================
// 주가 자동 변동
// =====================================================

async function updateStocks() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const [id, , startingPrice] of companies) {
            const result = await client.query(`
                SELECT
                    s.*,
                    COALESCE(m.direction,'normal') AS direction,
                    COALESCE(m.until_time,0) AS until_time
                FROM stocks s
                LEFT JOIN market_controls m
                    ON s.id=m.stock_id
                WHERE s.id=$1
                FOR UPDATE
            `, [id]);

            if (!result.rows.length) continue;

            const stock = result.rows[0];

            let current = Number(stock.price);

            if (!Number.isFinite(current) || current <= 0) {
                current = startingPrice;
            }

            let direction = stock.direction;
            const until = Number(stock.until_time);

            // 지속시간 종료
            if (direction !== "normal" && Date.now() >= until) {
                direction = "normal";

                await client.query(`
                    UPDATE market_controls
                    SET direction='normal', until_time=0
                    WHERE stock_id=$1
                `, [id]);
            }

            // 기본 변동
            const base =
                Math.floor(Math.random() * 2501) + 500;

            let change;

            if (direction === "up") {
                // 상승을 기본 방향으로 하지만 중간에 하락 가능
                change =
                    Math.random() < 0.25
                        ? -Math.floor(base * 0.6)
                        : base;

            } else if (direction === "down") {
                // 하락을 기본 방향으로 하지만 중간에 상승 가능
                change =
                    Math.random() < 0.25
                        ? Math.floor(base * 0.6)
                        : -base;

            } else {
                change =
                    Math.random() < 0.5
                        ? -base
                        : base;
            }

            let next = current + change;

            next = Math.round(next / 100) * 100;

            next = Math.max(1000, next);
            next = Math.min(1000000, next);

            const high = Math.max(
                Number(stock.high),
                next
            );

            const low = Math.min(
                Number(stock.low),
                next
            );

            await client.query(`
                UPDATE stocks
                SET
                    previous=$1,
                    price=$2,
                    high=$3,
                    low=$4
                WHERE id=$5
            `, [
                current,
                next,
                high,
                low,
                id
            ]);

            await client.query(`
                INSERT INTO price_history
                (stock_id,time,price)
                VALUES($1,$2,$3)
            `, [
                id,
                Date.now(),
                next
            ]);
        }

        // 30일 이상 된 차트 기록 삭제
        await client.query(`
            DELETE FROM price_history
            WHERE time < $1
        `, [Date.now() - 2592000000]);

        await client.query("COMMIT");

    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {}

        console.error("주가 업데이트 오류:", err);

    } finally {
        client.release();
    }
}

// =====================================================
// 관리자 페이지
// =====================================================

app.get("/admin", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VSM 관리자 패널</title>

<style>
*{box-sizing:border-box}
body{
    margin:0;
    font-family:Arial,sans-serif;
    background:#10131a;
    color:#fff;
}
header{
    padding:20px;
    background:#171b25;
    border-bottom:1px solid #292f3c;
}
h1{margin:0 0 5px}
.container{
    max-width:1400px;
    margin:auto;
    padding:20px;
}
.card{
    background:#171b25;
    border:1px solid #292f3c;
    border-radius:14px;
    padding:18px;
    margin-bottom:20px;
}
input,select{
    background:#0e1117;
    color:#fff;
    border:1px solid #343b49;
    border-radius:8px;
    padding:10px;
}
button{
    border:0;
    border-radius:8px;
    padding:10px 14px;
    cursor:pointer;
    font-weight:bold;
}
.btn{background:#3b82f6;color:white}
.up{background:#16a34a;color:white}
.down{background:#dc2626;color:white}
.gray{background:#4b5563;color:white}
.reset{background:#7c3aed;color:white}
table{
    width:100%;
    border-collapse:collapse;
}
th,td{
    padding:10px;
    border-bottom:1px solid #292f3c;
    text-align:left;
}
th{color:#9ca3af}
.stock{
    background:#0e1117;
    padding:15px;
    border-radius:12px;
    margin-bottom:12px;
}
.row{
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    align-items:center;
}
.price{
    font-size:22px;
    font-weight:bold;
}
.modal{
    display:none;
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.75);
    align-items:center;
    justify-content:center;
    z-index:100;
}
.modalBox{
    background:#171b25;
    padding:25px;
    border-radius:15px;
    width:min(500px,90%);
}
label{
    display:block;
    margin:12px 0;
}
</style>
</head>

<body>

<header>
<h1>📊 VSM 관리자 패널</h1>
<div>Virtual Stock Market V5</div>
</header>

<div class="container">

<div class="card" id="loginBox">
<h2>🔐 관리자 로그인</h2>
<div class="row">
<input id="adminPassword" type="password" placeholder="관리자 비밀번호">
<button class="btn" onclick="login()">로그인</button>
</div>
<p id="loginMsg"></p>
</div>

<div id="panel" style="display:none">

<div class="card">
<h2>👥 플레이어 관리</h2>

<div class="row">
<input id="search" placeholder="아이디 또는 닉네임 검색"
       oninput="renderUsers()">
<button class="btn" onclick="loadUsers()">새로고침</button>
</div>

<br>

<div id="users"></div>
</div>

<div class="card">
<h2>📈 주식 관리</h2>
<div id="stocks"></div>
</div>

<div class="card">
<h2>♻️ 초기화</h2>
<p>
원하는 항목만 선택해서 초기화할 수 있습니다.
<br>
<strong>거래량은 초기화하지 않습니다.</strong>
</p>

<button class="reset" onclick="openReset()">
초기화 메뉴 열기
</button>
</div>

</div>
</div>

<div class="modal" id="resetModal">
<div class="modalBox">

<h2>♻️ 초기화 항목 선택</h2>

<label>
<input type="checkbox" id="resetPrices">
주가
</label>

<label>
<input type="checkbox" id="resetCash">
플레이어 현금
</label>

<label>
<input type="checkbox" id="resetHoldings">
플레이어 보유 주식
</label>

<label>
<input type="checkbox" id="resetTransactions">
거래내역
</label>

<label>
<input type="checkbox" id="resetSessions">
로그인 세션
</label>

<hr>

<p>⚠️ 거래량은 여기서 초기화하지 않습니다.</p>

<div class="row">
<button class="gray" onclick="closeReset()">취소</button>
<button class="reset" onclick="doReset()">선택 항목 초기화</button>
</div>

</div>
</div>

<script>

let adminPassword="";
let users=[];
let stocks=[];

function login(){

    adminPassword =
        document.getElementById("adminPassword").value;

    fetch("/api/admin/stocks",{
        headers:{
            "x-admin-password":adminPassword
        }
    })
    .then(r=>{
        if(!r.ok) throw new Error();
        return r.json();
    })
    .then(()=>{
        document.getElementById("loginBox").style.display="none";
        document.getElementById("panel").style.display="block";
        loadUsers();
        loadStocks();
    })
    .catch(()=>{
        document.getElementById("loginMsg").innerText=
            "❌ 관리자 비밀번호가 틀렸습니다.";
    });
}

function headers(){
    return {
        "Content-Type":"application/json",
        "x-admin-password":adminPassword
    };
}

function loadUsers(){

    fetch("/api/admin/users",{headers:headers()})
    .then(r=>r.json())
    .then(data=>{
        users=data.users;
        renderUsers();
    });
}

function renderUsers(){

    const q =
        document.getElementById("search").value.toLowerCase();

    const list=users.filter(u=>
        u.username.toLowerCase().includes(q) ||
        u.nickname.toLowerCase().includes(q)
    );

    document.getElementById("users").innerHTML =
        list.map(u=>`

<div class="stock">

<h3>${escapeHtml(u.nickname)}</h3>

<div>
아이디:
<strong>${escapeHtml(u.username)}</strong>
</div>

<div>
보유 현금:
<strong>${Number(u.cash).toLocaleString()}원</strong>
</div>

<br>

<div class="row">

<input
 id="nick_${u.id}"
 value="${escapeAttr(u.nickname)}"
 placeholder="닉네임">

<input
 id="cash_${u.id}"
 type="number"
 value="${Number(u.cash)}"
 placeholder="현금">

<input
 id="pass_${u.id}"
 type="password"
 placeholder="새 비밀번호">

<button class="btn"
 onclick="saveUser('${u.id}')">
저장
</button>

</div>

<br>

<div>
보유 주식:
${Object.entries(u.holdings||{}).map(([id,h])=>
    id+" "+Number(h.qty)+"주"
).join(", ") || "없음"}
</div>

<br>

<div class="row">
<button class="reset"
 onclick="resetUser('${u.id}','holdings')">
주식 초기화
</button>

<button class="reset"
 onclick="resetUser('${u.id}','cash')">
현금 초기화
</button>

<button class="reset"
 onclick="resetUser('${u.id}','transactions')">
거래내역 초기화
</button>
</div>

</div>

`).join("") || "<p>검색 결과가 없습니다.</p>";
}

function saveUser(id){

    const nickname =
        document.getElementById("nick_"+id).value;

    const cash =
        Number(document.getElementById("cash_"+id).value);

    const password =
        document.getElementById("pass_"+id).value;

    fetch("/api/admin/users/"+id,{
        method:"PATCH",
        headers:headers(),
        body:JSON.stringify({
            nickname,
            cash,
            password
        })
    })
    .then(r=>r.json())
    .then(data=>{
        alert(data.error || "저장되었습니다.");
        loadUsers();
    });
}

function resetUser(id,type){

    if(!confirm("정말 초기화할까요?")) return;

    const body={};

    if(type==="holdings") body.holdings=true;
    if(type==="cash") body.cash=true;
    if(type==="transactions") body.transactions=true;

    fetch("/api/admin/users/"+id+"/reset",{
        method:"POST",
        headers:headers(),
        body:JSON.stringify(body)
    })
    .then(r=>r.json())
    .then(()=>{
        loadUsers();
        alert("초기화 완료");
    });
}

function loadStocks(){

    fetch("/api/admin/stocks",{headers:headers()})
    .then(r=>r.json())
    .then(data=>{
        stocks=data.stocks;
        renderStocks();
    });
}

function renderStocks(){

    document.getElementById("stocks").innerHTML =
        stocks.map(s=>`

<div class="stock">

<h3>${escapeHtml(s.name)} (${s.id})</h3>

<div class="price">
${Number(s.price).toLocaleString()}원
</div>

<p>
거래량:
<strong>${Number(s.volume).toLocaleString()}</strong>
</p>

<div class="row">

<input
 id="price_${s.id}"
 type="number"
 value="${Number(s.price)}"
>

<button class="btn"
 onclick="setPrice('${s.id}')">
주가 설정
</button>

</div>

<br>

<div class="row">

<input
 id="duration_${s.id}"
 type="number"
 value="30"
 min="1"
 placeholder="지속시간(초)"
>

<button class="up"
 onclick="control('${s.id}','up')">
⬆ UP
</button>

<button class="down"
 onclick="control('${s.id}','down')">
⬇ DOWN
</button>

<button class="gray"
 onclick="control('${s.id}','normal')">
정상화
</button>

</div>

<p>
현재 상태:
<strong>
${s.direction==="normal" ? "일반" :
  s.direction==="up" ? "⬆ UP" : "⬇ DOWN"}
</strong>
</p>

</div>

`).join("");
}

function setPrice(id){

    const price =
        Number(document.getElementById("price_"+id).value);

    fetch("/api/admin/stocks/"+id,{
        method:"PATCH",
        headers:headers(),
        body:JSON.stringify({price})
    })
    .then(r=>r.json())
    .then(data=>{
        alert(data.error || "주가 변경 완료");
        loadStocks();
    });
}

function control(id,direction){

    let duration=0;

    if(direction!=="normal"){
        duration =
            Number(document.getElementById("duration_"+id).value);

        if(duration<=0){
            alert("지속시간을 입력하세요.");
            return;
        }
    }

    fetch("/api/admin/stocks/"+id+"/control",{
        method:"POST",
        headers:headers(),
        body:JSON.stringify({
            direction,
            duration
        })
    })
    .then(r=>r.json())
    .then(data=>{
        alert(data.error || "설정 완료");
        loadStocks();
    });
}

function openReset(){
    document.getElementById("resetModal").style.display="flex";
}

function closeReset(){
    document.getElementById("resetModal").style.display="none";
}

function doReset(){

    if(!confirm(
        "선택한 항목을 정말 초기화할까요?"
    )) return;

    fetch("/api/admin/reset",{
        method:"POST",
        headers:headers(),
        body:JSON.stringify({

            prices:
                document.getElementById("resetPrices").checked,

            playerCash:
                document.getElementById("resetCash").checked,

            playerHoldings:
                document.getElementById("resetHoldings").checked,

            transactions:
                document.getElementById("resetTransactions").checked,

            sessions:
                document.getElementById("resetSessions").checked
        })
    })
    .then(r=>r.json())
    .then(data=>{
        alert(data.error || "초기화 완료");
        closeReset();
        loadUsers();
        loadStocks();
    });
}

function escapeHtml(str){
    return String(str)
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;");
}

function escapeAttr(str){
    return escapeHtml(str);
}

</script>

</body>
</html>
    `);
});

// =====================================================
// 홈페이지
// =====================================================

app.use((req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

// =====================================================
// 서버 시작
// =====================================================

async function startServer() {
    try {

        await initializeDatabase();

        app.listen(PORT, "0.0.0.0", () => {

            console.log("");
            console.log("========================================");
            console.log(" VSM Virtual Stock Market V5");
            console.log("========================================");
            console.log("시작금: 10,000원");
            console.log("주가 업데이트: 3초");
            console.log("PostgreSQL: 연결됨");
            console.log("서버 포트: " + PORT);
            console.log("관리자: /admin");
            console.log("========================================");
            console.log("");

        });

        setInterval(updateStocks, 3000);

    } catch (err) {
        console.error("서버 시작 실패:", err);
        process.exit(1);
    }
}

startServer();
