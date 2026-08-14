
const { pool, companies } = require("./market");


// =====================================================
// 데이터베이스 초기화
// =====================================================

async function initializeDatabase() {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");


        // =================================================
        // 사용자
        // =================================================

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


        // 기존 DB 보정
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


        // =================================================
        // 세션
        // =================================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (

                token TEXT PRIMARY KEY,

                user_id TEXT NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,

                created_at BIGINT NOT NULL
            )
        `);


        // =================================================
        // 주식
        // =================================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS stocks (

                id TEXT PRIMARY KEY,

                name TEXT NOT NULL,

                volatility NUMERIC NOT NULL DEFAULT 0.05,

                min_change NUMERIC NOT NULL DEFAULT 1,

                max_change NUMERIC NOT NULL DEFAULT 100,

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
            ADD COLUMN IF NOT EXISTS min_change NUMERIC
            NOT NULL DEFAULT 1
        `);

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS max_change NUMERIC
            NOT NULL DEFAULT 100
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


        // =================================================
        // 주가 기록
        // =================================================

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


        // =================================================
        // 관리자 주가 제어
        // =================================================

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


        // =================================================
        // 알림
        // =================================================

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


        // =================================================
        // 은행 이체
        // =================================================

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


        // =================================================
        // 피드백
        // =================================================

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


        // =================================================
        // 변경사항
        // =================================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS changes (

                id BIGSERIAL PRIMARY KEY,

                title TEXT NOT NULL,

                content TEXT NOT NULL,

                feedback_id BIGINT,

                created_at BIGINT NOT NULL
            )
        `);


        // =================================================
        // 공지사항
        // =================================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS notices (

                id BIGSERIAL PRIMARY KEY,

                title TEXT NOT NULL,

                content TEXT NOT NULL,

                created_at BIGINT NOT NULL,

                updated_at BIGINT NOT NULL
            )
        `);


        // =================================================
        // 서버 점검
        // =================================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS maintenance (

                id INTEGER PRIMARY KEY,

                enabled BOOLEAN NOT NULL DEFAULT FALSE,

                start_time BIGINT,

                end_time BIGINT,

                updated_at BIGINT NOT NULL
            )
        `);


        // =================================================
        // 기본 주식 생성
        // =================================================

        for (
            const [id, name, price, volatility]
            of companies
        ) {

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

                const defaultMin =
                    Math.max(
                        1,
                        Math.round(
                            Number(price) *
                            Number(volatility) *
                            0.01
                        )
                    );

                const defaultMax =
                    Math.max(
                        defaultMin,
                        Math.round(
                            Number(price) *
                            Number(volatility) *
                            0.05
                        )
                    );


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
                        FALSE,
                        0
                    )
                    `,
                    [
                        id,
                        name,
                        volatility,
                        defaultMin,
                        defaultMax,
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
                    `,
                    [id]
                );

            }
        }


        // =================================================
        // 점검 기본값
        // =================================================

        await client.query(`
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
        `, [
            Date.now()
        ]);


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
    initializeDatabase
};

