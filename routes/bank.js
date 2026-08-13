const express = require("express");

const router = express.Router();

// 안드로메다뱅크 기본 정보
router.get("/", async (req, res) => {
    res.json({
        ok: true,
        bankName: "안드로메다뱅크",
        message: "은행 API 준비 완료"
    });
});

// 내 계좌 정보
router.get("/account", async (req, res) => {
    res.json({
        ok: true,
        accountNumber: null,
        balance: 0,
        transactions: []
    });
});

// 이체
router.post("/transfer", async (req, res) => {
    try {
        const {
            accountNumber,
            amount,
            memo
        } = req.body;

        const money = Number(amount);

        if (!accountNumber) {
            return res.status(400).json({
                error: "받는 사람 계좌번호를 입력하세요."
            });
        }

        if (!Number.isInteger(money) || money <= 0) {
            return res.status(400).json({
                error: "이체 금액을 확인하세요."
            });
        }

        res.json({
            ok: true,
            message: "이체 API 준비 완료",
            accountNumber,
            amount: money,
            memo: memo || ""
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: "이체 처리 중 오류가 발생했습니다."
        });
    }
});

// 입금 내역
router.get("/deposits", async (req, res) => {
    res.json({
        ok: true,
        deposits: []
    });
});

// 출금 내역
router.get("/withdrawals", async (req, res) => {
    res.json({
        ok: true,
        withdrawals: []
    });
});

// 전체 거래내역
router.get("/transactions", async (req, res) => {
    res.json({
        ok: true,
        transactions: []
    });
});

module.exports = router;
