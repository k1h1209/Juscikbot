const express = require("express");
const crypto = require("crypto");
const { pool } = require("../services/market");

const router = express.Router();

const STARTING_CASH = 10000;

// =====================================================
// 비밀번호
// =====================================================

function hashPassword(password, salt) {
    return crypto
        .scryptSync(password, salt, 64)
        .toString("hex");
}

// =====================================================
// 토큰
// =====================================================

function createToken() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}

// =====================================================
// 사용자 정보 안전하게 반환
// =====================================================

function safeUser(user) {

    return {
        id: user.id,

        playerNumber:
            Number(user.player_number),

        username: user.username,

        nickname: user.nickname,

        cash: Number(user.cash),

        holdings:
            user.holdings || {}
    };
}

// =====================================================
// 인증
// =====================================================

async function auth(req, res, next) {

    try {

        const header =
            req.headers.authorization || "";

        const token =
            header.startsWith("Bearer ")
                ? header.substring(7)
                : "";

        if (!token) {

            return res.status(401).json({
                error: "로그인이 필요합니다."
            });

        }

        const result =
            await pool.query(
                `
                SELECT
                    u.id,
                    u.player_number,
                    u.username,
                    u.nickname,
                    u.cash,
                    u.holdings,
                    u.transactions

                FROM sessions s

                JOIN users u
                    ON u.id = s.user_id

                WHERE s.token = $1
                `,
                [token]
            );

        if (!result.rows.length) {

            return res.status(401).json({
                error: "로그인이 필요합니다."
            });

        }

        req.user =
            result.rows[0];

        req.token =
            token;

        next();

    } catch (error) {

        console.error(
            "AUTH ERROR:",
            error
        );

        res.status(500).json({
            error:
                "인증 처리 중 오류가 발생했습니다."
        });
    }
}

// =====================================================
// 회원가입
// =====================================================

router.post(
    "/register",
    async (req, res) => {

        try {

            const {
                username,
                password,
                nickname
            } = req.body;

            if (
                !username ||
                !password ||
                !nickname
            ) {

                return res.status(400).json({
                    error:
                        "아이디, 비밀번호, 닉네임을 모두 입력하세요."
                });

            }

            const cleanUsername =
                String(username).trim();

            const cleanNickname =
                String(nickname).trim();

            const cleanPassword =
                String(password);

            if (
                cleanUsername.length < 3
            ) {

                return res.status(400).json({
                    error:
                        "아이디는 3자 이상이어야 합니다."
                });

            }

            if (
                cleanPassword.length < 4
            ) {

                return res.status(400).json({
                    error:
                        "비밀번호는 4자 이상이어야 합니다."
                });

            }

            if (
                cleanNickname.length < 2
            ) {

                return res.status(400).json({
                    error:
                        "닉네임은 2자 이상이어야 합니다."
                });

            }

            // 중복 확인
            const duplicate =
                await pool.query(
                    `
                    SELECT id

                    FROM users

                    WHERE
                        LOWER(username)
                        =
                        LOWER($1)

                        OR nickname = $2

                    LIMIT 1
                    `,
                    [
                        cleanUsername,
                        cleanNickname
                    ]
                );

            if (duplicate.rows.length) {

                return res.status(409).json({
                    error:
                        "이미 사용 중인 아이디 또는 닉네임입니다."
                });

            }

            // 내부 UUID
            const id =
                crypto.randomUUID();

            // 비밀번호 암호화
            const salt =
                crypto
                    .randomBytes(16)
                    .toString("hex");

            const passwordHash =
                hashPassword(
                    cleanPassword,
                    salt
                );

            // 세션 토큰
            const token =
                createToken();

            const createdAt =
                Date.now();

            // =================================================
            // 사용자 생성
            //
            // player_number는 SERIAL이 자동 생성
            // =================================================

            const userResult =
                await pool.query(
                    `
                    INSERT INTO users
                    (
                        id,
                        username,
                        nickname,
                        salt,
                        password_hash,
                        cash,
                        holdings,
                        transactions,
                        created_at
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        '{}'::jsonb,
                        '[]'::jsonb,
                        $7
                    )

                    RETURNING
                        id,
                        player_number,
                        username,
                        nickname,
                        cash,
                        holdings
                    `,
                    [
                        id,
                        cleanUsername,
                        cleanNickname,
                        salt,
                        passwordHash,
                        STARTING_CASH,
                        createdAt
                    ]
                );

            const user =
                userResult.rows[0];

            // =================================================
            // 세션
            // =================================================

            await pool.query(
                `
                INSERT INTO sessions
                (
                    token,
                    user_id,
                    created_at
                )

                VALUES
                (
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    token,
                    id,
                    createdAt
                ]
            );

            // =================================================
            // 가입 환영 알림
            // =================================================

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
                    id,
                    "VSM 가입을 환영합니다!",
                    "welcome",
                    createdAt
                ]
            );

            // =================================================
            // 응답
            // =================================================

            res.status(201).json({

                ok: true,

                token,

                user:
                    safeUser(user)

            });

        } catch (error) {

            console.error(
                "REGISTER ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "회원가입 중 오류가 발생했습니다."
            });

        }
    }
);

// =====================================================
// 로그인
// =====================================================

router.post(
    "/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "아이디와 비밀번호를 입력하세요."
                });

            }

            const result =
                await pool.query(
                    `
                    SELECT *

                    FROM users

                    WHERE
                        LOWER(username)
                        =
                        LOWER($1)

                    LIMIT 1
                    `,
                    [
                        String(username).trim()
                    ]
                );

            if (!result.rows.length) {

                return res.status(401).json({
                    error:
                        "아이디 또는 비밀번호가 올바르지 않습니다."
                });

            }

            const user =
                result.rows[0];

            const passwordHash =
                hashPassword(
                    String(password),
                    user.salt
                );

            if (
                passwordHash !==
                user.password_hash
            ) {

                return res.status(401).json({
                    error:
                        "아이디 또는 비밀번호가 올바르지 않습니다."
                });

            }

            const token =
                createToken();

            await pool.query(
                `
                INSERT INTO sessions
                (
                    token,
                    user_id,
                    created_at
                )

                VALUES
                (
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    token,
                    user.id,
                    Date.now()
                ]
            );

            res.json({

                ok: true,

                token,

                user:
                    safeUser(user)

            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "로그인 중 오류가 발생했습니다."
            });

        }
    }
);

// =====================================================
// 내 정보
// =====================================================

router.get(
    "/me",
    auth,
    async (req, res) => {

        res.json({

            ok: true,

            user:
                safeUser(req.user)

        });

    }
);

// =====================================================
// 로그아웃
// =====================================================

router.post(
    "/logout",
    auth,
    async (req, res) => {

        try {

            await pool.query(
                `
                DELETE FROM sessions

                WHERE token = $1
                `,
                [
                    req.token
                ]
            );

            res.json({
                ok: true
            });

        } catch (error) {

            console.error(
                "LOGOUT ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "로그아웃 처리 중 오류가 발생했습니다."
            });

        }

    }
);

// =====================================================
// export
// =====================================================

module.exports = router;

module.exports.auth = auth;
