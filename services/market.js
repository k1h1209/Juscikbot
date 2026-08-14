const { Pool } = require("pg");


const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    }
});


// =====================================================
// 기본 주식
//
// [ID, 이름, 시작가격, 최소변동, 최대변동, 변동주기]
// =====================================================

const companies = [

    ["SKNX",  "스카닉스하이닉스", 4250, 1, 80, 5],

    ["SAMS",  "샘숭전자",         7100, 1, 50, 5],

    ["TWAI",  "티Wai",            1850, 1, 100, 5],

    ["NVR",   "나이버",           3500, 1, 70, 5],

    ["NFLX",  "니플릭스",         5200, 1, 90, 5],

    ["PASC",  "파스코",           2800, 1, 60, 5],

    ["LG",    "알쥐",             6400, 1, 50, 5],

    ["HYUN",  "현재자동차",       8300, 1, 60, 5],

    ["NVDO",  "N비디오",          9700, 1, 120, 5],

    ["MHD",   "마이크로하드",     7600, 1, 70, 5]

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
        await pool.query(`
            SELECT *
            FROM stocks
            WHERE id = $1
        `, [
            id
        ]);

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
        await pool.query(`
            SELECT
                time AS t,
                price AS p

            FROM price_history

            WHERE stock_id = $1

              AND time >= $2

            ORDER BY time ASC

            LIMIT 1000
        `, [
            id,
            minTime
        ]);


    return result.rows.map(row => ({

        t: Number(row.t),

        p: Number(row.p)

    }));
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


    await pool.query(`
        UPDATE stocks

        SET
            previous = price,

            price = $1,

            high = GREATEST(high, $1),

            low = LEAST(low, $1)

        WHERE id = $2
    `, [
        value,
        id
    ]);


    await pool.query(`
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
    `, [
        id,
        Date.now(),
        value
    ]);


    return getStock(id);
}


// =====================================================
// 랜덤 정수
// =====================================================

function randomInteger(
    min,
    max
) {

    return Math.floor(
        Math.random() *
        (max - min + 1)
    ) + min;

}


// =====================================================
// 다음 주가 계산
//
// min_change ~ max_change 사이에서
// 실제 원 단위 변동값을 뽑는다.
// =====================================================

function calculateNextPrice(
    stock,
    directionOverride = null
) {

    const currentPrice =
        Number(stock.price);


    let minChange =
        Number(stock.min_change);


    let maxChange =
        Number(stock.max_change);


    if (
        !Number.isFinite(minChange) ||
        minChange < 1
    ) {
        minChange = 1;
    }


    if (
        !Number.isFinite(maxChange) ||
        maxChange < minChange
    ) {
        maxChange = minChange;
    }


    minChange =
        Math.round(minChange);

    maxChange =
        Math.round(maxChange);


    const change =
        randomInteger(
            minChange,
            maxChange
        );


    let direction =
        directionOverride ||
        stock.change_mode ||
        "random";


    if (direction === "stop") {

        return Math.round(
            currentPrice
        );

    }


    if (direction === "up") {

        return Math.round(
            currentPrice + change
        );

    }


    if (direction === "down") {

        return Math.max(
            100,
            Math.round(
                currentPrice - change
            )
        );

    }


    // random

    const sign =
        Math.random() < 0.5
            ? -1
            : 1;


    return Math.max(
        100,
        Math.round(
            currentPrice +
            change * sign
        )
    );

}


// =====================================================
// 특정 주식 업데이트
// =====================================================

async function updateStock(
    stock
) {

    const controlResult =
        await pool.query(`
            SELECT
                direction,
                until_time,
                strength

            FROM market_controls

            WHERE stock_id = $1
        `, [
            stock.id
        ]);


    let direction =
        stock.change_mode || "random";


    if (controlResult.rows.length) {

        const control =
            controlResult.rows[0];


        if (
            control.direction &&
            control.direction !== "normal" &&
            Number(control.until_time) > Date.now()
        ) {

            direction =
                control.direction;

        }

        else if (
            Number(control.until_time) > 0 &&
            Number(control.until_time) <= Date.now()
        ) {

            await pool.query(`
                UPDATE market_controls

                SET
                    direction = 'normal',
                    until_time = 0,
                    strength = 1

                WHERE stock_id = $1
            `, [
                stock.id
            ]);

        }

    }


    const nextPrice =
        calculateNextPrice(
            stock,
            direction === "normal"
                ? null
                : direction
        );


    if (
        nextPrice ===
        Number(stock.price)
    ) {

        return stock;

    }


    return setPrice(
        stock.id,
        nextPrice
    );

}


// =====================================================
// 시장 전체 변동
// =====================================================

async function updateMarket() {

    try {

        const stocks =
            await getStocks();


        for (const stock of stocks) {

            try {

                await updateStock(
                    stock
                );

            } catch (error) {

                console.error(
                    `❌ ${stock.id} 주가 업데이트 오류:`,
                    error
                );

            }

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


// =====================================================
// 종목별 자동 변동 타이머
// =====================================================

const marketTimers =
    new Map();


function startStockTimer(
    stock
) {

    const oldTimer =
        marketTimers.get(
            stock.id
        );


    if (oldTimer) {

        clearInterval(
            oldTimer
        );

    }


    let seconds =
        Number(
            stock.change_interval
        );


    if (
        !Number.isFinite(seconds) ||
        seconds < 1
    ) {

        seconds = 5;

    }


    seconds =
        Math.round(seconds);


    const timer =
        setInterval(
            async () => {

                const currentStock =
                    await getStock(
                        stock.id
                    );


                if (!currentStock) {

                    clearInterval(
                        timer
                    );

                    marketTimers.delete(
                        stock.id
                    );

                    return;

                }


                await updateStock(
                    currentStock
                );

            },
            seconds * 1000
        );


    marketTimers.set(
        stock.id,
        timer
    );


    console.log(
        `📊 ${stock.id} · ${seconds}초 간격`
    );

}


// =====================================================
// 전체 엔진 시작
// =====================================================

async function startMarketEngine() {

    console.log("");

    console.log(
        "📈 주가 자동 변동 엔진 시작"
    );


    const stocks =
        await getStocks();


    for (const stock of stocks) {

        startStockTimer(
            stock
        );

    }


    console.log(
        `📈 ${stocks.length}개 종목 엔진 활성화`
    );

    console.log("");

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

    calculateNextPrice,

    updateMarket,

    updateStock,

    startMarketEngine

};
