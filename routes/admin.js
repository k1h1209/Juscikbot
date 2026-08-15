
const express = require("express");

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
                `, [
                    req.params.id
                ]);

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
//
// 수정 가능:
// - 닉네임
// - 현금
// - 플레이어 번호
// - 보유 주식
// - 거래 내역
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


            // -------------------------------------------------
            // 닉네임
            // -------------------------------------------------

            if (
                nickname !== undefined
            ) {

                const value =
                    String(nickname).trim();

                if (!value) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "닉네임을 입력하세요."
                    });

                }

                fields.push(
                    `nickname = $${index++}`
                );

                values.push(value);

            }


            // -------------------------------------------------
            // 현금
            // -------------------------------------------------

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
                            "잘못된 현금 값입니다."
                    });

                }

                fields.push(
                    `cash = $${index++}`
                );

                values.push(money);

            }


            // -------------------------------------------------
            // 플레이어 번호
            // -------------------------------------------------

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

                values.push(number);

            }


            // -------------------------------------------------
            // 보유 주식
            // -------------------------------------------------

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


            // -------------------------------------------------
            // 거래 내역
            // -------------------------------------------------

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

                    SET
                        ${fields.join(", ")}

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
                    minutes * 60 * 1000;

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


            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            // 기존 로그인 세션 제거
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


            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            res.json({
                ok: true,
                deleted: result.rows[0]
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
//
// volatility % 방식이 아니라
// min_change ~ max_change 방식 사용
//
// 예:
// min_change = 20
// max_change = 100
//
// → 한 번 변동할 때 20~100원 범위
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
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        min_change,
                        max_change,
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
                minChange,
                maxChange,
                volumeLimitEnabled,
                volumeLimit
            } = req.body;


            const stockId =
                String(id || "")
                    .trim()
                    .toUpperCase();

            const stockName =
                String(name || "")
                    .trim();

            const stockPrice =
                Number(price);

            const minimum =
                Number(minChange);

            const maximum =
                Number(maxChange);


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
                stockPrice < 100
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "주가는 100원 이상이어야 합니다."
                });

            }


            if (
                !Number.isFinite(minimum) ||
                !Number.isFinite(maximum) ||
                minimum < 0 ||
                maximum < minimum
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "최소 변동값과 최대 변동값을 확인하세요."
                });

            }


            const limitEnabled =
                Boolean(volumeLimitEnabled);

            const limit =
                Math.max(
                    0,
                    Number(volumeLimit || 0)
                );


            await client.query("BEGIN");


            const result =
                await client.query(
                    `
                    INSERT INTO stocks
                    (
                        id,
                        name,
                        volatility,
                        min_change,
                        max_change,
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
                        0,
                        $3,
                        $4,
                        $5,
                        $5,
                        $5,
                        $5,
                        $5,
                        0,
                        $6,
                        $7
                    )

                    RETURNING *
                    `,
                    [
                        stockId,
                        stockName,
                        minimum,
                        maximum,
                        Math.round(stockPrice),
                        limitEnabled,
                        limit
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
                    Math.round(stockPrice)
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

                ON CONFLICT (stock_id)
                DO NOTHING
                `,
                [stockId]
            );


            await client.query("COMMIT");


            res.status(201).json({
                ok: true,
                stock: result.rows[0]
            });

        } catch (error) {

            await client.query("ROLLBACK");

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
                minChange,
                maxChange,
                volumeLimitEnabled,
                volumeLimit
            } = req.body;

            const fields = [];
            const values = [];

            let index = 1;


            // -------------------------------------------------
            // 이름
            // -------------------------------------------------

            if (
                name !== undefined
            ) {

                const value =
                    String(name).trim();

                if (!value) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "주식 이름을 입력하세요."
                    });

                }

                fields.push(
                    `name = $${index++}`
                );

                values.push(value);

            }


            // -------------------------------------------------
            // 가격
            // -------------------------------------------------

            if (
                price !== undefined
            ) {

                const value =
                    Math.round(
                        Number(price)
                    );

                if (
                    !Number.isFinite(value) ||
                    value < 100
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "주가는 100원 이상이어야 합니다."
                    });

                }

                fields.push(
                    `previous = price`
                );

                fields.push(
                    `price = $${index++}`
                );

                fields.push(
                    `high = GREATEST(high, $${index - 1})`
                );

                fields.push(
                    `low = LEAST(low, $${index - 1})`
                );

                values.push(value);

            }


            // -------------------------------------------------
            // 최소 변동값
            // -------------------------------------------------

            if (
                minChange !== undefined
            ) {

                const value =
                    Number(minChange);

                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "최소 변동값이 올바르지 않습니다."
                    });

                }

                fields.push(
                    `min_change = $${index++}`
                );

                values.push(value);

            }


            // -------------------------------------------------
            // 최대 변동값
            // -------------------------------------------------

            if (
                maxChange !== undefined
            ) {

                const value =
                    Number(maxChange);

                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "최대 변동값이 올바르지 않습니다."
                    });

                }

                fields.push(
                    `max_change = $${index++}`
                );

                values.push(value);

            }


            // -------------------------------------------------
            // 거래량 제한
            // -------------------------------------------------

            if (
                volumeLimitEnabled !== undefined
            ) {

                fields.push(
                    `volume_limit_enabled = $${index++}`
                );

                values.push(
                    Boolean(volumeLimitEnabled)
                );

            }


            if (
                volumeLimit !== undefined
            ) {

                const value =
                    Number(volumeLimit);

                if (
                    !Number.isFinite(value) ||
                    value < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "거래량 제한값이 올바르지 않습니다."
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


            // 최소/최대값이 역전되는 것을 방지
            const current =
                await pool.query(
                    `
                    SELECT
                        min_change,
                        max_change
                    FROM stocks
                    WHERE id = $1
                    `,
                    [req.params.id]
                );


            if (!current.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });

            }


            const currentMin =
                Number(
                    current.rows[0].min_change
                );

            const currentMax =
                Number(
                    current.rows[0].max_change
                );


            const finalMin =
                minChange !== undefined
                    ? Number(minChange)
                    : currentMin;

            const finalMax =
                maxChange !== undefined
                    ? Number(maxChange)
                    : currentMax;


            if (
                finalMax < finalMin
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "최대 변동값은 최소 변동값보다 작을 수 없습니다."
                });

            }


            values.push(req.params.id);


            const result =
                await pool.query(
                    `
                    UPDATE stocks

                    SET
                        ${fields.join(", ")}

                    WHERE id = $${index}

                    RETURNING
                        id,
                        name,
                        price,
                        previous,
                        open_price,
                        high,
                        low,
                        volume,
                        min_change,
                        max_change,
                        volume_limit_enabled,
                        volume_limit
                    `,
                    values
                );


            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });

            }


            // 가격을 직접 수정했으면 기록
            if (
                price !== undefined
            ) {

                await pool.query(
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
                        req.params.id,
                        Date.now(),
                        Math.round(
                            Number(price)
                        )
                    ]
                );

            }


            res.json({
                ok: true,
                stock: result.rows[0]
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

            await client.query("BEGIN");


            const result =
                await client.query(
                    `
                    DELETE FROM stocks

                    WHERE id = $1

                    RETURNING
                        id,
                        name
                    `,
                    [req.params.id]
                );


            if (!result.rows.length) {

                await client.query("ROLLBACK");

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });

            }


            await client.query("COMMIT");


            res.json({
                ok: true,
                deleted: result.rows[0]
            });

        } catch (error) {

            await client.query("ROLLBACK");

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
                        f.id,
                        f.user_id,
                        u.player_number,
                        u.nickname,
                        u.username,
                        f.title,
                        f.content,
                        f.status,
                        f.created_at,
                        f.updated_at
                    FROM feedback f

                    LEFT JOIN users u
                        ON u.id = f.user_id

                    ORDER BY
                        f.created_at DESC
                `);


            res.json({
                ok: true,
                feedback: result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN FEEDBACK LIST ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백 목록을 불러오지 못했습니다."
            });

        }

    }
);


// =====================================================
// 피드백 처리
//
// action:
// approve
// reject
// pending
// =====================================================

router.patch(
    "/feedback/:id",
    adminAuth,
    async (req, res) => {

        const client =
            await pool.connect();

        try {

            const {
                action,
                status
            } = req.body;

            const requestedStatus =
                status ||
                action;


            let finalStatus;


            if (
                requestedStatus === "approve" ||
                requestedStatus === "approved"
            ) {

                finalStatus = "approved";

            } else if (
                requestedStatus === "reject" ||
                requestedStatus === "rejected"
            ) {

                finalStatus = "rejected";

            } else if (
                requestedStatus === "pending"
            ) {

                finalStatus = "pending";

            } else {

                return res.status(400).json({
                    ok: false,
                    error:
                        "잘못된 피드백 처리 상태입니다."
                });

            }


            await client.query("BEGIN");


            const result =
                await client.query(
                    `
                    UPDATE feedback

                    SET
                        status = $1,
                        updated_at = $2

                    WHERE id = $3

                    RETURNING
                        id,
                        user_id,
                        title,
                        content,
                        status,
                        created_at,
                        updated_at
                    `,
                    [
                        finalStatus,
                        Date.now(),
                        req.params.id
                    ]
                );


            if (!result.rows.length) {

                await client.query("ROLLBACK");

                return res.status(404).json({
                    ok: false,
                    error:
                        "피드백을 찾을 수 없습니다."
                });

            }


            const feedback =
                result.rows[0];


            // 승인 / 거절 시 사용자에게 알림
            if (
                finalStatus === "approved" ||
                finalStatus === "rejected"
            ) {

                if (
                    feedback.user_id
                ) {

                    const message =
                        finalStatus === "approved"
                            ? "당신의 피드백은 수락했습니다."
                            : "당신의 피드백은 거절했습니다.";


                    await client.query(
                        `
                        INSERT INTO notifications
                        (
                            user_id,
                            message,
                            type,
                            is_read,
                            created_at
                        )

                        VALUES
                        (
                            $1,
                            $2,
                            $3,
                            FALSE,
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


            await client.query("COMMIT");


            res.json({
                ok: true,
                feedback
            });

        } catch (error) {

            await client.query("ROLLBACK");

            console.error(
                "ADMIN FEEDBACK UPDATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백 처리에 실패했습니다."
            });

        } finally {

            client.release();

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
                    SELECT
                        id,
                        title,
                        content,
                        created_at,
                        updated_at
                    FROM notices
                    ORDER BY
                        created_at DESC
                `);


            res.json({
                ok: true,
                notices: result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICES LIST ERROR:",
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
// 공지사항 등록
// =====================================================

router.post(
    "/notices",
    adminAuth,
    async (req, res) => {

        try {

            const {
                title,
                content
            } = req.body;


            const cleanTitle =
                String(title || "").trim();

            const cleanContent =
                String(content || "").trim();


            if (!cleanTitle) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "공지사항 제목을 입력하세요."
                });

            }


            if (!cleanContent) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "공지사항 내용을 입력하세요."
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
                        cleanTitle,
                        cleanContent,
                        now
                    ]
                );


            res.status(201).json({
                ok: true,
                notice: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE CREATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "공지사항 등록에 실패했습니다."
            });

        }

    }
);


// =====================================================
// 공지사항 수정
// =====================================================

router.patch(
    "/notices/:id",
    adminAuth,
    async (req, res) => {

        try {

            const {
                title,
                content
            } = req.body;


            const fields = [];
            const values = [];

            let index = 1;


            if (
                title !== undefined
            ) {

                fields.push(
                    `title = $${index++}`
                );

                values.push(
                    String(title).trim()
                );

            }


            if (
                content !== undefined
            ) {

                fields.push(
                    `content = $${index++}`
                );

                values.push(
                    String(content).trim()
                );

            }


            fields.push(
                `updated_at = $${index++}`
            );

            values.push(
                Date.now()
            );


            values.push(
                req.params.id
            );


            const result =
                await pool.query(
                    `
                    UPDATE notices

                    SET
                        ${fields.join(", ")}

                    WHERE id = $${index}

                    RETURNING *
                    `,
                    values
                );


            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "공지사항을 찾을 수 없습니다."
                });

            }


            res.json({
                ok: true,
                notice: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE UPDATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "공지사항 수정에 실패했습니다."
            });

        }

    }
);


// =====================================================
// 공지사항 삭제
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


            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "공지사항을 찾을 수 없습니다."
                });

            }


            res.json({
                ok: true,
                deleted: result.rows[0]
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
// 서버 점검 상태 조회
// =====================================================

router.get(
    "/maintenance",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        enabled,
                        start_time,
                        end_time,
                        updated_at
                    FROM maintenance
                    WHERE id = 1
                `);


            if (!result.rows.length) {

                return res.json({
                    ok: true,
                    maintenance: {
                        id: 1,
                        enabled: false,
                        start_time: null,
                        end_time: null,
                        updated_at: Date.now()
                    }
                });

            }


            res.json({
                ok: true,
                maintenance:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE GET ERROR:",
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
// 서버 점검 상태 변경
// =====================================================

router.patch(
    "/maintenance",
    adminAuth,
    async (req, res) => {

        try {

            const {
                enabled,
                startTime,
                endTime
            } = req.body;


            const isEnabled =
                Boolean(enabled);


            const start =
                startTime === null ||
                startTime === undefined ||
                startTime === ""
                    ? null
                    : Number(startTime);


            const end =
                endTime === null ||
                endTime === undefined ||
                endTime === ""
                    ? null
                    : Number(endTime);


            if (
                start !== null &&
                !Number.isFinite(start)
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "점검 시작 시간이 올바르지 않습니다."
                });

            }


            if (
                end !== null &&
                !Number.isFinite(end)
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "점검 종료 시간이 올바르지 않습니다."
                });

            }


            const result =
                await pool.query(
                    `
                    INSERT INTO maintenance
                    (
                        id,
                        enabled,
                        start_time,
                        end_time,
                        updated_at
                    )

                    VALUES
                    (
                        1,
                        $1,
                        $2,
                        $3,
                        $4
                    )

                    ON CONFLICT (id)
                    DO UPDATE SET
                        enabled = EXCLUDED.enabled,
                        start_time = EXCLUDED.start_time,
                        end_time = EXCLUDED.end_time,
                        updated_at = EXCLUDED.updated_at

                    RETURNING *
                    `,
                    [
                        isEnabled,
                        start,
                        end,
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
                "ADMIN MAINTENANCE UPDATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "점검 상태 변경에 실패했습니다."
            });

        }

    }
);


// =====================================================
// 외부에서 사용할 관리자 인증 미들웨어
// =====================================================

router.adminAuth =
    adminAuth;


// =====================================================
// export
// =====================================================

module.exports = router;
