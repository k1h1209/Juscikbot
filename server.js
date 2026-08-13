const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

// 정적 파일
app.use(express.static(path.join(__dirname, "public")));

// 기능별 라우터
const authRoutes = require("./routes/auth");
const stockRoutes = require("./routes/stocks");
const bankRoutes = require("./routes/bank");
const feedbackRoutes = require("./routes/feedback");
const noticeRoutes = require("./routes/notices");
const adminRoutes = require("./routes/admin");

// API 연결
app.use("/api/auth", authRoutes);
app.use("/api/stocks", stockRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/notices", noticeRoutes);
app.use("/api/admin", adminRoutes);

// 홈페이지
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

// 서버 시작
app.listen(PORT, "0.0.0.0", () => {
    console.log("================================");
    console.log(" VSM Virtual Stock Market");
    console.log("================================");
    console.log("서버 시작");
    console.log("포트:", PORT);
    console.log("================================");
});
