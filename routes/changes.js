
const express = require("express");
const { pool } = require("../services/market");

const router = express.Router();

// =====================================================
// 변경사항 목록
// =====================================================

router.get("/", async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    title,
                    content,
                    feedback_id,
                    created_at
                FROM changes
                ORDER BY
                    created_at DESC,
                    id DESC
            `);

        res.json({
            ok: true,
            changes:
                result.rows
        });

    } catch (error) {

        console.error(
            "CHANGES LIST ERROR:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "변경사항을 불러오지 못했습니다."
        });

    }

});


// =====================================================
// 특정 변경사항
// =====================================================

router.get("/:id", async (req, res) => {

    try {

        const result =
            await pool.query(
                `
                SELECT
                    id,
                    title,
                    content,
                    feedback_id,
                    created_at
                FROM changes
                WHERE id = $1
                LIMIT 1
                `,
                [req.params.id]
            );

        if (!result.rows.length) {

            return res.status(404).json({
                ok: false,
                error:
                    "변경사항을 찾을 수 없습니다."
            });

        }

        res.json({
            ok: true,
            change:
                result.rows[0]
        });

    } catch (error) {

        console.error(
            "CHANGE DETAIL ERROR:",
            error
        );

        res.status(500).json({
            ok: false,
            error:
                "변경사항을 불러오지 못했습니다."
        });

    }

});


module.exports = router;
