const express = require("express");
const { pool } = require("../services/market");

const router = express.Router();

// =====================================================
// 관리자 인증
// =====================================================

function adminAuth(req, res, next) {
    const password =
        req.headers["x-admin-password"];

    const adminPassword =
        process.env.ADMIN_PASSWORD || "admin1234";

    if (
        !password ||
        password !== adminPassword
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

router.get("/check", adminAuth, (req, res) => {
    res.json({
        ok: true,
        message: "관리자 인증 성공"
    });
});

// =====================================================
// 플레이어 목록
// =====================================================

router.get("/users", adminAuth, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                id,
                player_number,
                username,
                nickname,
                cash,
                holdings,
                created_at,
                banned_until
            FROM users
            ORDER BY player_number ASC
        `);

        res.json({
            ok: true,
            users: result.rows.map(user => ({
                id: user.id,
                playerNumber:
                    Number(user.player_number),
                username: user.username,
                nickname: user.nickname,
                cash: Number(user.cash),
                holdings:
                    user.holdings || {},
                createdAt:
                    Number(user.created_at),
                bannedUntil:
                    user.banned_until
                        ? Number(user.banned_until)
                        : null
            }))
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
});

// =====================================================
// 플레이어 수정
// =====================================================

router.patch(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const {
                nickname,
                cash
            } = req.body;

            const updates = [];
            const values = [];
            let index = 1;

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

                updates.push(
                    `nickname = $${index++}`
                );

                values.push(
                    cleanNickname
                );
            }

            if (cash !== undefined) {

                const newCash =
                    Number(cash);

                if (
                    !Number.isFinite(newCash) ||
                    newCash < 0
                ) {
                    return res.status(400).json({
                        ok: false,
                        error:
                            "현금은 0 이상이어야 합니다."
                    });
                }

                updates.push(
                    `cash = $${index++}`
                );

                values.push(newCash);
            }

            if (!updates.length) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "수정할 데이터를 입력하세요."
                });
            }

            values.push(req.params.id);

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET ${updates.join(", ")}
                    WHERE id = $${index}
                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        banned_until
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

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 수정 중 오류가 발생했습니다."
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
                    RETURNING id, nickname
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
                message:
                    "플레이어가 삭제되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN USER DELETE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 삭제 중 오류가 발생했습니다."
            });
        }
    }
);

// =====================================================
// 플레이어 데이터 초기화
// =====================================================

router.post(
    "/users/:id/reset",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE users

                    SET
                        cash = 10000,
                        holdings = '{}'::jsonb,
                        transactions = '[]'::jsonb

                    WHERE id = $1

                    RETURNING
                        id,
                        player_number,
                        nickname,
                        cash
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
                message:
                    "플레이어 데이터가 초기화되었습니다.",
                user: result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN USER RESET ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "플레이어 초기화 중 오류가 발생했습니다."
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

            const {
                duration
            } = req.body;

            let bannedUntil;

            if (
                duration === "permanent"
            ) {

                bannedUntil = null;

            } else {

                const minutes =
                    Number(duration);

                if (
                    !Number.isInteger(minutes) ||
                    minutes <= 0
                ) {
                    return res.status(400).json({
                        ok: false,
                        error:
                            "올바른 밴 기간을 입력하세요."
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

                    SET banned_until = $1

                    WHERE id = $2

                    RETURNING
                        id,
                        player_number,
                        nickname,
                        banned_until
                    `,
                    [
                        bannedUntil,
                        req.params.id
                    ]
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
                message:
                    "플레이어 밴이 적용되었습니다.",
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
                    "밴 처리 중 오류가 발생했습니다."
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

                    SET banned_until = 0

                    WHERE id = $1

                    RETURNING
                        id,
                        player_number,
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
                message:
                    "밴이 해제되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN UNBAN ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "밴 해제 중 오류가 발생했습니다."
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
                stocks:
                    result.rows.map(stock => ({
                        id: stock.id,
                        name: stock.name,

                        volatility:
                            Number(stock.volatility),

                        price:
                            Number(stock.price),

                        previous:
                            Number(stock.previous),

                        openPrice:
                            Number(stock.open_price),

                        high:
                            Number(stock.high),

                        low:
                            Number(stock.low),

                        volume:
                            Number(stock.volume),

                        volumeLimitEnabled:
                            Boolean(
                                stock.volume_limit_enabled
                            ),

                        volumeLimit:
                            Number(
                                stock.volume_limit
                            )
                    }))
            });

        } catch (error) {

            console.error(
                "ADMIN STOCKS ERROR:",
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
                String(id || "").trim();

            const stockName =
                String(name || "").trim();

            const stockPrice =
                Number(price);

            const stockVolatility =
                Number(volatility);

            const limit =
                Number(volumeLimit || 0);

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
                        "주가는 0보다 커야 합니다."
                });
            }

            if (
                !Number.isFinite(stockVolatility) ||
                stockVolatility < 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "변동성은 0 이상이어야 합니다."
                });
            }

            const exists =
                await pool.query(
                    `
                    SELECT id
                    FROM stocks
                    WHERE id = $1
                    `,
                    [stockId]
                );

            if (exists.rows.length) {

                return res.status(409).json({
                    ok: false,
                    error:
                        "이미 존재하는 주식 ID입니다."
                });
            }

            const result =
                await pool.query(
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
                        limit
                    ]
                );

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
                    stockId,
                    Date.now(),
                    stockPrice
                ]
            );

            res.status(201).json({
                ok: true,
                stock:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "ADMIN STOCK CREATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "주식 추가 중 오류가 발생했습니다."
            });
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

            const updates = [];
            const values = [];
            let index = 1;

            if (name !== undefined) {

                updates.push(
                    `name = $${index++}`
                );

                values.push(
                    String(name).trim()
                );
            }

            if (price !== undefined) {

                const newPrice =
                    Number(price);

                if (
                    !Number.isFinite(newPrice) ||
                    newPrice <= 0
                ) {
                    return res.status(400).json({
                        ok: false,
                        error:
                            "주가는 0보다 커야 합니다."
                    });
                }

                updates.push(
                    `price = $${index++}`
                );

                values.push(newPrice);
            }

            if (
                volatility !== undefined
            ) {

                const newVolatility =
                    Number(volatility);

                if (
                    !Number.isFinite(
                        newVolatility
                    ) ||
                    newVolatility < 0
                ) {
                    return res.status(400).json({
                        ok: false,
                        error:
                            "변동성이 올바르지 않습니다."
                    });
                }

                updates.push(
                    `volatility = $${index++}`
                );

                values.push(
                    newVolatility
                );
            }

            if (
                volumeLimitEnabled !== undefined
            ) {

                updates.push(
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

                const newLimit =
                    Number(volumeLimit);

                if (
                    !Number.isInteger(newLimit) ||
                    newLimit < 0
                ) {
                    return res.status(400).json({
                        ok: false,
                        error:
                            "거래량 제한 수량이 올바르지 않습니다."
                    });
                }

                updates.push(
                    `volume_limit = $${index++}`
                );

                values.push(newLimit);
            }

            if (!updates.length) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "수정할 데이터가 없습니다."
                });
            }

            values.push(req.params.id);

            const result =
                await pool.query(
                    `
                    UPDATE stocks

                    SET ${updates.join(", ")}

                    WHERE id = $${index}

                    RETURNING *
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
                    "주식 수정 중 오류가 발생했습니다."
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

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM stocks
                    WHERE id = $1
                    RETURNING id, name
                    `,
                    [req.params.id]
                );

            if (!result.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });
            }

            res.json({
                ok: true,
                message:
                    "주식이 삭제되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN STOCK DELETE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "주식 삭제 중 오류가 발생했습니다."
            });
        }
    }
);

// =====================================================
// 주가 상승 / 하락 제어
// =====================================================

router.post(
    "/stocks/:id/control",
    adminAuth,
    async (req, res) => {

        try {

            const {
                direction,
                untilTime,
                strength
            } = req.body;

            const allowed = [
                "normal",
                "up",
                "down"
            ];

            if (
                !allowed.includes(direction)
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "direction은 normal, up, down 중 하나여야 합니다."
                });
            }

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
                        Number(
                            untilTime || 0
                        ),
                        Number(
                            strength || 1
                        )
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
                    "주가 제어 중 오류가 발생했습니다."
            });
        }
    }
);

// =====================================================
// 피드백
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

            const {
                status
            } = req.body;

            const allowed = [
                "pending",
                "review",
                "accepted",
                "rejected"
            ];

            if (
                !allowed.includes(status)
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
                        status,
                        Date.now(),
                        req.params.id
                    ]
                );

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
                "ADMIN FEEDBACK UPDATE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "피드백 상태 변경 중 오류가 발생했습니다."
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
                    ORDER BY created_at DESC
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
// 공지사항 생성
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
                        String(title).trim(),
                        String(content).trim(),
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
                    "공지사항 생성 중 오류가 발생했습니다."
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
                    RETURNING id
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
                message:
                    "공지사항이 삭제되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN NOTICE DELETE ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "공지사항 삭제 중 오류가 발생했습니다."
            });
        }
    }
);

// =====================================================
// 점검 상태
// =====================================================

router.get(
    "/maintenance",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        enabled,
                        start_time,
                        end_time
                    FROM maintenance
                    WHERE id = 1
                `);

            const row =
                result.rows[0];

            res.json({
                ok: true,
                maintenance:
                    Boolean(row?.enabled),
                startTime:
                    row?.start_time
                        ? Number(row.start_time)
                        : null,
                endTime:
                    row?.end_time
                        ? Number(row.end_time)
                        : null
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
// 점검 시작
// =====================================================

router.post(
    "/maintenance/start",
    adminAuth,
    async (req, res) => {

        try {

            const {
                startTime,
                endTime
            } = req.body;

            const start =
                Number(
                    startTime || Date.now()
                );

            const end =
                Number(
                    endTime || 0
                );

            await pool.query(
                `
                UPDATE maintenance

                SET
                    enabled = TRUE,
                    start_time = $1,
                    end_time = $2,
                    updated_at = $3

                WHERE id = 1
                `,
                [
                    start,
                    end,
                    Date.now()
                ]
            );

            res.json({
                ok: true,
                message:
                    "서버 점검이 시작되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE START ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "점검 시작 중 오류가 발생했습니다."
            });
        }
    }
);

// =====================================================
// 점검 종료
// =====================================================

router.post(
    "/maintenance/end",
    adminAuth,
    async (req, res) => {

        try {

            await pool.query(
                `
                UPDATE maintenance

                SET
                    enabled = FALSE,
                    start_time = NULL,
                    end_time = NULL,
                    updated_at = $1

                WHERE id = 1
                `,
                [Date.now()]
            );

            res.json({
                ok: true,
                message:
                    "서버 점검이 종료되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN MAINTENANCE END ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "점검 종료 중 오류가 발생했습니다."
            });
        }
    }
);

module.exports = router;
