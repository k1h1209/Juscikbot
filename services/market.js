const { Pool } = require("pg");

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:false});
const companies=[
  ["SKNX","스카닉스하이닉스",4250,50,250],["SAMS","샘숭전자",7100,80,350],["TWAI","티Wai",1850,20,120],["NVR","나이버",3500,40,220],["NFLX","니플릭스",5200,60,300],["PASC","파스코",2800,30,150],["LG","알쥐",6400,70,300],["HYUN","현재자동차",8300,80,350],["NVDO","N비디오",9700,100,500],["MHD","마이크로하드",7600,70,350]
];

async function getStocks(){return (await pool.query("SELECT * FROM stocks ORDER BY id ASC")).rows;}
async function getStock(id){return (await pool.query("SELECT * FROM stocks WHERE id=$1 LIMIT 1",[id])).rows[0]||null;}
async function getGlobalSettings(){
  try{const {rows}=await pool.query("SELECT global_price_floor,floor_lock_minutes FROM game_settings WHERE id=1 LIMIT 1");const r=rows[0]||{};return {floor:r.global_price_floor===null||r.global_price_floor===undefined?null:Number(r.global_price_floor),lockMinutes:Math.max(1,Number(r.floor_lock_minutes||10))};}
  catch{return {floor:null,lockMinutes:10};}
}
async function getGlobalPriceFloor(){return (await getGlobalSettings()).floor;}
async function getHistory(id,range="1d"){
  const ranges={"1h":3600000,"1d":86400000,"1w":604800000,"1m":2592000000,"3m":7776000000,all:Infinity};const duration=ranges[range]??ranges["1d"];const since=duration===Infinity?0:Date.now()-duration;
  const {rows}=await pool.query("SELECT time AS t,price AS p FROM price_history WHERE stock_id=$1 AND time >= $2 ORDER BY time ASC LIMIT 5000",[id,since]);return rows.map(r=>({t:Number(r.t),p:Number(r.p)}));
}
async function setPrice(id,price){
  const value=Math.max(1,Math.round(Number(price)));if(!Number.isFinite(value))throw new Error("가격이 올바르지 않습니다.");
  const client=await pool.connect();try{await client.query("BEGIN");const r=await client.query(`UPDATE stocks SET previous=price,price=$1,high=GREATEST(high,$1),low=LEAST(low,$1) WHERE id=$2 RETURNING *`,[value,id]);if(!r.rows.length)throw new Error("주식을 찾을 수 없습니다.");await client.query("INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)",[id,Date.now(),value]);await client.query("COMMIT");return r.rows[0];}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
function randomChange(stock){const min=Math.max(1,Math.round(Math.abs(Number(stock.min_change)||1)));const max=Math.max(min,Math.round(Math.abs(Number(stock.max_change)||min)));return min+Math.floor(Math.random()*(max-min+1));}
function biasedDirection(control){
  if(!control||!['up','down'].includes(control.direction)||Number(control.until_time)<=Date.now())return Math.random()<0.5?1:-1;
  const strength=Math.min(5,Math.max(1,Math.round(Number(control.strength)||1)));
  // 강도 1 = 55%, 강도 5 = 87% 정도로 지정 방향을 선호하지만 반대 방향도 나올 수 있습니다.
  const wanted=0.55+(strength-1)*0.08;
  return Math.random()<wanted?(control.direction==='up'?1:-1):(control.direction==='up'?-1:1);
}
async function updateStockMarket(stock){
  const now=Date.now();const settings=await getGlobalSettings();const rawFloor=Number(stock.price_floor);const floor=settings.floor!==null?settings.floor:(Number.isFinite(rawFloor)&&rawFloor>0?rawFloor:null);const hasFloor=floor!==null;
  let lockUntil=Number(stock.floor_lock_until||0);let recovery=Number(stock.floor_rise_remaining||0);const current=Math.max(1,Math.round(Number(stock.price)||1));

  if(hasFloor&&lockUntil>now){if(current!==floor)await setPrice(stock.id,floor);return;}

  // 커트라인 잠금 종료 후에는 반드시 두 번의 시장 업데이트를 상승으로 처리합니다.
  if(hasFloor&&lockUntil>0&&lockUntil<=now&&recovery>0){
    const next=current+randomChange(stock);
    await pool.query("UPDATE stocks SET floor_rise_remaining=$1 WHERE id=$2",[Math.max(0,recovery-1),stock.id]);
    await setPrice(stock.id,Math.max(floor+1,next));
    return;
  }

  const {rows}=await pool.query("SELECT direction,until_time,strength FROM market_controls WHERE stock_id=$1",[stock.id]);const control=rows[0]||null;
  const next=Math.max(1,current+biasedDirection(control)*randomChange(stock));

  if(hasFloor&&next<=floor){
    const newLockUntil=now+settings.lockMinutes*60000;
    await pool.query("UPDATE stocks SET previous=price,price=$1,high=GREATEST(high,$1),low=LEAST(low,$1),floor_lock_until=$2,floor_rise_remaining=2 WHERE id=$3",[floor,newLockUntil,stock.id]);
    await pool.query("INSERT INTO price_history(stock_id,time,price) VALUES($1,$2,$3)",[stock.id,now,floor]);
    return;
  }
  await setPrice(stock.id,next);
}
let marketTimer=null,updating=false;
async function updateMarket(){if(updating)return;updating=true;try{for(const s of await getStocks()){try{await updateStockMarket(s);}catch(e){console.error(`[MARKET] ${s.id}:`,e.message);}}}finally{updating=false;}}
function startMarketEngine(interval=5000){if(marketTimer)return;console.log(`📈 주가 엔진 시작 · ${interval/1000}초 간격`);updateMarket().catch(e=>console.error("[MARKET] 초기 업데이트:",e));marketTimer=setInterval(()=>updateMarket().catch(e=>console.error("[MARKET] 업데이트:",e)),interval);}
function stopMarketEngine(){if(!marketTimer)return;clearInterval(marketTimer);marketTimer=null;}
module.exports={pool,companies,getStocks,getStock,getHistory,getGlobalPriceFloor,getGlobalSettings,setPrice,updateMarket,startMarketEngine,stopMarketEngine};
