
const { pool, companies } = require("./market");

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

                created_at BIGINT NOT NULL
            )
        `);


        // 기존 users 테이블
        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS player_number SERIAL
        `);


        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS
            users_player_number_unique
            ON users(player_number)
        `);


        // ========================================
        // 로그인 세션
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
        //
        // volatility 제거
        // min_change / max_change 사용
        // ========================================

        await client.query(`
            CREATE TABLE IF NOT EXISTS stocks (

                id TEXT PRIMARY KEY,

                name TEXT NOT NULL,

                price NUMERIC NOT NULL,

                previous NUMERIC NOT NULL,

                open_price NUMERIC NOT NULL,

                high NUMERIC NOT NULL,

                low NUMERIC NOT NULL,

                volume BIGINT NOT NULL DEFAULT 0,

                min_change NUMERIC NOT NULL DEFAULT 1,

                max_change NUMERIC NOT NULL DEFAULT 10

            )
        `);


        // ========================================
        // 기존 stocks 테이블 마이그레이션
        // ========================================

        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS
            min_change NUMERIC NOT NULL DEFAULT 1
        `);


        await client.query(`
            ALTER TABLE stocks
            ADD COLUMN IF NOT EXISTS
            max_change NUMERIC NOT NULL DEFAULT 10
        `);


        // 기존 volatility 제거
        await client.query(`
            ALTER TABLE stocks
            DROP COLUMN IF EXISTS volatility
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
        // 은행 이체 기록
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
        // 서버 점검 상태
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
        //
        // companies:
        //
        // [id, name, price, min_change, max_change]
        // ========================================

        for (
            const [
                id,
                name,
                price,
                minChange,
                maxChange
            ]
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


            if (
                result.rows.length === 0
            ) {

                await client.query(
                    `
                    INSERT INTO stocks
                    (
                        id,
                        name,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        min_change,
                        max_change
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $3,
                        $3,
                        $3,
                        $3,
                        0,
                        $4,
                        $5
                    )
                    `,
                    [
                        id,
                        name,
                        price,
                        minChange,
                        maxChange
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

            } else {

                // 기존 주식에도
                // companies의 변동값 적용

                await client.query(
                    `
                    UPDATE stocks

                    SET
                        name = $2,
                        min_change = $4,
                        max_change = $5

                    WHERE id = $1
                    `,
                    [
                        id,
                        name,
                        price,
                        minChange,
                        maxChange
                    ]
                );

            }

        }


        // ========================================
        // 점검 상태 기본값
        // ========================================

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


        // ========================================
        // 완료
        // ========================================

        await client.query(
            "COMMIT"
        );


        console.log(
            "✅ PostgreSQL 데이터베이스 초기화 완료."
        );


    } catch (error) {

        await client.query(
            "ROLLBACK"
        );


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

