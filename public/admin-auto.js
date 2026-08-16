(() => {
  const $ = id => document.getElementById(id);

  function hideGlobalFloorUI() {
    const globalInput = $("globalFloor");
    const lockInput = $("floorLockMinutes");
    [globalInput, lockInput].forEach(input => {
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

  function ensureLockFields() {
    const addForm = document.querySelector("#stocks .form-grid");
    if (addForm && !$("nlock")) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `<label>커트라인 잠금 시간 (분)</label><input id="nlock" type="number" min="1" max="1440" value="10"><div class="hint">커트라인에 도달하면 이 시간 동안 가격을 고정합니다.</div>`;
      const shares = $("nshares")?.closest(".field");
      if (shares) shares.after(wrap);
      else addForm.appendChild(wrap);
    }

    const modal = $("stockModal")?.querySelector(".form-grid");
    if (modal && !$("mlock")) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `<label>커트라인 잠금 시간 (분)</label><input id="mlock" type="number" min="1" max="1440" value="10">`;
      const floor = $("mFloor")?.closest(".field");
      if (floor) floor.after(wrap);
      else modal.appendChild(wrap);
    }
  }

  function installStockOverrides() {
    if (window.__vsmStockOverrides) return;
    window.__vsmStockOverrides = true;

    const originalLoadStocks = window.loadStocks;
    window.loadStocks = async function() {
      if (typeof originalLoadStocks === "function") await originalLoadStocks();
      ensureLockFields();
      hideGlobalFloorUI();
    };

    window.addStock = async function() {
      try {
        const response = await fetch("/api/admin/stocks", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-password": window.P || "" },
          body: JSON.stringify({
            id: $("nid")?.value.trim(),
            name: $("nname")?.value.trim(),
            price: $("nprice")?.value,
            minChange: $("nmin")?.value,
            maxChange: $("nmax")?.value,
            priceFloor: $("nfloor")?.value,
            floorLockMinutes: $("nlock")?.value || 10,
            maxShares: $("nshares")?.value || 30
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "종목 추가에 실패했습니다.");

        ["nid", "nname", "nprice", "nmin", "nmax", "nfloor"].forEach(id => {
          if ($(id)) $(id).value = "";
        });
        if ($("nlock")) $("nlock").value = "10";
        if ($("nshares")) $("nshares").value = "30";

        await window.loadStocks();
        if (typeof window.toast === "function") window.toast("종목이 추가되었습니다.");
      } catch (error) {
        if (typeof window.toast === "function") window.toast(error.message);
      }
    };

    window.editStock = function(id) {
      const stock = (window.S || []).find(s => s.id === id);
      if (!stock) return;
      window.editingStock = id;
      ensureLockFields();
      $("mName").value = stock.name || "";
      $("mPrice").value = stock.price ?? 1;
      $("mMin").value = stock.minChange ?? 1;
      $("mMax").value = stock.maxChange ?? 1;
      $("mFloor").value = stock.priceFloor ?? "";
      $("mlock").value = stock.floorLockMinutes ?? 10;
      $("stockModal").classList.add("on");
    };

    window.saveStock = async function() {
      if (!window.editingStock) return;
      try {
        const id = window.editingStock;
        const response = await fetch("/api/admin/stocks/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-admin-password": window.P || "" },
          body: JSON.stringify({
            name: $("mName").value,
            price: $("mPrice").value,
            minChange: $("mMin").value,
            maxChange: $("mMax").value,
            priceFloor: $("mFloor").value,
            floorLockMinutes: $("mlock").value
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "주식 수정에 실패했습니다.");

        $("stockModal").classList.remove("on");
        window.editingStock = null;
        await window.loadStocks();
        if (typeof window.toast === "function") window.toast("주식 설정이 저장되었습니다.");
      } catch (error) {
        if (typeof window.toast === "function") window.toast(error.message);
      }
    };
  }

  function installAutoRefresh() {
    if (window.__vsmAutoRefresh) return;
    window.__vsmAutoRefresh = true;

    const refresh = async () => {
      if (!window.P) return;
      try {
        if (typeof window.refreshAll === "function") await window.refreshAll();
        hideGlobalFloorUI();
        ensureLockFields();
      } catch (error) {
        console.error("[ADMIN AUTO] refresh:", error);
      }
    };

    setInterval(refresh, 5000);
    setInterval(() => {
      hideGlobalFloorUI();
      ensureLockFields();
    }, 1000);
  }

  function boot() {
    hideGlobalFloorUI();
    ensureLockFields();
    installStockOverrides();
    installAutoRefresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
