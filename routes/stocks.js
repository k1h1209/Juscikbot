const express = require("express");

const router = express.Router();

// 현재 시장 정보
router.get("/market", async (req, res) => {
    res.json({
        ok: true,
        message: "시장 정보 API 준비 완료",
        companies: []
    });
});

// 특정 종목 차트
router.get("/history/:id", async (req, res) => {
    res.json({
        ok: true,
        message: "차트 API 준비 완료",
        stockId: req.params.id,
        points: []
    });
});

// 매수 / 매도
router.post("/trade", async (req, res) => {
    try {
        const { id, side, qty } = req.body;

        if (!id || !["buy", "sell"].includes(side)) {
            return res.status(400).json({
                error: "잘못된 거래입니다."
            });
        }

        const amount = Number(qty);

        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({
                error: "수량을 확인하세요."
            });
        }

        res.json({
            ok: true,
            message: "거래 API 준비 완료"
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: "거래 처리 중 오류가 발생했습니다."
        });
    }
});

// 포트폴리오
router.get("/portfolio", async (req, res) => {
    res.json({
        ok: true,
        cash: 0,
        stockValue: 0,
        total: 0,
        positions: []
    });
});

// 거래내역
router.get("/transactions", async (req, res) => {
    res.json({
        ok: true,
        transactions: []
    });
});

// 전체 랭킹
router.get("/rankings", async (req, res) => {
    res.json({
        ok: true,
        rankings: []
    });
});

module.exports = router;
