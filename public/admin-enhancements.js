(() => {
  const $ = id => document.getElementById(id);
  const escLocal = x => String(x ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const moneyLocal = x => Number(x || 0).toLocaleString() + "원";

  async function adminApi(path, options = {}) {
    const response = await fetch("/api/admin-shares" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": window.P || "",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  function addField(parent, id, label, value = "30") {
    if ($(id)) return $(id);
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `<label>${label}</label><input id="${id}" type="number" min="0" value="${escLocal(value)}">`;
    parent.insertBefore(wrap, parent.querySelector("button.primary") || null);
    return $(id);
  }

  function ensureStockFields() {
    const formGrid = document.querySelector("#stocks .form-grid");
    if (formGrid) addField(formGrid, "nshares", "최대 공유 거래량", "30");

    const modal = $("stockModal")?.querySelector(".modal");
    if (modal) {
      const floorField = $("mFloor")?.closest(".field");
      if (floorField && !$("mShares")) {
        const wrap = document.createElement("div");
        wrap.className = "field";
        wrap.innerHTML = `<label>최대 공유 거래량</label><input id="mShares" type="number" min="0"><div class="hint">모든 플레이어가 함께 사용하는 해당 종목의 총 주식 수입니다.</div>`;
        floorField.after(wrap);
      }
    }

    const head = document.querySelector("#stocks .table thead tr");
    if (head && !head.querySelector("[data-shared-shares]")) {
      const th = document.createElement("th");
      th.dataset.sharedShares = "1";
      th.textContent = "공유 거래량";
      head.insertBefore(th, head.lastElementChild);
    }
  }

  function renderStocks(list = window.S || []) {
    ensureStockFields();
    const body = $("stockRows");
    if (!body) return;
    body.innerHTML = list.map(s => {
      const available = Number(s.availableShares || 0);
      const max = Number(s.maxShares || 0);
      const lockLeft = Number(s.floorLockUntil || 0) - Date.now();
      const lock = lockLeft > 0
        ? `<span class="badge red">커트라인 잠금 ${Math.ceil(lockLeft / 60000)}분</span>`
        : `<span class="badge green">정상 변동</span>`;
      return `<tr>
        <td><span class="code">${escLocal(s.id)}</span></td>
        <td><b>${escLocal(s.name)}</b></td>
        <td class="price">${moneyLocal(s.price)}</td>
        <td>${moneyLocal(s.minChange)}</td>
        <td>${moneyLocal(s.maxChange)}</td>
        <td>${s.priceFloor === null ? "없음" : moneyLocal(s.priceFloor)}</td>
        <td><span class="badge blue">${available.toLocaleString()} / ${max.toLocaleString()}주</span></td>
        <td>${lock}</td>
        <td><div class="actions">
          <button class="secondary" onclick="editStock('${escLocal(s.id)}')">수정</button>
          <button class="success" onclick="ctrl('${escLocal(s.id)}','up')">상승</button>
          <button class="warning" onclick="ctrl('${escLocal(s.id)}','down')">하락</button>
          <button class="danger" onclick="delStock('${escLocal(s.id)}')">삭제</button>
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="9" style="text-align:center;padding:35px" class="muted">등록된 종목이 없습니다.</td></tr>`;
    if ($("stockCount")) $("stockCount").textContent = `· ${window.S.length}개`;
  }

  function mergeShares(data) {
    const map = new Map((data.stocks || []).map(s => [s.id, s]));
    window.S = (window.S || []).map(s => ({ ...s, ...(map.get(s.id) || {}) }));
  }

  function installStockEnhancements() {
    const originalLoadStocks = window.loadStocks;
    if (typeof originalLoadStocks !== "function") return false;
    window.loadStocks = async function() {
      await originalLoadStocks();
      try {
        const data = await adminApi("/stocks");
        mergeShares(data);
      } catch (error) {
        if (typeof window.toast === "function") window.toast(error.message);
      }
      renderStocks();
      if (typeof window.dash === "function") window.dash();
    };

    window.addStock = async function() {
      try {
        const payload = {
          id: $("nid").value.trim(),
          name: $("nname").value.trim(),
          price: $("nprice").value,
          minChange: $("nmin").value,
          maxChange: $("nmax").value,
          priceFloor: $("nfloor").value
        };
        const response = await fetch("/api/admin/stocks", {
          method: "POST",
          headers: { "Content-Type":"application/json", "x-admin-password":window.P || "" },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "종목 추가에 실패했습니다.");

        await adminApi(`/stocks/${encodeURIComponent(data.stock.id)}/shares`, {
          method: "PATCH",
          body: JSON.stringify({ maxShares: $("nshares")?.value || 30 })
        });

        ["nid","nname","nprice","nmin","nmax","nfloor"].forEach(id => { if ($(id)) $(id).value = ""; });
        if ($("nshares")) $("nshares").value = "30";
        await window.loadStocks();
        if (typeof window.toast === "function") window.toast("새 종목과 공유 거래량이 등록되었습니다.");
      } catch (error) {
        if (typeof window.toast === "function") window.toast(error.message);
      }
    };

    window.editStock = function(id) {
      const stock = (window.S || []).find(s => s.id === id);
      if (!stock) return;
      window.editingStock = id;
      $("mName").value = stock.name;
      $("mPrice").value = stock.price;
      $("mMin").value = stock.minChange;
      $("mMax").value = stock.maxChange;
      $("mFloor").value = stock.priceFloor ?? 0;
      ensureStockFields();
      $("mShares").value = Number(stock.maxShares || 0);
      $("stockModal").classList.add("on");
    };

    window.saveStockModal = async function() {
      if (!window.editingStock) return;
      try {
        const id = window.editingStock;
        const response = await fetch("/api/admin/stocks/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type":"application/json", "x-admin-password":window.P || "" },
          body: JSON.stringify({
            name: $("mName").value,
            price: $("mPrice").value,
            minChange: $("mMin").value,
            maxChange: $("mMax").value,
            priceFloor: $("mFloor").value
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "주식 정보 수정에 실패했습니다.");

        await adminApi(`/stocks/${encodeURIComponent(id)}/shares`, {
          method: "PATCH",
          body: JSON.stringify({ maxShares: $("mShares").value })
        });

        if (typeof window.closeStockModal === "function") window.closeStockModal();
        await window.loadStocks();
        if (typeof window.toast === "function") window.toast("주식 정보와 공유 거래량이 저장되었습니다.");
      } catch (error) {
        if (typeof window.toast === "function") window.toast(error.message);
      }
    };

    return true;
  }

  function ensurePlayerModal() {
    if ($("playerDetailModal")) return;
    const modal = document.createElement("div");
    modal.id = "playerDetailModal";
    modal.className = "modal-back";
    modal.innerHTML = `<div class="modal" style="width:min(900px,100%)">
      <div class="card-head"><h3>플레이어 상세정보</h3><button class="secondary" onclick="closePlayerDetail()">닫기</button></div>
      <div id="playerDetailBody" class="hint">불러오는 중...</div>
    </div>`;
    document.body.appendChild(modal);
  }

  function detailTable(title, html) {
    return `<div class="card" style="margin-top:14px"><div class="card-head"><h3>${title}</h3></div>${html}</div>`;
  }

  window.closePlayerDetail = function() {
    $("playerDetailModal")?.classList.remove("on");
  };

  window.playerDetail = async function(id) {
    ensurePlayerModal();
    $("playerDetailModal").classList.add("on");
    $("playerDetailBody").innerHTML = `<div class="hint">상세정보를 불러오는 중...</div>`;
    try {
      const data = await adminApi(`/users/${encodeURIComponent(id)}/detail`);
      const u = data.user;
      const holdings = u.holdings?.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th>종목</th><th>수량</th><th>현재가</th><th>평가금액</th></tr></thead><tbody>${u.holdings.map(s => `<tr><td><b>${escLocal(s.name)}</b> <span class="code">${escLocal(s.id)}</span></td><td>${s.quantity.toLocaleString()}주</td><td>${moneyLocal(s.price)}</td><td class="price">${moneyLocal(s.value)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="hint">보유 주식이 없습니다.</div>`;

      const tx = u.transactions?.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th>종류</th><th>종목</th><th>수량</th><th>가격</th><th>금액</th><th>시간</th></tr></thead><tbody>${u.transactions.slice().reverse().slice(0,100).map(t => `<tr><td>${t.type === "buy" ? '<span class="badge green">매수</span>' : '<span class="badge red">매도</span>'}</td><td>${escLocal(t.stockName || t.stockId)}</td><td>${Number(t.quantity).toLocaleString()}주</td><td>${moneyLocal(t.price)}</td><td>${moneyLocal(t.total)}</td><td>${new Date(Number(t.time)).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="hint">거래내역이 없습니다.</div>`;

      const bank = u.bankTransactions?.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th>구분</th><th>상대방</th><th>금액</th><th>메모</th><th>시간</th></tr></thead><tbody>${u.bankTransactions.map(t => { const sent=t.senderId===u.id; return `<tr><td>${sent?'<span class="badge red">보냄</span>':'<span class="badge green">받음</span>'}</td><td>${escLocal(sent?(t.receiverNickname||t.receiverId):(t.senderNickname||t.senderId))}</td><td class="price">${moneyLocal(t.amount)}</td><td>${escLocal(t.memo)}</td><td>${new Date(t.createdAt).toLocaleString()}</td></tr>`; }).join("")}</tbody></table></div>`
        : `<div class="hint">이체내역이 없습니다.</div>`;

      $("playerDetailBody").innerHTML = `
        <div class="grid3">
          <div class="stat"><div class="stat-top"><span>플레이어</span></div><h3>#${u.playerNumber}</h3><small>${escLocal(u.nickname)} · ${escLocal(u.username)}</small></div>
          <div class="stat"><div class="stat-top"><span>현금</span></div><h3>${moneyLocal(u.cash)}</h3><small>보유 현금</small></div>
          <div class="stat"><div class="stat-top"><span>총 자산</span></div><h3>${moneyLocal(u.totalAssets)}</h3><small>현금 + 주식 평가액</small></div>
        </div>
        ${detailTable("보유 주식", holdings)}
        ${detailTable("주식 거래내역", tx)}
        ${detailTable("은행 이체내역", bank)}
        <div class="hint" style="margin-top:12px">가입일: ${new Date(u.createdAt).toLocaleString()}${u.bannedUntil ? ` · 밴: ${new Date(u.bannedUntil).toLocaleString()}` : " · 상태: 정상"}${u.banReason ? ` · 사유: ${escLocal(u.banReason)}` : ""}</div>
      `;
    } catch (error) {
      $("playerDetailBody").innerHTML = `<div class="hint" style="color:#ff8499">${escLocal(error.message)}</div>`;
    }
  };

  function installPlayerEnhancements() {
    window.userRows = function(list = window.U || []) {
      $("userRows").innerHTML = list.map(u => {
        const banned = u.banned_until && Number(u.banned_until) > Date.now();
        return `<tr><td><span class="badge">#${u.player_number ?? "-"}</span></td><td>${escLocal(u.username)}</td><td><b>${escLocal(u.nickname)}</b></td><td class="price">${moneyLocal(u.cash)}</td><td>${banned ? '<span class="badge red">● 밴</span>' : '<span class="badge green">● 정상</span>'}</td><td><div class="actions"><button class="primary" onclick="playerDetail('${escLocal(u.id)}')">상세정보</button><button class="secondary" onclick="userEdit('${escLocal(u.id)}')">수정</button><button class="danger" onclick="ban('${escLocal(u.id)}')">밴</button><button class="success" onclick="unban('${escLocal(u.id)}')">해제</button></div></td></tr>`;
      }).join("") || `<tr><td colspan="6" style="text-align:center;padding:35px" class="muted">플레이어가 없습니다.</td></tr>`;
      if ($("userCount")) $("userCount").textContent = `· ${window.U.length}명`;
    };
  }

  function boot() {
    if (window.__vsmAdminEnhancements) return;
    window.__vsmAdminEnhancements = true;
    installStockEnhancements();
    installPlayerEnhancements();
    ensureStockFields();
    ensurePlayerModal();
    if (typeof window.loadStocks === "function") window.loadStocks();
    if (typeof window.loadUsers === "function") window.loadUsers();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
