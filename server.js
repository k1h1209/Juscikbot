
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// 기본 설정
// ========================================

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// 정적 파일
app.use(express.static(path.join(__dirname, "public")));

// ========================================
// 서비스
// ========================================

const { initializeDatabase } =
    require("./services/database");

// ========================================
// 라우터
// ========================================

const authRoutes =
    require("./routes/auth");

const stockRoutes =
    require("./routes/stocks");

const bankRoutes =
    require("./routes/bank");

const feedbackRoutes =
    require("./routes/feedback");

const noticeRoutes =
    require("./routes/notices");

const adminRoutes =
    require("./routes/admin");

// ========================================
// API 연결
// ========================================

app.use("/api/auth", authRoutes);
app.use("/api/stocks", stockRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/notices", noticeRoutes);
app.use("/api/admin", adminRoutes);

// ========================================
// 서버 상태 확인
// ========================================

app.get("/api/status", async (req, res) => {
    res.json({
        ok: true,
        name: "VSM Virtual Stock Market",
        time: Date.now()
    });
});

// ========================================
// 홈페이지
// ========================================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

// ========================================
// 404 API 처리
// ========================================

app.use("/api", (req, res) => {
    res.status(404).json({
        error: "존재하지 않는 API입니다."
    });
});

// ========================================
// 홈페이지 없는 경우
// ========================================

app.use((req, res) => {
    const indexPath =
        path.join(__dirname, "public", "index.html");

    res.sendFile(indexPath, err => {
        if (err) {
            res.status(404).send(
                "VSM 홈페이지 파일을 찾을 수 없습니다."
            );
        }
    });
});

// ========================================
// 서버 시작
// ========================================

async function startServer() {
    try {

        // PostgreSQL 테이블 생성
        await initializeDatabase();

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log("");
                console.log("================================");
                console.log(" VSM Virtual Stock Market");
                console.log("================================");
                console.log("✅ 서버 시작");
                console.log("✅ PostgreSQL 연결");
                console.log("포트:", PORT);
                console.log("================================");
                console.log("");
            }
        );

    } catch (error) {

        console.error(
            "❌ 서버 시작 실패:",
            error
        );

        process.exit(1);
    }
}

startServer();

