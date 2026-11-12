// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// VPNInsights Shield: opens the real link. Search engines and social networks send a click through their own address first so they can record it
// (google.com/url?q=..., l.facebook.com/l.php?u=...). This swaps in the real address just before you click, hover or copy it. It also drops the "ping"
// attribute, which tells a site to report your click. Needs shared.js, loaded before this file.
(() => {
  const S = globalThis.Shield;
  if (!S || window.__shieldUnwrap) return; window.__shieldUnwrap = true;
  const fix = (a) => {
    try {
      if (!a || !a.href) return;
      const real = S.unwrapUrl(a.href);
      if (real !== a.href) { a.dataset.shieldFrom = a.href; a.href = real; }
      if (a.hasAttribute('ping')) a.removeAttribute('ping');
    } catch (e) { /* leave the link alone */ }
  };
  const link = (e) => (e.target && e.target.closest ? e.target.closest('a[href]') : null);
  // Capture phase, so this runs before the page's own handler. The page may swap the address back on mouse down, so click is checked too.
  for (const ev of ['mouseover', 'focusin', 'mousedown', 'touchstart', 'click', 'auxclick', 'contextmenu']) document.addEventListener(ev, (e) => fix(link(e)), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') fix(link(e)); }, true);
})();
