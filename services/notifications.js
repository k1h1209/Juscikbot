const { pool } = require("./market");

// 사용자에게 보여줄 알림 생성
async function createNotification(userId, message, type = "info") {
    const result = await pool.query(`
        SELECT id
        FROM users
        WHERE id = $1
    `, [userId]);

    if (!result.rows.length) {
        throw new Error("사용자를 찾을 수 없습니다.");
    }

    return {
        userId,
        message,
        type,
        createdAt: Date.now()
    };
}

// 입금 알림
async function createDepositNotification(
    userId,
    senderNickname,
    amount
) {
    return createNotification(
        userId,
        `${senderNickname}님에게 ${Number(amount).toLocaleString()}원이 입금되었습니다.`,
        "deposit"
    );
}

// 일반 알림
async function createInfoNotification(
    userId,
    message
) {
    return createNotification(
        userId,
        message,
        "info"
    );
}

module.exports = {
    createNotification,
    createDepositNotification,
    createInfoNotification
};
