
const express = require("express");
const { pool } = require("../services/market");
const authRoutes = require("./auth");

const router = express.Router();

// auth.js에서 export한 인증 미들웨어
const { auth } = authRoutes;


// =====================================================
// 내 피드백 목록
// =====================================================

router.get(
    "/",
    auth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        title,
                        content,
                        status,
                        created_at,
                        updated_at
                    FROM feedback
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                `, [
                    req.user.id
                ]);


            res.json({
                ok: true,
                feedback: result.rows
            });

        } catch (error) {

            console.error(
                "FEEDBACK LIST ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백을 불러오지 못했습니다."
            });

        }

    }
);


// =====================================================
// 피드백 작성
// =====================================================

router.post(
    "/",
    auth,
    async (req, res) => {

        try {

            const title =
                String(
                    req.body.title || ""
                ).trim();

            const content =
                String(
                    req.body.content || ""
                ).trim();


            // 입력 확인

            if (!title) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "피드백 제목을 입력하세요."
                });

            }


            if (!content) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "피드백 내용을 입력하세요."
                });

            }


            if (title.length > 100) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "제목은 100자 이하로 입력하세요."
                });

            }


            if (content.length > 3000) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "내용은 3000자 이하로 입력하세요."
                });

            }


            const now =
                Date.now();


            // DB 저장

            const result =
                await pool.query(`
                    INSERT INTO feedback
                    (
                        user_id,
                        title,
                        content,
                        status,
                        created_at,
                        updated_at
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        'pending',
                        $4,
                        $4
                    )
                    RETURNING
                        id,
                        title,
                        content,
                        status,
                        created_at,
                        updated_at
                `, [
                    req.user.id,
                    title,
                    content,
                    now
                ]);


            // 관리자에게 전달될 실제 DB 데이터

            res.status(201).json({
                ok: true,
                message:
                    "피드백이 접수되었습니다.",
                feedback:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "FEEDBACK CREATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백 등록 중 오류가 발생했습니다."
            });

        }

    }
);


// =====================================================
// 내 피드백 하나 조회
// =====================================================

router.get(
    "/:id",
    auth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        title,
                        content,
                        status,
                        created_at,
                        updated_at
                    FROM feedback
                    WHERE id = $1
                      AND user_id = $2
                    LIMIT 1
                `, [
                    req.params.id,
                    req.user.id
                ]);


            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "피드백을 찾을 수 없습니다."
                });

            }


            res.json({
                ok: true,
                feedback:
                    result.rows[0]
            });


        } catch (error) {

            console.error(
                "FEEDBACK DETAIL ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백을 불러오지 못했습니다."
            });

        }

    }
);


module.exports = router;
