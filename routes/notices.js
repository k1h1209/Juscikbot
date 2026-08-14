const express = require("express");

const router = express.Router();

// 공지사항 목록
router.get("/", async (req, res) => {
    res.json({
        ok: true,
        notices: []
    });
});

// 공지사항 하나 보기
router.get("/:id", async (req, res) => {
    res.json({
        ok: true,
        id: req.params.id,
        notice: null
    });
});

module.exports = router;
