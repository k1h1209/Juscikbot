const { pool } = require("./market");

// 현재 서버 점검 상태 확인
async function getMaintenance() {
    const result = await pool.query(`
        SELECT
            enabled,
            start_time,
            end_time
        FROM maintenance
        WHERE id = 1
    `);

    if (!result.rows.length) {
        return {
            enabled: false,
            startTime: null,
            endTime: null
        };
    }

    const row = result.rows[0];

    return {
        enabled: row.enabled,
        startTime: row.start_time
            ? Number(row.start_time)
            : null,
        endTime: row.end_time
            ? Number(row.end_time)
            : null
    };
}

// 서버 점검 시작
async function startMaintenance(startTime, endTime) {
    await pool.query(`
        UPDATE maintenance
        SET
            enabled = TRUE,
            start_time = $1,
            end_time = $2,
            updated_at = $3
        WHERE id = 1
    `, [
        startTime,
        endTime,
        Date.now()
    ]);

    return getMaintenance();
}

// 서버 점검 종료
async function endMaintenance() {
    await pool.query(`
        UPDATE maintenance
        SET
            enabled = FALSE,
            start_time = NULL,
            end_time = NULL,
            updated_at = $1
        WHERE id = 1
    `, [Date.now()]);

    return getMaintenance();
}

module.exports = {
    getMaintenance,
    startMaintenance,
    endMaintenance
};
