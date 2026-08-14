


const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});


/* ========================================
   기본 주식 데이터

   minChange / maxChange

   예:
   0.01 = 1%
   0.05 = 5%

   한 번의 주가 변동에서
   최소 1% ~ 최대 5% 사이로 움직임
======================================== */

const companies = [
    ["SKNX", "스카닉스하이닉스", 4250, 0.01, 0.04],
    ["SAMS", "샘숭전자", 7100, 0.01, 0.03],
    ["TWAI", "티Wai", 1850, 0.02, 0.06],
    ["NVR", "나이버", 3500, 0.01, 0.04],
    ["NFLX", "니플릭스", 5200, 0.01, 0.05],
    ["PASC", "파스코", 2800, 0.01, 0.04],
    ["LG", "알쥐", 6400, 0.01, 0.03],
    ["HYUN", "현재자동차", 8300, 0.01, 0.04],
    ["NVDO", "N비디오", 9700, 0.02, 0.07],
    ["MHD", "마이크로하드", 7600, 0.01, 0.04]
];


/* ========================================
   데이터베이스 초기화
======================================== */

async function initializeDatabase() {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");


        // ========================================
        // 사용자
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (

                id TEXT PRIMARY KEY,

                player_number SERIAL UNIQUE,

                username TEXT UNIQUE NOT NULL,

                nickname TEXT UNIQUE NOT NULL,

                salt TEXT NOT NULL,

                password_hash TEXT NOT NULL,

                cash NUMERIC NOT NULL DEFAULT 10000,

                holdings JSONB NOT NULL DEFAULT '{}'::jsonb,

                transactions JSONB NOT NULL DEFAULT '[]'::jsonb,

                banned_until BIGINT,

                ban_reason TEXT,

                created_at BIGINT NOT NULL
            )
        `);


        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS player_number SERIAL
        `);

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS banned_until BIGINT
        `);

        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS ban_reason TEXT
        `);


        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS
            users_player_number_unique
            ON users(player_number)
        `);


        // ========================================
        // 세션
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (

                token TEXT PRIMARY KEY,

                user_id TEXT NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,

                created_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 주식
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS stocks (

                id TEXT PRIMARY KEY,

                name TEXT NOT NULL,

                volatility NUMERIC NOT NULL DEFAULT 0,

                min_change NUMERIC NOT NULL DEFAULT 0.01,

                max_change NUMERIC NOT NULL DEFAULT 0.05,

                price NUMERIC NOT NULL,

                previous NUMERIC NOT NULL,

                open_price NUMERIC NOT NULL,

                high NUMERIC NOT NULL,

                low NUMERIC NOT NULL,

                volume BIGINT NOT NULL DEFAULT 0,

                volume_limit_enabled BOOLEAN
                    NOT NULL DEFAULT FALSE,

                volume_limit BIGINT
                    NOT NULL DEFAULT 0
            )
        `);


        // 기존 stocks 테이블 보정

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS volatility NUMERIC
            NOT NULL DEFAULT 0
        `);

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS min_change NUMERIC
            NOT NULL DEFAULT 0.01
        `);

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS max_change NUMERIC
            NOT NULL DEFAULT 0.05
        `);

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS volume_limit_enabled BOOLEAN
            NOT NULL DEFAULT FALSE
        `);

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS volume_limit BIGINT
            NOT NULL DEFAULT 0
        `);


        // ========================================
        // 주가 기록
        // ========================================

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


        // ========================================
        // 관리자 주가 제어
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS market_controls (

                stock_id TEXT PRIMARY KEY
                    REFERENCES stocks(id)
                    ON DELETE CASCADE,

                direction TEXT NOT NULL DEFAULT 'normal',

                until_time BIGINT NOT NULL DEFAULT 0,

                strength NUMERIC NOT NULL DEFAULT 1
            )
        `);


        // ========================================
        // 알림
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (

                id BIGSERIAL PRIMARY KEY,

                user_id TEXT NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,

                message TEXT NOT NULL,

                type TEXT NOT NULL DEFAULT 'info',

                is_read BOOLEAN NOT NULL DEFAULT FALSE,

                created_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 은행 거래
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS bank_transactions (

                id BIGSERIAL PRIMARY KEY,

                sender_id TEXT
                    REFERENCES users(id)
                    ON DELETE SET NULL,

                receiver_id TEXT
                    REFERENCES users(id)
                    ON DELETE SET NULL,

                amount NUMERIC NOT NULL,

                memo TEXT DEFAULT '',

                type TEXT NOT NULL,

                created_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 피드백
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS feedback (

                id BIGSERIAL PRIMARY KEY,

                user_id TEXT
                    REFERENCES users(id)
                    ON DELETE SET NULL,

                title TEXT NOT NULL,

                content TEXT NOT NULL,

                status TEXT NOT NULL DEFAULT 'pending',

                created_at BIGINT NOT NULL,

                updated_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 변경사항
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS changes (

                id BIGSERIAL PRIMARY KEY,

                title TEXT NOT NULL,

                content TEXT NOT NULL,

                feedback_id BIGINT,

                created_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 공지사항
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS notices (

                id BIGSERIAL PRIMARY KEY,

                title TEXT NOT NULL,

                content TEXT NOT NULL,

                created_at BIGINT NOT NULL,

                updated_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 서버 점검
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS maintenance (

                id INTEGER PRIMARY KEY,

                enabled BOOLEAN NOT NULL DEFAULT FALSE,

                start_time BIGINT,

                end_time BIGINT,

                updated_at BIGINT NOT NULL
            )
        `);


        // ========================================
        // 기본 주식 생성
        // ========================================

        for (const [
            id,
            name,
            price,
            minChange,
            maxChange
        ] of companies) {

            const result =
                await client.query(
                    `
                    SELECT id
                    FROM stocks
                    WHERE id = $1
                    `,
                    [id]
                );


            if (!result.rows.length) {

                await client.query(
                    `
                    INSERT INTO stocks
                    (
                        id,
                        name,
                        volatility,
                        min_change,
                        max_change,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        volume_limit_enabled,
                        volume_limit
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        0,
                        $3,
                        $4,
                        $5,
                        $5,
                        $5,
                        $5,
                        $5,
                        0,
                        FALSE,
                        0
                    )
                    `,
                    [
                        id,
                        name,
                        minChange,
                        maxChange,
                        price
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
                    (
                        $1,
                        $2,
                        $3
                    )
                    `,
                    [
                        id,
                        Date.now(),
                        price
                    ]
                );


                await client.query(
                    `
                    INSERT INTO market_controls
                    (
                        stock_id,
                        direction,
                        until_time,
                        strength
                    )

                    VALUES
                    (
                        $1,
                        'normal',
                        0,
                        1
                    )

                    ON CONFLICT (stock_id)
                    DO NOTHING
                    `,
                    [id]
                );

            } else {

                // 기존 주식의 새 변동값이 비어 있거나
                // 기본값이면 현재 설정을 유지한다.

                await client.query(
                    `
                    UPDATE stocks

                    SET
                        min_change =
                            COALESCE(min_change, $1),

                        max_change =
                            COALESCE(max_change, $2)

                    WHERE id = $3
                    `,
                    [
                        minChange,
                        maxChange,
                        id
                    ]
                );

            }
        }


        // ========================================
        // 점검 기본값
        // ========================================

        await client.query(
            `
            INSERT INTO maintenance
            (
                id,
                enabled,
                start_time,
                end_time,
                updated_at
            )

            VALUES
            (
                1,
                FALSE,
                NULL,
                NULL,
                $1
            )

            ON CONFLICT (id)
            DO NOTHING
            `,
            [Date.now()]
        );


        await client.query("COMMIT");


        console.log(
            "✅ PostgreSQL 데이터베이스 초기화 완료."
        );

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


module.exports = {
    pool,
    companies,
    initializeDatabase
};
```

---

## 2. `services/market.js`

**중요:** 이 파일에서는 이제 `database.js`를 다시 불러오지 않는다.
이게 현재 `Cannot find module './services/database'` / 순환참조 문제를 해결하는 핵심이다.

```javascript
const {
    pool
} = require("./database");


/* ========================================
   전체 주식
======================================== */

async function getStocks() {

    const result =
        await pool.query(`
            SELECT *
            FROM stocks
            ORDER BY id
        `);

    return result.rows;
}


/* ========================================
   특정 주식
======================================== */

async function getStock(id) {

    const result =
        await pool.query(
            `
            SELECT *
            FROM stocks
            WHERE id = $1
            `,
            [id]
        );

    return result.rows[0] || null;
}


/* ========================================
   주가 기록
======================================== */

async function getHistory(
    id,
    range = "1d"
) {

    const ranges = {

        "1d": 86400000,

        "1w": 604800000,

        "1m": 2592000000,

        "3m": 7776000000,

        "all": Infinity

    };


    const selectedRange =
        ranges[range] ??
        ranges["1d"];


    const minTime =
        selectedRange === Infinity
            ? 0
            : Date.now() - selectedRange;


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


    return result.rows.map(
        row => ({

            t: Number(row.t),

            p: Number(row.p)

        })
    );
}


/* ========================================
   주가 설정
======================================== */

async function setPrice(
    id,
    price
) {

    const value =
        Math.round(
            Number(price)
        );


    if (
        !Number.isFinite(value) ||
        value < 100
    ) {

        throw new Error(
            "가격이 올바르지 않습니다."
        );

    }


    await pool.query(
        `
        UPDATE stocks

        SET
            previous = price,

            price = $1,

            high =
                GREATEST(high, $1),

            low =
                LEAST(low, $1)

        WHERE id = $2
        `,
        [
            value,
            id
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
        (
            $1,
            $2,
            $3
        )
        `,
        [
            id,
            Date.now(),
            value
        ]
    );


    return getStock(id);
}


/* ========================================
   다음 주가 계산
======================================== */

/*
 * 이제 volatility를 사용하지 않는다.
 *
 * min_change = 최소 변동률
 * max_change = 최대 변동률
 *
 * 예:
 *
 * min = 0.01
 * max = 0.05
 *
 * → 1% ~ 5% 중 랜덤으로 변동
 *
 * 방향은 상승/하락 랜덤.
 */

function calculateNextPrice(stock) {

    const currentPrice =
        Number(stock.price);


    let minChange =
        Number(stock.min_change);


    let maxChange =
        Number(stock.max_change);


    // 잘못된 값 방어

    if (
        !Number.isFinite(minChange) ||
        minChange < 0
    ) {
        minChange = 0.01;
    }


    if (
        !Number.isFinite(maxChange) ||
        maxChange < minChange
    ) {
        maxChange =
            Math.max(
                minChange,
                0.05
            );
    }


    /*
     * 최소 ~ 최대 사이의
     * 랜덤 변동률
     */

    const changeRate =
        minChange +
        Math.random() *
        (
            maxChange -
            minChange
        );


    /*
     * 상승 / 하락 랜덤
     *
     * 50% 상승
     * 50% 하락
     */

    const direction =
        Math.random() < 0.5
            ? -1
            : 1;


    const change =
        currentPrice *
        changeRate *
        direction;


    let nextPrice =
        currentPrice + change;


    /*
     * 최저 가격 100원
     */

    nextPrice =
        Math.max(
            100,
            nextPrice
        );


    return Math.round(
        nextPrice
    );
}


/* ========================================
   관리자 방향 제어를 적용한
   다음 주가 계산
======================================== */

async function calculateControlledPrice(
    stock
) {

    const result =
        await pool.query(
            `
            SELECT
                direction,
                until_time,
                strength

            FROM market_controls

            WHERE stock_id = $1
            `,
            [stock.id]
        );


    const control =
        result.rows[0];


    if (
        !control ||
        control.direction === "normal"
    ) {

        return calculateNextPrice(
            stock
        );

    }


    /*
     * 시간이 끝났으면 normal로 복귀
     */

    if (
        Number(control.until_time) > 0 &&
        Date.now() >=
        Number(control.until_time)
    ) {

        await pool.query(
            `
            UPDATE market_controls

            SET
                direction = 'normal',
                until_time = 0,
                strength = 1

            WHERE stock_id = $1
            `,
            [stock.id]
        );


        return calculateNextPrice(
            stock
        );

    }


    let minChange =
        Number(stock.min_change);


    let maxChange =
        Number(stock.max_change);


    if (
        !Number.isFinite(minChange) ||
        minChange < 0
    ) {
        minChange = 0.01;
    }


    if (
        !Number.isFinite(maxChange) ||
        maxChange < minChange
    ) {
        maxChange = 0.05;
    }


    /*
     * 최소 ~ 최대 사이
     */

    const changeRate =
        minChange +
        Math.random() *
        (
            maxChange -
            minChange
        );


    let strength =
        Number(control.strength);


    if (
        !Number.isFinite(strength) ||
        strength <= 0
    ) {
        strength = 1;
    }


    /*
     * 관리자 방향
     *
     * up   → 상승
     * down → 하락
     */

    const direction =
        control.direction === "up"
            ? 1
            : -1;


    const change =
        Number(stock.price) *
        changeRate *
        strength *
        direction;


    const nextPrice =
        Math.max(
            100,
            Number(stock.price) + change
        );


    return Math.round(
        nextPrice
    );
}


/* ========================================
   시장 전체 주가 변동
======================================== */

async function updateMarket() {

    try {

        const stocks =
            await getStocks();


        for (
            const stock of stocks
        ) {

            const nextPrice =
                await calculateControlledPrice(
                    stock
                );


            await setPrice(
                stock.id,
                nextPrice
            );

        }


        console.log(
            `📈 주가 자동 변동 완료 · ${stocks.length}개 종목`
        );

    } catch (error) {

        console.error(
            "❌ 주가 자동 변동 오류:",
            error
        );

    }
}


/* ========================================
   주가 엔진 시작
======================================== */

function startMarketEngine() {

    const interval =
        5000;


    console.log("");

    console.log(
        `📈 주가 엔진 시작 · ${interval / 1000}초 간격`
    );


    /*
     * 서버 시작 직후 한 번 실행
     */

    updateMarket();


    /*
     * 이후 5초마다 실행
     */

    setInterval(
        updateMarket,
        interval
    );

}


/* ========================================
   Export
======================================== */

module.exports = {

    pool,

    getStocks,

    getStock,

    getHistory,

    setPrice,

    calculateNextPrice,

    updateMarket,

    startMarketEngine

};
```

---

## 3. `routes/admin.js`

관리자 페이지에서도 **최소 변동률 / 최대 변동률**을 직접 설정할 수 있게 수정한다.

```javascript
const express = require("express");

const {
    pool
} = require("../services/market");


const router =
    express.Router();


// =====================================================
// 관리자 인증
// =====================================================

function getAdminPassword() {

    return (
        process.env.ADMIN_PASSWORD ||
        "admin1234"
    );

}


function adminAuth(
    req,
    res,
    next
) {

    const password =
        req.headers["x-admin-password"];


    if (
        !password ||
        password !== getAdminPassword()
    ) {

        return res.status(401).json({

            ok: false,

            error:
                "관리자 인증이 필요합니다."

        });

    }


    next();

}


// =====================================================
// 관리자 인증 확인
// =====================================================

router.get(
    "/check",
    adminAuth,
    (req, res) => {

        res.json({

            ok: true,

            message:
                "관리자 인증 성공"

        });

    }
);


// =====================================================
// 플레이어 목록
// =====================================================

router.get(
    "/users",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        banned_until,
                        ban_reason,
                        created_at

                    FROM users

                    ORDER BY
                        player_number ASC
                `);


            res.json({

                ok: true,

                users:
                    result.rows

            });

        } catch (error) {

            console.error(
                "ADMIN USERS ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "플레이어 목록을 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 플레이어 수정
// =====================================================

router.patch(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(req.params.id);


            const {
                nickname,
                cash,
                playerNumber
            } = req.body;


            const fields = [];

            const values = [];

            let index = 1;


            if (
                nickname !== undefined &&
                String(nickname).trim()
            ) {

                fields.push(
                    `nickname = $${index++}`
                );


                values.push(
                    String(nickname).trim()
                );

            }


            if (
                cash !== undefined
            ) {

                const money =
                    Number(cash);


                if (
                    !Number.isFinite(money) ||
                    money < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 잔액입니다."

                    });

                }


                fields.push(
                    `cash = $${index++}`
                );


                values.push(
                    money
                );

            }


            if (
                playerNumber !== undefined
            ) {

                const number =
                    Number(playerNumber);


                if (
                    !Number.isInteger(number) ||
                    number <= 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 플레이어 번호입니다."

                    });

                }


                fields.push(
                    `player_number = $${index++}`
                );


                values.push(
                    number
                );

            }


            if (!fields.length) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "수정할 항목이 없습니다."

                });

            }


            values.push(id);


            const result =
                await pool.query(
                    `
                    UPDATE users

                    SET ${fields.join(", ")}

                    WHERE id = $${index}

                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        banned_until,
                        ban_reason,
                        created_at
                    `,
                    values
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "플레이어를 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true,

                user:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN USER UPDATE ERROR:",
                error
            );


            if (
                error.code === "23505"
            ) {

                return res.status(409).json({

                    ok: false,

                    error:
                        "이미 사용 중인 닉네임 또는 플레이어 번호입니다."

                });

            }


            res.status(500).json({

                ok: false,

                error:
                    "플레이어 수정에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 플레이어 밴
// =====================================================

router.post(
    "/users/:id/ban",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(req.params.id);


            const {
                duration,
                reason
            } = req.body;


            let bannedUntil = null;


            if (
                duration !== "permanent"
            ) {

                const minutes =
                    Number(duration);


                if (
                    !Number.isFinite(minutes) ||
                    minutes <= 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 밴 기간입니다."

                    });

                }


                bannedUntil =
                    Date.now() +
                    minutes *
                    60 *
                    1000;

            }


            const result =
                await pool.query(
                    `
                    UPDATE users

                    SET
                        banned_until = $1,
                        ban_reason = $2

                    WHERE id = $3

                    RETURNING
                        id,
                        player_number,
                        nickname,
                        banned_until,
                        ban_reason
                    `,
                    [
                        bannedUntil,

                        String(
                            reason || ""
                        ).slice(0, 200),

                        id
                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "플레이어를 찾을 수 없습니다."

                });

            }


            await pool.query(
                `
                DELETE FROM sessions

                WHERE user_id = $1
                `,
                [id]
            );


            res.json({

                ok: true,

                user:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN BAN ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "밴 처리에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 밴 해제
// =====================================================

router.post(
    "/users/:id/unban",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE users

                    SET
                        banned_until = NULL,
                        ban_reason = NULL

                    WHERE id = $1

                    RETURNING
                        id,
                        player_number,
                        nickname,
                        banned_until,
                        ban_reason
                    `,
                    [req.params.id]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "플레이어를 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true,

                user:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN UNBAN ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "밴 해제에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 플레이어 삭제
// =====================================================

router.delete(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM users

                    WHERE id = $1

                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname
                    `,
                    [req.params.id]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "플레이어를 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true,

                deleted:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN USER DELETE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "플레이어 삭제에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 주식 목록
// =====================================================

router.get(
    "/stocks",
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
                        min_change,
                        max_change,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        volume_limit_enabled,
                        volume_limit

                    FROM stocks

                    ORDER BY id ASC
                    `
                );


            res.json({

                ok: true,

                stocks:
                    result.rows

            });

        } catch (error) {

            console.error(
                "ADMIN STOCK LIST ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "주식 목록을 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 주식 추가
// =====================================================

router.post(
    "/stocks",
    adminAuth,
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            const {
                id,
                name,
                price,
                volatility,
                minChange,
                maxChange,
                volumeLimitEnabled,
                volumeLimit
            } = req.body;


            const stockId =
                String(id || "")
                    .trim()
                    .toLowerCase();


            const stockName =
                String(name || "")
                    .trim();


            const stockPrice =
                Number(price);


            const stockVolatility =
                Number(volatility || 0);


            const stockMinChange =
                Number(minChange);


            const stockMaxChange =
                Number(maxChange);


            if (!stockId) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "주식 ID를 입력하세요."

                });

            }


            if (!stockName) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "주식 이름을 입력하세요."

                });

            }


            if (
                !Number.isFinite(stockPrice) ||
                stockPrice <= 0
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "주가가 올바르지 않습니다."

                });

            }


            if (
                !Number.isFinite(stockMinChange) ||
                stockMinChange < 0
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "최소 변동률이 올바르지 않습니다."

                });

            }


            if (
                !Number.isFinite(stockMaxChange) ||
                stockMaxChange < stockMinChange
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "최대 변동률이 올바르지 않습니다."

                });

            }


            await client.query("BEGIN");


            const result =
                await client.query(
                    `
                    INSERT INTO stocks
                    (
                        id,
                        name,
                        volatility,
                        min_change,
                        max_change,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        volume_limit_enabled,
                        volume_limit
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $6,
                        $6,
                        $6,
                        $6,
                        0,
                        $7,
                        $8
                    )

                    RETURNING *
                    `,
                    [
                        stockId,
                        stockName,
                        stockVolatility,
                        stockMinChange,
                        stockMaxChange,
                        stockPrice,
                        Boolean(volumeLimitEnabled),
                        Math.max(
                            0,
                            Number(volumeLimit || 0)
                        )
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
                (
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    stockId,
                    Date.now(),
                    stockPrice
                ]
            );


            await client.query(
                `
                INSERT INTO market_controls
                (
                    stock_id,
                    direction,
                    until_time,
                    strength
                )

                VALUES
                (
                    $1,
                    'normal',
                    0,
                    1
                )
                `,
                [stockId]
            );


            await client.query("COMMIT");


            res.status(201).json({

                ok: true,

                stock:
                    result.rows[0]

            });

        } catch (error) {

            try {

                await client.query(
                    "ROLLBACK"
                );

            } catch (_) {}


            console.error(
                "ADMIN STOCK CREATE ERROR:",
                error
            );


            if (
                error.code === "23505"
            ) {

                return res.status(409).json({

                    ok: false,

                    error:
                        "이미 존재하는 주식 ID입니다."

                });

            }


            res.status(500).json({

                ok: false,

                error:
                    "주식 추가에 실패했습니다."

            });

        } finally {

            client.release();

        }

    }
);


// =====================================================
// 주식 수정
// =====================================================

router.patch(
    "/stocks/:id",
    adminAuth,
    async (req, res) => {

        try {

            const {
                name,
                price,
                volatility,
                minChange,
                maxChange,
                volumeLimitEnabled,
                volumeLimit
            } = req.body;


            const fields = [];

            const values = [];

            let index = 1;


            if (
                name !== undefined
            ) {

                const value =
                    String(name).trim();


                if (!value) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "주식 이름이 올바르지 않습니다."

                    });

                }


                fields.push(
                    `name = $${index++}`
                );


                values.push(
                    value
                );

            }


            if (
                price !== undefined
            ) {

                const value =
                    Number(price);


                if (
                    !Number.isFinite(value) ||
                    value <= 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 주가입니다."

                    });

                }


                fields.push(
                    `price = $${index++}`
                );


                values.push(
                    value
                );

            }


            if (
                volatility !== undefined
            ) {

                const value =
                    Number(volatility);


                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 변동성입니다."

                    });

                }


                fields.push(
                    `volatility = $${index++}`
                );


                values.push(
                    value
                );

            }


            if (
                minChange !== undefined
            ) {

                const value =
                    Number(minChange);


                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 최소 변동률입니다."

                    });

                }


                fields.push(
                    `min_change = $${index++}`
                );


                values.push(
                    value
                );

            }


            if (
                maxChange !== undefined
            ) {

                const value =
                    Number(maxChange);


                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 최대 변동률입니다."

                    });

                }


                fields.push(
                    `max_change = $${index++}`
                );


                values.push(
                    value
                );

            }


            if (
                minChange !== undefined &&
                maxChange !== undefined
            ) {

                const min =
                    Number(minChange);

                const max =
                    Number(maxChange);


                if (max < min) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "최대 변동률은 최소 변동률보다 작을 수 없습니다."

                    });

                }

            }


            if (
                volumeLimitEnabled !== undefined
            ) {

                fields.push(
                    `volume_limit_enabled = $${index++}`
                );


                values.push(
                    Boolean(
                        volumeLimitEnabled
                    )
                );

            }


            if (
                volumeLimit !== undefined
            ) {

                const value =
                    Number(volumeLimit);


                if (
                    !Number.isInteger(value) ||
                    value < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 거래량 제한입니다."

                    });

                }


                fields.push(
                    `volume_limit = $${index++}`
                );


                values.push(
                    value
                );

            }


            if (!fields.length) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "수정할 항목이 없습니다."

                });

            }


            values.push(
                req.params.id
            );


            const result =
                await pool.query(
                    `
                    UPDATE stocks

                    SET ${fields.join(", ")}

                    WHERE id = $${index}

                    RETURNING *
                    `,
                    values
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "주식을 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true,

                stock:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN STOCK UPDATE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "주식 수정에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 주식 삭제
// =====================================================

router.delete(
    "/stocks/:id",
    adminAuth,
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            await client.query(
                "BEGIN"
            );


            const result =
                await client.query(
                    `
                    DELETE FROM stocks

                    WHERE id = $1

                    RETURNING *
                    `,
                    [req.params.id]
                );


            if (!result.rows.length) {

                await client.query(
                    "ROLLBACK"
                );


                return res.status(404).json({

                    ok: false,

                    error:
                        "주식을 찾을 수 없습니다."

                });

            }


            await client.query(
                "COMMIT"
            );


            res.json({

                ok: true,

                deleted:
                    result.rows[0]

            });

        } catch (error) {

            try {

                await client.query(
                    "ROLLBACK"
                );

            } catch (_) {}


            console.error(
                "ADMIN STOCK DELETE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "주식 삭제에 실패했습니다."

            });

        } finally {

            client.release();

        }

    }
);


// =====================================================
// 주가 방향 제어
// =====================================================

router.post(
    "/stocks/:id/control",
    adminAuth,
    async (req, res) => {

        try {

            const {
                direction,
                duration,
                strength
            } = req.body;


            const allowed = [
                "normal",
                "up",
                "down"
            ];


            if (
                !allowed.includes(
                    direction
                )
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "잘못된 주가 방향입니다."

                });

            }


            const minutes =
                Number(duration || 0);


            const controlStrength =
                Number(strength || 1);


            const untilTime =
                direction === "normal"
                    ? 0
                    : Date.now() +
                      Math.max(
                          0,
                          minutes
                      ) *
                      60 *
                      1000;


            const result =
                await pool.query(
                    `
                    INSERT INTO market_controls
                    (
                        stock_id,
                        direction,
                        until_time,
                        strength
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4
                    )

                    ON CONFLICT (stock_id)

                    DO UPDATE SET
                        direction =
                            EXCLUDED.direction,

                        until_time =
                            EXCLUDED.until_time,

                        strength =
                            EXCLUDED.strength

                    RETURNING *
                    `,
                    [
                        req.params.id,
                        direction,
                        untilTime,
                        controlStrength
                    ]
                );


            res.json({

                ok: true,

                control:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN STOCK CONTROL ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "주가 제어에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 피드백
// =====================================================

router.get(
    "/feedback",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        f.*,
                        u.player_number,
                        u.nickname

                    FROM feedback f

                    LEFT JOIN users u
                        ON u.id = f.user_id

                    ORDER BY
                        f.created_at DESC
                    `
                );


            res.json({

                ok: true,

                feedback:
                    result.rows

            });

        } catch (error) {

            console.error(
                "ADMIN FEEDBACK ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "피드백을 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 피드백 상태
// =====================================================

router.patch(
    "/feedback/:id",
    adminAuth,
    async (req, res) => {

        try {

            const allowed = [
                "pending",
                "review",
                "accepted",
                "rejected"
            ];


            if (
                !allowed.includes(
                    req.body.status
                )
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "잘못된 상태입니다."

                });

            }


            const result =
                await pool.query(
                    `
                    UPDATE feedback

                    SET
                        status = $1,
                        updated_at = $2

                    WHERE id = $3

                    RETURNING *
                    `,
                    [
                        req.body.status,
                        Date.now(),
                        req.params.id
                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "피드백을 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true,

                feedback:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN FEEDBACK UPDATE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "피드백 수정에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 공지사항
// =====================================================

router.get(
    "/notices",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM notices
                    ORDER BY created_at DESC
                    `
                );


            res.json({

                ok: true,

                notices:
                    result.rows

            });

        } catch (error) {

            console.error(
                "ADMIN NOTICES ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "공지사항을 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 공지 생성
// =====================================================

router.post(
    "/notices",
    adminAuth,
    async (req, res) => {

        try {

            const title =
                String(
                    req.body.title || ""
                ).trim();


            const content =
                String(
                    req.body.content || ""
                ).trim();


            if (
                !title ||
                !content
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "제목과 내용을 입력하세요."

                });

            }


            const now =
                Date.now();


            const result =
                await pool.query(
                    `
                    INSERT INTO notices
                    (
                        title,
                        content,
                        created_at,
                        updated_at
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $3
                    )

                    RETURNING *
                    `,
                    [
                        title,
                        content,
                        now
                    ]
                );


            res.status(201).json({

                ok: true,

                notice:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE CREATE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "공지사항 생성에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 공지 삭제
// =====================================================

router.delete(
    "/notices/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM notices

                    WHERE id = $1

                    RETURNING *
                    `,
                    [req.params.id]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "공지사항을 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true,

                deleted:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE DELETE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "공지사항 삭제에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 서버 점검 상태
// =====================================================

router.get(
    "/maintenance",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM maintenance
                    WHERE id = 1
                    `
                );


            res.json({

                ok: true,

                maintenance:
                    result.rows[0] ||
                    null

            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "점검 상태를 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 서버 점검 시작
// =====================================================

router.post(
    "/maintenance/start",
    adminAuth,
    async (req, res) => {

        try {

            const startTime =
                Number(
                    req.body.startTime ||
                    Date.now()
                );


            const endTime =
                req.body.endTime
                    ? Number(
                        req.body.endTime
                    )
                    : null;


            const result =
                await pool.query(
                    `
                    UPDATE maintenance

                    SET
                        enabled = TRUE,
                        start_time = $1,
                        end_time = $2,
                        updated_at = $3

                    WHERE id = 1

                    RETURNING *
                    `,
                    [
                        startTime,
                        endTime,
                        Date.now()
                    ]
                );


            res.json({

                ok: true,

                maintenance:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE START ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "점검 시작에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 서버 점검 종료
// =====================================================

router.post(
    "/maintenance/end",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE maintenance

                    SET
                        enabled = FALSE,
                        start_time = NULL,
                        end_time = NULL,
                        updated_at = $1

                    WHERE id = 1

                    RETURNING *
                    `,
                    [Date.now()]
                );


            res.json({

                ok: true,

                maintenance:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE END ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "점검 종료에 실패했습니다."

            });

        }

    }
);


// =====================================================
// Export
// =====================================================

module.exports =
    router;
```

---

## 4. `server.js`

네가 마지막으로 준 `server.js`는 **그대로 사용하면 된다.**

```javascript
const express = require("express");
const path = require("path");

const app = express();

const PORT =
    process.env.PORT || 3000;


// ========================================
// 기본 설정
// ========================================

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);


// ========================================
// 정적 파일
// ========================================

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// ========================================
// 서비스
// ========================================

const {
    initializeDatabase
} = require("./services/database");


const {
    startMarketEngine
} = require("./services/market");


// ========================================
// 라우터
// ========================================

const authRoutes =
    require("./routes/auth");

const stockRoutes =
    require("./routes/stocks");

const bankRoutes =
    require("./routes/bank");

const feedbackRoutes =
    require("./routes/feedback");

const noticeRoutes =
    require("./routes/notices");

const adminRoutes =
    require("./routes/admin");

const notificationsRouter =
    require("./routes/notifications");


// ========================================
// API
// ========================================

app.use(
    "/api/notifications",
    notificationsRouter
);

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/stocks",
    stockRoutes
);

app.use(
    "/api/bank",
    bankRoutes
);

app.use(
    "/api/feedback",
    feedbackRoutes
);

app.use(
    "/api/notices",
    noticeRoutes
);

app.use(
    "/api/admin",
    adminRoutes
);


// ========================================
// 서버 상태
// ========================================

app.get(
    "/api/status",
    async (req, res) => {

        res.json({

            ok: true,

            name:
                "VSM Virtual Stock Market",

            time:
                Date.now()

        });

    }
);


// ========================================
// 홈페이지
// ========================================

app.get(
    "/",
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
// API 404
// ========================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            error:
                "존재하지 않는 API입니다."

        });

    }
);


// ========================================
// 홈페이지 fallback
// ========================================

app.use(
    (req, res) => {

        const indexPath =
            path.join(
                __dirname,
                "public",
                "index.html"
            );


        res.sendFile(
            indexPath,
            err => {

                if (err) {

                    res.status(404).send(
                        "VSM 홈페이지 파일을 찾을 수 없습니다."
                    );

                }

            }
        );

    }
);


// ========================================
// 서버 시작
// ========================================

async function startServer() {

    try {

        await initializeDatabase();

        await startMarketEngine();


        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log("");

                console.log(
                    "================================"
                );

                console.log(
                    " VSM Virtual Stock Market"
                );

                console.log(
                    "================================"
                );

                console.log(
                    "✅ 서버 시작"
                );

                console.log(
                    "✅ PostgreSQL 연결"
                );

                console.log(
                    "✅ 주가 자동 변동 엔진"
                );

                console.log(
                    "포트:",
                    PORT
                );

                console.log(
                    "================================"
                );

                console.log("");

            }
        );

    } catch (error) {

        console.error("");

        console.error(
            "❌ 서버 시작 실패:",
            error
        );

        console.error("");

        process.exit(1);

    }

}


startServer();



