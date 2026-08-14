const express = require("express");
const { pool } = require("../services/market");

const router = express.Router();


// =====================================================
// 인증
// =====================================================

async function requireAuth(req, res, next) {

    try {

        const header =
            req.headers.authorization || "";

        if (!header.startsWith("Bearer ")) {

            return res.status(401).json({
                ok: false,
                error: "로그인이 필요합니다."
            });

        }

        const token =
            header.substring(7).trim();

        if (!token) {

            return res.status(401).json({
                ok: false,
                error: "로그인이 필요합니다."
            });

        }

        const result =
            await pool.query(
                `
                SELECT
                    u.id
                FROM sessions s

                JOIN users u
                    ON u.id = s.user_id

                WHERE s.token = $1
                `,
                [token]
            );

        if (!result.rows.length) {

            return res.status(401).json({
                ok: false,
                error: "로그인이 필요합니다."
            });

        }

        req.userId =
            result.rows[0].id;

        next();

    } catch (error) {

        console.error(
            "NOTIFICATION AUTH ERROR:",
            error
        );

        res.status(500).json({
            ok: false,
            error: "인증 처리 중 오류가 발생했습니다."
        });

    }

}


// =====================================================
// 알림 목록
// 읽지 않은 알림만 가져옴
// =====================================================

router.get(
    "/",
    requireAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        message,
                        type,
                        is_read,
                        created_at

                    FROM notifications

                    WHERE
                        user_id = $1
                        AND is_read = FALSE

                    ORDER BY
                        created_at DESC

                    LIMIT 100
                    `,
                    [req.userId]
                );


            res.json({

                ok: true,

                notifications:
                    result.rows

            });

        } catch (error) {

            console.error(
                "NOTIFICATIONS GET ERROR:",
                error
            );

            res.status(500).json({

                ok: false,

                error:
                    "알림을 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 안 읽은 알림 개수
// =====================================================

router.get(
    "/unread-count",
    requireAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT COUNT(*)::INTEGER AS count

                    FROM notifications

                    WHERE
                        user_id = $1
                        AND is_read = FALSE
                    `,
                    [req.userId]
                );


            res.json({

                ok: true,

                count:
                    result.rows[0].count

            });

        } catch (error) {

            console.error(
                "NOTIFICATION COUNT ERROR:",
                error
            );

            res.status(500).json({

                ok: false,

                error:
                    "알림 개수를 불러오지 못했습니다."

            });

        }

    }
);


// =====================================================
// 특정 알림 읽음 처리
// =====================================================

router.patch(
    "/:id/read",
    requireAuth,
    async (req, res) => {

        try {

            const notificationId =
                Number(req.params.id);

            if (
                !Number.isInteger(
                    notificationId
                )
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "잘못된 알림 번호입니다."

                });

            }


            const result =
                await pool.query(
                    `
                    UPDATE notifications

                    SET
                        is_read = TRUE

                    WHERE
                        id = $1
                        AND user_id = $2

                    RETURNING
                        id
                    `,
                    [
                        notificationId,
                        req.userId
                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "알림을 찾을 수 없습니다."

                });

            }


            res.json({

                ok: true

            });

        } catch (error) {

            console.error(
                "NOTIFICATION READ ERROR:",
                error
            );

            res.status(500).json({

                ok: false,

                error:
                    "알림을 읽음 처리하지 못했습니다."

            });

        }

    }
);


module.exports = router;
