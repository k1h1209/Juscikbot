const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "data.json");

// ========================================
// 기본 설정
// ========================================

const STARTING_CASH = 100000;

const companies = [
    ["SKNX", "스카닉스하이닉스", 4250, 0.08],
    ["SAMS", "샘숭전자", 7100, 0.05],
    ["TWAI", "티Wai", 1850, 0.10],
    ["NVR", "나이버", 3500, 0.07],
    ["NFLX", "니플릭스", 5200, 0.09],
    ["PASC", "파스코", 2800, 0.06],
    ["LG", "알쥐", 6400, 0.05],
    ["HYUN", "현재자동차", 8300, 0.06],
    ["NVDO", "N비디오", 9700, 0.12],
    ["MHD", "마이크로하드", 7600, 0.07]
];


// ========================================
// 데이터베이스 생성
// ========================================

function createDatabase() {

    const stocks = {};
    const history = {};

    for (const company of companies) {

        const id = company[0];
        const price = company[2];

        stocks[id] = {

            price: price,

            previous: price,

            open: price,

            high: price,

            low: price,

            volume: 0

        };

        history[id] = [

            {
                t: Date.now(),
                p: price
            }

        ];
    }

    return {

        users: {},

        sessions: {},

        stocks: stocks,

        history: history

    };
}


// ========================================
// 데이터 불러오기
// ========================================

let db;

if (fs.existsSync(DATA_FILE)) {

    try {

        db = JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            )
        );

        console.log("데이터베이스 불러오기 완료.");

    } catch (error) {

        console.log(
            "data.json이 손상되어 새로 생성합니다."
        );

        db = createDatabase();
    }

} else {

    db = createDatabase();

}


// ========================================
// 저장
// ========================================

function saveDatabase() {

    fs.writeFileSync(

        DATA_FILE,

        JSON.stringify(
            db,
            null,
            2
        ),

        "utf8"

    );
}


// ========================================
// 비밀번호 암호화
// ========================================

function hashPassword(
    password,
    salt
) {

    return crypto
        .scryptSync(
            password,
            salt,
            64
        )
        .toString("hex");

}


// ========================================
// 토큰
// ========================================

function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");

}


// ========================================
// Express 설정
// ========================================

app.use(
    express.json()
);

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// ========================================
// 인증
// ========================================

function auth(
    req,
    res,
    next
) {

    const header =
        req.headers.authorization || "";

    const token =
        header.replace(
            "Bearer ",
            ""
        );

    const userId =
        db.sessions[token];

    if (
        !userId ||
        !db.users[userId]
    ) {

        return res
            .status(401)
            .json({

                error:
                    "로그인이 필요합니다."

            });

    }

    req.user =
        db.users[userId];

    req.token =
        token;

    next();
}


// ========================================
// 개인정보 제거
// ========================================

function safeUser(user) {

    return {

        id: user.id,

        username:
            user.username,

        nickname:
            user.nickname,

        cash:
            user.cash,

        holdings:
            user.holdings

    };
}


// ========================================
// 시장 정보
// ========================================

app.get(
    "/api/market",
    (req, res) => {

        res.json({

            companies:
                companies.map(
                    company => ({

                        id:
                            company[0],

                        name:
                            company[1],

                        price:
                            company[2],

                        volatility:
                            company[3]

                    })
                ),

            stocks:
                db.stocks,

            serverTime:
                Date.now()

        });

    }
);


// ========================================
// 회원가입
// ========================================

app.post(
    "/api/register",
    (req, res) => {

        const {
            username,
            password,
            nickname
        } = req.body;

        if (
            !username ||
            !password ||
            !nickname
        ) {

            return res
                .status(400)
                .json({

                    error:
                        "아이디, 비밀번호, 닉네임을 모두 입력하세요."

                });

        }

        if (
            username.length < 3
        ) {

            return res
                .status(400)
                .json({

                    error:
                        "아이디는 3자 이상이어야 합니다."

                });

        }

        if (
            password.length < 4
        ) {

            return res
                .status(400)
                .json({

                    error:
                        "비밀번호는 4자 이상이어야 합니다."

                });

        }


        const users =
            Object.values(
                db.users
            );


        if (
            users.some(
                user =>
                    user.username
                        .toLowerCase()
                    ===
                    username
                        .toLowerCase()
            )
        ) {

            return res
                .status(409)
                .json({

                    error:
                        "이미 사용 중인 아이디입니다."

                });

        }


        if (
            users.some(
                user =>
                    user.nickname
                    ===
                    nickname
            )
        ) {

            return res
                .status(409)
                .json({

                    error:
                        "이미 사용 중인 닉네임입니다."

                });

        }


        const id =
            crypto.randomUUID();


        const salt =
            crypto
                .randomBytes(16)
                .toString("hex");


        db.users[id] = {

            id: id,

            username:
                username,

            nickname:
                nickname,

            salt:
                salt,

            passwordHash:
                hashPassword(
                    password,
                    salt
                ),

            cash:
                STARTING_CASH,

            holdings: {},

            transactions: []

        };


        const token =
            createToken();


        db.sessions[token] =
            id;


        saveDatabase();


        res.json({

            token:
                token,

            user:
                safeUser(
                    db.users[id]
                )

        });

    }
);


// ========================================
// 로그인
// ========================================

app.post(
    "/api/login",
    (req, res) => {

        const {
            username,
            password
        } = req.body;


        const user =
            Object.values(
                db.users
            ).find(
                u =>
                    u.username
                        .toLowerCase()
                    ===
                    String(
                        username
                    ).toLowerCase()
            );


        if (!user) {

            return res
                .status(401)
                .json({

                    error:
                        "아이디 또는 비밀번호가 올바르지 않습니다."

                });

        }


        const passwordHash =
            hashPassword(
                password,
                user.salt
            );


        if (
            passwordHash
            !==
            user.passwordHash
        ) {

            return res
                .status(401)
                .json({

                    error:
                        "아이디 또는 비밀번호가 올바르지 않습니다."

                });

        }


        const token =
            createToken();


        db.sessions[token] =
            user.id;


        saveDatabase();


        res.json({

            token:
                token,

            user:
                safeUser(user)

        });

    }
);


// ========================================
// 내 정보
// ========================================

app.get(
    "/api/me",
    auth,
    (req, res) => {

        res.json({

            user:
                safeUser(
                    req.user
                )

        });

    }
);


// ========================================
// 로그아웃
// ========================================

app.post(
    "/api/logout",
    auth,
    (req, res) => {

        delete db.sessions[
            req.token
        ];

        saveDatabase();

        res.json({

            ok: true

        });

    }
);


// ========================================
// 그래프 데이터
// ========================================

app.get(
    "/api/history/:id",
    (req, res) => {

        const id =
            req.params.id;


        if (
            !db.history[id]
        ) {

            return res
                .status(404)
                .json({

                    error:
                        "종목을 찾을 수 없습니다."

                });

        }


        const ranges = {

            "1d":
                86400000,

            "1w":
                604800000,

            "1m":
                2592000000,

            "3m":
                7776000000,

            "all":
                Infinity

        };


        const range =
            ranges[
                req.query.range
                || "1d"
            ];


        const points =
            db.history[id]
                .filter(
                    point =>
                        point.t
                        >=
                        Date.now()
                        -
                        range
                )
                .slice(-1000);


        res.json({

            points:
                points

        });

    }
);


// ========================================
// 매수 / 매도
// ========================================

app.post(
    "/api/trade",
    auth,
    (req, res) => {

        const {
            id,
            side,
            qty
        } = req.body;


        const stock =
            db.stocks[id];


        const amount =
            Number(qty);


        if (!stock) {

            return res
                .status(400)
                .json({

                    error:
                        "존재하지 않는 종목입니다."

                });

        }


        if (
            side !== "buy"
            &&
            side !== "sell"
        ) {

            return res
                .status(400)
                .json({

                    error:
                        "잘못된 거래입니다."

                });

        }


        if (
            !Number.isInteger(amount)
            ||
            amount <= 0
        ) {

            return res
                .status(400)
                .json({

                    error:
                        "수량을 확인하세요."

                });

        }


        const user =
            req.user;


        const holding =
            user.holdings[id]
            ||
            {

                qty: 0,

                avg: 0

            };


        const total =
            stock.price
            *
            amount;


        // ============================
        // 매수
        // ============================

        if (
            side === "buy"
        ) {

            if (
                user.cash < total
            ) {

                return res
                    .status(400)
                    .json({

                        error:
                            "현금이 부족합니다."

                    });

            }


            const newQty =
                holding.qty
                +
                amount;


            holding.avg =
                (
                    holding.qty
                    *
                    holding.avg
                    +
                    total
                )
                /
                newQty;


            holding.qty =
                newQty;


            user.cash -=
                total;

        }


        // ============================
        // 매도
        // ============================

        if (
            side === "sell"
        ) {

            if (
                holding.qty
                <
                amount
            ) {

                return res
                    .status(400)
                    .json({

                        error:
                            "보유 주식이 부족합니다."

                    });

            }


            holding.qty -=
                amount;


            user.cash +=
                total;


            if (
                holding.qty === 0
            ) {

                holding.avg =
                    0;

            }

        }


        user.holdings[id] =
            holding;


        stock.volume +=
            amount;


        user.transactions.unshift({

            companyId:
                id,

            side:
                side,

            qty:
                amount,

            price:
                stock.price,

            total:
                total,

            time:
                Date.now()

        });


        saveDatabase();


        res.json({

            ok: true,

            user:
                safeUser(user)

        });

    }
);


// ========================================
// 내 포트폴리오
// ========================================

app.get(
    "/api/portfolio",
    auth,
    (req, res) => {

        const user =
            req.user;


        let stockValue =
            0;


        const positions =
            [];


        for (
            const [
                id,
                holding
            ]
            of Object.entries(
                user.holdings
            )
        ) {

            const stock =
                db.stocks[id];


            if (
                !stock
                ||
                holding.qty <= 0
            ) {

                continue;

            }


            const value =
                holding.qty
                *
                stock.price;


            const pnl =
                value
                -
                holding.qty
                *
                holding.avg;


            stockValue +=
                value;


            positions.push({

                id:
                    id,

                qty:
                    holding.qty,

                avg:
                    holding.avg,

                price:
                    stock.price,

                value:
                    value,

                pnl:
                    pnl,

                pnlPct:
                    holding.avg === 0
                        ? 0
                        :
                        (
                            (
                                stock.price
                                -
                                holding.avg
                            )
                            /
                            holding.avg
                        )
                        *
                        100

            });

        }


        const total =
            user.cash
            +
            stockValue;


        res.json({

            cash:
                user.cash,

            stockValue:
                stockValue,

            total:
                total,

            totalPnl:
                total
                -
                STARTING_CASH,

            totalPnlPct:
                (
                    total
                    /
                    STARTING_CASH
                    -
                    1
                )
                *
                100,

            positions:
                positions

        });

    }
);


// ========================================
// 거래내역
// ========================================

app.get(
    "/api/transactions",
    auth,
    (req, res) => {

        res.json({

            transactions:
                req.user.transactions
                    .slice(0, 100)

        });

    }
);


// ========================================
// 자산 랭킹
// ========================================

app.get(
    "/api/rankings",
    (req, res) => {

        const rankings =
            Object.values(
                db.users
            )
            .map(
                user => {

                    let stockValue =
                        0;


                    for (
                        const [
                            id,
                            holding
                        ]
                        of Object.entries(
                            user.holdings
                        )
                    ) {

                        const stock =
                            db.stocks[id];


                        if (
                            stock
                        ) {

                            stockValue +=
                                stock.price
                                *
                                holding.qty;

                        }

                    }


                    return {

                        nickname:
                            user.nickname,

                        total:
                            user.cash
                            +
                            stockValue

                    };

                }
            )
            .sort(
                (a, b) =>
                    b.total
                    -
                    a.total
            );


        res.json({

            rankings:
                rankings

        });

    }
);


// ========================================
// 주가 변동
// ========================================

setInterval(
    () => {

        for (
            const company
            of companies
        ) {

            const id =
                company[0];


            const stock =
                db.stocks[id];


            // 약 ±5% 변동
            const random =
                Math.random()
                -
                0.5;


            const changePercent =
                random
                *
                0.10;


            let nextPrice =
                stock.price
                *
                (
                    1
                    +
                    changePercent
                );


            // 100원 단위
            nextPrice =
                Math.round(
                    nextPrice
                    /
                    100
                )
                *
                100;


            // 최저가
            if (
                nextPrice < 1000
            ) {

                nextPrice =
                    1000;

            }


            // 최고가
            if (
                nextPrice > 1000000
            ) {

                nextPrice =
                    1000000;

            }


            // 이전 가격
            stock.previous =
                stock.price;


            // 현재 가격
            stock.price =
                nextPrice;


            // 최고가
            if (
                nextPrice
                >
                stock.high
            ) {

                stock.high =
                    nextPrice;

            }


            // 최저가
            if (
                nextPrice
                <
                stock.low
            ) {

                stock.low =
                    nextPrice;

            }


            // 그래프 기록
            db.history[id].push({

                t:
                    Date.now(),

                p:
                    nextPrice

            });


            // 너무 많은 기록 삭제
            if (
                db.history[id].length
                >
                10000
            ) {

                db.history[id] =
                    db.history[id]
                        .slice(-10000);

            }

        }


        saveDatabase();


    },
    5000
);


// ========================================
// 홈페이지
// ========================================

app.use(
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
// 서버 시작
// ========================================

app.listen(PORT, "0.0.0.0", () => {

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            " VSM Virtual Stock Market V2"
        );
        console.log(
            "================================"
        );
        console.log(
            "시작금: 10,000원"
        );
        console.log(
            "주가 변동: 약 ±5%"
        );
        console.log(
            "서버 주소: http://localhost:" +
            PORT
        );
        console.log(
            "================================"
        );
        console.log("");

    }
);
