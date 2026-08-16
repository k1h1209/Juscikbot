
const express = require("express");
const { pool } = require("../services/market");

const router = express.Router();


// =====================================================
// 공지사항 목록
// =====================================================

router.get("/", async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    title,
                    content,
                    created_at,
                    updated_at
                FROM notices
                ORDER BY created_at DESC
            `);

        res.json({
            ok: true,
            notices: result.rows
        });

    } catch (error) {

        console.error(
            "NOTICE LIST ERROR:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "공지사항을 불러오지 못했습니다."
        });

    }

});


// =====================================================
// 공지사항 하나 조회
// =====================================================

router.get("/:id", async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    title,
                    content,
                    created_at,
                    updated_at
                FROM notices
                WHERE id = $1
                LIMIT 1
            `, [
                req.params.id
            ]);


        if (!result.rows.length) {

            return res.status(404).json({
                ok: false,
                error:
                    "공지사항을 찾을 수 없습니다."
            });

        }


        res.json({
            ok: true,
            notice:
                result.rows[0]
        });

    } catch (error) {

        console.error(
            "NOTICE DETAIL ERROR:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "공지사항을 불러오지 못했습니다."
        });

    }

});


module.exports = router;

