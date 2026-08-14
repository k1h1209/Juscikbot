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

async function getStocks() {
    const result = await pool.query(`
        SELECT *
        FROM stocks
        ORDER BY id
    `);

    return result.rows;
}

async function getStock(id) {
    const result = await pool.query(`
        SELECT *
        FROM stocks
        WHERE id = $1
    `, [id]);

    return result.rows[0] || null;
}

async function getHistory(id, range = "1d") {
    const ranges = {
        "1d": 86400000,
        "1w": 604800000,
        "1m": 2592000000,
        "3m": 7776000000,
        "all": Infinity
    };

    const selectedRange = ranges[range] ?? ranges["1d"];

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
    `, [id, minTime]);

    return result.rows.map(row => ({
        t: Number(row.t),
        p: Number(row.p)
    }));
}

async function setPrice(id, price) {
    const value = Math.round(Number(price));

    if (!Number.isFinite(value) || value < 100) {
        throw new Error("가격이 올바르지 않습니다.");
    }

    await pool.query(`
        UPDATE stocks
        SET
            previous = price,
            price = $1,
            high = GREATEST(high, $1),
            low = LEAST(low, $1)
        WHERE id = $2
    `, [value, id]);

    await pool.query(`
        INSERT INTO price_history(stock_id, time, price)
        VALUES($1, $2, $3)
    `, [id, Date.now(), value]);

    return getStock(id);
}

module.exports = {
    pool,
    companies,
    getStocks,
    getStock,
    getHistory,
    setPrice
};
