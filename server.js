const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT =
    process.env.PORT || 3000;


// ========================================
// 기본 설정
// ========================================

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);


// ========================================
// 정적 파일
// ========================================

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// ========================================
// 서비스
// ========================================

const {
    initializeDatabase
} = require("./services/database");

const {
    startMarketEngine
} = require("./services/market");


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

const notificationsRouter =
    require("./routes/notifications");


// ========================================
// API
// ========================================

app.use(
    "/api/notifications",
    notificationsRouter
);

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/stocks",
    stockRoutes
);

app.use(
    "/api/bank",
    bankRoutes
);

app.use(
    "/api/feedback",
    feedbackRoutes
);

app.use(
    "/api/notices",
    noticeRoutes
);

app.use(
    "/api/admin",
    adminRoutes
);


// ========================================
// 서버 상태
// ========================================

app.get(
    "/api/status",
    async (req, res) => {

        res.json({

            ok: true,

            name:
                "VSM Virtual Stock Market",

            time:
                Date.now()

        });

    }
);


// ========================================
// 관리자 VSM 우회 토큰 확인
// ========================================

function verifyAdminSiteToken(token) {

    try {

        if (!token) {
            return false;
        }

        const parts =
            String(token).split(".");

        if (
            parts.length !== 2
        ) {
            return false;
        }

        const timestamp =
            Number(parts[0]);

        const signature =
            parts[1];

        if (
            !Number.isFinite(timestamp) ||
            !signature
        ) {
            return false;
        }

        // 토큰 유효시간: 5분
        const age =
            Date.now() - timestamp;

        if (
            age < 0 ||
            age > 5 * 60 * 1000
        ) {
            return false;
        }

        const secret =
            process.env.ADMIN_PASSWORD ||
            "admin1234";

        const expected =
            crypto
                .createHmac(
                    "sha256",
                    secret
                )
                .update(
                    String(timestamp)
                )
                .digest("hex");

        if (
            signature.length !==
            expected.length
        ) {
            return false;
        }

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expected)
        );

    } catch (error) {

        console.error(
            "ADMIN SITE TOKEN ERROR:",
            error
        );

        return false;

    }

}


// ========================================
// 관리자 전용 VSM 사이트
// ========================================
//
// 점검 중에도 관리자만 실제 index.html 접근 가능
//
// 일반 유저:
// /
//     ↓
// 점검 화면
//
// 관리자:
// /admin/vsm?token=...
//     ↓
// 실제 VSM
//
// ========================================

app.get(
    "/admin/vsm",
    (req, res) => {

        const token =
            String(
                req.query.token || ""
            );

        if (
            !verifyAdminSiteToken(token)
        ) {

            return res.status(403).send(`
                <!DOCTYPE html>
                <html lang="ko">
                <head>
                    <meta charset="UTF-8">
                    <title>접근 거부</title>
                    <style>
                        body {
                            margin: 0;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            background: #f4f6f8;
                            font-family: Arial, sans-serif;
                        }

                        .box {
                            background: white;
                            padding: 40px;
                            border-radius: 16px;
                            text-align: center;
                            box-shadow:
                                0 10px 30px
                                rgba(0,0,0,.08);
                        }

                        h1 {
                            margin-top: 0;
                        }

                        p {
                            color: #666;
                        }
                    </style>
                </head>

                <body>

                    <div class="box">

                        <h1>접근할 수 없습니다.</h1>

                        <p>
                            관리자 인증이 필요하거나
                            관리자 접근 토큰이 만료되었습니다.
                        </p>

                    </div>

                </body>
                </html>
            `);

        }

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);


// ========================================
// 홈페이지
// ========================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);


// ========================================
// API 404
// ========================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            error:
                "존재하지 않는 API입니다."

        });

    }
);


// ========================================
// 홈페이지 fallback
// ========================================

app.use(
    (req, res) => {

        const indexPath =
            path.join(
                __dirname,
                "public",
                "index.html"
            );

        res.sendFile(
            indexPath,
            err => {

                if (err) {

                    res.status(404).send(
                        "VSM 홈페이지 파일을 찾을 수 없습니다."
                    );

                }

            }
        );

    }
);


// ========================================
// 서버 시작
// ========================================

async function startServer() {

    try {

        // PostgreSQL 초기화

        await initializeDatabase();


        // 주가 엔진 시작

        startMarketEngine();


        // 서버 시작

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log("");

                console.log(
                    "================================"
                );

                console.log(
                    " VSM Virtual Stock Market"
                );

                console.log(
                    "================================"
                );

                console.log(
                    "✅ 서버 시작"
                );

                console.log(
                    "✅ PostgreSQL 연결"
                );

                console.log(
                    "✅ 주가 자동 변동 엔진"
                );

                console.log(
                    "✅ 관리자 VSM 우회 경로"
                );

                console.log(
                    "포트:",
                    PORT
                );

                console.log(
                    "================================"
                );

                console.log("");

            }
        );

    } catch (error) {

        console.error("");

        console.error(
            "❌ 서버 시작 실패:",
            error
        );

        console.error("");

        process.exit(1);

    }

}


startServer();
