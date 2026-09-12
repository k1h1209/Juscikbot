(() => {
  const STORAGE_KEY = 'vsm-theme';
  const getTheme = () => localStorage.getItem(STORAGE_KEY) || 'light';

  const applyTheme = (theme) => {
    const dark = theme === 'dark';
    document.body.classList.toggle('dark', dark);
    const button = document.getElementById('themeButton');
    if (button) {
      const label = button.querySelector('span');
      if (label) label.textContent = dark ? '화이트모드' : '다크모드';
      else button.textContent = dark ? '☀️ 화이트모드' : '🌙 다크모드';
    }
  };

  const init = () => {
    applyTheme(getTheme());
    const button = document.getElementById('themeButton');
    if (!button || button.dataset.themeSyncBound) return;
    button.dataset.themeSyncBound = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
