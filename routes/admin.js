const express = require("express");

const router = express.Router();

// ========================================
// VSM 관리자 API
// ========================================

// 관리자 API 기본 확인
router.get("/", async (req, res) => {
    res.json({
        ok: true,
        service: "VSM Admin API",
        message: "관리자 API가 정상적으로 작동하고 있습니다."
    });
});


// ========================================
// 관리자 대시보드 정보
// ========================================

router.get("/dashboard", async (req, res) => {
    try {
        res.json({
            ok: true,
            dashboard: {
                users: 0,
                stocks: 0,
                pendingFeedback: 0,
                notices: 0
            }
        });

    } catch (err) {
        console.error("관리자 대시보드 오류:", err);

        res.status(500).json({
            ok: false,
            error: "관리자 대시보드 정보를 불러오는 중 오류가 발생했습니다."
        });
    }
});


// ========================================
// 플레이어 관리
// ========================================

router.get("/users", async (req, res) => {
    try {
        res.json({
            ok: true,
            users: []
        });

    } catch (err) {
        console.error("플레이어 목록 오류:", err);

        res.status(500).json({
            ok: false,
            error: "플레이어 목록을 불러오는 중 오류가 발생했습니다."
        });
    }
});


// ========================================
// 주식 관리
// ========================================

router.get("/stocks", async (req, res) => {
    try {
        res.json({
            ok: true,
            stocks: []
        });

    } catch (err) {
        console.error("관리자 주식 목록 오류:", err);

        res.status(500).json({
            ok: false,
            error: "주식 목록을 불러오는 중 오류가 발생했습니다."
        });
    }
});


// ========================================
// 피드백 관리
// ========================================

router.get("/feedback", async (req, res) => {
    try {
        res.json({
            ok: true,
            feedback: []
        });

    } catch (err) {
        console.error("관리자 피드백 목록 오류:", err);

        res.status(500).json({
            ok: false,
            error: "피드백 목록을 불러오는 중 오류가 발생했습니다."
        });
    }
});


// ========================================
// 공지사항 관리
// ========================================

router.get("/notices", async (req, res) => {
    try {
        res.json({
            ok: true,
            notices: []
        });

    } catch (err) {
        console.error("관리자 공지사항 오류:", err);

        res.status(500).json({
            ok: false,
            error: "공지사항 목록을 불러오는 중 오류가 발생했습니다."
        });
    }
});


// ========================================
// 서버 상태
// ========================================

router.get("/status", async (req, res) => {
    try {
        res.json({
            ok: true,
            status: "online",
            serverTime: new Date().toISOString()
        });

    } catch (err) {
        console.error("서버 상태 확인 오류:", err);

        res.status(500).json({
            ok: false,
            error: "서버 상태를 확인할 수 없습니다."
        });
    }
});


// ========================================
// 관리자 API 종료
// ========================================

module.exports = router;
