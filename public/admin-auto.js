(() => {
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const money = x => Number(x || 0).toLocaleString() + "원";

  function injectStyle() {
    if ($("vsmAdminModernStyle")) return;
    const s = document.createElement("style");
    s.id = "vsmAdminModernStyle";
    s.textContent = `
      :root{
        --accent:#6d5dfc;--accent2:#3b82f6;--glass:rgba(15,23,42,.72);
        --line:#26324a;--green:#35d39b;--red:#ff647d;--yellow:#f5c95b
      }
      body{background:
        radial-gradient(circle at 15% 0%,rgba(109,93,252,.18),transparent 28%),
        radial-gradient(circle at 90% 10%,rgba(59,130,246,.13),transparent 25%),
        #050811!important}
      .side{background:rgba(4,8,17,.82)!important;border-right:1px solid rgba(120,140,180,.14)!important}
      .side-brand{padding-bottom:30px!important}
      .side-brand .mark,.login .mark{background:linear-gradient(135deg,#6d5dfc,#3b82f6)!important}
      .nav button{transition:.18s ease!important}
      .nav button.active{background:linear-gradient(100deg,rgba(109,93,252,.22),rgba(59,130,246,.08))!important;border-color:rgba(109,93,252,.35)!important;box-shadow:inset 3px 0 0 #6d5dfc,0 8px 24px rgba(0,0,0,.12)!important}
      .top{height:82px!important;background:rgba(5,8,17,.78)!important;border-bottom-color:rgba(120,140,180,.13)!important}
      .top-title b{font-size:19px!important}
      .top-title span{font-size:10px!important}
      .body{padding-top:26px!important}
      .head h2{font-size:31px!important}
      .card,.stat{background:linear-gradient(145deg,rgba(16,25,43,.92),rgba(8,14,25,.96))!important;border-color:rgba(100,120,160,.17)!important;box-shadow:0 18px 55px rgba(0,0,0,.22)!important;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
      .card:hover,.stat:hover{border-color:rgba(109,93,252,.3)!important;box-shadow:0 22px 65px rgba(0,0,0,.3)!important}
      .stat strong{font-size:30px!important}
      .btn{transition:.16s ease!important}
      .btn:hover{transform:translateY(-1px)!important}
      .btn.primary{background:linear-gradient(135deg,#6d5dfc,#3b82f6)!important}
      .table-wrap{border-color:rgba(100,120,160,.16)!important}
      .table th{background:#080f1c!important}
      .table td{border-bottom-color:rgba(100,120,160,.12)!important}
      .table tr:hover td{background:rgba(109,93,252,.055)!important}
      .stock{background:linear-gradient(145deg,#0c1627,#08101c)!important;border-color:rgba(100,120,160,.15)!important}
      .stock:hover{transform:translateY(-2px);border-color:rgba(109,93,252,.3)!important}
      .market-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .live-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid rgba(53,211,155,.2);background:rgba(53,211,155,.07);border-radius:999px;color:#8de8c7;font-size:10px;font-weight:900}
      .live-dot{width:7px;height:7px;border-radius:50%;background:#35d39b;box-shadow:0 0 0 4px rgba(53,211,155,.1);animation:vsmPulse 1.8s infinite}
      @keyframes vsmPulse{50%{opacity:.4;transform:scale(.75)}}
      #vsmRefreshDock{position:fixed;right:22px;bottom:22px;z-index:60;display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(100,120,160,.2);background:rgba(8,14,25,.88);backdrop-filter:blur(18px);border-radius:15px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
      #vsmRefreshDock button{border:0;border-radius:10px;background:linear-gradient(135deg,#6d5dfc,#3b82f6);color:white;font-weight:900;padding:9px 12px;cursor:pointer}
      #vsmRefreshState{font-size:9px;color:#8290a8;padding:0 4px;white-space:nowrap}
      #vsmLastRefresh{color:#aeb9cb}
      .vsm-section-kicker{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#65738b;font-weight:900;margin-bottom:5px}
      .vsm-hero{display:grid;grid-template-columns:1.5fr .8fr;gap:14px;margin-bottom:14px}
      .vsm-hero-box{border:1px solid rgba(100,120,160,.16);border-radius:20px;padding:20px;background:linear-gradient(135deg,rgba(109,93,252,.13),rgba(59,130,246,.05) 50%,rgba(8,14,25,.92));box-shadow:0 18px 60px rgba(0,0,0,.22)}
      .vsm-hero-box h2{margin:0;font-size:28px}.vsm-hero-box p{margin:7px 0 0;color:#8c99ae;font-size:11px;line-height:1.6}
      .vsm-mini{border:1px solid rgba(100,120,160,.16);border-radius:20px;padding:18px;background:rgba(8,14,25,.86)}
      .vsm-mini strong{display:block;font-size:24px;margin-top:7px}
      .market-controls{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
      .market-controls select,.market-controls input{border:1px solid #263653;background:#08111f;color:#eef3ff;border-radius:9px;padding:7px 8px;font-size:10px}
      .trend-up{color:#65e2b2}.trend-down{color:#ff8499}.trend-normal{color:#9eabc0}
      #stockRows td:last-child{min-width:280px}
      @media(max-width:900px){.vsm-hero{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  function hideGlobalFloorUI() {
    [$("globalFloor"), $("floorLockMinutes")].forEach(input => {
      const field = input?.closest(".field");
      if (field) field.style.display = "none";
    });
    const cards = document.querySelectorAll("#settings .grid.g2 > .card");
    if (cards[1]) cards[1].style.display = "none";
    [$("dFloor"),$("dLock")].forEach(x => { if(x?.parentElement)x.parentElement.style.display="none"; });
  }

  function ensureFields() {
    const addForm = document.querySelector("#stocks .form-grid");
    if (addForm && !$("nlock")) {
      const wrap=document.createElement("div");wrap.className="field";
      wrap.innerHTML='<label>커트라인 유지시간</label><input id="nlock" type="number" min="1" max="1440" value="10"><div class="hint">커트라인 도달 후 가격 고정 시간(분)</div>';
      const shares=$("nshares")?.closest(".field");if(shares)shares.after(wrap);else addForm.appendChild(wrap);
    }
    const modal=$("stockModal")?.querySelector(".form-grid");
    if(modal&&!$("mlock")){const w=document.createElement("div");w.className="field";w.innerHTML='<label>커트라인 유지시간</label><input id="mlock" type="number" min="1" max="1440" value="10">';const f=$("mFloor")?.closest(".field");if(f)f.after(w);else modal.appendChild(w)}
    if(modal&&!$("mShares")){const w=document.createElement("div");w.className="field";w.innerHTML='<label>최대 공유 거래량</label><input id="mShares" type="number" min="0" value="30">';modal.appendChild(w)}
  }

  async function request(path, options={}) {
    const r=await fetch("/api/admin"+path,{...options,headers:{"Content-Type":"application/json","x-admin-password":window.P||"",...(options.headers||{})}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"요청에 실패했습니다.");return d;
  }

  function addModernHeader() {
    if($("vsmModernHeader"))return;
    const top=document.querySelector(".top");if(!top)return;
    const pill=document.createElement("span");pill.className="live-pill";pill.innerHTML='<i class="live-dot"></i> LIVE';pill.id="vsmModernHeader";top.insertBefore(pill,top.querySelector("button"));
  }

  function addHero() {
    if($("vsmHero"))return;
    const home=$("home");const head=home?.querySelector(".head");if(!home||!head)return;
    const hero=document.createElement("div");hero.id="vsmHero";hero.className="vsm-hero";
    hero.innerHTML='<div class="vsm-hero-box"><div class="vsm-section-kicker">VIRTUAL STOCK MARKET</div><h2>운영 센터</h2><p>주식 · 플레이어 · 시장 설정을 한 화면에서 관리합니다.<br>자동 갱신이 실패해도 아래 새로고침 버튼으로 즉시 최신 상태를 불러올 수 있습니다.</p></div><div class="vsm-mini"><div class="vsm-section-kicker">LAST SYNC</div><strong id="vsmLastRefresh">-</strong><span id="vsmRefreshState">대기 중</span></div>';
    head.after(hero);
  }

  function addRefreshDock() {
    if($("vsmRefreshDock"))return;
    const d=document.createElement("div");d.id="vsmRefreshDock";d.innerHTML='<span id="vsmRefreshState">수동 새로고침 가능</span><button id="vsmRefreshButton">↻ 새로고침</button>';
    document.body.appendChild(d);
    $("vsmRefreshButton").onclick=async()=>{await forceRefresh(true)};
  }

  async function forceRefresh(showToast=true){
    if(!window.P)return;
    const state=$("vsmRefreshState");if(state)state.textContent="불러오는 중...";
    try{
      if(typeof window.refreshAll==="function")await window.refreshAll();
      else{await Promise.all([window.loadStocks?.(),window.loadUsers?.(),window.loadSettings?.(),window.loadFeedback?.(),window.loadNotices?.(),window.loadChanges?.(),window.loadMaintenance?.()]);}
      const now=new Date();if($("vsmLastRefresh"))$("vsmLastRefresh").textContent=now.toLocaleTimeString("ko-KR");
      if(state)state.textContent="최신 상태";
      if(showToast&&typeof window.toast==="function")window.toast("관리자 패널을 새로고침했습니다.");
    }catch(e){if(state)state.textContent="갱신 실패";if(typeof window.toast==="function")window.toast(e.message)}
  }

  function installStockUI(){
    if(window.__vsmStockUI)return;window.__vsmStockUI=true;
    window.drawStockRows=function(list=window.S||[]){if(!$("stockRows"))return;$("stockRows").innerHTML=list.map(stockRow).join("")||'<tr><td colspan="8" style="text-align:center;padding:34px" class="muted">등록된 종목이 없습니다.</td></tr>';if($("stockCount2"))$("stockCount2").textContent="· "+list.length+"개"};
    const oldLoad=window.loadStocks;
    window.loadStocks=async function(){const d=await request("/stocks");window.S=d.stocks||[];window.drawStockRows(window.S);ensureFields();hideGlobalFloorUI();};
    window.addStock=async function(){try{await request("/stocks",{method:"POST",body:JSON.stringify({id:$("nid").value.trim(),name:$("nname").value.trim(),price:$("nprice").value,minChange:$("nmin").value,maxChange:$("nmax").value,priceFloor:$("nfloor").value,floorLockMinutes:$("nlock")?.value||10,maxShares:$("nshares").value||30})});["nid","nname","nprice","nmin","nmax","nfloor"].forEach(id=>{if($(id))$(id).value=""});if($("nlock"))$("nlock").value="10";if($("nshares"))$("nshares").value="30";await window.loadStocks();toast("종목이 추가되었습니다.")}catch(e){toast(e.message)}};
    window.editStock=function(id){const s=(window.S||[]).find(x=>x.id===id);if(!s)return;window.editingStock=id;ensureFields();$("mName").value=s.name||"";$("mPrice").value=s.price||1;$("mMin").value=s.minChange||1;$("mMax").value=s.maxChange||1;$("mFloor").value=s.priceFloor??"";$("mlock").value=s.floorLockMinutes||10;$("mShares").value=s.maxShares??30;$("stockModal").classList.add("on")};
    window.saveStock=async function(){if(!window.editingStock)return;try{await request("/stocks/"+encodeURIComponent(window.editingStock),{method:"PATCH",body:JSON.stringify({name:$("mName").value,price:$("mPrice").value,minChange:$("mMin").value,maxChange:$("mMax").value,priceFloor:$("mFloor").value,floorLockMinutes:$("mlock").value,maxShares:$("mShares").value})});$("stockModal").classList.remove("on");window.editingStock=null;await window.loadStocks();toast("주식 설정이 저장되었습니다.")}catch(e){toast(e.message)}};
    window.applyTrend=async function(id){try{const direction=$("trend-"+id).value;const strength=Number($("strength-"+id).value);const seconds=Math.max(5,Number($("seconds-"+id).value)||60);await request("/stocks/"+encodeURIComponent(id)+"/control",{method:"POST",body:JSON.stringify({direction,strength,seconds})});toast(direction==="up"?`상승세 ${strength}단계 적용`:direction==="down"?`하락세 ${strength}단계 적용`:"보통 변동으로 전환")}catch(e){toast(e.message)}};
  }

  function stockRow(s){const left=Number(s.floorLockUntil||0)-Date.now();const locked=s.priceFloor!=null&&left>0;const status=locked?`<span class="badge red">커트라인 잠금 ${Math.ceil(left/60000)}분</span>`:'<span class="badge green">정상 변동</span>';return `<tr><td><span class="code">${esc(s.id)}</span></td><td><b>${esc(s.name)}</b></td><td class="price">${money(s.price)}</td><td>${money(s.minChange)} ~ ${money(s.maxChange)}</td><td>${s.priceFloor==null?"없음":money(s.priceFloor)}</td><td>${Number(s.maxShares||0).toLocaleString()}주 <span class="muted">/ ${Number(s.availableShares||0).toLocaleString()} 남음</span></td><td>${status}${s.floorRiseRemaining?`<br><span class="badge yellow">강제 상승 ${s.floorRiseRemaining}회</span>`:""}</td><td><div class="market-controls"><button class="btn" onclick="editStock('${esc(s.id)}')">수정</button><select id="trend-${esc(s.id)}"><option value="normal">보통</option><option value="up">상승</option><option value="down">하락</option></select><select id="strength-${esc(s.id)}"><option value="1">강도 1</option><option value="2">강도 2</option><option value="3" selected>강도 3</option><option value="4">강도 4</option><option value="5">강도 5</option></select><input id="seconds-${esc(s.id)}" type="number" min="5" max="86400" value="60"><button class="btn primary" onclick="applyTrend('${esc(s.id)}')">적용</button><button class="btn red" onclick="deleteStock('${esc(s.id)}')">삭제</button></div></td></tr>`}

  function installAutoRefresh(){
    if(window.__vsmAutoRefresh)return;window.__vsmAutoRefresh=true;
    const refresh=async()=>{if(!window.P)return;try{await window.loadStocks();if(typeof window.loadUsers==="function")await window.loadUsers();if(typeof window.loadSettings==="function")await window.loadSettings();hideGlobalFloorUI();ensureFields();if($("vsmLastRefresh"))$("vsmLastRefresh").textContent=new Date().toLocaleTimeString("ko-KR");}catch(e){console.warn("ADMIN AUTO REFRESH:",e)}};
    setInterval(refresh,10000);
    setInterval(()=>{hideGlobalFloorUI();ensureFields()},1500);
  }

  function boot(){injectStyle();addModernHeader();addHero();addRefreshDock();hideGlobalFloorUI();ensureFields();installStockUI();installAutoRefresh();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
