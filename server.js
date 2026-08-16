const express=require("express");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const app=express();
const PORT=Number(process.env.PORT||3000);
const publicDir=path.join(__dirname,"public");

app.disable("x-powered-by");
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));

const {initializeDatabase}=require("./services/database");
const {startMarketEngine}=require("./services/market");
const authRoutes=require("./routes/auth");
const stockRoutes=require("./routes/stocks");
const bankRoutes=require("./routes/bank");
const feedbackRoutes=require("./routes/feedback");
const noticeRoutes=require("./routes/notices");
const adminRoutes=require("./routes/admin");
const adminGlobalRoutes=require("./routes/admin-global");
const adminSharesRoutes=require("./routes/admin-shares");
const notificationsRoutes=require("./routes/notifications");
const changesRoutes=require("./routes/changes");
const {pool}=require("./services/market");

app.use("/api/auth",authRoutes);
app.use("/api/stocks",stockRoutes);
app.use("/api/bank",bankRoutes);
app.use("/api/feedback",feedbackRoutes);
app.use("/api/notices",noticeRoutes);
app.use("/api/admin",adminRoutes);
app.use("/api/admin",adminGlobalRoutes);
app.use("/api/admin-shares",adminSharesRoutes);
app.use("/api/notifications",notificationsRoutes);
app.use("/api/changes",changesRoutes);

app.get("/api/status",(req,res)=>res.json({ok:true,name:"VSM Virtual Stock Market",time:Date.now()}));

// 공개 점검 상태. 관리자 인증 없이 플레이어 화면에서 확인합니다.
app.get("/api/maintenance/status",async(req,res)=>{
  try{
    const {rows}=await pool.query("SELECT enabled,start_time,end_time,updated_at FROM maintenance WHERE id=1 LIMIT 1");
    const m=rows[0]||{};
    const enabled=Boolean(m.enabled)&&(!m.end_time||Number(m.end_time)>Date.now());
    res.json({ok:true,enabled,startTime:m.start_time?Number(m.start_time):null,endTime:m.end_time?Number(m.end_time):null,updatedAt:m.updated_at?Number(m.updated_at):0});
  }catch(error){
    console.error("MAINTENANCE STATUS ERROR:",error);
    res.status(500).json({ok:false,error:"점검 상태를 확인할 수 없습니다."});
  }
});

function verifyAdminSiteToken(token){
  try{
    const [t,s]=String(token||"").split(".");
    const timestamp=Number(t);
    if(!Number.isFinite(timestamp)||!s)return false;
    const age=Date.now()-timestamp;
    if(age<0||age>300000)return false;
    const secret=process.env.ADMIN_PASSWORD||"admin1234";
    const expected=crypto.createHmac("sha256",secret).update(String(timestamp)).digest("hex");
    return s.length===expected.length&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected));
  }catch{return false;}
}

function renderAdmin(){
  const file=fs.readFileSync(path.join(publicDir,"admin.html"),"utf8");
  return file.replace("</body>",'<script src="/admin-global-floor.js"></script><script src="/admin-enhancements.js"></script></body>');
}

function renderPlayerPage(){
  const file=fs.readFileSync(path.join(publicDir,"index.html"),"utf8");
  return file.replace("</body>",'<script src="/maintenance.js"></script></body>');
}

app.get("/admin",(req,res)=>{
  try{res.type("html").send(renderAdmin());}
  catch(error){console.error("ADMIN PAGE ERROR:",error);res.status(500).send("관리자 페이지를 불러오지 못했습니다.");}
});

app.get("/admin/vsm",(req,res)=>{
  if(!verifyAdminSiteToken(req.query.token))return res.status(403).send("관리자 인증 토큰이 없거나 만료되었습니다.");
  try{res.type("html").send(renderPlayerPage());}
  catch(error){console.error("ADMIN VSM PAGE ERROR:",error);res.status(500).send("VSM 화면을 불러오지 못했습니다.");}
});

app.get("/",(req,res)=>{
  try{res.type("html").send(renderPlayerPage());}
  catch(error){console.error("PLAYER PAGE ERROR:",error);res.status(500).send("VSM 화면을 불러오지 못했습니다.");}
});

// 정적 리소스는 HTML 라우트보다 뒤에서 처리합니다.
app.use(express.static(publicDir));

app.use("/api",(req,res)=>res.status(404).json({ok:false,error:"존재하지 않는 API입니다."}));
app.use((err,req,res,next)=>{console.error("UNHANDLED ERROR:",err);if(res.headersSent)return next(err);res.status(500).json({ok:false,error:"서버 내부 오류가 발생했습니다."});});

async function startServer(){
  try{
    await initializeDatabase();
    startMarketEngine(5000);
    app.listen(PORT,"0.0.0.0",()=>{
      console.log("================================");
      console.log(" VSM Virtual Stock Market");
      console.log("================================");
      console.log(`✅ 서버 시작: ${PORT}`);
      console.log("✅ PostgreSQL 연결");
      console.log("✅ 주가 자동 변동: 5초");
      console.log("✅ 최소/최대 변동금액 방식");
      console.log("✅ 종목별 공유 거래량 제한");
      console.log("================================");
    });
  }catch(e){console.error("❌ 서버 시작 실패:",e);process.exit(1);}
}
startServer();
