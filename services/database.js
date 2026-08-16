const { pool } = require("./market");

async function initializeDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // =====================================================
    // 사용자
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        player_number SERIAL UNIQUE,
        username TEXT UNIQUE NOT NULL,
        nickname TEXT UNIQUE NOT NULL,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        cash NUMERIC NOT NULL DEFAULT 10000,
        holdings JSONB NOT NULL DEFAULT '{}'::jsonb,
        transactions JSONB NOT NULL DEFAULT '[]'::jsonb,
        banned_until BIGINT,
        ban_reason TEXT DEFAULT '',
        created_at BIGINT NOT NULL
      )
    `);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS player_number SERIAL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until BIGINT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT DEFAULT ''`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_player_number_unique ON users(player_number)`);

    // =====================================================
    // 로그인 세션
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL
      )
    `);

    // =====================================================
    // 주식
    //
    // 중요:
    // 이제 주식 기본값을 코드에 넣지 않습니다.
    // 관리자가 /api/admin/stocks 를 통해 추가한 종목만 DB에 존재합니다.
    // 서버 재시작/재배포 시 기존 관리자 추가 종목은 유지됩니다.
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS stocks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price NUMERIC NOT NULL,
        previous NUMERIC NOT NULL,
        open_price NUMERIC NOT NULL,
        high NUMERIC NOT NULL,
        low NUMERIC NOT NULL,
        volume BIGINT NOT NULL DEFAULT 0,
        min_change NUMERIC NOT NULL DEFAULT 1,
        max_change NUMERIC NOT NULL DEFAULT 10,
        price_floor NUMERIC,
        floor_lock_until BIGINT NOT NULL DEFAULT 0,
        floor_rise_remaining INTEGER NOT NULL DEFAULT 0,
        max_shares BIGINT NOT NULL DEFAULT 30,
        available_shares BIGINT NOT NULL DEFAULT 30
      )
    `);

    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS min_change NUMERIC NOT NULL DEFAULT 1`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS max_change NUMERIC NOT NULL DEFAULT 10`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS price_floor NUMERIC`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS floor_lock_until BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS floor_rise_remaining INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS max_shares BIGINT NOT NULL DEFAULT 30`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS available_shares BIGINT NOT NULL DEFAULT 30`);
    await client.query(`ALTER TABLE stocks DROP COLUMN IF EXISTS volatility`);

    // =====================================================
    // 가격 기록
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id BIGSERIAL PRIMARY KEY,
        stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
        time BIGINT NOT NULL,
        price NUMERIC NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS price_history_stock_time_idx ON price_history(stock_id, time)`);

    // =====================================================
    // 관리자 주가 제어
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_controls (
        stock_id TEXT PRIMARY KEY REFERENCES stocks(id) ON DELETE CASCADE,
        direction TEXT NOT NULL DEFAULT 'normal',
        until_time BIGINT NOT NULL DEFAULT 0,
        strength INTEGER NOT NULL DEFAULT 1
      )
    `);
    await client.query(`ALTER TABLE market_controls ADD COLUMN IF NOT EXISTS strength INTEGER NOT NULL DEFAULT 1`);

    // =====================================================
    // 게임 설정
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_settings (
        id INTEGER PRIMARY KEY,
        starting_cash NUMERIC NOT NULL DEFAULT 10000,
        global_price_floor NUMERIC,
        floor_lock_minutes INTEGER NOT NULL DEFAULT 10,
        updated_at BIGINT NOT NULL
      )
    `);
    await client.query(`ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS starting_cash NUMERIC NOT NULL DEFAULT 10000`);
    await client.query(`ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS global_price_floor NUMERIC`);
    await client.query(`ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS floor_lock_minutes INTEGER NOT NULL DEFAULT 10`);

    // =====================================================
    // 알림 / 은행 / 피드백 / 변경사항 / 공지 / 점검
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id BIGSERIAL PRIMARY KEY,
        sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        receiver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        amount NUMERIC NOT NULL,
        memo TEXT DEFAULT '',
        type TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS changes (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        feedback_id BIGINT,
        created_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance (
        id INTEGER PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        start_time BIGINT,
        end_time BIGINT,
        updated_at BIGINT NOT NULL
      )
    `);

    // =====================================================
    // 스키마 마이그레이션 기록
    // =====================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `);

    // 기존 코드에 박혀 있던 10개 기본 종목은 이번 구조 변경에서 한 번만 제거합니다.
    // 이후에는 관리자가 다시 같은 종목 코드를 추가해도 삭제하지 않습니다.
    const legacyMigration = await client.query(
      `SELECT 1 FROM schema_migrations WHERE version=$1 LIMIT 1`,
      ["remove-hardcoded-stocks-v1"]
    );

    if (!legacyMigration.rows.length) {
      await client.query(`
        DELETE FROM stocks
        WHERE id IN (
          'SKNX','SAMS','TWAI','NVR','NFLX',
          'PASC','LG','HYUN','NVDO','MHD'
        )
      `);

      await client.query(
        `INSERT INTO schema_migrations(version, applied_at) VALUES($1,$2)`,
        ["remove-hardcoded-stocks-v1", Date.now()]
      );
    }

    // =====================================================
    // 공유 거래량 재계산
    // =====================================================
    const { rows: stockRows } = await client.query(`SELECT id, max_shares FROM stocks`);
    const { rows: userRows } = await client.query(`SELECT holdings FROM users`);

    for (const stock of stockRows) {
      let held = 0;

      for (const user of userRows) {
        const holdings = user.holdings || {};
        held += Math.max(0, Math.floor(Number(holdings[stock.id] || 0)));
      }

      await client.query(
        `UPDATE stocks
         SET available_shares=GREATEST(0, max_shares-$2::BIGINT)
         WHERE id=$1`,
        [stock.id, held]
      );
    }

    // =====================================================
    // 기본 게임 설정
    // =====================================================
    await client.query(`
      INSERT INTO game_settings
        (id, starting_cash, global_price_floor, floor_lock_minutes, updated_at)
      VALUES
        (1, 10000, NULL, 10, $1)
      ON CONFLICT (id) DO NOTHING
    `, [Date.now()]);

    await client.query(`
      INSERT INTO maintenance
        (id, enabled, start_time, end_time, updated_at)
      VALUES
        (1, FALSE, NULL, NULL, $1)
      ON CONFLICT (id) DO NOTHING
    `, [Date.now()]);

    await client.query("COMMIT");
    console.log("✅ PostgreSQL 데이터베이스 초기화 완료.");
    console.log("✅ 주식은 관리자 패널에서 추가한 종목만 사용합니다.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ 데이터베이스 초기화 실패:", error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initializeDatabase
};
