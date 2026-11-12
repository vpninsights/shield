// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
const api = globalThis.browser || globalThis.chrome;
const S = globalThis.Shield;
const SITE = 'https://vpninsights.com';
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
let W = null;

const dayName = (day) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
const longDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

function rank(el, rows, label) {
  if (!rows.length) { el.safeHTML = '<p class="empty">Nothing yet. Browse for a few days and this fills in.</p>'; return; }
  const max = Math.max(...rows.map((r) => r.v));
  el.safeHTML = rows.map((r, i) => `<div class="rk"><span class="n">${i + 1}</span><span class="nm" title="${esc(r.name)}">${esc(r.name)}</span><div class="bar"><i style="width:${Math.max(4, Math.round(r.v / max * 100))}%"></i></div><em>${esc(label(r))}</em></div>`).join('');
}

function render() {
  $('#range').textContent = `${longDay(W.from)} to ${longDay(W.to)}. All of this stays on your device.`;
  $('#streak').safeHTML = `${ic('fire')} ${W.streak}`;
  $('#kpis').safeHTML = [['ban', fmt(W.blocked), 'Trackers blocked'], ['globe', fmt(W.sites), 'Sites visited'], ['cookie', fmt(W.banners), 'Cookie banners declined'], ['db', fmt(W.topCompanies.length), 'Companies that tracked you']]
    .map(([i, n, l]) => `<div class="kpi">${ic(i)}<b>${n}</b><small>${l}</small></div>`).join('');
  const max = Math.max(1, ...W.bars.map((b) => b.n));
  $('#bars').safeHTML = W.bars.map((b) => `<div style="height:${Math.max(2, Math.round(b.n / max * 100))}%" title="${b.n} on ${b.day}"></div>`).join('');
  $('#ax').safeHTML = W.bars.map((b) => `<span>${dayName(b.day)}</span>`).join('');
  rank($('#cos'), W.topCompanies.map((c) => ({ name: c.name, v: c.n, n: c.n })), (r) => fmt(r.n));
  rank($('#sites'), W.topSites.map((s) => ({ name: s.host, v: s.per, per: s.per })), (r) => `${r.per} / visit`);
  const tip = S.pickTip(W);
  $('#tip').textContent = tip.text;
  const a = $('#tipLink'); a.textContent = tip.label;
  a.href = tip.path ? SITE + tip.path : '#';
  if (!tip.path) a.addEventListener('click', (e) => { e.preventDefault(); api.runtime.openOptionsPage(); });
}

// A plain picture of the week. Numbers only: no site names, no companies, nothing that identifies you.
function makeImage() {
  const w = 1200, h = 630, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6d28d9'); g.addColorStop(1, '#4c1d95'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = '#fff'; x.font = '700 30px system-ui,Segoe UI,sans-serif'; x.fillText('Shield by VPNInsights', 70, 90);
  x.font = '700 76px system-ui,Segoe UI,sans-serif'; x.fillText('My privacy week', 70, 210);
  const tiles = [[fmt(W.blocked), 'trackers blocked'], [fmt(W.sites), 'sites visited'], [fmt(W.banners), 'cookie banners declined'], [String(W.streak), 'day streak']];
  tiles.forEach(([n, l], i) => {
    const px = 70 + (i % 2) * 540, py = 270 + Math.floor(i / 2) * 150;
    x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.roundRect(px, py, 500, 128, 20); x.fill();
    x.fillStyle = '#fff'; x.font = '800 58px system-ui,Segoe UI,sans-serif'; x.fillText(n, px + 28, py + 70);
    x.font = '500 26px system-ui,Segoe UI,sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(l, px + 28, py + 108);
  });
  x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '500 24px system-ui,Segoe UI,sans-serif'; x.fillText('Free privacy extension  ·  vpninsights.com/shield', 70, 590);
  return c;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('#bShare'); if (!t || !W) return;
  makeImage().toBlob((blob) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-privacy-week.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
});

document.querySelectorAll('[data-ic]').forEach((el) => { el.safeHTML = ic(el.dataset.ic); });
(async () => {
  let r = null;
  for (let i = 0; i < 5 && !r; i++) { try { r = await api.runtime.sendMessage({ type: 'getReport' }); } catch (e) { /* worker not ready */ } if (!r) await new Promise((z) => setTimeout(z, 300)); }
  W = S.weekSummary((r && r.report) || {});
  render();
})();
