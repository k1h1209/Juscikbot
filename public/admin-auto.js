(() => {
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const money = x => Number(x || 0).toLocaleString() + "원";

  function style() {
    if ($("vsmAdminPatchStyle")) return;
    const s = document.createElement("style");
    s.id = "vsmAdminPatchStyle";
    s.textContent = `
      #stocks .card{box-shadow:0 18px 50px rgba(0,0,0,.22)}
      .market-live{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #263653;border-radius:999px;background:#0a1424;color:#9eabc0;font-size:10px;font-weight:800}
      .market-live i{width:7px;height:7px;border-radius:50%;background:#37d59c;box-shadow:0 0 0 4px #37d59c18}
      .market-controls{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
      .market-controls select,.market-controls input{border:1px solid #25334c;background:#08111f;color:#eef3ff;border-radius:9px;padding:7px 8px;font-size:10px}
      .trend-up{color:#65e2b2}.trend-down{color:#ff8499}.trend-normal{color:#9eabc0}
      .stock-control-card{margin-top:10px;border:1px solid #202e47;background:#091321;border-radius:13px;padding:11px}
      .stock-control-card b{font-size:11px}.stock-control-card small{display:block;color:#6f7d95;margin-top:4px;font-size:9px}
      #stockRows td:last-child{min-width:270px}
      .field .hint{margin-top:4px}
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
    const floorBox = $("dFloor")?.parentElement;
    const lockBox = $("dLock")?.parentElement;
    if (floorBox) floorBox.style.display = "none";
    if (lockBox) lockBox.style.display = "none";
  }

  function ensureFields() {
    const addForm = document.querySelector("#stocks .form-grid");
    if (addForm && !$("nlock")) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `<label>커트라인 유지시간</label><input id="nlock" type="number" min="1" max="1440" value="10"><div class="hint">커트라인 도달 후 가격 고정 시간(분)</div>`;
      const shares = $("nshares")?.closest(".field");
      if (shares) shares.after(wrap); else addForm.appendChild(wrap);
    }
    const modal = $("stockModal")?.querySelector(".form-grid");
    if (modal && !$("mlock")) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `<label>커트라인 유지시간</label><input id="mlock" type="number" min="1" max="1440" value="10">`;
      const floor = $("mFloor")?.closest(".field");
      if (floor) floor.after(wrap); else modal.appendChild(wrap);
    }
    if (modal && !$("mShares")) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `<label>최대 공유 거래량</label><input id="mShares" type="number" min="0" value="30">`;
      modal.appendChild(wrap);
    }
  }

  async function request(path, options={}) {
    const r = await fetch("/api/admin" + path, {
      ...options,
      headers: {"Content-Type":"application/json","x-admin-password":window.P || "",...(options.headers || {})}
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || "요청에 실패했습니다.");
    return d;
  }

  function stockRow(s) {
    const left = Number(s.floorLockUntil || 0) - Date.now();
    const locked = s.priceFloor != null && left > 0;
    const status = locked
      ? `<span class="badge red">커트라인 잠금 ${Math.ceil(left/60000)}분</span>`
      : `<span class="badge green">정상 변동</span>`;
    return `<tr>
      <td><span class="code">${esc(s.id)}</span></td>
      <td><b>${esc(s.name)}</b></td>
      <td class="price">${money(s.price)}</td>
      <td>${money(s.minChange)} ~ ${money(s.maxChange)}</td>
      <td>${s.priceFloor == null ? "없음" : money(s.priceFloor)}</td>
      <td>${Number(s.maxShares||0).toLocaleString()}주 <span class="muted">/ ${Number(s.availableShares||0).toLocaleString()} 남음</span></td>
      <td>${status}${s.floorRiseRemaining ? `<br><span class="badge yellow">강제 상승 ${s.floorRiseRemaining}회 남음</span>` : ""}</td>
      <td><div class="market-controls">
        <button class="btn" onclick="editStock('${esc(s.id)}')">수정</button>
        <select id="trend-${esc(s.id)}"><option value="normal">보통</option><option value="up">상승</option><option value="down">하락</option></select>
        <select id="strength-${esc(s.id)}"><option value="1">강도 1</option><option value="2">강도 2</option><option value="3" selected>강도 3</option><option value="4">강도 4</option><option value="5">강도 5</option></select>
        <input id="seconds-${esc(s.id)}" type="number" min="5" max="86400" value="60" title="제어 시간(초)">
        <button class="btn primary" onclick="applyTrend('${esc(s.id)}')">적용</button>
        <button class="btn red" onclick="deleteStock('${esc(s.id)}')">삭제</button>
      </div></td>
    </tr>`;
  }

  function installStockUI() {
    if (window.__vsmStockUI) return;
    window.__vsmStockUI = true;

    window.drawStockRows = function(list = window.S || []) {
      if (!$("stockRows")) return;
      $("stockRows").innerHTML = list.map(stockRow).join("") || `<tr><td colspan="8" style="text-align:center;padding:34px" class="muted">등록된 종목이 없습니다.</td></tr>`;
      if ($("stockCount2")) $("stockCount2").textContent = "· " + list.length + "개";
    };

    const oldLoadStocks = window.loadStocks;
    window.loadStocks = async function() {
      if (typeof oldLoadStocks === "function") {
        const d = await request("/stocks");
        window.S = d.stocks || [];
        window.drawStockRows(window.S);
      }
      ensureFields();
      hideGlobalFloorUI();
    };

    window.addStock = async function() {
      try {
        await request("/stocks", {method:"POST", body:JSON.stringify({
          id:$("nid").value.trim(), name:$("nname").value.trim(), price:$("nprice").value,
          minChange:$("nmin").value, maxChange:$("nmax").value,
          priceFloor:$("nfloor").value, floorLockMinutes:$("nlock")?.value || 10,
          maxShares:$("nshares").value || 30
        })});
        ["nid","nname","nprice","nmin","nmax","nfloor"].forEach(id => {if($(id))$(id).value="";});
        if($("nlock"))$("nlock").value="10";
        if($("nshares"))$("nshares").value="30";
        await window.loadStocks();
        toast("종목이 추가되었습니다.");
      } catch(e) { toast(e.message); }
    };

    window.editStock = function(id) {
      const s = (window.S || []).find(x => x.id === id);
      if (!s) return;
      window.editingStock = id;
      ensureFields();
      $("mName").value=s.name || ""; $("mPrice").value=s.price || 1;
      $("mMin").value=s.minChange || 1; $("mMax").value=s.maxChange || 1;
      $("mFloor").value=s.priceFloor ?? ""; $("mlock").value=s.floorLockMinutes || 10;
      $("mShares").value=s.maxShares ?? 30;
      $("stockModal").classList.add("on");
    };

    window.saveStock = async function() {
      if (!window.editingStock) return;
      try {
        await request("/stocks/" + encodeURIComponent(window.editingStock), {method:"PATCH", body:JSON.stringify({
          name:$("mName").value, price:$("mPrice").value, minChange:$("mMin").value,
          maxChange:$("mMax").value, priceFloor:$("mFloor").value,
          floorLockMinutes:$("mlock").value, maxShares:$("mShares").value
        })});
        $("stockModal").classList.remove("on"); window.editingStock=null;
        await window.loadStocks(); toast("주식 설정이 저장되었습니다.");
      } catch(e) { toast(e.message); }
    };

    window.applyTrend = async function(id) {
      try {
        const direction=$("trend-"+id).value;
        const strength=Number($("strength-"+id).value);
        const seconds=Math.max(5,Number($("seconds-"+id).value)||60);
        await request("/stocks/"+encodeURIComponent(id)+"/control", {method:"POST",body:JSON.stringify({direction,strength,seconds})});
        toast(direction === "up" ? `상승세 ${strength}단계 적용` : direction === "down" ? `하락세 ${strength}단계 적용` : "보통 변동으로 전환");
      } catch(e) { toast(e.message); }
    };
  }

  function installAutoRefresh() {
    if (window.__vsmAutoRefresh) return;
    window.__vsmAutoRefresh=true;
    const refresh = async () => {
      if (!window.P) return;
      try {
        await window.loadStocks();
        if (typeof window.loadUsers === "function") await window.loadUsers();
        if (typeof window.loadSettings === "function") await window.loadSettings();
        hideGlobalFloorUI(); ensureFields();
      } catch(e) { console.error("ADMIN AUTO REFRESH:",e); }
    };
    setInterval(refresh,3000);
    setInterval(()=>{hideGlobalFloorUI();ensureFields();},1000);
  }

  function boot() {
    style(); hideGlobalFloorUI(); ensureFields(); installStockUI(); installAutoRefresh();
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
