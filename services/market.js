const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

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


/* ========================================
   전체 주식
======================================== */

async function getStocks() {

    const result = await pool.query(`
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

    const result = await pool.query(`
        SELECT *
        FROM stocks
        WHERE id = $1
    `, [id]);

    return result.rows[0] || null;
}


/* ========================================
   주가 기록
======================================== */

async function getHistory(id, range = "1d") {

    const ranges = {
        "1d": 86400000,
        "1w": 604800000,
        "1m": 2592000000,
        "3m": 7776000000,
        "all": Infinity
    };

    const selectedRange =
        ranges[range] ?? ranges["1d"];

    const minTime =
        selectedRange === Infinity
            ? 0
            : Date.now() - selectedRange;

    const result = await pool.query(`
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


/* ========================================
   주가 설정
======================================== */

async function setPrice(id, price) {

    const value =
        Math.round(Number(price));

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


/* ========================================
   다음 주가 계산
======================================== */

function calculateNextPrice(stock) {

    const currentPrice =
        Number(stock.price);

    const volatility =
        Number(stock.volatility);

    /*
     * volatility 예:
     *
     * 0.05 = 5%
     * 0.08 = 8%
     * 0.12 = 12%
     *
     * 한 번의 변동에서는
     * 전체 변동성의 10%만 사용한다.
     */

    const maxChange =
        currentPrice *
        volatility *
        0.10;

    /*
     * -1 ~ +1 사이의 랜덤값
     */

    const random =
        Math.random() * 2 - 1;

    const change =
        random * maxChange;

    let nextPrice =
        currentPrice + change;

    /*
     * 최저 가격 100원
     */

    nextPrice =
        Math.max(100, nextPrice);

    return Math.round(nextPrice);
}


/* ========================================
   시장 전체 주가 변동
======================================== */

async function updateMarket() {

    try {

        const stocks =
            await getStocks();

        for (const stock of stocks) {

            const nextPrice =
                calculateNextPrice(stock);

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

    /*
     * 5초마다 주가 변경
     */

    const interval =
        5000;

    console.log("");
    console.log(
        `📈 주가 엔진 시작 · ${interval / 1000}초 간격`
    );

    /*
     * 서버 시작 직후에도
     * 한 번 가격을 변동시킨다.
     */

    updateMarket();

    /*
     * 이후 5초마다 반복
     */

    setInterval(
        updateMarket,
        interval
    );
}


/* ========================================
   내보내기
======================================== */

module.exports = {
    pool,
    companies,

    getStocks,
    getStock,
    getHistory,

    setPrice,

    updateMarket,
    startMarketEngine
};
