// Runs before first paint (blocking script) so the window never flashes the wrong theme.
// A separate file because the CSP forbids inline scripts. Mirrors Yoda's index.html snippet.
(function () {
  try {
    var raw = localStorage.getItem('smartdd-theme');
    var pref = raw ? JSON.parse(raw) : null;
    var effective =
      pref === 'ylight' || pref === 'ydark'
        ? pref
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'ydark'
          : 'ylight';
    document.documentElement.classList.add(effective);
  } catch (_) {
    document.documentElement.classList.add('ydark');
  }
})();
