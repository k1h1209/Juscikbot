
const { Pool } = require("pg");

// =====================================================
// PostgreSQL
// =====================================================

const pool = new Pool({

    connectionString:
        process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    }

});

// =====================================================
// 기본 주식
// [ID, 이름, 시작가격, 최소변동값, 최대변동값]
// =====================================================

const companies = [

    ["SKNX", "스카닉스하이닉스", 4250, 10, 50],
    ["SAMS", "샘숭전자", 7100, 10, 40],
    ["TWAI", "티Wai", 1850, 5, 30],
    ["NVR", "나이버", 3500, 10, 40],
    ["NFLX", "니플릭스", 5200, 10, 50],
    ["PASC", "파스코", 2800, 5, 30],
    ["LG", "알쥐", 6400, 10, 40],
    ["HYUN", "현재자동차", 8300, 10, 50],
    ["NVDO", "N비디오", 9700, 20, 70],
    ["MHD", "마이크로하드", 7600, 10, 50]

];

// =====================================================
// 전체 주식
// =====================================================

async function getStocks() {

    const result =
        await pool.query(`
            SELECT *
            FROM stocks
            ORDER BY id
        `);

    return result.rows;

}

// =====================================================
// 특정 주식
// =====================================================

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

// =====================================================
// 주가 기록
// =====================================================

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

// =====================================================
// 주가 설정
// =====================================================

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

// =====================================================
// 다음 주가 계산
//
// volatility 사용 안 함
//
// 최소 변동값 ~ 최대 변동값의
// 절대 금액만큼 랜덤하게 움직임
// =====================================================

function calculateNextPrice(
    stock,
    control = null
) {

    const currentPrice =
        Number(stock.price);

    let minChange =
        Math.abs(
            Number(stock.min_change)
        );

    let maxChange =
        Math.abs(
            Number(stock.max_change)
        );

    if (
        !Number.isFinite(minChange)
    ) {
        minChange = 1;
    }

    if (
        !Number.isFinite(maxChange)
    ) {
        maxChange = minChange;
    }

    if (
        minChange > maxChange
    ) {

        [
            minChange,
            maxChange
        ] = [
            maxChange,
            minChange
        ];

    }

    const change =
        minChange +
        Math.random() *
        (
            maxChange -
            minChange
        );

    let direction =
        Math.random() < 0.5
            ? -1
            : 1;

    // 관리자 방향 제어
    if (control) {

        const now =
            Date.now();

        if (
            control.direction !== "normal" &&
            Number(control.until_time) > now
        ) {

            if (
                control.direction === "up"
            ) {

                direction = 1;

            } else if (
                control.direction === "down"
            ) {

                direction = -1;

            }

        }

    }

    let nextPrice =
        currentPrice +
        direction * change;

    nextPrice =
        Math.max(
            100,
            nextPrice
        );

    return Math.round(
        nextPrice
    );

}

// =====================================================
// 시장 업데이트
// =====================================================

async function updateMarket() {

    try {

        const stocks =
            await getStocks();

        for (
            const stock
            of stocks
        ) {

            const controlResult =
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
                controlResult.rows[0] ||
                null;

            const nextPrice =
                calculateNextPrice(
                    stock,
                    control
                );

            await setPrice(
                stock.id,
                nextPrice
            );

        }

    } catch (error) {

        console.error(
            "❌ 주가 자동 변동 오류:",
            error
        );

    }

}

// =====================================================
// 주가 엔진
// =====================================================

function startMarketEngine() {

    const interval =
        5000;

    console.log("");

    console.log(
        `📈 주가 엔진 시작 · ${interval / 1000}초 간격`
    );

    updateMarket();

    setInterval(
        updateMarket,
        interval
    );

}

// =====================================================
// Export
// =====================================================

module.exports = {

    pool,

    companies,

    getStocks,

    getStock,

    getHistory,

    setPrice,

    updateMarket,

    startMarketEngine,

    calculateNextPrice

};

