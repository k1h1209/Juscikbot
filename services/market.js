
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
// =====================================================

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
//  기록
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
//  설정
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
// 다음  계산
//
// min_change ~ max_change
// 절대 금액 기준
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

        maxChange =
            minChange;
    }


    // 작은 값이 항상 최소
    if (
        minChange >
        maxChange
    ) {

        [
            minChange,
            maxChange
        ] = [
            maxChange,
            minChange
        ];
    }


    // 랜덤 변동량
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
            control.direction !==
                "normal" &&
            Number(control.until_time) >
                now
        ) {

            if (
                control.direction ===
                "up"
            ) {

                direction = 1;

            } else if (
                control.direction ===
                "down"
            ) {

                direction = -1;
            }
        }
    }


    let nextPrice =
        currentPrice +
        direction *
        change;


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

