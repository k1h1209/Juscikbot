const express = require("express");
const crypto = require("crypto");
const { pool } = require("../services/market");

const router = express.Router();

// =====================================================
// 관리자 인증
// =====================================================

function getAdminPassword() {
    return process.env.ADMIN_PASSWORD || "admin1234";
}

function adminAuth(req, res, next) {

    const password =
        req.headers["x-admin-password"];

    if (
        !password ||
        password !== getAdminPassword()
    ) {

        return res.status(401).json({
            ok: false,
            error: "관리자 인증이 필요합니다."
        });

    }

    next();
}

// =====================================================
// 비밀번호 암호화
// =====================================================

function hashPassword(password, salt) {

    return crypto
        .scryptSync(
            String(password),
            String(salt),
            64
        )
        .toString("hex");
}

// =====================================================
// 관리자 인증 확인
// =====================================================

router.get(
    "/check",
    adminAuth,
    (req, res) => {

        res.json({
            ok: true,
            message: "관리자 인증 성공"
        });

    }
);

// =====================================================
// 플레이어 목록
// =====================================================

router.get(
    "/users",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        banned_until,
                        ban_reason,
                        created_at
                    FROM users
                    ORDER BY player_number ASC
                `);

            res.json({
                ok: true,
                users: result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN USERS ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 목록을 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 플레이어 상세정보
// =====================================================

router.get(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(req.params.id);

            const result =
                await pool.query(`
                    SELECT
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        banned_until,
                        ban_reason,
                        created_at
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                `, [id]);

            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }

            res.json({
                ok: true,
                user: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN USER DETAIL ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 상세정보를 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 플레이어 수정
// =====================================================

router.patch(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(req.params.id);

            const {
                nickname,
                cash,
                playerNumber,
                holdings,
                transactions
            } = req.body;

            const fields = [];
            const values = [];

            let index = 1;

            // 닉네임
            if (
                nickname !== undefined
            ) {

                const cleanNickname =
                    String(nickname).trim();

                if (
                    cleanNickname.length < 2
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "닉네임은 2자 이상이어야 합니다."
                    });

                }

                fields.push(
                    `nickname = $${index++}`
                );

                values.push(
                    cleanNickname
                );

            }

            // 현금
            if (
                cash !== undefined
            ) {

                const money =
                    Number(cash);

                if (
                    !Number.isFinite(money) ||
                    money < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "잘못된 잔액입니다."
                    });

                }

                fields.push(
                    `cash = $${index++}`
                );

                values.push(
                    money
                );

            }

            // 플레이어 번호
            if (
                playerNumber !== undefined
            ) {

                const number =
                    Number(playerNumber);

                if (
                    !Number.isInteger(number) ||
                    number <= 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "잘못된 플레이어 번호입니다."
                    });

                }

                fields.push(
                    `player_number = $${index++}`
                );

                values.push(
                    number
                );

            }

            // 보유 주식
            if (
                holdings !== undefined
            ) {

                if (
                    typeof holdings !== "object" ||
                    holdings === null ||
                    Array.isArray(holdings)
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "보유 주식 데이터가 올바르지 않습니다."
                    });

                }

                fields.push(
                    `holdings = $${index++}::jsonb`
                );

                values.push(
                    JSON.stringify(holdings)
                );

            }

            // 거래 내역
            if (
                transactions !== undefined
            ) {

                if (
                    !Array.isArray(transactions)
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "거래 내역 데이터가 올바르지 않습니다."
                    });

                }

                fields.push(
                    `transactions = $${index++}::jsonb`
                );

                values.push(
                    JSON.stringify(transactions)
                );

            }

            if (!fields.length) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "수정할 항목이 없습니다."
                });

            }

            values.push(id);

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET ${fields.join(", ")}
                    WHERE id = $${index}
                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        transactions,
                        banned_until,
                        ban_reason,
                        created_at
                    `,
                    values
                );

            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }

            res.json({
                ok: true,
                user: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN USER UPDATE ERROR:",
                error
            );

            if (
                error.code === "23505"
            ) {

                return res.status(409).json({
                    ok: false,
                    error:
                        "이미 사용 중인 닉네임 또는 플레이어 번호입니다."
                });

            }

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 수정에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 플레이어 비밀번호 재설정
// =====================================================

router.post(
    "/users/:id/password",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(req.params.id);

            const password =
                String(
                    req.body.password || ""
                );

            if (
                password.length < 4
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "비밀번호는 4자 이상이어야 합니다."
                });

            }

            if (
                password.length > 128
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "비밀번호가 너무 깁니다."
                });

            }

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [id]
                );

            if (
                !userResult.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }

            const salt =
                crypto
                    .randomBytes(16)
                    .toString("hex");

            const passwordHash =
                hashPassword(
                    password,
                    salt
                );

            await pool.query(
                `
                UPDATE users
                SET
                    salt = $1,
                    password_hash = $2
                WHERE id = $3
                `,
                [
                    salt,
                    passwordHash,
                    id
                ]
            );

            // 기존 로그인 세션 제거
            // 비밀번호가 변경되었으므로
            // 기존 로그인 상태를 모두 종료
            await pool.query(
                `
                DELETE FROM sessions
                WHERE user_id = $1
                `,
                [id]
            );

            res.json({
                ok: true,
                message:
                    "비밀번호가 재설정되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN PASSWORD RESET ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "비밀번호 재설정에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 플레이어 밴
// =====================================================

router.post(
    "/users/:id/ban",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(req.params.id);

            const {
                duration,
                reason
            } = req.body;

            let bannedUntil = null;

            if (
                duration !== "permanent"
            ) {

                const minutes =
                    Number(duration);

                if (
                    !Number.isFinite(minutes) ||
                    minutes <= 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "잘못된 밴 기간입니다."
                    });

                }

                bannedUntil =
                    Date.now() +
                    minutes *
                    60 *
                    1000;

            }

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        banned_until = $1,
                        ban_reason = $2
                    WHERE id = $3
                    RETURNING
                        id,
                        player_number,
                        nickname,
                        banned_until,
                        ban_reason
                    `,
                    [
                        bannedUntil,
                        String(
                            reason || ""
                        ).slice(0, 200),
                        id
                    ]
                );

            if (
                !result.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }

            await pool.query(
                `
                DELETE FROM sessions
                WHERE user_id = $1
                `,
                [id]
            );

            res.json({
                ok: true,
                user: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN BAN ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "밴 처리에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 밴 해제
// =====================================================

router.post(
    "/users/:id/unban",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        banned_until = NULL,
                        ban_reason = NULL
                    WHERE id = $1
                    RETURNING
                        id,
                        player_number,
                        nickname,
                        banned_until,
                        ban_reason
                    `,
                    [req.params.id]
                );

            if (
                !result.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }

            res.json({
                ok: true,
                user: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN UNBAN ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "밴 해제에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 플레이어 삭제
// =====================================================

router.delete(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM users
                    WHERE id = $1
                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname
                    `,
                    [req.params.id]
                );

            if (
                !result.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }

            res.json({
                ok: true,
                deleted:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN USER DELETE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 삭제에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 주식 목록
// =====================================================

router.get(
    "/stocks",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        name,
                        volatility,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        volume_limit_enabled,
                        volume_limit
                    FROM stocks
                    ORDER BY id ASC
                `);

            res.json({
                ok: true,
                stocks: result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN STOCK LIST ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "주식 목록을 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 주식 추가
// =====================================================

router.post(
    "/stocks",
    adminAuth,
    async (req, res) => {

        const client =
            await pool.connect();

        try {

            const {
                id,
                name,
                price,
                volatility,
                volumeLimitEnabled,
                volumeLimit
            } = req.body;

            const stockId =
                String(id || "")
                    .trim()
                    .toLowerCase();

            const stockName =
                String(name || "")
                    .trim();

            const stockPrice =
                Number(price);

            const stockVolatility =
                Number(volatility);

            if (!stockId) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "주식 ID를 입력하세요."
                });

            }

            if (!stockName) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "주식 이름을 입력하세요."
                });

            }

            if (
                !Number.isFinite(stockPrice) ||
                stockPrice <= 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "주가가 올바르지 않습니다."
                });

            }

            if (
                !Number.isFinite(stockVolatility) ||
                stockVolatility < 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "변동성이 올바르지 않습니다."
                });

            }

            await client.query(
                "BEGIN"
            );

            const result =
                await client.query(
                    `
                    INSERT INTO stocks
                    (
                        id,
                        name,
                        volatility,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        volume_limit_enabled,
                        volume_limit
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $4,
                        $4,
                        $4,
                        $4,
                        0,
                        $5,
                        $6
                    )
                    RETURNING *
                    `,
                    [
                        stockId,
                        stockName,
                        stockVolatility,
                        stockPrice,
                        Boolean(
                            volumeLimitEnabled
                        ),
                        Math.max(
                            0,
                            Number(
                                volumeLimit || 0
                            )
                        )
                    ]
                );

            await client.query(
                `
                INSERT INTO price_history
                (
                    stock_id,
                    time,
                    price
                )
                VALUES
                (
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    stockId,
                    Date.now(),
                    stockPrice
                ]
            );

            await client.query(
                `
                INSERT INTO market_controls
                (
                    stock_id,
                    direction,
                    until_time,
                    strength
                )
                VALUES
                (
                    $1,
                    'normal',
                    0,
                    1
                )
                `,
                [stockId]
            );

            await client.query(
                "COMMIT"
            );

            res.status(201).json({
                ok: true,
                stock:
                    result.rows[0]
            });

        } catch (error) {

            try {
                await client.query(
                    "ROLLBACK"
                );
            } catch (_) {}

            console.error(
                "ADMIN STOCK CREATE ERROR:",
                error
            );

            if (
                error.code === "23505"
            ) {

                return res.status(409).json({
                    ok: false,
                    error:
                        "이미 존재하는 주식 ID입니다."
                });

            }

            res.status(500).json({
                ok: false,
                error:
                    "주식 추가에 실패했습니다."
            });

        } finally {

            client.release();

        }

    }
);

// =====================================================
// 주식 수정
// =====================================================

router.patch(
    "/stocks/:id",
    adminAuth,
    async (req, res) => {

        try {

            const {
                name,
                price,
                volatility,
                volumeLimitEnabled,
                volumeLimit
            } = req.body;

            const fields = [];
            const values = [];

            let index = 1;

            if (
                name !== undefined
            ) {

                fields.push(
                    `name = $${index++}`
                );

                values.push(
                    String(name).trim()
                );

            }

            if (
                price !== undefined
            ) {

                const value =
                    Number(price);

                if (
                    !Number.isFinite(value) ||
                    value <= 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "잘못된 주가입니다."
                    });

                }

                fields.push(
                    `price = $${index++}`
                );

                values.push(value);

            }

            if (
                volatility !== undefined
            ) {

                const value =
                    Number(volatility);

                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "잘못된 변동성입니다."
                    });

                }

                fields.push(
                    `volatility = $${index++}`
                );

                values.push(value);

            }

            if (
                volumeLimitEnabled !== undefined
            ) {

                fields.push(
                    `volume_limit_enabled = $${index++}`
                );

                values.push(
                    Boolean(
                        volumeLimitEnabled
                    )
                );

            }

            if (
                volumeLimit !== undefined
            ) {

                const value =
                    Number(volumeLimit);

                if (
                    !Number.isInteger(value) ||
                    value < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "잘못된 거래량 제한입니다."
                    });

                }

                fields.push(
                    `volume_limit = $${index++}`
                );

                values.push(value);

            }

            if (!fields.length) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "수정할 항목이 없습니다."
                });

            }

            values.push(
                req.params.id
            );

            const result =
                await pool.query(
                    `
                    UPDATE stocks
                    SET ${fields.join(", ")}
                    WHERE id = $${index}
                    RETURNING *
                    `,
                    values
                );

            if (
                !result.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });

            }

            res.json({
                ok: true,
                stock:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN STOCK UPDATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "주식 수정에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 주식 삭제
// =====================================================

router.delete(
    "/stocks/:id",
    adminAuth,
    async (req, res) => {

        const client =
            await pool.connect();

        try {

            await client.query(
                "BEGIN"
            );

            const result =
                await client.query(
                    `
                    DELETE FROM stocks
                    WHERE id = $1
                    RETURNING *
                    `,
                    [req.params.id]
                );

            if (
                !result.rows.length
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });

            }

            await client.query(
                "COMMIT"
            );

            res.json({
                ok: true,
                deleted:
                    result.rows[0]
            });

        } catch (error) {

            try {
                await client.query(
                    "ROLLBACK"
                );
            } catch (_) {}

            console.error(
                "ADMIN STOCK DELETE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "주식 삭제에 실패했습니다."
            });

        } finally {

            client.release();

        }

    }
);

// =====================================================
// 주가 방향 제어
// =====================================================

router.post(
    "/stocks/:id/control",
    adminAuth,
    async (req, res) => {

        try {

            const {
                direction,
                duration,
                strength
            } = req.body;

            const allowed = [
                "normal",
                "up",
                "down"
            ];

            if (
                !allowed.includes(
                    direction
                )
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "잘못된 주가 방향입니다."
                });

            }

            const minutes =
                Number(
                    duration || 0
                );

            const controlStrength =
                Number(
                    strength || 1
                );

            const untilTime =
                direction === "normal"
                    ? 0
                    : Date.now() +
                      Math.max(
                          0,
                          minutes
                      ) *
                      60 *
                      1000;

            const result =
                await pool.query(
                    `
                    INSERT INTO market_controls
                    (
                        stock_id,
                        direction,
                        until_time,
                        strength
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4
                    )
                    ON CONFLICT (stock_id)
                    DO UPDATE SET
                        direction =
                            EXCLUDED.direction,
                        until_time =
                            EXCLUDED.until_time,
                        strength =
                            EXCLUDED.strength
                    RETURNING *
                    `,
                    [
                        req.params.id,
                        direction,
                        untilTime,
                        controlStrength
                    ]
                );

            res.json({
                ok: true,
                control:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN STOCK CONTROL ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "주가 제어에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 피드백 목록
// =====================================================

router.get(
    "/feedback",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        f.*,
                        u.player_number,
                        u.nickname
                    FROM feedback f
                    LEFT JOIN users u
                        ON u.id = f.user_id
                    ORDER BY
                        f.created_at DESC
                `);

            res.json({
                ok: true,
                feedback:
                    result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN FEEDBACK ERROR:",
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
// 피드백 상태 변경
// =====================================================

router.patch(
    "/feedback/:id",
    adminAuth,
    async (req, res) => {

        try {

            const allowed = [
                "pending",
                "review",
                "accepted",
                "rejected"
            ];

            if (
                !allowed.includes(
                    req.body.status
                )
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "잘못된 상태입니다."
                });

            }

            const result =
                await pool.query(
                    `
                    UPDATE feedback
                    SET
                        status = $1,
                        updated_at = $2
                    WHERE id = $3
                    RETURNING *
                    `,
                    [
                        req.body.status,
                        Date.now(),
                        req.params.id
                    ]
                );

            if (
                !result.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "피드백을 찾을 수 없습니다."
                });

            }

            // 수락 / 거절 시 사용자 알림
            if (
                req.body.status === "accepted" ||
                req.body.status === "rejected"
            ) {

                const feedback =
                    result.rows[0];

                if (
                    feedback.user_id
                ) {

                    const message =
                        req.body.status === "accepted"
                            ? "당신의 피드백은 수락했습니다."
                            : "당신의 피드백은 거절했습니다.";

                    await pool.query(
                        `
                        INSERT INTO notifications
                        (
                            user_id,
                            message,
                            type,
                            created_at
                        )
                        VALUES
                        (
                            $1,
                            $2,
                            $3,
                            $4
                        )
                        `,
                        [
                            feedback.user_id,
                            message,
                            "feedback",
                            Date.now()
                        ]
                    );

                }

            }

            res.json({
                ok: true,
                feedback:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN FEEDBACK UPDATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백 수정에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 공지사항 목록
// =====================================================

router.get(
    "/notices",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT *
                    FROM notices
                    ORDER BY
                        created_at DESC
                `);

            res.json({
                ok: true,
                notices:
                    result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICES ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "공지사항을 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 공지 생성
// =====================================================

router.post(
    "/notices",
    adminAuth,
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

            if (
                !title ||
                !content
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "제목과 내용을 입력하세요."
                });

            }

            const now =
                Date.now();

            const result =
                await pool.query(
                    `
                    INSERT INTO notices
                    (
                        title,
                        content,
                        created_at,
                        updated_at
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $3
                    )
                    RETURNING *
                    `,
                    [
                        title,
                        content,
                        now
                    ]
                );

            res.status(201).json({
                ok: true,
                notice:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE CREATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "공지사항 생성에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 공지 삭제
// =====================================================

router.delete(
    "/notices/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM notices
                    WHERE id = $1
                    RETURNING *
                    `,
                    [req.params.id]
                );

            if (
                !result.rows.length
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "공지사항을 찾을 수 없습니다."
                });

            }

            res.json({
                ok: true,
                deleted:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE DELETE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "공지사항 삭제에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 서버 점검 상태
// =====================================================

router.get(
    "/maintenance",
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT *
                    FROM maintenance
                    WHERE id = 1
                `);

            res.json({
                ok: true,
                maintenance:
                    result.rows[0] || null
            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "점검 상태를 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 서버 점검 시작
// =====================================================

router.post(
    "/maintenance/start",
    adminAuth,
    async (req, res) => {

        try {

            const startTime =
                Number(
                    req.body.startTime ||
                    Date.now()
                );

            const endTime =
                req.body.endTime
                    ? Number(
                        req.body.endTime
                    )
                    : null;

            const result =
                await pool.query(
                    `
                    UPDATE maintenance
                    SET
                        enabled = TRUE,
                        start_time = $1,
                        end_time = $2,
                        updated_at = $3
                    WHERE id = 1
                    RETURNING *
                    `,
                    [
                        startTime,
                        endTime,
                        Date.now()
                    ]
                );

            res.json({
                ok: true,
                maintenance:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE START ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "점검 시작에 실패했습니다."
            });

        }

    }
);

// =====================================================
// 서버 점검 종료
// =====================================================

router.post(
    "/maintenance/end",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE maintenance
                    SET
                        enabled = FALSE,
                        start_time = NULL,
                        end_time = NULL,
                        updated_at = $1
                    WHERE id = 1
                    RETURNING *
                    `,
                    [Date.now()]
                );

            res.json({
                ok: true,
                maintenance:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE END ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "점검 종료에 실패했습니다."
            });

        }

    }
);

// =====================================================
// Export
// =====================================================

module.exports = router;
