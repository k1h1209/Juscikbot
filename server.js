const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const STARTING_CASH = 10000;

// ========================================
// 관리자 설정
// ========================================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error("❌ ADMIN_PASSWORD 환경변수가 없습니다.");
    console.error("예: ADMIN_PASSWORD=yourpassword npm start");
    process.exit(1);
}

// 관리자 세션
const adminSessions = new Map();

// 관리자 주가 제어
const stockControls = {};


// ========================================
// 회사 설정
// ========================================

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


// ========================================
// PostgreSQL
// ========================================

if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL이 없습니다.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    }
});


// ========================================
// 기본값
// ========================================

for (const company of companies) {

    stockControls[company[0]] = {
        mode: "random",
        step: 0,
        target: null
    };

}


// ========================================
// DB 초기화
// ========================================

async function initializeDatabase() {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        // ====================================
        // 사용자
        // ====================================

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


        // ====================================
        // 로그인 세션
        // ====================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,
                created_at BIGINT NOT NULL
            )
        `);


        // ====================================
        // 주식
        // ====================================

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


        // ====================================
        // 주가 기록
        // ====================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS price_history (
                id BIGSERIAL PRIMARY KEY,
                stock_id TEXT NOT NULL
                    REFERENCES stocks(id)
                    ON DELETE CASCADE,
                time BIGINT NOT NULL,
                price NUMERIC NOT NULL
            )
        `);


        // ====================================
        // 주식 생성 / 복구
        // ====================================

        for (const company of companies) {

            const [
                id,
                name,
                startingPrice,
                volatility
            ] = company;

            const result = await client.query(
                `
                SELECT *
                FROM stocks
                WHERE id = $1
                `,
                [id]
            );


            // ==================================
            // 주식 없음
            // ==================================

            if (result.rows.length === 0) {

                await client.query(
                    `
                    INSERT INTO stocks
                    (
                        id,
                        name,
                        volatility,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $4,
                        $4,
                        $4,
                        $4,
                        0
                    )
                    `,
                    [
                        id,
                        name,
                        volatility,
                        startingPrice
                    ]
                );

                await client.query(
                    `
                    INSERT INTO price_history
                    (
                        stock_id,
                        time,
                        price
                    )
                    VALUES
                    ($1,$2,$3)
                    `,
                    [
                        id,
                        Date.now(),
                        startingPrice
                    ]
                );

                console.log(
                    `주식 생성: ${id} = ${startingPrice}원`
                );

            }

            // ==================================
            // 기존 주식 검사
            // ==================================

            else {

                const stock = result.rows[0];

                const values = [
                    stock.price,
                    stock.previous,
                    stock.open_price,
                    stock.high,
                    stock.low
                ].map(Number);

                const invalid =
                    values.some(
                        value =>
                            !Number.isFinite(value)
                    );

                if (invalid) {

                    console.log(
                        `⚠️ ${id} 데이터 손상 → 복구`
                    );

                    await client.query(
                        `
                        UPDATE stocks
                        SET
                            name = $1,
                            volatility = $2,
                            price = $3,
                            previous = $3,
                            open_price = $3,
                            high = $3,
                            low = $3
                        WHERE id = $4
                        `,
                        [
                            name,
                            volatility,
                            startingPrice,
                            id
                        ]
                    );

                    await client.query(
                        `
                        INSERT INTO price_history
                        (
                            stock_id,
                            time,
                            price
                        )
                        VALUES
                        ($1,$2,$3)
                        `,
                        [
                            id,
                            Date.now(),
                            startingPrice
                        ]
                    );

                }

            }

        }

        await client.query("COMMIT");

        console.log("✅ PostgreSQL 초기화 완료.");

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(
            "❌ 데이터베이스 초기화 실패:",
            error
        );

        throw error;

    } finally {

        client.release();

    }

}


// ========================================
// 비밀번호 암호화
// ========================================

function hashPassword(password, salt) {

    return crypto
        .scryptSync(
            String(password),
            salt,
            64
        )
        .toString("hex");

}


// ========================================
// 토큰
// ========================================

function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");

}


// ========================================
// 안전한 사용자 정보
// ========================================

function safeUser(user) {

    return {

        id: user.id,

        username: user.username,

        nickname: user.nickname,

        cash: Number(user.cash),

        holdings:
            user.holdings || {}

    };

}


// ========================================
// Express
// ========================================

app.use(express.json({
    limit: "1mb"
}));

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// ========================================
// 사용자 인증
// ========================================

async function auth(req, res, next) {

    try {

        const header =
            req.headers.authorization || "";

        const token =
            header.startsWith("Bearer ")
                ? header.slice(7)
                : "";

        if (!token) {

            return res
                .status(401)
                .json({
                    error:
                        "로그인이 필요합니다."
                });

        }

        const result =
            await pool.query(
                `
                SELECT
                    u.id,
                    u.username,
                    u.nickname,
                    u.cash,
                    u.holdings,
                    u.transactions
                FROM sessions s
                JOIN users u
                    ON u.id = s.user_id
                WHERE s.token = $1
                `,
                [token]
            );

        if (result.rows.length === 0) {

            return res
                .status(401)
                .json({
                    error:
                        "로그인이 필요합니다."
                });

        }

        req.user =
            result.rows[0];

        req.token =
            token;

        next();

    } catch (error) {

        console.error(error);

        res
            .status(500)
            .json({
                error:
                    "인증 처리 중 오류가 발생했습니다."
            });

    }

}


// ========================================
// 관리자 인증
// ========================================

function adminAuth(req, res, next) {

    const header =
        req.headers.authorization || "";

    const token =
        header.startsWith("Bearer ")
            ? header.slice(7)
            : "";

    if (
        !token ||
        !adminSessions.has(token)
    ) {

        return res
            .status(401)
            .json({
                error:
                    "관리자 로그인이 필요합니다."
            });

    }

    req.adminToken = token;

    next();

}


// ========================================
// 시장 정보
// ========================================

app.get(
    "/api/market",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        name,
                        volatility,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume
                    FROM stocks
                    ORDER BY id
                    `
                );

            const stocks = {};

            for (
                const stock
                of result.rows
            ) {

                stocks[stock.id] = {

                    price:
                        Number(stock.price),

                    previous:
                        Number(stock.previous),

                    open:
                        Number(stock.open_price),

                    high:
                        Number(stock.high),

                    low:
                        Number(stock.low),

                    volume:
                        Number(stock.volume)

                };

            }

            res.json({

                companies:
                    result.rows.map(
                        stock => ({

                            id:
                                stock.id,

                            name:
                                stock.name,

                            price:
                                Number(stock.price),

                            volatility:
                                Number(
                                    stock.volatility
                                )

                        })
                    ),

                stocks,

                serverTime:
                    Date.now()

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "시장 정보를 불러오지 못했습니다."
                });

        }

    }
);


// ========================================
// 회원가입
// ========================================

app.post(
    "/api/register",
    async (req, res) => {

        try {

            const {
                username,
                password,
                nickname
            } = req.body;

            const cleanUsername =
                String(username || "")
                    .trim();

            const cleanNickname =
                String(nickname || "")
                    .trim();

            const cleanPassword =
                String(password || "");

            if (
                !cleanUsername ||
                !cleanPassword ||
                !cleanNickname
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "아이디, 비밀번호, 닉네임을 모두 입력하세요."
                    });

            }

            if (
                cleanUsername.length < 3
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "아이디는 3자 이상이어야 합니다."
                    });

            }

            if (
                cleanPassword.length < 4
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "비밀번호는 4자 이상이어야 합니다."
                    });

            }

            const existingUsername =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE LOWER(username)
                        = LOWER($1)
                    `,
                    [cleanUsername]
                );

            if (
                existingUsername.rows.length > 0
            ) {

                return res
                    .status(409)
                    .json({
                        error:
                            "이미 사용 중인 아이디입니다."
                    });

            }

            const existingNickname =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE nickname = $1
                    `,
                    [cleanNickname]
                );

            if (
                existingNickname.rows.length > 0
            ) {

                return res
                    .status(409)
                    .json({
                        error:
                            "이미 사용 중인 닉네임입니다."
                    });

            }

            const id =
                crypto.randomUUID();

            const salt =
                crypto
                    .randomBytes(16)
                    .toString("hex");

            const passwordHash =
                hashPassword(
                    cleanPassword,
                    salt
                );

            const token =
                createToken();

            await pool.query(
                `
                INSERT INTO users
                (
                    id,
                    username,
                    nickname,
                    salt,
                    password_hash,
                    cash,
                    holdings,
                    transactions,
                    created_at
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    '{}'::jsonb,
                    '[]'::jsonb,
                    $7
                )
                `,
                [
                    id,
                    cleanUsername,
                    cleanNickname,
                    salt,
                    passwordHash,
                    STARTING_CASH,
                    Date.now()
                ]
            );

            await pool.query(
                `
                INSERT INTO sessions
                (
                    token,
                    user_id,
                    created_at
                )
                VALUES
                ($1,$2,$3)
                `,
                [
                    token,
                    id,
                    Date.now()
                ]
            );

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        nickname,
                        cash,
                        holdings
                    FROM users
                    WHERE id = $1
                    `,
                    [id]
                );

            res.json({

                token,

                user:
                    safeUser(
                        userResult.rows[0]
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "회원가입 중 오류가 발생했습니다."
                });

        }

    }
);


// ========================================
// 로그인
// ========================================

app.post(
    "/api/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM users
                    WHERE LOWER(username)
                        = LOWER($1)
                    `,
                    [
                        String(username || "")
                    ]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(401)
                    .json({
                        error:
                            "아이디 또는 비밀번호가 올바르지 않습니다."
                    });

            }

            const user =
                result.rows[0];

            const passwordHash =
                hashPassword(
                    String(password || ""),
                    user.salt
                );

            if (
                passwordHash
                !==
                user.password_hash
            ) {

                return res
                    .status(401)
                    .json({
                        error:
                            "아이디 또는 비밀번호가 올바르지 않습니다."
                    });

            }

            const token =
                createToken();

            await pool.query(
                `
                INSERT INTO sessions
                (
                    token,
                    user_id,
                    created_at
                )
                VALUES
                ($1,$2,$3)
                `,
                [
                    token,
                    user.id,
                    Date.now()
                ]
            );

            res.json({

                token,

                user:
                    safeUser(user)

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "로그인 중 오류가 발생했습니다."
                });

        }

    }
);


// ========================================
// 내 정보
// ========================================

app.get(
    "/api/me",
    auth,
    async (req, res) => {

        res.json({

            user:
                safeUser(
                    req.user
                )

        });

    }
);


// ========================================
// 로그아웃
// ========================================

app.post(
    "/api/logout",
    auth,
    async (req, res) => {

        try {

            await pool.query(
                `
                DELETE FROM sessions
                WHERE token = $1
                `,
                [req.token]
            );

            res.json({
                ok: true
            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "로그아웃 중 오류가 발생했습니다."
                });

        }

    }
);


// ========================================
// 차트
// ========================================

app.get(
    "/api/history/:id",
    async (req, res) => {

        try {

            const id =
                req.params.id;

            const ranges = {

                "1d":
                    86400000,

                "1w":
                    604800000,

                "1m":
                    2592000000,

                "3m":
                    7776000000,

                "all":
                    Infinity

            };

            const requestedRange =
                req.query.range || "1d";

            const range =
                ranges[requestedRange]
                ??
                ranges["1d"];

            const minTime =
                range === Infinity
                    ? 0
                    :
                    Date.now() - range;

            const result =
                await pool.query(
                    `
                    SELECT
                        time AS t,
                        price AS p
                    FROM price_history
                    WHERE stock_id = $1
                    AND time >= $2
                    ORDER BY time ASC
                    LIMIT 1000
                    `,
                    [
                        id,
                        minTime
                    ]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "차트 데이터가 없습니다."
                    });

            }

            res.json({

                points:
                    result.rows.map(
                        row => ({

                            t:
                                Number(row.t),

                            p:
                                Number(row.p)

                        })
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "차트 데이터를 불러오지 못했습니다."
                });

        }

    }
);


// ========================================
// 매수 / 매도
// ========================================

app.post(
    "/api/trade",
    auth,
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted = false;

        try {

            const {
                id,
                side,
                qty
            } = req.body;

            const amount =
                Number(qty);

            if (
                side !== "buy" &&
                side !== "sell"
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "잘못된 거래입니다."
                    });

            }

            if (
                !Number.isInteger(amount) ||
                amount <= 0
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "수량을 확인하세요."
                    });

            }

            await client.query("BEGIN");

            transactionStarted = true;

            const stockResult =
                await client.query(
                    `
                    SELECT *
                    FROM stocks
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [id]
                );

            if (
                stockResult.rows.length === 0
            ) {

                await client.query("ROLLBACK");

                transactionStarted = false;

                return res
                    .status(400)
                    .json({
                        error:
                            "존재하지 않는 종목입니다."
                    });

            }

            const stock =
                stockResult.rows[0];

            const userResult =
                await client.query(
                    `
                    SELECT *
                    FROM users
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [req.user.id]
                );

            if (
                userResult.rows.length === 0
            ) {

                await client.query("ROLLBACK");

                transactionStarted = false;

                return res
                    .status(404)
                    .json({
                        error:
                            "사용자를 찾을 수 없습니다."
                    });

            }

            const user =
                userResult.rows[0];

            const holdings =
                user.holdings || {};

            const holding =
                holdings[id]
                ||
                {
                    qty: 0,
                    avg: 0
                };

            const price =
                Number(stock.price);

            if (
                !Number.isFinite(price) ||
                price <= 0
            ) {

                await client.query("ROLLBACK");

                transactionStarted = false;

                return res
                    .status(400)
                    .json({
                        error:
                            "현재 주가가 올바르지 않습니다."
                    });

            }

            const total =
                price * amount;


            // ==================================
            // 매수
            // ==================================

            if (side === "buy") {

                if (
                    Number(user.cash) <
                    total
                ) {

                    await client.query("ROLLBACK");

                    transactionStarted = false;

                    return res
                        .status(400)
                        .json({
                            error:
                                "현금이 부족합니다."
                        });

                }

                const oldQty =
                    Number(holding.qty);

                const oldAvg =
                    Number(holding.avg);

                const newQty =
                    oldQty + amount;

                holding.avg =
                    (
                        oldQty * oldAvg +
                        total
                    ) /
                    newQty;

                holding.qty =
                    newQty;

                user.cash =
                    Number(user.cash) -
                    total;

            }


            // ==================================
            // 매도
            // ==================================

            if (side === "sell") {

                if (
                    Number(holding.qty) <
                    amount
                ) {

                    await client.query("ROLLBACK");

                    transactionStarted = false;

                    return res
                        .status(400)
                        .json({
                            error:
                                "보유 주식이 부족합니다."
                        });

                }

                holding.qty =
                    Number(holding.qty) -
                    amount;

                user.cash =
                    Number(user.cash) +
                    total;

                if (
                    holding.qty === 0
                ) {

                    holding.avg = 0;

                }

            }


            holdings[id] =
                holding;


            // ==================================
            // 거래 기록
            // ==================================

            const transactions =
                user.transactions || [];

            transactions.unshift({

                companyId:
                    id,

                side:
                    side,

                qty:
                    amount,

                price:
                    price,

                total:
                    total,

                time:
                    Date.now()

            });

            if (
                transactions.length > 1000
            ) {

                transactions.splice(1000);

            }


            // ==================================
            // 사용자 저장
            // ==================================

            await client.query(
                `
                UPDATE users
                SET
                    cash = $1,
                    holdings = $2::jsonb,
                    transactions = $3::jsonb
                WHERE id = $4
                `,
                [
                    user.cash,
                    JSON.stringify(holdings),
                    JSON.stringify(transactions),
                    user.id
                ]
            );


            // ==================================
            // 거래량
            // ==================================

            await client.query(
                `
                UPDATE stocks
                SET volume = volume + $1
                WHERE id = $2
                `,
                [
                    amount,
                    id
                ]
            );


            await client.query("COMMIT");

            transactionStarted = false;


            const updatedUser =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        nickname,
                        cash,
                        holdings
                    FROM users
                    WHERE id = $1
                    `,
                    [user.id]
                );


            res.json({

                ok: true,

                user:
                    safeUser(
                        updatedUser.rows[0]
                    )

            });

        } catch (error) {

            if (transactionStarted) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch {}

            }

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "거래 처리 중 오류가 발생했습니다."
                });

        } finally {

            client.release();

        }

    }
);


// ========================================
// 포트폴리오
// ========================================

app.get(
    "/api/portfolio",
    auth,
    async (req, res) => {

        try {

            const stockResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        price
                    FROM stocks
                    `
                );

            const stockMap = {};

            for (
                const stock
                of stockResult.rows
            ) {

                stockMap[stock.id] =
                    Number(stock.price);

            }

            const holdings =
                req.user.holdings || {};

            let stockValue = 0;

            const positions = [];

            for (
                const [id, holding]
                of Object.entries(holdings)
            ) {

                const price =
                    stockMap[id];

                if (
                    price === undefined ||
                    Number(holding.qty) <= 0
                ) {

                    continue;

                }

                const qty =
                    Number(holding.qty);

                const avg =
                    Number(holding.avg);

                const value =
                    qty * price;

                const pnl =
                    value -
                    qty * avg;

                stockValue += value;

                positions.push({

                    id,

                    qty,

                    avg,

                    price,

                    value,

                    pnl,

                    pnlPct:
                        avg === 0
                            ? 0
                            :
                            (
                                (price - avg)
                                /
                                avg
                            ) * 100

                });

            }

            const cash =
                Number(req.user.cash);

            const total =
                cash + stockValue;

            res.json({

                cash,

                stockValue,

                total,

                totalPnl:
                    total -
                    STARTING_CASH,

                totalPnlPct:
                    (
                        total /
                        STARTING_CASH -
                        1
                    ) * 100,

                positions

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "포트폴리오를 불러오지 못했습니다."
                });

        }

    }
);


// ========================================
// 거래내역
// ========================================

app.get(
    "/api/transactions",
    auth,
    async (req, res) => {

        res.json({

            transactions:
                (
                    req.user.transactions ||
                    []
                ).slice(0, 100)

        });

    }
);


// ========================================
// 랭킹
// ========================================

app.get(
    "/api/rankings",
    async (req, res) => {

        try {

            const usersResult =
                await pool.query(
                    `
                    SELECT
                        nickname,
                        cash,
                        holdings
                    FROM users
                    `
                );

            const stocksResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        price
                    FROM stocks
                    `
                );

            const prices = {};

            for (
                const stock
                of stocksResult.rows
            ) {

                prices[stock.id] =
                    Number(stock.price);

            }

            const rankings =
                usersResult.rows
                    .map(user => {

                        let stockValue = 0;

                        const holdings =
                            user.holdings || {};

                        for (
                            const [
                                id,
                                holding
                            ]
                            of Object.entries(
                                holdings
                            )
                        ) {

                            if (
                                prices[id] !==
                                undefined
                            ) {

                                stockValue +=
                                    prices[id] *
                                    Number(
                                        holding.qty
                                    );

                            }

                        }

                        return {

                            nickname:
                                user.nickname,

                            total:
                                Number(user.cash) +
                                stockValue

                        };

                    })
                    .sort(
                        (a, b) =>
                            b.total -
                            a.total
                    );

            res.json({
                rankings
            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "랭킹을 불러오지 못했습니다."
                });

        }

    }
);


// ============================================================================
// ============================================================================
//                              관리자 시스템
// ============================================================================
// ============================================================================


// ========================================
// 관리자 로그인
// ========================================

app.post(
    "/api/admin/login",
    (req, res) => {

        const password =
            String(
                req.body.password || ""
            );

        if (
            password !== ADMIN_PASSWORD
        ) {

            return res
                .status(401)
                .json({
                    error:
                        "관리자 비밀번호가 올바르지 않습니다."
                });

        }

        const token =
            createToken();

        adminSessions.set(
            token,
            {
                createdAt:
                    Date.now()
            }
        );

        res.json({
            ok: true,
            token
        });

    }
);


// ========================================
// 관리자 로그아웃
// ========================================

app.post(
    "/api/admin/logout",
    adminAuth,
    (req, res) => {

        adminSessions.delete(
            req.adminToken
        );

        res.json({
            ok: true
        });

    }
);


// ========================================
// 관리자 - 전체 플레이어
// ========================================

app.get(
    "/api/admin/users",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        created_at
                    FROM users
                    ORDER BY created_at ASC
                    `
                );

            res.json({

                users:
                    result.rows.map(
                        user => ({

                            id:
                                user.id,

                            username:
                                user.username,

                            nickname:
                                user.nickname,

                            cash:
                                Number(
                                    user.cash
                                ),

                            holdings:
                                user.holdings ||
                                {},

                            transactions:
                                user.transactions ||
                                [],

                            createdAt:
                                Number(
                                    user.created_at
                                )

                        })
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "플레이어 정보를 불러오지 못했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 플레이어 상세
// ========================================

app.get(
    "/api/admin/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        created_at
                    FROM users
                    WHERE id = $1
                    `,
                    [req.params.id]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "플레이어를 찾을 수 없습니다."
                    });

            }

            const user =
                result.rows[0];

            res.json({

                user: {

                    id:
                        user.id,

                    username:
                        user.username,

                    nickname:
                        user.nickname,

                    cash:
                        Number(user.cash),

                    holdings:
                        user.holdings ||
                        {},

                    transactions:
                        user.transactions ||
                        [],

                    createdAt:
                        Number(
                            user.created_at
                        )

                }

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "플레이어 정보를 불러오지 못했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 닉네임 변경
// ========================================

app.post(
    "/api/admin/users/:id/nickname",
    adminAuth,
    async (req, res) => {

        try {

            const nickname =
                String(
                    req.body.nickname || ""
                ).trim();

            if (
                nickname.length < 1
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "닉네임을 입력하세요."
                    });

            }

            const existing =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE nickname = $1
                    AND id <> $2
                    `,
                    [
                        nickname,
                        req.params.id
                    ]
                );

            if (
                existing.rows.length > 0
            ) {

                return res
                    .status(409)
                    .json({
                        error:
                            "이미 사용 중인 닉네임입니다."
                    });

            }

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET nickname = $1
                    WHERE id = $2
                    RETURNING
                        id,
                        username,
                        nickname,
                        cash,
                        holdings
                    `,
                    [
                        nickname,
                        req.params.id
                    ]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "플레이어를 찾을 수 없습니다."
                    });

            }

            res.json({

                ok: true,

                user:
                    safeUser(
                        result.rows[0]
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "닉네임 변경에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 비밀번호 변경
// ========================================

app.post(
    "/api/admin/users/:id/password",
    adminAuth,
    async (req, res) => {

        try {

            const password =
                String(
                    req.body.password || ""
                );

            if (
                password.length < 4
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "비밀번호는 4자 이상이어야 합니다."
                    });

            }

            const salt =
                crypto
                    .randomBytes(16)
                    .toString("hex");

            const passwordHash =
                hashPassword(
                    password,
                    salt
                );

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        salt = $1,
                        password_hash = $2
                    WHERE id = $3
                    RETURNING id
                    `,
                    [
                        salt,
                        passwordHash,
                        req.params.id
                    ]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "플레이어를 찾을 수 없습니다."
                    });

            }

            // 기존 로그인 세션 전부 제거
            await pool.query(
                `
                DELETE FROM sessions
                WHERE user_id = $1
                `,
                [req.params.id]
            );

            res.json({
                ok: true,
                message:
                    "비밀번호가 변경되었습니다."
            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "비밀번호 변경에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 현금 설정
// ========================================

app.post(
    "/api/admin/users/:id/cash",
    adminAuth,
    async (req, res) => {

        try {

            const cash =
                Number(req.body.cash);

            if (
                !Number.isFinite(cash) ||
                cash < 0
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "올바른 금액을 입력하세요."
                    });

            }

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET cash = $1
                    WHERE id = $2
                    RETURNING
                        id,
                        username,
                        nickname,
                        cash,
                        holdings
                    `,
                    [
                        cash,
                        req.params.id
                    ]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "플레이어를 찾을 수 없습니다."
                    });

            }

            res.json({

                ok: true,

                user:
                    safeUser(
                        result.rows[0]
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "현금 설정에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 현금 증감
// ========================================

app.post(
    "/api/admin/users/:id/cash/add",
    adminAuth,
    async (req, res) => {

        try {

            const amount =
                Number(req.body.amount);

            if (
                !Number.isFinite(amount)
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "올바른 금액을 입력하세요."
                    });

            }

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET cash =
                        GREATEST(
                            0,
                            cash + $1
                        )
                    WHERE id = $2
                    RETURNING
                        id,
                        username,
                        nickname,
                        cash,
                        holdings
                    `,
                    [
                        amount,
                        req.params.id
                    ]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "플레이어를 찾을 수 없습니다."
                    });

            }

            res.json({

                ok: true,

                user:
                    safeUser(
                        result.rows[0]
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "현금 변경에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 플레이어 거래내역 삭제
// ========================================

app.post(
    "/api/admin/users/:id/clear-transactions",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET transactions =
                        '[]'::jsonb
                    WHERE id = $1
                    RETURNING id
                    `,
                    [req.params.id]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "플레이어를 찾을 수 없습니다."
                    });

            }

            res.json({
                ok: true
            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "거래내역 삭제에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 주식 목록
// ========================================

app.get(
    "/api/admin/stocks",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        name,
                        volatility,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume
                    FROM stocks
                    ORDER BY id
                    `
                );

            res.json({

                stocks:
                    result.rows.map(
                        stock => ({

                            id:
                                stock.id,

                            name:
                                stock.name,

                            price:
                                Number(
                                    stock.price
                                ),

                            previous:
                                Number(
                                    stock.previous
                                ),

                            open:
                                Number(
                                    stock.open_price
                                ),

                            high:
                                Number(
                                    stock.high
                                ),

                            low:
                                Number(
                                    stock.low
                                ),

                            volume:
                                Number(
                                    stock.volume
                                ),

                            control:
                                stockControls[
                                    stock.id
                                ] || {

                                    mode:
                                        "random",

                                    step:
                                        0,

                                    target:
                                        null

                                }

                        })
                    )

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "주식 정보를 불러오지 못했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 현재 주가 직접 설정
// ========================================

app.post(
    "/api/admin/stocks/:id/price",
    adminAuth,
    async (req, res) => {

        try {

            const price =
                Number(req.body.price);

            if (
                !Number.isFinite(price) ||
                price < 100
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "주가는 100원 이상이어야 합니다."
                    });

            }

            const safePrice =
                Math.min(
                    1000000,
                    Math.round(
                        price / 100
                    ) * 100
                );

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM stocks
                    WHERE id = $1
                    `,
                    [req.params.id]
                );

            if (
                result.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "주식을 찾을 수 없습니다."
                    });

            }

            const stock =
                result.rows[0];

            const oldPrice =
                Number(stock.price);

            const high =
                Math.max(
                    Number(stock.high),
                    safePrice
                );

            const low =
                Math.min(
                    Number(stock.low),
                    safePrice
                );

            await pool.query(
                `
                UPDATE stocks
                SET
                    previous = $1,
                    price = $2,
                    high = $3,
                    low = $4
                WHERE id = $5
                `,
                [
                    oldPrice,
                    safePrice,
                    high,
                    low,
                    req.params.id
                ]
            );

            await pool.query(
                `
                INSERT INTO price_history
                (
                    stock_id,
                    time,
                    price
                )
                VALUES
                ($1,$2,$3)
                `,
                [
                    req.params.id,
                    Date.now(),
                    safePrice
                ]
            );

            res.json({

                ok: true,

                price:
                    safePrice

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "주가 설정에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 주가 변동 제어
// ========================================

app.post(
    "/api/admin/stocks/:id/control",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                req.params.id;

            const mode =
                String(
                    req.body.mode || "random"
                ).toLowerCase();

            const step =
                Number(
                    req.body.step
                );

            let target =
                req.body.target;

            if (
                target === "" ||
                target === null ||
                target === undefined
            ) {

                target = null;

            } else {

                target =
                    Number(target);

            }

            if (
                ![
                    "random",
                    "up",
                    "down",
                    "stop"
                ].includes(mode)
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "mode는 random, up, down, stop 중 하나여야 합니다."
                    });

            }

            if (
                !Number.isFinite(step) ||
                step < 0
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "변동폭은 0 이상이어야 합니다."
                    });

            }

            if (
                target !== null &&
                (
                    !Number.isFinite(target) ||
                    target < 100 ||
                    target > 1000000
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "목표 주가가 올바르지 않습니다."
                    });

            }

            const stockResult =
                await pool.query(
                    `
                    SELECT id, price
                    FROM stocks
                    WHERE id = $1
                    `,
                    [id]
                );

            if (
                stockResult.rows.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            "주식을 찾을 수 없습니다."
                    });

            }

            stockControls[id] = {

                mode,

                step:
                    Math.round(step),

                target:
                    target === null
                        ? null
                        :
                        Math.round(
                            target / 100
                        ) * 100

            };

            res.json({

                ok: true,

                control:
                    stockControls[id]

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error:
                        "주가 제어 설정에 실패했습니다."
                });

        }

    }
);


// ========================================
// 관리자 - 주가 제어 초기화
// ========================================

app.post(
    "/api/admin/stocks/:id/reset-control",
    adminAuth,
    (req, res) => {

        if (
            !stockControls[
                req.params.id
            ]
        ) {

            return res
                .status(404)
                .json({
                    error:
                        "존재하지 않는 종목입니다."
                });

        }

        stockControls[
            req.params.id
        ] = {

            mode:
                "random",

            step:
                0,

            target:
                null

        };

        res.json({

            ok: true,

            control:
                stockControls[
                    req.params.id
                ]

        });

    }
);


// ========================================
// 주가 업데이트
// ========================================

async function updateStocks() {

    const client =
        await pool.connect();

    let started = false;

    try {

        await client.query("BEGIN");

        started = true;

        for (
            const company
            of companies
        ) {

            const id =
                company[0];

            const startingPrice =
                Number(company[2]);

            const result =
                await client.query(
                    `
                    SELECT *
                    FROM stocks
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [id]
                );

            if (
                result.rows.length === 0
            ) {

                continue;

            }

            const stock =
                result.rows[0];

            let currentPrice =
                Number(stock.price);

            if (
                !Number.isFinite(currentPrice) ||
                currentPrice <= 0
            ) {

                currentPrice =
                    startingPrice;

            }

            let nextPrice =
                currentPrice;

            const control =
                stockControls[id] || {

                    mode:
                        "random",

                    step:
                        0,

                    target:
                        null

                };


            // ==================================
            // STOP
            // ==================================

            if (
                control.mode === "stop"
            ) {

                nextPrice =
                    currentPrice;

            }


            // ==================================
            // UP
            // ==================================

            else if (
                control.mode === "up"
            ) {

                const step =
                    control.step > 0
                        ? control.step
                        :
                        Math.max(
                            100,
                            Math.round(
                                currentPrice *
                                0.01 /
                                100
                            ) * 100
                        );

                nextPrice =
                    currentPrice +
                    step;

                // 목표 가격이 있으면
                // 목표를 넘지 않음
                if (
                    control.target !== null
                ) {

                    nextPrice =
                        Math.min(
                            nextPrice,
                            control.target
                        );

                    if (
                        nextPrice >=
                        control.target
                    ) {

                        nextPrice =
                            control.target;

                        control.mode =
                            "stop";

                    }

                }

            }


            // ==================================
            // DOWN
            // ==================================

            else if (
                control.mode === "down"
            ) {

                const step =
                    control.step > 0
                        ? control.step
                        :
                        Math.max(
                            100,
                            Math.round(
                                currentPrice *
                                0.01 /
                                100
                            ) * 100
                        );

                nextPrice =
                    currentPrice -
                    step;

                if (
                    control.target !== null
                ) {

                    nextPrice =
                        Math.max(
                            nextPrice,
                            control.target
                        );

                    if (
                        nextPrice <=
                        control.target
                    ) {

                        nextPrice =
                            control.target;

                        control.mode =
                            "stop";

                    }

                }

            }


            // ==================================
            // RANDOM
            // ==================================

            else {

                const changeAmount =
                    Math.floor(
                        Math.random() * 2501
                    ) + 500;

                const direction =
                    Math.random() < 0.5
                        ? -1
                        : 1;

                nextPrice =
                    currentPrice +
                    changeAmount *
                    direction;

            }


            // ==================================
            // 100원 단위
            // ==================================

            nextPrice =
                Math.round(
                    nextPrice / 100
                ) * 100;


            // ==================================
            // 최소 / 최대
            // ==================================

            nextPrice =
                Math.max(
                    100,
                    Math.min(
                        1000000,
                        nextPrice
                    )
                );


            // ==================================
            // 고가 / 저가
            // ==================================

            let high =
                Number(stock.high);

            let low =
                Number(stock.low);

            if (
                !Number.isFinite(high)
            ) {

                high =
                    currentPrice;

            }

            if (
                !Number.isFinite(low)
            ) {

                low =
                    currentPrice;

            }

            high =
                Math.max(
                    high,
                    nextPrice
                );

            low =
                Math.min(
                    low,
                    nextPrice
                );


            // ==================================
            // 저장
            // ==================================

            await client.query(
                `
                UPDATE stocks
                SET
                    previous = $1,
                    price = $2,
                    high = $3,
                    low = $4
                WHERE id = $5
                `,
                [
                    currentPrice,
                    nextPrice,
                    high,
                    low,
                    id
                ]
            );


            // ==================================
            // 차트 기록
            // ==================================

            await client.query(
                `
                INSERT INTO price_history
                (
                    stock_id,
                    time,
                    price
                )
                VALUES
                ($1,$2,$3)
                `,
                [
                    id,
                    Date.now(),
                    nextPrice
                ]
            );

        }


        // ==================================
        // 30일 이전 차트 삭제
        // ==================================

        await client.query(
            `
            DELETE FROM price_history
            WHERE time < $1
            `,
            [
                Date.now() -
                2592000000
            ]
        );


        await client.query("COMMIT");

        started = false;

    } catch (error) {

        if (started) {

            try {

                await client.query(
                    "ROLLBACK"
                );

            } catch {}

        }

        console.error(
            "주가 업데이트 오류:",
            error
        );

    } finally {

        client.release();

    }

}


// ============================================================================
// 관리자 페이지
// ============================================================================

app.get(
    "/admin",
    (req, res) => {

        res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>VSM 관리자 패널</title>

<style>

* {
    box-sizing: border-box;
}

body {

    margin: 0;

    font-family:
        Arial,
        "Noto Sans KR",
        sans-serif;

    background:
        #0b1020;

    color:
        #ffffff;

}

header {

    padding: 20px 30px;

    background:
        #11182d;

    border-bottom:
        1px solid #26304d;

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;

}

h1 {

    margin: 0;

    font-size:
        24px;

}

.container {

    padding: 25px;

    max-width:
        1500px;

    margin:
        auto;

}

.card {

    background:
        #11182d;

    border:
        1px solid #26304d;

    border-radius:
        14px;

    padding:
        20px;

    margin-bottom:
        20px;

}

input,
select,
button {

    border:
        1px solid #303b60;

    background:
        #0b1020;

    color:
        white;

    border-radius:
        8px;

    padding:
        10px;

}

input {

    width:
        100%;

}

button {

    cursor:
        pointer;

}

button:hover {

    background:
        #1b2748;

}

.grid {

    display:
        grid;

    grid-template-columns:
        repeat(
            auto-fit,
            minmax(
                300px,
                1fr
            )
        );

    gap:
        15px;

}

.stock {

    border:
        1px solid #26304d;

    border-radius:
        12px;

    padding:
        15px;

}

.stock h3 {

    margin-top:
        0;

}

.row {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        8px;

    margin-top:
        8px;

}

.full {

    grid-column:
        1 / -1;

}

.user {

    border:
        1px solid #26304d;

    border-radius:
        12px;

    padding:
        15px;

    margin-bottom:
        10px;

}

.hidden {

    display:
        none;

}

#login {

    max-width:
        450px;

    margin:
        100px auto;

}

.message {

    margin-top:
        10px;

    color:
        #8ab4ff;

}

.danger {

    background:
        #4a1720;

}

.up {

    color:
        #ff6464;

}

.down {

    color:
        #65a7ff;

}

pre {

    white-space:
        pre-wrap;

    word-break:
        break-word;

    background:
        #080c18;

    padding:
        10px;

    border-radius:
        8px;

}

</style>

</head>

<body>


<div id="login" class="card">

    <h1>VSM 관리자 로그인</h1>

    <p>
        관리자 비밀번호를 입력하세요.
    </p>

    <input
        id="adminPassword"
        type="password"
        placeholder="관리자 비밀번호"
    >

    <br><br>

    <button
        onclick="adminLogin()"
    >
        로그인
    </button>

    <div
        id="loginMessage"
        class="message"
    ></div>

</div>


<div id="panel" class="hidden">

<header>

    <h1>
        VSM 관리자 패널
    </h1>

    <button
        onclick="adminLogout()"
    >
        로그아웃
    </button>

</header>


<div class="container">


<div class="card">

    <h2>주식 관리</h2>

    <div
        id="stocks"
        class="grid"
    ></div>

</div>


<div class="card">

    <h2>플레이어 관리</h2>

    <div
        id="users"
    ></div>

</div>


</div>

</div>


<script>

let adminToken =
    localStorage.getItem(
        "vsm_admin_token"
    );


async function api(
    url,
    options = {}
) {

    options.headers =
        options.headers || {};

    options.headers[
        "Content-Type"
    ] =
        "application/json";

    options.headers[
        "Authorization"
    ] =
        "Bearer " + adminToken;

    const response =
        await fetch(
            url,
            options
        );

    const data =
        await response.json()
            .catch(
                () => ({})
            );

    if (!response.ok) {

        throw new Error(
            data.error ||
            "요청 실패"
        );

    }

    return data;

}


async function adminLogin() {

    const password =
        document
            .getElementById(
                "adminPassword"
            )
            .value;

    try {

        const response =
            await fetch(
                "/api/admin/login",
                {

                    method:
                        "POST",

                    headers:
                        {
                            "Content-Type":
                                "application/json"
                        },

                    body:
                        JSON.stringify({
                            password
                        })

                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error
            );

        }

        adminToken =
            data.token;

        localStorage.setItem(
            "vsm_admin_token",
            adminToken
        );

        document
            .getElementById(
                "login"
            )
            .classList
            .add("hidden");

        document
            .getElementById(
                "panel"
            )
            .classList
            .remove("hidden");

        loadAll();

    } catch (error) {

        document
            .getElementById(
                "loginMessage"
            )
            .textContent =
                error.message;

    }

}


async function adminLogout() {

    try {

        await api(
            "/api/admin/logout",
            {
                method:
                    "POST"
            }
        );

    } catch {}

    localStorage.removeItem(
        "vsm_admin_token"
    );

    location.reload();

}


async function loadAll() {

    await Promise.all([
        loadStocks(),
        loadUsers()
    ]);

}


async function loadStocks() {

    try {

        const data =
            await api(
                "/api/admin/stocks"
            );

        const container =
            document
                .getElementById(
                    "stocks"
                );

        container.innerHTML = "";

        for (
            const stock
            of data.stocks
        ) {

            const control =
                stock.control;

            const div =
                document.createElement(
                    "div"
                );

            div.className =
                "stock";

            const mode =
                control.mode;

            const target =
                control.target === null
                    ? ""
                    :
                    control.target;

            div.innerHTML = \`
                <h3>
                    \${stock.id}
                    -
                    \${stock.name}
                </h3>

                <p>
                    현재가:
                    <b>
                        \${stock.price.toLocaleString()}원
                    </b>
                </p>

                <p>
                    이전:
                    \${stock.previous.toLocaleString()}원
                </p>

                <p>
                    고가:
                    \${stock.high.toLocaleString()}원
                    /
                    저가:
                    \${stock.low.toLocaleString()}원
                </p>

                <hr>

                <b>현재 주가 직접 설정</b>

                <div class="row">

                    <input
                        id="price-\${stock.id}"
                        type="number"
                        value="\${stock.price}"
                    >

                    <button
                        onclick="setPrice('\${stock.id}')"
                    >
                        주가 설정
                    </button>

                </div>

                <br>

                <b>자동 주가 제어</b>

                <div class="row">

                    <select
                        id="mode-\${stock.id}"
                    >

                        <option
                            value="random"
                            \${mode === "random" ? "selected" : ""}
                        >
                            RANDOM
                        </option>

                        <option
                            value="up"
                            \${mode === "up" ? "selected" : ""}
                        >
                            UP
                        </option>

                        <option
                            value="down"
                            \${mode === "down" ? "selected" : ""}
                        >
                            DOWN
                        </option>

                        <option
                            value="stop"
                            \${mode === "stop" ? "selected" : ""}
                        >
                            STOP
                        </option>

                    </select>

                    <input
                        id="step-\${stock.id}"
                        type="number"
                        value="\${control.step || 0}"
                        placeholder="변동 금액"
                    >

                </div>

                <div class="row">

                    <input
                        id="target-\${stock.id}"
                        type="number"
                        value="\${target}"
                        placeholder="목표 주가 (선택)"
                    >

                    <button
                        onclick="setControl('\${stock.id}')"
                    >
                        적용
                    </button>

                </div>

                <br>

                <button
                    onclick="resetControl('\${stock.id}')"
                >
                    자동제어 초기화
                </button>

            \`;

            container.appendChild(
                div
            );

        }

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function setPrice(id) {

    const price =
        Number(
            document
                .getElementById(
                    "price-" + id
                )
                .value
        );

    try {

        await api(
            "/api/admin/stocks/" +
            id +
            "/price",
            {

                method:
                    "POST",

                body:
                    JSON.stringify({
                        price
                    })

            }
        );

        alert(
            "현재 주가가 변경되었습니다."
        );

        loadStocks();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function setControl(id) {

    const mode =
        document
            .getElementById(
                "mode-" + id
            )
            .value;

    const step =
        Number(
            document
                .getElementById(
                    "step-" + id
                )
                .value
        );

    const targetValue =
        document
            .getElementById(
                "target-" + id
            )
            .value;

    const target =
        targetValue === ""
            ? null
            :
            Number(targetValue);

    try {

        await api(
            "/api/admin/stocks/" +
            id +
            "/control",
            {

                method:
                    "POST",

                body:
                    JSON.stringify({
                        mode,
                        step,
                        target
                    })

            }
        );

        alert(
            "주가 제어가 적용되었습니다."
        );

        loadStocks();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function resetControl(id) {

    try {

        await api(
            "/api/admin/stocks/" +
            id +
            "/reset-control",
            {
                method:
                    "POST"
            }
        );

        loadStocks();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function loadUsers() {

    try {

        const data =
            await api(
                "/api/admin/users"
            );

        const container =
            document
                .getElementById(
                    "users"
                );

        container.innerHTML = "";

        for (
            const user
            of data.users
        ) {

            const holdings =
                Object.entries(
                    user.holdings || {}
                );

            let holdingText =
                "없음";

            if (
                holdings.length > 0
            ) {

                holdingText =
                    holdings
                        .map(
                            ([id, holding]) =>
                                id +
                                ": " +
                                holding.qty +
                                "주"
                        )
                        .join(
                            " / "
                        );

            }

            const div =
                document.createElement(
                    "div"
                );

            div.className =
                "user";

            div.innerHTML = \`
                <h3>
                    \${escapeHtml(user.nickname)}
                </h3>

                <p>
                    아이디:
                    <b>
                        \${escapeHtml(user.username)}
                    </b>
                </p>

                <p>
                    현금:
                    <b>
                        \${user.cash.toLocaleString()}원
                    </b>
                </p>

                <p>
                    보유주식:
                    \${escapeHtml(holdingText)}
                </p>

                <hr>

                <b>닉네임 변경</b>

                <div class="row">

                    <input
                        id="nickname-\${user.id}"
                        value="\${escapeAttr(user.nickname)}"
                    >

                    <button
                        onclick="changeNickname('\${user.id}')"
                    >
                        변경
                    </button>

                </div>

                <br>

                <b>비밀번호 재설정</b>

                <div class="row">

                    <input
                        id="password-\${user.id}"
                        type="password"
                        placeholder="새 비밀번호"
                    >

                    <button
                        onclick="changePassword('\${user.id}')"
                    >
                        변경
                    </button>

                </div>

                <br>

                <b>현금 설정</b>

                <div class="row">

                    <input
                        id="cash-\${user.id}"
                        type="number"
                        value="\${user.cash}"
                    >

                    <button
                        onclick="setCash('\${user.id}')"
                    >
                        설정
                    </button>

                </div>

                <br>

                <b>현금 증감</b>

                <div class="row">

                    <input
                        id="cashadd-\${user.id}"
                        type="number"
                        placeholder="예: 5000 또는 -5000"
                    >

                    <button
                        onclick="addCash('\${user.id}')"
                    >
                        적용
                    </button>

                </div>

                <br>

                <button
                    class="danger"
                    onclick="clearTransactions('\${user.id}')"
                >
                    거래내역 삭제
                </button>

            \`;

            container.appendChild(
                div
            );

        }

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function changeNickname(id) {

    const nickname =
        document
            .getElementById(
                "nickname-" + id
            )
            .value;

    try {

        await api(
            "/api/admin/users/" +
            id +
            "/nickname",
            {

                method:
                    "POST",

                body:
                    JSON.stringify({
                        nickname
                    })

            }
        );

        alert(
            "닉네임 변경 완료"
        );

        loadUsers();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function changePassword(id) {

    const password =
        document
            .getElementById(
                "password-" + id
            )
            .value;

    if (!password) {

        alert(
            "새 비밀번호를 입력하세요."
        );

        return;

    }

    try {

        await api(
            "/api/admin/users/" +
            id +
            "/password",
            {

                method:
                    "POST",

                body:
                    JSON.stringify({
                        password
                    })

            }
        );

        alert(
            "비밀번호 변경 완료\\n기존 로그인 세션은 모두 로그아웃됩니다."
        );

        loadUsers();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function setCash(id) {

    const cash =
        Number(
            document
                .getElementById(
                    "cash-" + id
                )
                .value
        );

    try {

        await api(
            "/api/admin/users/" +
            id +
            "/cash",
            {

                method:
                    "POST",

                body:
                    JSON.stringify({
                        cash
                    })

            }
        );

        alert(
            "현금 설정 완료"
        );

        loadUsers();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function addCash(id) {

    const amount =
        Number(
            document
                .getElementById(
                    "cashadd-" + id
                )
                .value
        );

    try {

        await api(
            "/api/admin/users/" +
            id +
            "/cash/add",
            {

                method:
                    "POST",

                body:
                    JSON.stringify({
                        amount
                    })

            }
        );

        loadUsers();

    } catch (error) {

        alert(
            error.message
        );

    }

}


async function clearTransactions(id) {

    if (
        !confirm(
            "정말 이 플레이어의 거래내역을 삭제할까요?"
        )
    ) {

        return;

    }

    try {

        await api(
            "/api/admin/users/" +
            id +
            "/clear-transactions",
            {

                method:
                    "POST"

            }
        );

        alert(
            "거래내역 삭제 완료"
        );

        loadUsers();

    } catch (error) {

        alert(
            error.message
        );

    }

}


function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


function escapeAttr(value) {

    return escapeHtml(value);

}


// 이미 로그인되어 있으면 바로 패널
if (adminToken) {

    document
        .getElementById(
            "login"
        )
        .classList
        .add("hidden");

    document
        .getElementById(
            "panel"
        )
        .classList
        .remove("hidden");

    loadAll()
        .catch(() => {

            localStorage.removeItem(
                "vsm_admin_token"
            );

            location.reload();

        });

}


// 5초마다 관리자 정보 새로고침
setInterval(
    () => {

        if (
            adminToken &&
            !document
                .getElementById(
                    "panel"
                )
                .classList
                .contains("hidden")
        ) {

            loadAll();

        }

    },
    5000
);

</script>

</body>
</html>
        `);

    }
);


// ========================================
// 홈페이지
// ========================================

app.use(
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);


// ========================================
// 서버 시작
// ========================================

async function startServer() {

    try {

        await initializeDatabase();

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log("");
                console.log(
                    "========================================"
                );
                console.log(
                    " VSM Virtual Stock Market V4"
                );
                console.log(
                    "========================================"
                );
                console.log(
                    "시작금: 10,000원"
                );
                console.log(
                    "주가 업데이트: 3초"
                );
                console.log(
                    "PostgreSQL: 연결됨"
                );
                console.log(
                    "서버 포트: " + PORT
                );
                console.log(
                    "관리자: /admin"
                );
                console.log(
                    "========================================"
                );
                console.log("");

            }
        );


        // ==================================
        // 3초마다 주가 업데이트
        // ==================================

        setInterval(
            updateStocks,
            3000
        );

    } catch (error) {

        console.error(
            "❌ 서버 시작 실패:",
            error
        );

        process.exit(1);

    }

}

startServer();
