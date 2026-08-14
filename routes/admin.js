
const express = require("express");

const {
    pool
} = require("../services/market");

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
        req.headers[
            "x-admin-password"
        ];


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
// 관리자 인증 확인
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

            const fields = [];

            const values = [];

            let index = 1;


            if (
                req.body.nickname !==
                undefined
            ) {

                const nickname =
                    String(
                        req.body.nickname
                    ).trim();


                if (!nickname) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "닉네임이 올바르지 않습니다."

                    });
                }


                fields.push(
                    `nickname = $${index++}`
                );

                values.push(
                    nickname
                );
            }


            if (
                req.body.cash !==
                undefined
            ) {

                const cash =
                    Number(
                        req.body.cash
                    );


                if (
                    !Number.isFinite(cash) ||
                    cash < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "잔액이 올바르지 않습니다."

                    });
                }


                fields.push(
                    `cash = $${index++}`
                );

                values.push(
                    cash
                );
            }


            if (
                req.body.playerNumber !==
                undefined
            ) {

                const number =
                    Number(
                        req.body.playerNumber
                    );


                if (
                    !Number.isInteger(number) ||
                    number <= 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "플레이어 번호가 올바르지 않습니다."

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


            values.push(
                req.params.id
            );


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

            const duration =
                req.body.duration;


            const reason =
                String(
                    req.body.reason || ""
                ).slice(
                    0,
                    200
                );


            let bannedUntil =
                null;


            if (
                duration !==
                "permanent"
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
                            "밴 기간이 올바르지 않습니다."

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
                        reason,
                        req.params.id
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
                [req.params.id]
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
                        volatility,
                        min_change,
                        max_change,
                        volume,
                        volume_limit_enabled,
                        volume_limit

                    FROM stocks

                    ORDER BY id ASC
                `);


            const stocks =
                result.rows.map(
                    stock => ({

                        ...stock,

                        min_change:
                            Number(
                                stock.min_change
                            ),

                        max_change:
                            Number(
                                stock.max_change
                            ),

                        // 화면 표시용
                        change_range:
                            `${Math.min(
                                Number(stock.min_change),
                                Number(stock.max_change)
                            )} ~ ${Math.max(
                                Number(stock.min_change),
                                Number(stock.max_change)
                            )}`

                    })
                );


            res.json({

                ok: true,

                stocks

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

            const id =
                String(
                    req.body.id || ""
                )
                .trim()
                .toLowerCase();


            const name =
                String(
                    req.body.name || ""
                ).trim();


            const price =
                Number(
                    req.body.price
                );


            const volatility =
                Number(
                    req.body.volatility ||
                    0
                );


            let minChange =
                Math.abs(
                    Number(
                        req.body.minChange
                    )
                );


            let maxChange =
                Math.abs(
                    Number(
                        req.body.maxChange
                    )
                );


            if (
                !Number.isFinite(minChange)
            ) {

                minChange = 1;
            }


            if (
                !Number.isFinite(maxChange)
            ) {

                maxChange =
                    minChange;
            }


            if (
                minChange >
                maxChange
            ) {

                [
                    minChange,
                    maxChange
                ] = [
                    maxChange,
                    minChange
                ];
            }


            if (!id || !name) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "주식 ID와 이름을 입력하세요."

                });
            }


            if (
                !Number.isFinite(price) ||
                price <= 0
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "주가가 올바르지 않습니다."

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
                        $3,
                        $4,
                        $5,
                        $6,
                        $6,
                        $6,
                        $6,
                        $6,
                        0,
                        $7,
                        $8
                    )

                    RETURNING *
                    `,
                    [
                        id,
                        name,
                        volatility,
                        minChange,
                        maxChange,
                        price,
                        Boolean(
                            req.body.volumeLimitEnabled
                        ),
                        Math.max(
                            0,
                            Number(
                                req.body.volumeLimit ||
                                0
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
                    id,
                    Date.now(),
                    price
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
                [id]
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

            const fields = [];

            const values = [];

            let index = 1;


            if (
                req.body.name !==
                undefined
            ) {

                fields.push(
                    `name = $${index++}`
                );

                values.push(
                    String(
                        req.body.name
                    ).trim()
                );
            }


            if (
                req.body.price !==
                undefined
            ) {

                const price =
                    Number(
                        req.body.price
                    );


                if (
                    !Number.isFinite(price) ||
                    price <= 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "주가가 올바르지 않습니다."

                    });
                }


                fields.push(
                    `price = $${index++}`
                );

                values.push(
                    price
                );
            }


            if (
                req.body.volatility !==
                undefined
            ) {

                const volatility =
                    Number(
                        req.body.volatility
                    );


                if (
                    !Number.isFinite(volatility) ||
                    volatility < 0
                ) {

                    return res.status(400).json({

                        ok: false,

                        error:
                            "변동성이 올바르지 않습니다."

                    });
                }


                fields.push(
                    `volatility = $${index++}`
                );

                values.push(
                    volatility
                );
            }


            let minChange =
                req.body.minChange !==
                undefined
                    ? Math.abs(
                        Number(
                            req.body.minChange
                        )
                    )
                    : null;


            let maxChange =
                req.body.maxChange !==
                undefined
                    ? Math.abs(
                        Number(
                            req.body.maxChange
                        )
                    )
                    : null;


            if (
                minChange !== null &&
                !Number.isFinite(minChange)
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "최소 변동값이 올바르지 않습니다."

                });
            }


            if (
                maxChange !== null &&
                !Number.isFinite(maxChange)
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "최대 변동값이 올바르지 않습니다."

                });
            }


            if (
                minChange !== null &&
                maxChange !== null &&
                minChange > maxChange
            ) {

                [
                    minChange,
                    maxChange
                ] = [
                    maxChange,
                    minChange
                ];
            }


            if (
                minChange !== null
            ) {

                fields.push(
                    `min_change = $${index++}`
                );

                values.push(
                    minChange
                );
            }


            if (
                maxChange !== null
            ) {

                fields.push(
                    `max_change = $${index++}`
                );

                values.push(
                    maxChange
                );
            }


            if (
                req.body.volumeLimitEnabled !==
                undefined
            ) {

                fields.push(
                    `volume_limit_enabled = $${index++}`
                );

                values.push(
                    Boolean(
                        req.body.volumeLimitEnabled
                    )
                );
            }


            if (
                req.body.volumeLimit !==
                undefined
            ) {

                const limit =
                    Number(
                        req.body.volumeLimit
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


                fields.push(
                    `volume_limit = $${index++}`
                );

                values.push(
                    limit
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

        try {

            const result =
                await pool.query(
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

                return res.status(404).json({

                    ok: false,

                    error:
                        "주식을 찾을 수 없습니다."

                });
            }


            res.json({

                ok: true,

                deleted:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "ADMIN STOCK DELETE ERROR:",
                error
            );


            res.status(500).json({

                ok: false,

                error:
                    "주식 삭제에 실패했습니다."

            });
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

            const allowed = [
                "normal",
                "up",
                "down"
            ];


            const direction =
                req.body.direction;


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


            const duration =
                Number(
                    req.body.duration ||
                    0
                );


            const strength =
                Number(
                    req.body.strength ||
                    1
                );


            if (
                !Number.isFinite(strength) ||
                strength <= 0
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "강도가 올바르지 않습니다."

                });
            }


            const untilTime =
                direction === "normal"
                    ? 0
                    : Date.now() +
                      Math.max(
                          0,
                          duration
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
                        strength
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


module.exports = router;
