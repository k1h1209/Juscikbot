const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const STARTING_CASH = 10000;

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
// PostgreSQL 연결
// ========================================

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    }
});


// ========================================
// 데이터베이스 초기화
// ========================================

async function initializeDatabase() {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        // 사용자
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

        // 로그인 세션
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at BIGINT NOT NULL
            )
        `);

        // 주식
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

        // 주가 기록
        await client.query(`
            CREATE TABLE IF NOT EXISTS price_history (
                id BIGSERIAL PRIMARY KEY,
                stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
                time BIGINT NOT NULL,
                price NUMERIC NOT NULL
            )
        `);

        // 기존 주식이 없으면 초기화
        for (const company of companies) {

            const [
                id,
                name,
                startingPrice,
                volatility
            ] = company;

            const result = await client.query(
                `
                SELECT id
                FROM stocks
                WHERE id = $1
                `,
                [id]
            );

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
                    ($1,$2,$3,$4,$4,$4,$4,$4,0)
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
            }
        }

        await client.query("COMMIT");

        console.log("PostgreSQL 데이터베이스 초기화 완료.");

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(
            "데이터베이스 초기화 실패:",
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
            password,
            salt,
            64
        )
        .toString("hex");

}


// ========================================
// 토큰 생성
// ========================================

function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");

}


// ========================================
// 사용자 안전 정보
// ========================================

function safeUser(user) {

    return {

        id: user.id,

        username: user.username,

        nickname: user.nickname,

        cash: Number(user.cash),

        holdings: user.holdings

    };

}


// ========================================
// Express
// ========================================

app.use(
    express.json()
);

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// ========================================
// 인증
// ========================================

async function auth(req, res, next) {

    try {

        const header =
            req.headers.authorization || "";

        const token =
            header.replace(
                "Bearer ",
                ""
            );

        if (!token) {

            return res
                .status(401)
                .json({
                    error: "로그인이 필요합니다."
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
                    u.transactions,
                    u.salt,
                    u.password_hash
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
                    error: "로그인이 필요합니다."
                });

        }

        req.user = result.rows[0];

        req.token = token;

        next();

    } catch (error) {

        console.error(error);

        res
            .status(500)
            .json({
                error: "인증 처리 중 오류가 발생했습니다."
            });

    }

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

            for (const stock of result.rows) {

                stocks[stock.id] = {

                    price: Number(stock.price),

                    previous: Number(stock.previous),

                    open: Number(stock.open_price),

                    high: Number(stock.high),

                    low: Number(stock.low),

                    volume: Number(stock.volume)

                };

            }

            res.json({

                companies:
                    result.rows.map(
                        stock => ({

                            id: stock.id,

                            name: stock.name,

                            price: Number(stock.price),

                            volatility:
                                Number(stock.volatility)

                        })
                    ),

                stocks: stocks,

                serverTime:
                    Date.now()

            });

        } catch (error) {

            console.error(error);

            res
                .status(500)
                .json({
                    error: "시장 정보를 불러오지 못했습니다."
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

            if (
                !username ||
                !password ||
                !nickname
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "아이디, 비밀번호, 닉네임을 모두 입력하세요."
                    });

            }

            if (username.length < 3) {

                return res
                    .status(400)
                    .json({
                        error:
                            "아이디는 3자 이상이어야 합니다."
                    });

            }

            if (password.length < 4) {

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
                    WHERE LOWER(username) = LOWER($1)
                    `,
                    [username]
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
                    [nickname]
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
                    password,
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
                    username,
                    nickname,
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

                token: token,

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
                    WHERE LOWER(username) = LOWER($1)
                    `,
                    [String(username || "")]
                );

            if (result.rows.length === 0) {

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
                    password,
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

                token: token,

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
// 그래프
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

            const range =
                ranges[
                    req.query.range || "1d"
                ];

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

            if (result.rows.length === 0) {

                return res
                    .status(404)
                    .json({
                        error:
                            "종목을 찾을 수 없습니다."
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

        try {

            const {
                id,
                side,
                qty
            } = req.body;

            const amount =
                Number(qty);

            if (
                side !== "buy"
                &&
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
                !Number.isInteger(amount)
                ||
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

            const total =
                price * amount;

            // ====================================
            // 매수
            // ====================================

            if (side === "buy") {

                if (
                    Number(user.cash)
                    <
                    total
                ) {

                    await client.query("ROLLBACK");

                    return res
                        .status(400)
                        .json({
                            error:
                                "현금이 부족합니다."
                        });

                }

                const newQty =
                    Number(holding.qty)
                    +
                    amount;

                holding.avg =
                    (
                        Number(holding.qty)
                        *
                        Number(holding.avg)
                        +
                        total
                    )
                    /
                    newQty;

                holding.qty =
                    newQty;

                user.cash =
                    Number(user.cash)
                    -
                    total;

            }

            // ====================================
            // 매도
            // ====================================

            if (side === "sell") {

                if (
                    Number(holding.qty)
                    <
                    amount
                ) {

                    await client.query("ROLLBACK");

                    return res
                        .status(400)
                        .json({
                            error:
                                "보유 주식이 부족합니다."
                        });

                }

                holding.qty =
                    Number(holding.qty)
                    -
                    amount;

                user.cash =
                    Number(user.cash)
                    +
                    total;

                if (
                    holding.qty === 0
                ) {

                    holding.avg = 0;

                }

            }

            holdings[id] =
                holding;

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
                transactions.length
                >
                1000
            ) {

                transactions.splice(
                    1000
                );

            }

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

            await client.query("ROLLBACK");

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

            for (const stock of stockResult.rows) {

                stockMap[stock.id] =
                    Number(stock.price);

            }

            const holdings =
                req.user.holdings || {};

            let stockValue = 0;

            const positions = [];

            for (
                const [id, holding]
                of Object.entries(
                    holdings
                )
            ) {

                const price =
                    stockMap[id];

                if (
                    price === undefined
                    ||
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
                    value
                    -
                    qty * avg;

                stockValue += value;

                positions.push({

                    id: id,

                    qty: qty,

                    avg: avg,

                    price: price,

                    value: value,

                    pnl: pnl,

                    pnlPct:
                        avg === 0
                            ? 0
                            :
                            (
                                (
                                    price - avg
                                )
                                /
                                avg
                            )
                            *
                            100

                });

            }

            const cash =
                Number(req.user.cash);

            const total =
                cash + stockValue;

            res.json({

                cash: cash,

                stockValue:
                    stockValue,

                total:
                    total,

                totalPnl:
                    total
                    -
                    STARTING_CASH,

                totalPnlPct:
                    (
                        total
                        /
                        STARTING_CASH
                        -
                        1
                    )
                    *
                    100,

                positions:
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
                    req.user.transactions
                    ||
                    []
                ).slice(0, 100)

        });

    }
);


// ========================================
// 자산 랭킹
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
                    .map(
                        user => {

                            let stockValue = 0;

                            const holdings =
                                user.holdings
                                ||
                                {};

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
                                    prices[id]
                                ) {

                                    stockValue +=
                                        prices[id]
                                        *
                                        Number(
                                            holding.qty
                                        );

                                }

                            }

                            return {

                                nickname:
                                    user.nickname,

                                total:
                                    Number(user.cash)
                                    +
                                    stockValue

                            };

                        }
                    )
                    .sort(
                        (a, b) =>
                            b.total - a.total
                    );

            res.json({

                rankings:
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


// ========================================
// 주가 변동
// ========================================

async function updateStocks() {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");

        for (
            const company
            of companies
        ) {

            const id =
                company[0];

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

            // 주가 변동: 한 번에 500원 ~ 3,000원
const changeAmount =
    Math.floor(
        Math.random() * 2501
    ) + 500;

// 상승 또는 하락
const direction =
    Math.random() < 0.5
        ? -1
        : 1;

let nextPrice =
    stock.price
    +
    changeAmount * direction;

            nextPrice =
                Math.round(
                    nextPrice / 100
                )
                *
                100;

            if (
                nextPrice < 1000
            ) {

                nextPrice = 1000;

            }

            if (
                nextPrice > 1000000
            ) {

                nextPrice = 1000000;

            }

            const high =
                Math.max(
                    Number(stock.high),
                    nextPrice
                );

            const low =
                Math.min(
                    Number(stock.low),
                    nextPrice
                );

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
                    Number(stock.price),
                    nextPrice,
                    high,
                    low,
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
                    nextPrice
                ]
            );

        }

        // 너무 오래된 기록 삭제
        await client.query(
            `
            DELETE FROM price_history
            WHERE id IN (
                SELECT id
                FROM price_history
                WHERE time < $1
            )
            `,
            [
                Date.now()
                -
                2592000000
            ]
        );

        await client.query("COMMIT");

    } catch (error) {

        await client.query("ROLLBACK");

        console.error(
            "주가 업데이트 오류:",
            error
        );

    } finally {

        client.release();

    }

}


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
                    "================================"
                );
                console.log(
                    " VSM Virtual Stock Market V3"
                );
                console.log(
                    "================================"
                );
                console.log(
                    "시작금: 10,000원"
                );
                console.log(
                    "주가 변동: 약 ±5%"
                );
                console.log(
                    "PostgreSQL: 연결됨"
                );
                console.log(
                    "서버 포트: " + PORT
                );
                console.log(
                    "================================"
                );
                console.log("");

            }
        );

        // 5초마다 주가 변경
        setInterval(
            updateStocks,
            5000
        );

    } catch (error) {

        console.error(
            "서버 시작 실패:",
            error
        );

        process.exit(1);

    }

}

startServer();
