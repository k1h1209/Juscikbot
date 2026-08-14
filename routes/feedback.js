
const express = require("express");

const router = express.Router();

// 피드백 목록
router.get("/", async (req, res) => {
    res.json({
        ok: true,
        feedback: []
    });
});

// 피드백 작성
router.post("/", async (req, res) => {
    try {
        const { title, content } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                error: "제목과 내용을 입력하세요."
            });
        }

        res.json({
            ok: true,
            message: "피드백이 접수되었습니다.",
            feedback: {
                title,
                content,
                status: "pending"
            }
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: "피드백 등록 오류"
        });
    }
});

// 특정 피드백 조회
router.get("/:id", async (req, res) => {
    res.json({
        ok: true,
        id: req.params.id
    });
});

module.exports = router;
