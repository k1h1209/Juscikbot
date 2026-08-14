const express = require("express");

const { pool } =
    require("../services/market");

const router =
    express.Router();


// =====================================================
// 관리자 인증
// =====================================================

function getAdminPassword() {

    return (
        process.env.ADMIN_PASSWORD ||
        "admin1234"
    );

}


function adminAuth(
    req,
    res,
    next
) {

    const password =
        req.headers["x-admin-password"];


    if (
        !password ||
        password !==
        getAdminPassword()
    ) {

        return res.status(401).json({

            ok: false,

            error:
                "관리자 인증이 필요합니다."

        });

    }


    next();

}


// =====================================================
// 관리자 확인
// =====================================================

router.get(
    "/check",
    adminAuth,
    (req, res) => {

        res.json({

            ok: true,

            message:
                "관리자 인증 성공"

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

                    ORDER BY
                        player_number ASC
                `);


            res.json({

                ok: true,

                users:
                    result.rows

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
// 플레이어 수정
// =====================================================

router.patch(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const id =
                String(
                    req.params.id
                );


            const {
                nickname,
                cash,
                playerNumber
            } = req.body;


            const fields = [];

            const values = [];

            let index = 1;


            if (
                nickname !== undefined &&
                String(nickname).trim()
            ) {

                fields.push(
                    `nickname = $${index++}`
                );

                values.push(
                    String(
                        nickname
                    ).trim()
                );

            }


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


            if (
                playerNumber !== undefined
            ) {

                const number =
                    Number(
                        playerNumber
                    );


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

                user:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN USER UPDATE ERROR:",
                error
            );


            if (
                error.code ===
                "23505"
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
                String(
                    req.params.id
                );


            const {
                duration,
                reason
            } = req.body;


            let bannedUntil = null;


            if (
                duration !==
                "permanent"
            ) {

                const minutes =
                    Number(
                        duration
                    );


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
                        ).slice(
                            0,
                            200
                        ),

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


            await pool.query(
                `
                DELETE FROM sessions

                WHERE user_id = $1
                `,
                [id]
            );


            res.json({

                ok: true,

                user:
                    result.rows[0]

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
                    [
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

                user:
                    result.rows[0]

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
                    [
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

                        price,
                        previous,
                        open_price,
                        high,
                        low,

                        volume,

                        min_change,
                        max_change,

                        change_interval,
                        change_mode,

                        volume_limit_enabled,
                        volume_limit

                    FROM stocks

                    ORDER BY id ASC
                `);


            res.json({

                ok: true,

                stocks:
                    result.rows

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

                changeInterval,
                changeMode,

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


            const minimum =
                Number(
                    minChange
                );


            const maximum =
                Number(
                    maxChange
                );


            const interval =
                Number(
                    changeInterval
                );


            const allowedModes = [
                "random",
                "up",
                "down",
                "stop"
            ];


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
                !Number.isInteger(minimum) ||
                minimum < 1
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "최소 변동값이 올바르지 않습니다."

                });

            }


            if (
                !Number.isInteger(maximum) ||
                maximum < minimum
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "최대 변동값이 올바르지 않습니다."

                });

            }


            if (
                !Number.isInteger(interval) ||
                interval < 1
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "변동 주기는 1초 이상이어야 합니다."

                });

            }


            if (
                !allowedModes.includes(
                    changeMode || "random"
                )
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "잘못된 변동 방식입니다."

                });

            }


            const limit =
                Number(
                    volumeLimit || 0
                );


            if (
                !Number.isInteger(limit) ||
                limit < 0
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "거래량 제한이 올바르지 않습니다."

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

                        price,
                        previous,
                        open_price,
                        high,
                        low,

                        volume,

                        min_change,
                        max_change,

                        change_interval,
                        change_mode,

                        volume_limit_enabled,
                        volume_limit
                    )

                    VALUES
                    (
                        $1,
                        $2,

                        $3,
                        $3,
                        $3,
                        $3,
                        $3,

                        0,

                        $4,
                        $5,

                        $6,
                        $7,

                        $8,
                        $9
                    )

                    RETURNING *
                    `,
                    [
                        stockId,
                        stockName,

                        stockPrice,

                        minimum,
                        maximum,

                        interval,

                        changeMode || "random",

                        Boolean(
                            volumeLimitEnabled
                        ),

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
                [
                    stockId
                ]
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
                error.code ===
                "23505"
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

                changeInterval,
                changeMode,

                volumeLimitEnabled,
                volumeLimit

            } = req.body;


            const fields = [];

            const values = [];

            let index = 1;


            // 이름

            if (
                name !== undefined
            ) {

                const value =
                    String(
                        name
                    ).trim();


                if (!value) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "주식 이름이 비어 있습니다."

                    });

                }


                fields.push(
                    `name = $${index++}`
                );

                values.push(
                    value
                );

            }


            // 주가

            if (
                price !== undefined
            ) {

                const value =
                    Number(price);


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
                    `price = $${index++}`
                );

                values.push(
                    Math.round(value)
                );

            }


            // 최소 변동

            if (
                minChange !== undefined
            ) {

                const value =
                    Number(
                        minChange
                    );


                if (
                    !Number.isInteger(value) ||
                    value < 1
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

                values.push(
                    value
                );

            }


            // 최대 변동

            if (
                maxChange !== undefined
            ) {

                const value =
                    Number(
                        maxChange
                    );


                if (
                    !Number.isInteger(value) ||
                    value < 1
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

                values.push(
                    value
                );

            }


            // 변동 주기

            if (
                changeInterval !== undefined
            ) {

                const value =
                    Number(
                        changeInterval
                    );


                if (
                    !Number.isInteger(value) ||
                    value < 1
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "변동 주기는 1초 이상이어야 합니다."

                    });

                }


                fields.push(
                    `change_interval = $${index++}`
                );

                values.push(
                    value
                );

            }


            // 변동 방식

            if (
                changeMode !== undefined
            ) {

                const allowed = [
                    "random",
                    "up",
                    "down",
                    "stop"
                ];


                if (
                    !allowed.includes(
                        changeMode
                    )
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잘못된 변동 방식입니다."

                    });

                }


                fields.push(
                    `change_mode = $${index++}`
                );

                values.push(
                    changeMode
                );

            }


            // 거래량 제한 ON/OFF

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


            // 거래량 제한

            if (
                volumeLimit !== undefined
            ) {

                const value =
                    Number(
                        volumeLimit
                    );


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

                values.push(
                    value
                );

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
                    [
                        req.params.id
                    ]
                );


            if (!result.rows.length) {

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
// 주가 방향 강제 제어
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
// 피드백 상태
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
                    "피드백 수정에 실패했습니다."

            });

        }

    }
);


// =====================================================
// 공지 목록
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
                    [
                        req.params.id
                    ]
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
                    result.rows[0] ||
                    null

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
// 점검 종료
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
                    [
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


module.exports = router;
