(() => {
  const modal = (title, text) => {
    let el = document.getElementById('vsmRefreshModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vsmRefreshModal';
      el.className = 'vsm-refresh-modal';
      el.innerHTML = '<div class="box"><h3></h3><p></p><button class="close">확인</button></div>';
      el.addEventListener('click', e => { if (e.target === el || e.target.classList.contains('close')) el.classList.remove('on'); });
      document.body.appendChild(el);
    }
    el.querySelector('h3').textContent = title;
    el.querySelector('p').textContent = text;
    el.classList.add('on');
  };

  const addPlayerModules = () => {
    const candidates = [...document.querySelectorAll('button,a,[role="button"]')];
    const company = candidates.find(x => /주식회사/.test(x.textContent || ''));
    if (!company || document.getElementById('vsmEconomyModules')) return;
    const wrap = document.createElement('div');
    wrap.id = 'vsmEconomyModules';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px';
    const make = (label, text) => {
      const b = document.createElement('button');
      b.className = 'vsm-module-chip'; b.textContent = label;
      b.onclick = () => modal(label, text);
      return b;
    };
    wrap.append(make('💰 경제', '세금·경제 시스템은 다음 단계에서 실제 규칙과 함께 연결됩니다.'));
    wrap.append(make('🎮 게임센터', '게임센터는 가상자산을 걸거나 베팅하지 않는 방식의 미니게임으로 확장할 수 있습니다.'));
    company.parentElement?.parentElement?.appendChild(wrap);
  };

  const addAdminModules = () => {
    const nav = document.querySelector('#app .nav');
    if (!nav || document.getElementById('vsmAdminModules')) return;
    const wrap = document.createElement('div');
    wrap.id = 'vsmAdminModules';
    wrap.className = 'vsm-admin-module';
    wrap.innerHTML = '<h3>확장 모듈</h3><p>경제·세금과 게임센터 관리 영역을 위한 UI 공간입니다. 실제 규칙은 별도 설정으로 연결합니다.</p>';
    nav.parentElement?.appendChild(wrap);
  };

  const syncPublicTheme = () => {
    const button = document.getElementById('themeButton');
    if (!button) return;
    const key = 'vsm-theme';
    const apply = (theme) => {
      const dark = theme === 'dark';
      document.body.classList.toggle('dark', dark);
      const label = button.querySelector('span');
      if (label) label.textContent = dark ? '화이트모드' : '다크모드';
    };
    apply(localStorage.getItem(key) || 'light');
    if (button.dataset.themeSyncBound) return;
    button.dataset.themeSyncBound = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = (localStorage.getItem(key) || 'light') === 'dark' ? 'light' : 'dark';
      localStorage.setItem(key, next);
      apply(next);
    });
  };

  const run = () => { addPlayerModules(); addAdminModules(); syncPublicTheme(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  setTimeout(run, 1200);
})();
