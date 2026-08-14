```javascript
const express = require("express");
const { pool } = require("../services/market");

const router = express.Router();


// =====================================================
// 관리자 비밀번호
// =====================================================

function getAdminPassword() {
    return process.env.ADMIN_PASSWORD || "admin1234";
}


// =====================================================
// 관리자 인증
// =====================================================

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
// 숫자 안전 변환
// =====================================================

function toNumber(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;

}


// =====================================================
// 플레이어 번호 → 실제 UUID 찾기
// =====================================================

async function findUserId(value) {

    const input =
        String(value || "").trim();

    if (!input) {
        return null;
    }


    // UUID / 내부 ID
    const byId =
        await pool.query(
            `
            SELECT id
            FROM users
            WHERE id = $1
            LIMIT 1
            `,
            [input]
        );


    if (byId.rows.length) {
        return byId.rows[0].id;
    }


    // 플레이어 번호
    if (/^\d+$/.test(input)) {

        const byNumber =
            await pool.query(
                `
                SELECT id
                FROM users
                WHERE player_number = $1
                LIMIT 1
                `,
                [Number(input)]
            );


        if (byNumber.rows.length) {
            return byNumber.rows[0].id;
        }

    }


    // 아이디
    const byUsername =
        await pool.query(
            `
            SELECT id
            FROM users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [input]
        );


    if (byUsername.rows.length) {
        return byUsername.rows[0].id;
    }


    return null;

}


// =====================================================
// DB에 관리자용 컬럼이 없으면 자동 생성
// =====================================================

async function ensureAdminColumns() {

    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS banned_until BIGINT
    `);


    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS ban_reason TEXT
    `);


    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_banned BOOLEAN
        NOT NULL DEFAULT FALSE
    `);


    await pool.query(`
        ALTER TABLE stocks
        ADD COLUMN IF NOT EXISTS min_change NUMERIC
        NOT NULL DEFAULT 1
    `);


    await pool.query(`
        ALTER TABLE stocks
        ADD COLUMN IF NOT EXISTS max_change NUMERIC
        NOT NULL DEFAULT 1000
    `);


    await pool.query(`
        ALTER TABLE stocks
        ADD COLUMN IF NOT EXISTS volume_limit_enabled BOOLEAN
        NOT NULL DEFAULT FALSE
    `);


    await pool.query(`
        ALTER TABLE stocks
        ADD COLUMN IF NOT EXISTS volume_limit BIGINT
        NOT NULL DEFAULT 0
    `);


    await pool.query(`
        ALTER TABLE stocks
        ADD COLUMN IF NOT EXISTS trading_enabled BOOLEAN
        NOT NULL DEFAULT TRUE
    `);

}


// =====================================================
// 관리자 인증 확인
// =====================================================

router.get(
    "/check",
    adminAuth,
    async (req, res) => {

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

            await ensureAdminColumns();


            const result =
                await pool.query(`
                    SELECT
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings,
                        created_at,
                        is_banned,
                        banned_until,
                        ban_reason

                    FROM users

                    ORDER BY
                        player_number ASC
                `);


            const users =
                result.rows.map(user => ({

                    id:
                        user.id,

                    playerNumber:
                        Number(user.player_number),

                    username:
                        user.username,

                    nickname:
                        user.nickname,

                    cash:
                        Number(user.cash),

                    holdings:
                        user.holdings || {},

                    createdAt:
                        Number(user.created_at),

                    isBanned:
                        Boolean(user.is_banned),

                    bannedUntil:
                        user.banned_until
                            ? Number(user.banned_until)
                            : null,

                    banReason:
                        user.ban_reason || ""

                }));


            res.json({
                ok: true,
                users
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

            await ensureAdminColumns();


            const userId =
                await findUserId(
                    req.params.id
                );


            if (!userId) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            const {
                nickname,
                cash
            } = req.body;


            if (
                nickname !== undefined &&
                String(nickname).trim().length < 2
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "닉네임은 2자 이상이어야 합니다."
                });

            }


            if (cash !== undefined) {

                const money =
                    toNumber(cash, -1);

                if (
                    !Number.isFinite(money) ||
                    money < 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "현금은 0원 이상의 숫자여야 합니다."
                    });

                }

            }


            const current =
                await pool.query(
                    `
                    SELECT nickname, cash
                    FROM users
                    WHERE id = $1
                    `,
                    [userId]
                );


            if (!current.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            const newNickname =
                nickname !== undefined
                    ? String(nickname).trim()
                    : current.rows[0].nickname;


            const newCash =
                cash !== undefined
                    ? Number(cash)
                    : Number(current.rows[0].cash);


            const result =
                await pool.query(
                    `
                    UPDATE users

                    SET
                        nickname = $1,
                        cash = $2

                    WHERE id = $3

                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname,
                        cash
                    `,
                    [
                        newNickname,
                        newCash,
                        userId
                    ]
                );


            res.json({
                ok: true,
                user: {
                    id:
                        result.rows[0].id,

                    playerNumber:
                        Number(
                            result.rows[0].player_number
                        ),

                    username:
                        result.rows[0].username,

                    nickname:
                        result.rows[0].nickname,

                    cash:
                        Number(result.rows[0].cash)
                }
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
// 플레이어 초기화
// =====================================================

router.post(
    "/users/:id/reset",
    adminAuth,
    async (req, res) => {

        try {

            const userId =
                await findUserId(
                    req.params.id
                );


            if (!userId) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            await pool.query(
                `
                UPDATE users

                SET
                    cash = 10000,
                    holdings = '{}'::jsonb,
                    transactions = '[]'::jsonb

                WHERE id = $1
                `,
                [userId]
            );


            res.json({
                ok: true,
                message:
                    "플레이어 데이터가 초기화되었습니다."
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
// 플레이어 삭제
// =====================================================

router.delete(
    "/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const userId =
                await findUserId(
                    req.params.id
                );


            if (!userId) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            await pool.query(
                `
                DELETE FROM users
                WHERE id = $1
                `,
                [userId]
            );


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
// 플레이어 밴
// =====================================================

router.post(
    "/users/:id/ban",
    adminAuth,
    async (req, res) => {

        try {

            await ensureAdminColumns();


            const userId =
                await findUserId(
                    req.params.id
                );


            if (!userId) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            const {
                duration,
                reason
            } = req.body;


            const durationNumber =
                Number(duration);


            let bannedUntil = null;


            // 영구 밴
            if (
                duration === "permanent" ||
                duration === "permanent" ||
                durationNumber === -1
            ) {

                bannedUntil = null;

            }

            // 기간제
            else {

                if (
                    !Number.isFinite(
                        durationNumber
                    ) ||
                    durationNumber <= 0
                ) {

                    return res.status(400).json({
                        ok: false,
                        error:
                            "올바른 밴 기간을 입력하세요."
                    });

                }


                bannedUntil =
                    Date.now() +
                    durationNumber;
            }


            await pool.query(
                `
                UPDATE users

                SET
                    is_banned = TRUE,
                    banned_until = $1,
                    ban_reason = $2

                WHERE id = $3
                `,
                [
                    bannedUntil,
                    String(reason || "").slice(0, 200),
                    userId
                ]
            );


            res.json({
                ok: true,
                message:
                    "플레이어가 밴되었습니다.",
                bannedUntil
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

            await ensureAdminColumns();


            const userId =
                await findUserId(
                    req.params.id
                );


            if (!userId) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "플레이어를 찾을 수 없습니다."
                });

            }


            await pool.query(
                `
                UPDATE users

                SET
                    is_banned = FALSE,
                    banned_until = NULL,
                    ban_reason = NULL

                WHERE id = $1
                `,
                [userId]
            );


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

            await ensureAdminColumns();


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
                        volatility,
                        min_change,
                        max_change,
                        volume_limit_enabled,
                        volume_limit,
                        trading_enabled

                    FROM stocks

                    ORDER BY id
                `);


            const stocks =
                result.rows.map(stock => ({

                    id:
                        stock.id,

                    name:
                        stock.name,

                    price:
                        Number(stock.price),

                    previous:
                        Number(stock.previous),

                    open:
                        Number(stock.open_price),

                    high:
                        Number(stock.high),

                    low:
                        Number(stock.low),

                    volume:
                        Number(stock.volume),

                    volatility:
                        Number(stock.volatility),

                    minChange:
                        Number(stock.min_change),

                    maxChange:
                        Number(stock.max_change),

                    volumeLimitEnabled:
                        Boolean(
                            stock.volume_limit_enabled
                        ),

                    volumeLimit:
                        Number(
                            stock.volume_limit
                        ),

                    tradingEnabled:
                        Boolean(
                            stock.trading_enabled
                        )

                }));


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
// 주식 수정
// =====================================================

router.patch(
    "/stocks/:id",
    adminAuth,
    async (req, res) => {

        try {

            await ensureAdminColumns();


            const stockId =
                String(
                    req.params.id
                ).trim();


            const {
                name,
                price,
                minChange,
                maxChange,
                volumeLimitEnabled,
                volumeLimit,
                tradingEnabled
            } = req.body;


            const current =
                await pool.query(
                    `
                    SELECT *
                    FROM stocks
                    WHERE id = $1
                    `,
                    [stockId]
                );


            if (!current.rows.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "주식을 찾을 수 없습니다."
                });

            }


            const stock =
                current.rows[0];


            const newName =
                name !== undefined
                    ? String(name).trim()
                    : stock.name;


            const newPrice =
                price !== undefined
                    ? Number(price)
                    : Number(stock.price);


            const newMinChange =
                minChange !== undefined
                    ? Number(minChange)
                    : Number(stock.min_change);


            const newMaxChange =
                maxChange !== undefined
                    ? Number(maxChange)
                    : Number(stock.max_change);


            const newVolumeLimitEnabled =
                volumeLimitEnabled !== undefined
                    ? Boolean(volumeLimitEnabled)
                    : Boolean(
                        stock.volume_limit_enabled
                    );


            const newVolumeLimit =
                volumeLimit !== undefined
                    ? Number(volumeLimit)
                    : Number(stock.volume_limit);


            const newTradingEnabled =
                tradingEnabled !== undefined
                    ? Boolean(tradingEnabled)
                    : Boolean(stock.trading_enabled);


            if (
                !newName ||
                newPrice < 0 ||
                newMinChange < 0 ||
                newMaxChange < newMinChange ||
                newVolumeLimit < 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "주식 설정값이 올바르지 않습니다."
                });

            }


            const result =
                await pool.query(
                    `
                    UPDATE stocks

                    SET
                        name = $1,
                        price = $2,
                        min_change = $3,
                        max_change = $4,
                        volume_limit_enabled = $5,
                        volume_limit = $6,
                        trading_enabled = $7

                    WHERE id = $8

                    RETURNING *
                    `,
                    [
                        newName,
                        newPrice,
                        newMinChange,
                        newMaxChange,
                        newVolumeLimitEnabled,
                        newVolumeLimit,
                        newTradingEnabled,
                        stockId
                    ]
                );


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
                    "주식 수정 중 오류가 발생했습니다."
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

            await ensureAdminColumns();


            const {
                id,
                name,
                price,
                minChange,
                maxChange,
                volumeLimitEnabled,
                volumeLimit,
                tradingEnabled,
                volatility
            } = req.body;


            const stockId =
                String(id || "")
                    .trim()
                    .toUpperCase();


            const stockName =
                String(name || "").trim();


            const stockPrice =
                Number(price);


            const min =
                Number(
                    minChange ?? 1
                );


            const max =
                Number(
                    maxChange ?? 1000
                );


            if (
                !stockId ||
                !stockName ||
                !Number.isFinite(stockPrice) ||
                stockPrice < 0 ||
                min < 0 ||
                max < min
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "주식 정보를 올바르게 입력하세요."
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
                        "이미 존재하는 주식 코드입니다."
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
                        min_change,
                        max_change,
                        volume_limit_enabled,
                        volume_limit,
                        trading_enabled
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
                        Number(
                            volatility ?? 0
                        ),
                        stockPrice,
                        min,
                        max,
                        Boolean(
                            volumeLimitEnabled
                        ),
                        Number(
                            volumeLimit ?? 0
                        ),
                        tradingEnabled !== false
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
                stock: result.rows[0]
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
// 주식 삭제
// =====================================================

router.delete(
    "/stocks/:id",
    adminAuth,
    async (req, res) => {

        try {

            const stockId =
                String(
                    req.params.id
                ).trim();


            const result =
                await pool.query(
                    `
                    DELETE FROM stocks
                    WHERE id = $1
                    RETURNING id
                    `,
                    [stockId]
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

            const stockId =
                String(
                    req.params.id
                ).trim();


            const {
                direction,
                duration,
                strength
            } = req.body;


            const allowed =
                [
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
                        "direction은 normal, up, down 중 하나여야 합니다."
                });

            }


            const until =
                Date.now() +
                Math.max(
                    0,
                    Number(duration || 0)
                );


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
                    direction = EXCLUDED.direction,
                    until_time = EXCLUDED.until_time,
                    strength = EXCLUDED.strength
                `,
                [
                    stockId,
                    direction,
                    until,
                    Number(
                        strength ?? 1
                    )
                ]
            );


            res.json({
                ok: true,
                message:
                    "주가 제어가 적용되었습니다.",
                direction,
                untilTime: until
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
// 피드백 전체 조회
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
                        u.username,
                        u.nickname,
                        u.player_number

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


            const allowed =
                [
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
                !String(title || "").trim() ||
                !String(content || "").trim()
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
// 변경사항
// =====================================================

router.get(
    "/changes",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT *
                    FROM changes
                    ORDER BY created_at DESC
                    LIMIT 100
                `);


            res.json({
                ok: true,
                changes:
                    result.rows
            });

        } catch (error) {

            console.error(
                "ADMIN CHANGES ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "변경사항을 불러오지 못했습니다."
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
                        end_time,
                        updated_at

                    FROM maintenance

                    WHERE id = 1
                `);


            const row =
                result.rows[0];


            res.json({
                ok: true,

                maintenance:
                    Boolean(
                        row?.enabled
                    ),

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


            const now =
                Date.now();


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
                    startTime || now,
                    endTime || null,
                    now
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

            await pool.query(`
                UPDATE maintenance

                SET
                    enabled = FALSE,
                    start_time = NULL,
                    end_time = NULL,
                    updated_at = $1

                WHERE id = 1
            `, [
                Date.now()
            ]);


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


// =====================================================
// 전체 초기화
// =====================================================

router.post(
    "/reset",
    adminAuth,
    async (req, res) => {

        try {

            await pool.query(`
                UPDATE users

                SET
                    cash = 10000,
                    holdings = '{}'::jsonb,
                    transactions = '[]'::jsonb
            `);


            res.json({
                ok: true,
                message:
                    "전체 플레이어 데이터가 초기화되었습니다."
            });

        } catch (error) {

            console.error(
                "ADMIN GLOBAL RESET ERROR:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    "전체 초기화 중 오류가 발생했습니다."
            });

        }

    }
);


// =====================================================
// Export
// =====================================================

module.exports = router;
```
