(() => {
  let overlay = null;
  let timer = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "vsmMaintenanceOverlay";
    overlay.innerHTML = `
      <div class="vsm-maint-card">
        <div class="vsm-maint-icon">⚙</div>
        <h1>현재 서버 점검 중입니다</h1>
        <p>서비스 안정화를 위해 잠시 이용이 제한됩니다.</p>
        <div class="vsm-maint-status">관리자가 점검을 종료하면 자동으로 다시 이용할 수 있습니다.</div>
      </div>
    `;
    const style = document.createElement("style");
    style.textContent = `
      #vsmMaintenanceOverlay{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(6,10,20,.96);color:#edf2ff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #vsmMaintenanceOverlay.on{display:flex}
      .vsm-maint-card{width:min(520px,100%);padding:42px 30px;text-align:center;border:1px solid rgba(109,124,255,.25);border-radius:24px;background:linear-gradient(145deg,#11182b,#0d1426);box-shadow:0 25px 80px rgba(0,0,0,.45)}
      .vsm-maint-icon{font-size:54px;margin-bottom:14px}
      .vsm-maint-card h1{margin:0 0 10px;font-size:28px}
      .vsm-maint-card p{margin:0;color:#9aa6c2;font-size:14px}
      .vsm-maint-status{margin-top:22px;padding:13px 15px;border-radius:13px;background:#0b1020;border:1px solid #25304a;color:#7f8ba7;font-size:12px;line-height:1.6}
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    return overlay;
  }

  async function check() {
    try {
      const response = await fetch("/api/maintenance/status", { cache: "no-store" });
      const data = await response.json();
      const active = Boolean(data.enabled);
      const el = ensureOverlay();
      el.classList.toggle("on", active);
      document.documentElement.style.overflow = active ? "hidden" : "";
      document.body.style.overflow = active ? "hidden" : "";
    } catch (_) {
      // 점검 상태 확인 실패만으로 사이트 전체를 막지는 않습니다.
    }
  }

  function start() {
    check();
    timer = setInterval(check, 3000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
