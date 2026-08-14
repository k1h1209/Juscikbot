
const express = require("express");
const { pool, getStocks, getStock, getHistory } = require("../services/market");
const { auth } = require("./auth");

const router = express.Router();

// =====================================================
// 전체 주식 목록
// GET /api/stocks
// =====================================================

router.get("/", async (req, res) => {
    try {
        const stocks = await getStocks();

        res.json({
            ok: true,
            stocks: stocks.map(stock => ({
                id: stock.id,
                name: stock.name,
                price: Number(stock.price),
                previous: Number(stock.previous),
                open: Number(stock.open_price),
                high: Number(stock.high),
                low: Number(stock.low),
                volume: Number(stock.volume),
                change: Number(stock.price) - Number(stock.previous),
                changeRate:
                    Number(stock.previous) === 0
                        ? 0
                        : (
                            (Number(stock.price) - Number(stock.previous))
                            / Number(stock.previous)
                        ) * 100
            }))
        });

    } catch (error) {
        console.error("STOCK LIST ERROR:", error);

        res.status(500).json({
            error: "주식 정보를 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 특정 주식
// GET /api/stocks/:id
// =====================================================

router.get("/:id", async (req, res) => {
    try {
        const stock = await getStock(req.params.id);

        if (!stock) {
            return res.status(404).json({
                error: "존재하지 않는 주식입니다."
            });
        }

        res.json({
            ok: true,
            stock: {
                id: stock.id,
                name: stock.name,
                price: Number(stock.price),
                previous: Number(stock.previous),
                open: Number(stock.open_price),
                high: Number(stock.high),
                low: Number(stock.low),
                volume: Number(stock.volume)
            }
        });

    } catch (error) {
        console.error("STOCK DETAIL ERROR:", error);

        res.status(500).json({
            error: "주식 정보를 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 주가 기록
// GET /api/stocks/:id/history?range=1d
// =====================================================

router.get("/:id/history", async (req, res) => {
    try {
        const stock = await getStock(req.params.id);

        if (!stock) {
            return res.status(404).json({
                error: "존재하지 않는 주식입니다."
            });
        }

        const range =
            req.query.range || "1d";

        const history =
            await getHistory(
                req.params.id,
                range
            );

        res.json({
            ok: true,
            stockId: req.params.id,
            range,
            history
        });

    } catch (error) {
        console.error("STOCK HISTORY ERROR:", error);

        res.status(500).json({
            error: "주가 기록을 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 내 보유주식
// GET /api/stocks/portfolio/me
// =====================================================

router.get("/portfolio/me", auth, async (req, res) => {
    try {
        const holdings =
            req.user.holdings || {};

        const result = [];

        for (const [stockId, quantity] of Object.entries(holdings)) {

            const stock =
                await getStock(stockId);

            if (!stock) {
                continue;
            }

            const qty =
                Number(quantity);

            const price =
                Number(stock.price);

            result.push({
                id: stock.id,
                name: stock.name,
                quantity: qty,
                price,
                value: qty * price
            });
        }

        res.json({
            ok: true,
            holdings: result
        });

    } catch (error) {
        console.error("PORTFOLIO ERROR:", error);

        res.status(500).json({
            error: "보유주식을 불러오지 못했습니다."
        });
    }
});

// =====================================================
// 주식 매수
// POST /api/stocks/buy
// =====================================================

router.post("/buy", auth, async (req, res) => {

    const client =
        await pool.connect();

    try {

        const {
            stockId,
            quantity
        } = req.body;

        const qty =
            Number(quantity);

        if (
            !stockId ||
            !Number.isInteger(qty) ||
            qty <= 0
        ) {
            return res.status(400).json({
                error: "올바른 종목과 수량을 입력하세요."
            });
        }

        const stock =
            await getStock(stockId);

        if (!stock) {
            return res.status(404).json({
                error: "존재하지 않는 주식입니다."
            });
        }

        const price =
            Number(stock.price);

        const total =
            price * qty;

        await client.query("BEGIN");

        // 사용자 최신 정보 확인
        const userResult =
            await client.query(`
                SELECT
                    cash,
                    holdings,
                    transactions
                FROM users
                WHERE id = $1
                FOR UPDATE
            `, [req.user.id]);

        if (!userResult.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                error: "사용자를 찾을 수 없습니다."
            });
        }

        const user =
            userResult.rows[0];

        const cash =
            Number(user.cash);

        if (cash < total) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                error: "현금이 부족합니다."
            });
        }

        const holdings =
            user.holdings || {};

        const transactions =
            user.transactions || [];

        holdings[stockId] =
            Number(holdings[stockId] || 0) + qty;

        transactions.push({
            type: "buy",
            stockId,
            stockName: stock.name,
            quantity: qty,
            price,
            total,
            time: Date.now()
        });

        await client.query(`
            UPDATE users
            SET
                cash = $1,
                holdings = $2::jsonb,
                transactions = $3::jsonb
            WHERE id = $4
        `, [
            cash - total,
            JSON.stringify(holdings),
            JSON.stringify(transactions),
            req.user.id
        ]);

        await client.query(`
            UPDATE stocks
            SET volume = volume + $1
            WHERE id = $2
        `, [
            qty,
            stockId
        ]);

        await client.query("COMMIT");

        res.json({
            ok: true,
            message: `${stock.name} ${qty}주 매수 완료`,
            cash: cash - total,
            holding: holdings[stockId],
            total
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error("BUY ERROR:", error);

        res.status(500).json({
            error: "주식 매수 중 오류가 발생했습니다."
        });

    } finally {
        client.release();
    }
});

// =====================================================
// 주식 매도
// POST /api/stocks/sell
// =====================================================

router.post("/sell", auth, async (req, res) => {

    const client =
        await pool.connect();

    try {

        const {
            stockId,
            quantity
        } = req.body;

        const qty =
            Number(quantity);

        if (
            !stockId ||
            !Number.isInteger(qty) ||
            qty <= 0
        ) {
            return res.status(400).json({
                error: "올바른 종목과 수량을 입력하세요."
            });
        }

        const stock =
            await getStock(stockId);

        if (!stock) {
            return res.status(404).json({
                error: "존재하지 않는 주식입니다."
            });
        }

        const price =
            Number(stock.price);

        const total =
            price * qty;

        await client.query("BEGIN");

        const userResult =
            await client.query(`
                SELECT
                    cash,
                    holdings,
                    transactions
                FROM users
                WHERE id = $1
                FOR UPDATE
            `, [req.user.id]);

        if (!userResult.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                error: "사용자를 찾을 수 없습니다."
            });
        }

        const user =
            userResult.rows[0];

        const cash =
            Number(user.cash);

        const holdings =
            user.holdings || {};

        const currentQuantity =
            Number(holdings[stockId] || 0);

        if (currentQuantity < qty) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                error: "보유한 주식보다 많이 팔 수 없습니다."
            });
        }

        const transactions =
            user.transactions || [];

        const newQuantity =
            currentQuantity - qty;

        if (newQuantity === 0) {
            delete holdings[stockId];
        } else {
            holdings[stockId] =
                newQuantity;
        }

        transactions.push({
            type: "sell",
            stockId,
            stockName: stock.name,
            quantity: qty,
            price,
            total,
            time: Date.now()
        });

        await client.query(`
            UPDATE users
            SET
                cash = $1,
                holdings = $2::jsonb,
                transactions = $3::jsonb
            WHERE id = $4
        `, [
            cash + total,
            JSON.stringify(holdings),
            JSON.stringify(transactions),
            req.user.id
        ]);

        await client.query(`
            UPDATE stocks
            SET volume = volume + $1
            WHERE id = $2
        `, [
            qty,
            stockId
        ]);

        await client.query("COMMIT");

        res.json({
            ok: true,
            message: `${stock.name} ${qty}주 매도 완료`,
            cash: cash + total,
            holding: newQuantity,
            total
        });

    } catch (error) {

        await client.query("ROLLBACK");

        console.error("SELL ERROR:", error);

        res.status(500).json({
            error: "주식 매도 중 오류가 발생했습니다."
        });

    } finally {
        client.release();
    }
});

// =====================================================
// 내 거래내역
// GET /api/stocks/transactions/me
// =====================================================

router.get("/transactions/me", auth, async (req, res) => {

    try {

        res.json({
            ok: true,
            transactions:
                req.user.transactions || []
        });

    } catch (error) {

        console.error(
            "TRANSACTION ERROR:",
            error
        );

        res.status(500).json({
            error: "거래내역을 불러오지 못했습니다."
        });
    }
});

module.exports = router;
