const express = require("express");

const { pool } =
    require("../services/market");

const router =
    express.Router();

// =====================================================
// 플레이어 번호 포맷
// 5 → 00005
// =====================================================

function formatPlayerNumber(number) {

    if (
        number === null ||
        number === undefined
    ) {
        return null;
    }

    return String(number)
        .padStart(5, "0");
}

// =====================================================
// 인증
// =====================================================

async function getCurrentUser(req) {

    const auth =
        req.headers.authorization || "";

    if (!auth.startsWith("Bearer ")) {
        return null;
    }

    const token =
        auth.slice(7).trim();

    if (!token) {
        return null;
    }

    const result =
        await pool.query(`
            SELECT
                u.id,
                u.player_number,
                u.username,
                u.nickname,
                u.cash

            FROM sessions s

            JOIN users u
                ON u.id = s.user_id

            WHERE s.token = $1

            LIMIT 1
        `, [
            token
        ]);

    if (!result.rows.length) {
        return null;
    }

    return result.rows[0];
}

// =====================================================
// 인증 필요
// =====================================================

async function requireAuth(
    req,
    res,
    next
) {

    try {

        const user =
            await getCurrentUser(req);

        if (!user) {

            return res.status(401).json({
                ok: false,
                error:
                    "로그인이 필요합니다."
            });

        }

        req.user =
            user;

        next();

    } catch (error) {

        console.error(
            "BANK AUTH ERROR:",
            error
        );

        return res.status(500).json({
            ok: false,
            error:
                "사용자 인증 중 오류가 발생했습니다."
        });

    }
}

// =====================================================
// 은행 기본 정보
// =====================================================

router.get(
    "/",
    (req, res) => {

        res.json({

            ok: true,

            bankName:
                "안드로메다뱅크",

            message:
                "안드로메다뱅크 정상 운영 중"

        });

    }
);

// =====================================================
// 내 계좌
// =====================================================

router.get(
    "/account",
    requireAuth,
    async (req, res) => {

        try {

            const transactions =
                await pool.query(`
                    SELECT
                        bt.id,
                        bt.sender_id,
                        bt.receiver_id,
                        bt.amount,
                        bt.memo,
                        bt.type,
                        bt.created_at,

                        sender.player_number
                            AS sender_player_number,

                        sender.nickname
                            AS sender_nickname,

                        receiver.player_number
                            AS receiver_player_number,

                        receiver.nickname
                            AS receiver_nickname

                    FROM bank_transactions bt

                    LEFT JOIN users sender
                        ON sender.id =
                            bt.sender_id

                    LEFT JOIN users receiver
                        ON receiver.id =
                            bt.receiver_id

                    WHERE
                        bt.sender_id = $1

                        OR

                        bt.receiver_id = $1

                    ORDER BY
                        bt.created_at DESC

                    LIMIT 50
                `, [
                    req.user.id
                ]);

            const formattedTransactions =
                transactions.rows.map(
                    transaction => ({
                        ...transaction,

                        sender_player_number:
                            formatPlayerNumber(
                                transaction.sender_player_number
                            ),

                        receiver_player_number:
                            formatPlayerNumber(
                                transaction.receiver_player_number
                            )
                    })
                );

            return res.json({

                ok: true,

                accountNumber:
                    formatPlayerNumber(
                        req.user.player_number
                    ),

                balance:
                    Number(
                        req.user.cash
                    ),

                transactions:
                    formattedTransactions

            });

        } catch (error) {

            console.error(
                "BANK ACCOUNT ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "계좌 정보를 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 송금
// =====================================================

router.post(
    "/transfer",
    requireAuth,
    async (req, res) => {

        const client =
            await pool.connect();

        try {

            const {
                accountNumber,
                amount,
                memo
            } = req.body;

            // =================================================
            // 플레이어 번호 처리
            // 00005 → 5
            // =================================================

            const receiverNumberText =
                String(
                    accountNumber || ""
                ).trim();

            const receiverPlayerNumber =
                Number(
                    receiverNumberText
                );

            const money =
                Number(amount);

            const transferMemo =
                String(
                    memo || ""
                )
                .trim()
                .slice(0, 100);

            // =================================================
            // 플레이어 번호 검사
            // =================================================

            if (
                !receiverNumberText ||
                !Number.isInteger(
                    receiverPlayerNumber
                ) ||
                receiverPlayerNumber <= 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "받는 사람 플레이어 번호를 올바르게 입력하세요."
                });

            }

            // =================================================
            // 금액 검사
            // =================================================

            if (
                !Number.isInteger(money) ||
                money <= 0
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "이체 금액은 1원 이상의 정수여야 합니다."
                });

            }

            // =================================================
            // 자기 자신 검사
            // =================================================

            if (
                receiverPlayerNumber ===
                Number(req.user.player_number)
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "자기 자신에게 송금할 수 없습니다."
                });

            }

            // =================================================
            // 거래 시작
            // =================================================

            await client.query(
                "BEGIN"
            );

            // =================================================
            // 보내는 사람 잠금
            // =================================================

            const senderResult =
                await client.query(`
                    SELECT
                        id,
                        player_number,
                        nickname,
                        cash

                    FROM users

                    WHERE id = $1

                    FOR UPDATE
                `, [
                    req.user.id
                ]);

            if (
                !senderResult.rows.length
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    ok: false,
                    error:
                        "보내는 사람 계정을 찾을 수 없습니다."
                });

            }

            const sender =
                senderResult.rows[0];

            // =================================================
            // 받는 사람
            // 플레이어 번호로 검색
            // =================================================

            const receiverResult =
                await client.query(`
                    SELECT
                        id,
                        player_number,
                        nickname,
                        cash

                    FROM users

                    WHERE
                        player_number = $1

                    FOR UPDATE
                `, [
                    receiverPlayerNumber
                ]);

            if (
                !receiverResult.rows.length
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(404).json({
                    ok: false,
                    error:
                        `플레이어 번호 ${formatPlayerNumber(receiverPlayerNumber)}인 사용자를 찾을 수 없습니다.`
                });

            }

            const receiver =
                receiverResult.rows[0];

            // =================================================
            // 잔액
            // =================================================

            const senderCash =
                Number(
                    sender.cash
                );

            if (
                senderCash < money
            ) {

                await client.query(
                    "ROLLBACK"
                );

                return res.status(400).json({
                    ok: false,
                    error:
                        "잔액이 부족합니다.",
                    balance:
                        senderCash
                });

            }

            const senderBalanceBefore =
                senderCash;

            const receiverBalanceBefore =
                Number(
                    receiver.cash
                );

            // =================================================
            // 보내는 사람 차감
            // =================================================

            await client.query(`
                UPDATE users

                SET cash =
                    cash - $1

                WHERE id = $2
            `, [
                money,
                sender.id
            ]);

            // =================================================
            // 받는 사람 증가
            // =================================================

            await client.query(`
                UPDATE users

                SET cash =
                    cash + $1

                WHERE id = $2
            `, [
                money,
                receiver.id
            ]);

            // =================================================
            // 거래 기록
            // =================================================

            const transaction =
                await client.query(`
                    INSERT INTO bank_transactions
                    (
                        sender_id,
                        receiver_id,
                        amount,
                        memo,
                        type,
                        created_at
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        'transfer',
                        $5
                    )

                    RETURNING *
                `, [
                    sender.id,
                    receiver.id,
                    money,
                    transferMemo,
                    Date.now()
                ]);

            // =================================================
            // 보내는 사람 알림
            // =================================================

            await client.query(`
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
                    'bank',
                    FALSE,
                    $3
                )
            `, [
                sender.id,

                `${receiver.nickname}님에게 ${money.toLocaleString("ko-KR")}원을 송금했습니다.`,

                Date.now()
            ]);

            // =================================================
            // 받는 사람 알림
            // =================================================

            await client.query(`
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
                    'bank',
                    FALSE,
                    $3
                )
            `, [
                receiver.id,

                `${sender.nickname}님에게서 ${money.toLocaleString("ko-KR")}원을 받았습니다.`,

                Date.now()
            ]);

            // =================================================
            // 완료
            // =================================================

            await client.query(
                "COMMIT"
            );

            const senderBalanceAfter =
                senderBalanceBefore -
                money;

            const receiverBalanceAfter =
                receiverBalanceBefore +
                money;

            return res.json({

                ok: true,

                message:
                    "송금이 완료되었습니다.",

                transaction:
                    transaction.rows[0],

                sender: {

                    playerNumber:
                        formatPlayerNumber(
                            sender.player_number
                        ),

                    nickname:
                        sender.nickname,

                    balance:
                        senderBalanceAfter

                },

                receiver: {

                    playerNumber:
                        formatPlayerNumber(
                            receiver.player_number
                        ),

                    nickname:
                        receiver.nickname,

                    balance:
                        receiverBalanceAfter

                }

            });

        } catch (error) {

            try {
                await client.query(
                    "ROLLBACK"
                );
            } catch (_) {
            }

            console.error(
                "BANK TRANSFER ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "송금 처리 중 오류가 발생했습니다."
            });

        } finally {

            client.release();

        }

    }
);

// =====================================================
// 입금 내역
// =====================================================

router.get(
    "/deposits",
    requireAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        bt.*,

                        u.player_number
                            AS sender_player_number,

                        u.nickname
                            AS sender_nickname

                    FROM bank_transactions bt

                    LEFT JOIN users u
                        ON u.id =
                            bt.sender_id

                    WHERE
                        bt.receiver_id = $1

                    ORDER BY
                        bt.created_at DESC

                    LIMIT 100
                `, [
                    req.user.id
                ]);

            return res.json({
                ok: true,

                deposits:
                    result.rows.map(
                        row => ({
                            ...row,

                            sender_player_number:
                                formatPlayerNumber(
                                    row.sender_player_number
                                )
                        })
                    )
            });

        } catch (error) {

            console.error(
                "BANK DEPOSITS ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "입금 내역을 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 출금 내역
// =====================================================

router.get(
    "/withdrawals",
    requireAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        bt.*,

                        u.player_number
                            AS receiver_player_number,

                        u.nickname
                            AS receiver_nickname

                    FROM bank_transactions bt

                    LEFT JOIN users u
                        ON u.id =
                            bt.receiver_id

                    WHERE
                        bt.sender_id = $1

                    ORDER BY
                        bt.created_at DESC

                    LIMIT 100
                `, [
                    req.user.id
                ]);

            return res.json({
                ok: true,

                withdrawals:
                    result.rows.map(
                        row => ({
                            ...row,

                            receiver_player_number:
                                formatPlayerNumber(
                                    row.receiver_player_number
                                )
                        })
                    )
            });

        } catch (error) {

            console.error(
                "BANK WITHDRAWALS ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "출금 내역을 불러오지 못했습니다."
            });

        }

    }
);

// =====================================================
// 전체 거래내역
// =====================================================

router.get(
    "/transactions",
    requireAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(`
                    SELECT
                        bt.id,
                        bt.sender_id,
                        bt.receiver_id,
                        bt.amount,
                        bt.memo,
                        bt.type,
                        bt.created_at,

                        sender.player_number
                            AS sender_player_number,

                        sender.nickname
                            AS sender_nickname,

                        receiver.player_number
                            AS receiver_player_number,

                        receiver.nickname
                            AS receiver_nickname

                    FROM bank_transactions bt

                    LEFT JOIN users sender
                        ON sender.id =
                            bt.sender_id

                    LEFT JOIN users receiver
                        ON receiver.id =
                            bt.receiver_id

                    WHERE
                        bt.sender_id = $1

                        OR

                        bt.receiver_id = $1

                    ORDER BY
                        bt.created_at DESC

                    LIMIT 100
                `, [
                    req.user.id
                ]);

            return res.json({

                ok: true,

                transactions:
                    result.rows.map(
                        row => ({
                            ...row,

                            sender_player_number:
                                formatPlayerNumber(
                                    row.sender_player_number
                                ),

                            receiver_player_number:
                                formatPlayerNumber(
                                    row.receiver_player_number
                                )
                        })
                    )

            });

        } catch (error) {

            console.error(
                "BANK TRANSACTIONS ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "거래내역을 불러오지 못했습니다."
            });

        }

    }
);

module.exports =
    router;
