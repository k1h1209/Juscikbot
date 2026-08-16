const { pool, companies } = require("./market");

async function initializeDatabase(){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");

    await client.query(`CREATE TABLE IF NOT EXISTS users(
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
    )`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS player_number SERIAL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until BIGINT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT DEFAULT ''`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_player_number_unique ON users(player_number)`);

    await client.query(`CREATE TABLE IF NOT EXISTS sessions(
      token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at BIGINT NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS stocks(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,price NUMERIC NOT NULL,previous NUMERIC NOT NULL,
      open_price NUMERIC NOT NULL,high NUMERIC NOT NULL,low NUMERIC NOT NULL,volume BIGINT NOT NULL DEFAULT 0,
      min_change NUMERIC NOT NULL DEFAULT 1,max_change NUMERIC NOT NULL DEFAULT 10
    )`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS min_change NUMERIC NOT NULL DEFAULT 1`);
    await client.query(`ALTER TABLE stocks ADD COLUMN IF NOT EXISTS max_change NUMERIC NOT NULL DEFAULT 10`);
    await client.query(`ALTER TABLE stocks DROP COLUMN IF EXISTS volatility`);

    await client.query(`CREATE TABLE IF NOT EXISTS price_history(
      id BIGSERIAL PRIMARY KEY,stock_id TEXT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,time BIGINT NOT NULL,price NUMERIC NOT NULL
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS price_history_stock_time_idx ON price_history(stock_id,time)`);

    await client.query(`CREATE TABLE IF NOT EXISTS market_controls(
      stock_id TEXT PRIMARY KEY REFERENCES stocks(id) ON DELETE CASCADE,
      direction TEXT NOT NULL DEFAULT 'normal',until_time BIGINT NOT NULL DEFAULT 0,strength NUMERIC NOT NULL DEFAULT 1
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS notifications(
      id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'info',is_read BOOLEAN NOT NULL DEFAULT FALSE,created_at BIGINT NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS bank_transactions(
      id BIGSERIAL PRIMARY KEY,sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      receiver_id TEXT REFERENCES users(id) ON DELETE SET NULL,amount NUMERIC NOT NULL,memo TEXT DEFAULT '',type TEXT NOT NULL,created_at BIGINT NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS feedback(
      id BIGSERIAL PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,title TEXT NOT NULL,content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS changes(
      id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,feedback_id BIGINT,created_at BIGINT NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS notices(
      id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS maintenance(
      id INTEGER PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,start_time BIGINT,end_time BIGINT,updated_at BIGINT NOT NULL
    )`);

    for(const [id,name,price,minChange,maxChange] of companies){
      const r=await client.query("SELECT id FROM stocks WHERE id=$1",[id]);
      if(!r.rows.length){
        await client.query(`INSERT INTO stocks(id,name,price,previous,open_price,high,low,volume,min_change,max_change) VALUES($1,$2,$3,$3,$3,$3,$3,0,$4,$5)`,[id,name,price,minChange,maxChange]);
        await client.query(`INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)`,[id,Date.now(),price]);
      }else{
        await client.query(`UPDATE stocks SET name=$2,min_change=$3,max_change=$4 WHERE id=$1`,[id,name,minChange,maxChange]);
      }
    }

    await client.query(`INSERT INTO maintenance(id,enabled,start_time,end_time,updated_at) VALUES(1,FALSE,NULL,NULL,$1) ON CONFLICT(id) DO NOTHING`,[Date.now()]);
    await client.query("COMMIT");
    console.log("✅ PostgreSQL 데이터베이스 초기화 완료.");
  }catch(e){await client.query("ROLLBACK");console.error("❌ 데이터베이스 초기화 실패:",e);throw e;}
  finally{client.release();}
}
module.exports={initializeDatabase};
