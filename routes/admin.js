const express = require("express");

const router = express.Router();

// 관리자 인증
function adminAuth(req, res, next) {
    const password = req.headers["x-admin-password"];
    const adminPassword =
        process.env.ADMIN_PASSWORD || "admin1234";

    if (!password || password !== adminPassword) {
        return res.status(401).json({
            error: "관리자 인증이 필요합니다."
        });
    }

    next();
}

// 관리자 로그인 확인
router.get("/check", adminAuth, (req, res) => {
    res.json({
        ok: true,
        message: "관리자 인증 성공"
    });
});

// 플레이어 목록
router.get("/users", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        users: []
    });
});

// 플레이어 수정
router.patch("/users/:id", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        message: "플레이어 수정 API 준비 완료",
        id: req.params.id
    });
});

// 플레이어 초기화
router.post("/users/:id/reset", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        message: "플레이어 초기화 API 준비 완료",
        id: req.params.id
    });
});

// 주식 목록
router.get("/stocks", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        stocks: []
    });
});

// 주가 직접 변경
router.patch("/stocks/:id", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        message: "주가 변경 API 준비 완료",
        id: req.params.id
    });
});

// 주가 상승 / 하락 제어
router.post("/stocks/:id/control", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        message: "주가 제어 API 준비 완료",
        id: req.params.id,
        direction: req.body.direction
    });
});

// 전체 초기화
router.post("/reset", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        message: "초기화 API 준비 완료"
    });
});

// ================================
// 피드백 관리
// ================================

// 모든 피드백
router.get("/feedback", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        feedback: []
    });
});

// 피드백 상태 변경
router.patch(
    "/feedback/:id",
    adminAuth,
    async (req, res) => {
        const { status } = req.body;

        const allowed = [
            "pending",
            "review",
            "accepted",
            "rejected"
        ];

        if (!allowed.includes(status)) {
            return res.status(400).json({
                error: "잘못된 상태입니다."
            });
        }

        res.json({
            ok: true,
            message: "피드백 상태 변경 API 준비 완료",
            id: req.params.id,
            status
        });
    }
);

// ================================
// 공지사항 관리
// ================================

// 공지사항 생성
router.post("/notices", adminAuth, async (req, res) => {
    const { title, content } = req.body;

    if (!title || !content) {
        return res.status(400).json({
            error: "제목과 내용을 입력하세요."
        });
    }

    res.json({
        ok: true,
        message: "공지사항 생성 API 준비 완료"
    });
});

// 공지사항 삭제
router.delete(
    "/notices/:id",
    adminAuth,
    async (req, res) => {
        res.json({
            ok: true,
            message: "공지사항 삭제 API 준비 완료",
            id: req.params.id
        });
    }
);

// ================================
// 변경사항
// ================================

router.get("/changes", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        changes: []
    });
});

// ================================
// 서버 점검
// ================================

router.get("/maintenance", adminAuth, async (req, res) => {
    res.json({
        ok: true,
        maintenance: false,
        startTime: null,
        endTime: null
    });
});

// 서버 점검 시작
router.post(
    "/maintenance/start",
    adminAuth,
    async (req, res) => {
        const {
            startTime,
            endTime,
            password
        } = req.body;

        const adminPassword =
            process.env.ADMIN_PASSWORD || "admin1234";

        if (password !== adminPassword) {
            return res.status(401).json({
                error: "비밀번호가 올바르지 않습니다."
            });
        }

        res.json({
            ok: true,
            message: "서버 점검 시작 API 준비 완료",
            startTime,
            endTime
        });
    }
);

// 서버 점검 종료
router.post(
    "/maintenance/end",
    adminAuth,
    async (req, res) => {
        const { password } = req.body;

        const adminPassword =
            process.env.ADMIN_PASSWORD || "admin1234";

        if (password !== adminPassword) {
            return res.status(401).json({
                error: "비밀번호가 올바르지 않습니다."
            });
        }

        res.json({
            ok: true,
            message: "서버 점검 종료 API 준비 완료"
        });
    }
);

module.exports = router;
