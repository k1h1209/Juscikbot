const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// [ID, 이름, 시작가격, 최소변동금액, 최대변동금액]
const companies = [
  ["SKNX", "스카닉스하이닉스", 4250, 50, 250],
  ["SAMS", "샘숭전자", 7100, 80, 350],
  ["TWAI", "티Wai", 1850, 20, 120],
  ["NVR", "나이버", 3500, 40, 220],
  ["NFLX", "니플릭스", 5200, 60, 300],
  ["PASC", "파스코", 2800, 30, 150],
  ["LG", "알쥐", 6400, 70, 300],
  ["HYUN", "현재자동차", 8300, 80, 350],
  ["NVDO", "N비디오", 9700, 100, 500],
  ["MHD", "마이크로하드", 7600, 70, 350]
];

async function getStocks() {
  const { rows } = await pool.query("SELECT * FROM stocks ORDER BY id ASC");
  return rows;
}

async function getStock(id) {
  const { rows } = await pool.query("SELECT * FROM stocks WHERE id=$1 LIMIT 1", [id]);
  return rows[0] || null;
}

async function getHistory(id, range="1d") {
  const ranges={"1h":3600000,"1d":86400000,"1w":604800000,"1m":2592000000,"3m":7776000000,all:Infinity};
  const duration=ranges[range] ?? ranges["1d"];
  const since=duration===Infinity?0:Date.now()-duration;
  const { rows }=await pool.query("SELECT time AS t, price AS p FROM price_history WHERE stock_id=$1 AND time >= $2 ORDER BY time ASC LIMIT 5000",[id,since]);
  return rows.map(r=>({t:Number(r.t),p:Number(r.p)}));
}

async function setPrice(id, price) {
  const value=Math.round(Number(price));
  if(!Number.isFinite(value)||value<1) throw new Error("가격이 올바르지 않습니다.");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const r=await client.query("UPDATE stocks SET previous=price,price=$1,high=GREATEST(high,$1),low=LEAST(low,$1) WHERE id=$2 RETURNING *",[value,id]);
    if(!r.rows.length) throw new Error("주식을 찾을 수 없습니다.");
    await client.query("INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)",[id,Date.now(),value]);
    await client.query("COMMIT");
    return r.rows[0];
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

function calculateNextPrice(stock, control=null) {
  const current=Math.max(1,Math.round(Number(stock.price)||1));
  const min=Math.max(1,Math.round(Math.abs(Number(stock.min_change)||1)));
  const max=Math.max(min,Math.round(Math.abs(Number(stock.max_change)||min)));
  const change=min+Math.floor(Math.random()*(max-min+1));
  let direction=Math.random()<0.5?-1:1;
  if(control && Number(control.until_time)>Date.now()) {
    if(control.direction==="up") direction=1;
    if(control.direction==="down") direction=-1;
  }
  return Math.max(1,current+direction*change);
}

let marketTimer=null;
let updating=false;
async function updateMarket(){
  if(updating)return;
  updating=true;
  try {
    for(const stock of await getStocks()) {
      try {
        const {rows}=await pool.query("SELECT direction,until_time,strength FROM market_controls WHERE stock_id=$1",[stock.id]);
        await setPrice(stock.id,calculateNextPrice(stock,rows[0]||null));
      } catch(e) { console.error(`[MARKET] ${stock.id}:`,e.message); }
    }
  } finally { updating=false; }
}

function startMarketEngine(interval=5000){
  if(marketTimer)return;
  console.log(`📈 주가 엔진 시작 · ${interval/1000}초 간격`);
  updateMarket().catch(e=>console.error("[MARKET] 초기 업데이트:",e));
  marketTimer=setInterval(()=>updateMarket().catch(e=>console.error("[MARKET] 업데이트:",e)),interval);
}
function stopMarketEngine(){if(marketTimer){clearInterval(marketTimer);marketTimer=null;}}

module.exports={pool,companies,getStocks,getStock,getHistory,setPrice,calculateNextPrice,updateMarket,startMarketEngine,stopMarketEngine};
