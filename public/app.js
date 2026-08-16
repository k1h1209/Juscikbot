let token = localStorage.token;
let mode = "login";
let market;
let selected;
let range = "1d";

const $ = (x) => document.querySelector(x);

const won = (n) => {
    return Math.round(n).toLocaleString() + "원";
};


// ========================================
// API 요청
// ========================================

async function api(url, options = {}) {

    options.headers = {
        ...(options.headers || {}),
        ...(token
            ? { Authorization: "Bearer " + token }
            : {})
    };

    if (options.body) {

        options.headers["Content-Type"] =
            "application/json";

        options.body =
            JSON.stringify(options.body);
    }

    const response =
        await fetch(url, options);

    const data =
        await response.json();

    if (!response.ok) {
        throw Error(data.error);
    }

    return data;
}


// ========================================
// 페이지 이동
// ========================================

function page(id) {

    [
        "market",
        "detail",
        "portfolio",
        "tx",
        "rank"
    ].forEach((x) => {

        $("#" + x).classList.toggle(
            "hide",
            x !== id
        );

    });

    if (id === "portfolio") {
        portfolio();
    }

    if (id === "tx") {
        transactions();
    }

    if (id === "rank") {
        rank();
    }
}


// ========================================
// 로그인 / 회원가입
// ========================================

function auth() {

    const button = $("#authbtn");

    button.onclick = async () => {

        try {

            const body = {

                username:
                    $("#user").value,

                password:
                    $("#pass").value
            };

            if (mode === "reg") {

                body.nickname =
                    $("#nick").value;
            }

            const data =
                await api(
                    mode === "reg"
                        ? "/api/register"
                        : "/api/login",
                    {
                        method: "POST",
                        body: body
                    }
                );

            token = data.token;

            localStorage.token =
                token;

            $("#auth").classList.add("hide");

            $("#app").classList.remove("hide");

            start();

        } catch (error) {

            alert(error.message);
        }
    };


    $("#toggle").onclick = () => {

        mode =
            mode === "login"
                ? "reg"
                : "login";

        $("#title").textContent =
            mode === "login"
                ? "로그인"
                : "회원가입";

        button.textContent =
            mode === "login"
                ? "로그인"
                : "회원가입";

        $("#toggle").textContent =
            mode === "login"
                ? "회원가입"
                : "로그인";

        $("#auth .box")
            .classList
            .toggle(
                "register",
                mode === "reg"
            );
    };
}


// ========================================
// 시장 시작
// ========================================

async function start() {

    market =
        await api("/api/market");

    render();


    // 5초마다 주가 갱신
    setInterval(async () => {

        market =
            await api("/api/market");

        render();

        // ❌ 여기서는 detail()을 자동으로 호출하지 않음

    }, 5000);
}


// ========================================
// 주식 목록 화면
// ========================================

function render() {

    let html = "";

    for (const company of market.companies) {

        const stock =
            market.stocks[company.id];

        const change =
            stock.price -
            stock.previous;

        const percent =
            change /
            stock.previous *
            100;

        html += `

            <div class="card">

                <div class="ticker">
                    ${company.id}
                </div>

                <h2>
                    ${company.name}
                </h2>

                <div class="price">
                    ${won(stock.price)}
                </div>

                <div class="${percent >= 0
                    ? "up"
                    : "down"}">

                    ${change >= 0 ? "+" : ""}
                    ${won(change)}

                    (${percent.toFixed(2)}%)

                </div>

                <p>
                    거래량
                    ${stock.volume.toLocaleString()}주
                </p>

                <button
                    onclick="detail('${company.id}')">

                    상세정보 →

                </button>

            </div>

        `;
    }

    $("#cards").innerHTML =
        html;
}


// ========================================
// 주식 상세정보
// ========================================

async function detail(id) {

    selected = id;

    page("detail");


    const company =
        market.companies.find(
            (x) => x.id === id
        );

    const stock =
        market.stocks[id];

    const portfolioData =
        await api("/api/portfolio");

    const holding =
        portfolioData.positions.find(
            (x) => x.id === id
        );

    const history =
        await api(
            "/api/history/" +
            id +
            "?range=" +
            range
        );


    $("#detail").innerHTML = `

        <button
            onclick="page('market')">

            ← 시장

        </button>

        <h1>
            ${company.name}
        </h1>

        <h2>
            ${won(stock.price)}
        </h2>


        <div class="chart">

            <canvas
                id="cv"
                width="1000"
                height="300">
            </canvas>

        </div>


        <p>

            시가 ${won(stock.open)}
            　
            고가 ${won(stock.high)}
            　
            저가 ${won(stock.low)}
            　
            거래량
            ${stock.volume.toLocaleString()}주

        </p>


        <div class="stats">

            <div class="stat">

                보유

                <b>
                    ${holding?.qty || 0}주
                </b>

            </div>


            <div class="stat">

                평균매수가

                <b>
                    ${won(holding?.avg || 0)}
                </b>

            </div>


            <div class="stat">

                평가손익

                <b class="${
                    (holding?.pnl || 0) >= 0
                        ? "up"
                        : "down"
                }">

                    ${won(holding?.pnl || 0)}

                </b>

            </div>


            <div class="stat">

                수익률

                <b>

                    ${
                        (holding?.pnlPct || 0)
                            .toFixed(2)
                    }%

                </b>

            </div>

        </div>


        <div class="trade">

            <input
                id="q"
                type="number"
                min="1"
                value="1"
            >

            <button
                class="buy"
                onclick="trade('buy')">

                매수

            </button>

            <button
                class="sell"
                onclick="trade('sell')">

                매도

            </button>

        </div>


        <p>

            차트:

            <button
                onclick="range='1d'; detail('${id}')">
                1일
            </button>

            <button
                onclick="range='1w'; detail('${id}')">
                1주
            </button>

            <button
                onclick="range='1m'; detail('${id}')">
                1개월
            </button>

            <button
                onclick="range='3m'; detail('${id}')">
                3개월
            </button>

            <button
                onclick="range='all'; detail('${id}')">
                전체
            </button>

        </p>

    `;


    // ====================================
    // 그래프
    // ====================================

    const canvas =
        $("#cv");

    const context =
        canvas.getContext("2d");

    const points =
        history.points;


    if (!points.length) {
        return;
    }


    const min =
        Math.min(
            ...points.map(
                (a) => a.p
            )
        );

    const max =
        Math.max(
            ...points.map(
                (a) => a.p
            )
        );

    const span =
        Math.max(
            1,
            max - min
        );


    context.strokeStyle =
        "#75aaff";

    context.lineWidth =
        3;

    context.beginPath();


    points.forEach((point, index) => {

        const X =
            20 +
            (
                960 * index /
                Math.max(
                    1,
                    points.length - 1
                )
            );

        const Y =
            275 -
            (
                (point.p - min) /
                span *
                250
            );


        if (index === 0) {

            context.moveTo(
                X,
                Y
            );

        } else {

            context.lineTo(
                X,
                Y
            );
        }

    });


    context.stroke();
}


// ========================================
// 매수 / 매도
// ========================================

async function trade(side) {

    try {

        await api(
            "/api/trade",
            {
                method: "POST",

                body: {

                    id: selected,

                    side: side,

                    qty:
                        +$("#q").value
                }
            }
        );


        market =
            await api("/api/market");

        detail(selected);

    } catch (error) {

        alert(error.message);
    }
}


// ========================================
// 내 자산
// ========================================

async function portfolio() {

    const data =
        await api("/api/portfolio");


    $("#sum").innerHTML = [

        ["현금", data.cash],

        ["주식평가액", data.stockValue],

        ["총자산", data.total],

        ["수익률", data.totalPnlPct]

    ].map((item) => `

        <div class="stat">

            ${item[0]}

            <b>

                ${
                    item[0] === "수익률"
                        ? item[1].toFixed(2) + "%"
                        : won(item[1])
                }

            </b>

        </div>

    `).join("");


    $("#pos").innerHTML =

        data.positions.length

            ? data.positions.map((item) => `

                <p>

                    <b>

                        ${
                            market.companies.find(
                                c =>
                                    c.id === item.id
                            ).name
                        }

                    </b>

                    　
                    ${item.qty}주

                    　
                    현재
                    ${won(item.price)}

                    　
                    손익

                    <span class="${
                        item.pnl >= 0
                            ? "up"
                            : "down"
                    }">

                        ${won(item.pnl)}

                    </span>

                </p>

            `).join("")

            : "보유 종목이 없습니다.";
}


// ========================================
// 거래내역
// ========================================

async function transactions() {

    const data =
        await api("/api/transactions");


    $("#txlist").innerHTML =

        data.transactions

            .map((item) => `

                <p>

                    ${
                        new Date(
                            item.time
                        ).toLocaleString()
                    }

                    ·

                    ${
                        market.companies.find(
                            c =>
                                c.id ===
                                item.companyId
                        ).name
                    }

                    ·

                    ${
                        item.side === "buy"
                            ? "매수"
                            : "매도"
                    }

                    ·

                    ${item.qty}주

                    ·

                    ${won(item.total)}

                </p>

            `)

            .join("")

        || "거래내역이 없습니다.";
}


// ========================================
// 랭킹
// ========================================

async function rank() {

    const data =
        await api("/api/rankings");


    $("#ranklist").innerHTML =

        data.rankings

            .map(
                (item, index) => `

                    <p>

                        <b>

                            ${index + 1}위
                            ${item.nickname}

                        </b>

                        　

                        ${won(item.total)}

                    </p>

                `
            )

            .join("");
}


// ========================================
// 로그아웃
// ========================================

async function logout() {

    await api(
        "/api/logout",
        {
            method: "POST"
        }
    ).catch(() => {});


    localStorage.removeItem(
        "token"
    );

    location.reload();
}


// ========================================
// 시작
// ========================================

auth();


if (token) {

    api("/api/me")

        .then(() => {

            $("#auth")
                .classList
                .add("hide");

            $("#app")
                .classList
                .remove("hide");

            start();

        })

        .catch(() => {

            localStorage.removeItem(
                "token"
            );

        });
}


// ========================================
// VSM UI 1.2
// 기존 기능은 유지하고 화면 스타일만 개선
// ========================================

(function setupVsmUi() {

    const savedTheme =
        localStorage.getItem("vsm-theme");

    const systemDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;

    const theme =
        savedTheme ||
        (systemDark ? "dark" : "light");

    document.documentElement.dataset.theme = theme;

    const style = document.createElement("style");

    style.id = "vsm-ui-12-style";

    style.textContent = `
        :root {
            --vsm-bg: #f5f7fb;
            --vsm-surface: #ffffff;
            --vsm-surface-2: #f8fafc;
            --vsm-border: #e4e8ef;
            --vsm-text: #172033;
            --vsm-muted: #6b7280;
            --vsm-accent: #2563eb;
            --vsm-accent-soft: #eaf1ff;
            --vsm-green: #16a34a;
            --vsm-green-soft: #eaf8ef;
            --vsm-red: #dc2626;
            --vsm-red-soft: #fff0f0;
            --vsm-shadow: 0 12px 35px rgba(15,23,42,.07);
        }

        html[data-theme="dark"] {
            --vsm-bg: #0b1020;
            --vsm-surface: #121a2b;
            --vsm-surface-2: #182236;
            --vsm-border: #26324a;
            --vsm-text: #edf2ff;
            --vsm-muted: #9aa8c2;
            --vsm-accent: #79a8ff;
            --vsm-accent-soft: #172b50;
            --vsm-green: #4ade80;
            --vsm-green-soft: #123524;
            --vsm-red: #fb7185;
            --vsm-red-soft: #3a1820;
            --vsm-shadow: 0 18px 45px rgba(0,0,0,.28);
        }

        html, body {
            background: var(--vsm-bg) !important;
            color: var(--vsm-text) !important;
        }

        body {
            min-height: 100vh;
            transition: background .25s ease, color .25s ease;
        }

        .topbar {
            background: color-mix(in srgb, var(--vsm-surface) 90%, transparent) !important;
            border-bottom-color: var(--vsm-border) !important;
            box-shadow: 0 5px 25px rgba(0,0,0,.04);
        }

        .money, .menu-panel, .notification-panel,
        .card, #authBox, #profileBox {
            background: var(--vsm-surface) !important;
            border-color: var(--vsm-border) !important;
            color: var(--vsm-text) !important;
            box-shadow: var(--vsm-shadow) !important;
        }

        .money {
            color: var(--vsm-text) !important;
            background: var(--vsm-surface-2) !important;
        }

        .card {
            position: relative;
            overflow: hidden;
            padding: 24px !important;
            border-radius: 20px !important;
            transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        }

        .card:hover {
            transform: translateY(-3px);
            border-color: color-mix(in srgb, var(--vsm-accent) 35%, var(--vsm-border)) !important;
        }

        .ticker {
            display: inline-flex;
            align-items: center;
            min-height: 26px;
            padding: 4px 9px;
            border-radius: 999px;
            background: var(--vsm-accent-soft);
            color: var(--vsm-accent);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .04em;
        }

        .card h2 {
            margin-top: 12px !important;
            margin-bottom: 8px !important;
            color: var(--vsm-text) !important;
        }

        .price {
            font-size: clamp(25px, 3vw, 34px) !important;
            letter-spacing: -.03em;
            color: var(--vsm-text) !important;
        }

        .up {
            color: var(--vsm-green) !important;
        }

        .down {
            color: var(--vsm-red) !important;
        }

        .card p, .welcome p, .notification-count,
        .notification-time, .detail p, .menu-title {
            color: var(--vsm-muted) !important;
        }

        button {
            border: 1px solid var(--vsm-border);
            border-radius: 11px;
            background: var(--vsm-surface-2);
            color: var(--vsm-text);
            font-weight: 700;
            cursor: pointer;
            transition: transform .15s ease, background .15s ease, border-color .15s ease;
        }

        button:hover {
            transform: translateY(-1px);
            border-color: color-mix(in srgb, var(--vsm-accent) 35%, var(--vsm-border));
            background: var(--vsm-accent-soft);
        }

        .menu-item:hover, .icon-button:hover, .menu-button:hover {
            background: var(--vsm-surface-2) !important;
        }

        .notification-header {
            background: var(--vsm-surface) !important;
            border-bottom-color: var(--vsm-border) !important;
        }

        .notification-item {
            border-bottom-color: var(--vsm-border) !important;
        }

        .notification-message, .notification-title,
        .logo, .welcome h1, .card h2,
        #authTitle, #profileBox, #authBox {
            color: var(--vsm-text) !important;
        }

        .notification-icon {
            background: var(--vsm-surface-2) !important;
        }

        .notification-confirm,
        .auth-submit {
            background: var(--vsm-accent) !important;
            color: #fff !important;
            border-color: transparent !important;
        }

        .auth-input, input, select, textarea {
            background: var(--vsm-surface-2) !important;
            color: var(--vsm-text) !important;
            border-color: var(--vsm-border) !important;
            outline: none;
        }

        input:focus, select:focus, textarea:focus {
            border-color: var(--vsm-accent) !important;
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--vsm-accent) 18%, transparent);
        }

        .buy {
            background: var(--vsm-green-soft) !important;
            color: var(--vsm-green) !important;
            border-color: color-mix(in srgb, var(--vsm-green) 25%, var(--vsm-border)) !important;
        }

        .sell {
            background: var(--vsm-red-soft) !important;
            color: var(--vsm-red) !important;
            border-color: color-mix(in srgb, var(--vsm-red) 25%, var(--vsm-border)) !important;
        }

        .stats {
            gap: 12px !important;
        }

        .stat {
            background: var(--vsm-surface-2) !important;
            border: 1px solid var(--vsm-border) !important;
            color: var(--vsm-muted) !important;
            border-radius: 14px !important;
        }

        .stat b {
            color: var(--vsm-text) !important;
        }

        .chart {
            background: var(--vsm-surface-2) !important;
            border: 1px solid var(--vsm-border) !important;
            border-radius: 18px !important;
            overflow: hidden;
        }

        #vsmThemeToggle {
            position: fixed;
            right: 18px;
            bottom: 46px;
            z-index: 8000;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            border: 1px solid var(--vsm-border);
            background: var(--vsm-surface);
            color: var(--vsm-text);
            box-shadow: var(--vsm-shadow);
            font-size: 18px;
            display: grid;
            place-items: center;
        }

        #vsmVersion {
            position: fixed;
            right: 18px;
            bottom: 12px;
            z-index: 7999;
            color: var(--vsm-muted);
            font-size: 10px;
            font-weight: 600;
            letter-spacing: .04em;
            opacity: .72;
            pointer-events: none;
        }

        @media (max-width: 760px) {
            .content {
                width: min(100% - 20px, 1200px) !important;
                padding-top: 24px !important;
            }

            .grid {
                grid-template-columns: 1fr !important;
            }

            .welcome h1 {
                font-size: 25px !important;
            }

            .topbar {
                padding: 0 10px !important;
            }

            .logo {
                font-size: 17px !important;
            }

            #vsmThemeToggle {
                right: 12px;
                bottom: 42px;
            }

            #vsmVersion {
                right: 12px;
                bottom: 10px;
            }
        }
    `;

    document.head.appendChild(style);

    const themeButton = document.createElement("button");
    themeButton.id = "vsmThemeToggle";
    themeButton.type = "button";
    themeButton.setAttribute("aria-label", "테마 변경");
    document.body.appendChild(themeButton);

    const version = document.createElement("div");
    version.id = "vsmVersion";
    version.textContent = "v.1.2";
    document.body.appendChild(version);

    function applyTheme(next) {
        document.documentElement.dataset.theme = next;
        localStorage.setItem("vsm-theme", next);
        themeButton.textContent = next === "dark" ? "☀️" : "🌙";
        themeButton.title = next === "dark" ? "라이트 모드" : "다크 모드";
    }

    themeButton.addEventListener("click", () => {
        applyTheme(
            document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark"
        );
    });

    applyTheme(theme);
})();
