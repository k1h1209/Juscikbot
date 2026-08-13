const express = require("express");

const router = express.Router();

// 회원가입
router.post("/register", async (req, res) => {
    try {
        res.json({
            ok: true,
            message: "회원가입 API 준비 완료"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "회원가입 오류"
        });
    }
});

// 로그인
router.post("/login", async (req, res) => {
    try {
        res.json({
            ok: true,
            message: "로그인 API 준비 완료"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "로그인 오류"
        });
    }
});

// 로그아웃
router.post("/logout", async (req, res) => {
    res.json({
        ok: true,
        message: "로그아웃 API 준비 완료"
    });
});

// 내 정보
router.get("/me", async (req, res) => {
    res.json({
        ok: true,
        message: "내 정보 API 준비 완료"
    });
});

module.exports = router;
