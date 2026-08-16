(() => {
  const $ = (id) => document.getElementById(id);
  const money = (x) => Number(x || 0).toLocaleString() + "원";

  function injectGlobalFloorCard() {
    if ($("globalFloorCard")) return;

    const stocksSection = $("stocks");
    if (!stocksSection) return;

    const card = document.createElement("div");
    card.id = "globalFloorCard";
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <div>
          <h3>전체 주식 커트라인</h3>
          <span>모든 종목에 동일하게 적용</span>
        </div>
        <span class="badge blue">GLOBAL</span>
      </div>
      <div class="grid2">
        <div>
          <div class="field">
            <label>전체 커트라인</label>
            <input id="globalFloor" type="number" min="0" step="1" placeholder="예: 1000">
          </div>
          <div class="actions">
            <button class="primary" id="saveGlobalFloor">전체 종목에 적용</button>
            <button class="secondary" id="disableGlobalFloor">전체 적용 해제</button>
          </div>
        </div>
        <div>
          <div class="muted">현재 전체 커트라인</div>
          <div id="globalFloorPreview" class="setting-big">-</div>
          <div id="globalFloorUpdated" class="hint">-</div>
          <div class="hint" style="margin-top:8px">
            0원으로 해제하면 기존의 종목별 커트라인이 다시 사용됩니다.<br>
            전체 커트라인이 설정되어 있으면 모든 종목은 이 값을 우선 적용합니다.
          </div>
        </div>
      </div>
    `;

    const addCard = stocksSection.querySelector(".card");
    if (addCard) addCard.after(card);
    else stocksSection.prepend(card);

    $("saveGlobalFloor").addEventListener("click", saveGlobalFloor);
    $("disableGlobalFloor").addEventListener("click", () => saveGlobalFloor(true));
  }

  async function globalApi(path, options = {}) {
    const password = window.__VSM_ADMIN_PASSWORD || "";
    const response = await fetch("/api/admin" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  async function loadGlobalFloor() {
    try {
      const data = await globalApi("/global-floor");
      const value = data.globalFloor;
      $("globalFloor").value = value ?? 0;
      $("globalFloorPreview").textContent = value === null ? "사용 안 함" : money(value);
      $("globalFloorUpdated").textContent = data.updatedAt
        ? "마지막 변경: " + new Date(data.updatedAt).toLocaleString()
        : "아직 설정되지 않았습니다.";
    } catch (error) {
      if ($("globalFloorPreview")) $("globalFloorPreview").textContent = "관리자 로그인 후 불러옵니다.";
    }
  }

  async function saveGlobalFloor(disable = false) {
    const input = $("globalFloor");
    if (!input) return;

    const value = disable ? 0 : input.value;
    if (!disable && (!value || Number(value) < 1)) {
      alert("전체 커트라인은 1원 이상 입력하세요. 사용하지 않으려면 '전체 적용 해제'를 누르세요.");
      return;
    }

    try {
      const data = await globalApi("/global-floor", {
        method: "PATCH",
        body: JSON.stringify({ globalFloor: value })
      });

      input.value = data.globalFloor ?? 0;
      $("globalFloorPreview").textContent = data.globalFloor === null ? "사용 안 함" : money(data.globalFloor);
      $("globalFloorUpdated").textContent = "마지막 변경: " + new Date(data.updatedAt).toLocaleString();

      if (typeof window.toast === "function") {
        window.toast(data.globalFloor === null
          ? "전체 커트라인을 해제했습니다."
          : `전체 주식 커트라인을 ${money(data.globalFloor)}로 설정했습니다.`);
      } else {
        alert(data.globalFloor === null ? "전체 커트라인을 해제했습니다." : "전체 커트라인이 적용되었습니다.");
      }
    } catch (error) {
      alert(error.message);
    }
  }

  function hookPassword() {
    const originalLogin = window.login;
    if (typeof originalLogin !== "function") return;

    window.login = async function(...args) {
      window.__VSM_ADMIN_PASSWORD = $("pw")?.value || "";
      const result = await originalLogin.apply(this, args);
      if (!( $("app")?.classList.contains("hidden") )) {
        await loadGlobalFloor();
      }
      return result;
    };
  }

  function start() {
    hookPassword();
    injectGlobalFloorCard();

    const observer = new MutationObserver(() => {
      if (!$("globalFloorCard")) injectGlobalFloorCard();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
