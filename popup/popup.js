// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
const api = globalThis.browser || globalThis.chrome;
const S = globalThis.Shield;
const $ = (s) => document.querySelector(s);
const SITE = 'https://vpninsights.com';
let st = null, url = '', tabName = 'shield', vpnInfo = null;

// The background may still be waking up when this page opens, so try a few times before giving up.
async function send(m) {
  for (let i = 0; i < 5; i++) {
    try { const r = await api.runtime.sendMessage(m); if (r !== undefined) return r; } catch (e) { /* worker not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CAT_ICON = { analytics: 'chart', ads: 'ad', social: 'users', replay: 'eye', fingerprint: 'shield', other: 'ban' };
const CAT_NAME = { analytics: 'Analytics', ads: 'Ads', social: 'Social', replay: 'Session replay', fingerprint: 'Fingerprinting', other: 'Other' };
const reqs = (b) => b.n || 1;
const fmt = (n) => Number(n).toLocaleString('en-US');

// Blocked requests grouped by the company behind them, biggest first.
function companies(tab) {
  const by = new Map();
  for (const b of tab.blocked || []) {
    const name = S.companyOf(b.h) || b.h;
    const c = by.get(name) || { name, cat: b.c, hosts: [], n: 0 };
    c.hosts.push(b); c.n += reqs(b); by.set(name, c);
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

function hydrateIcons() { document.querySelectorAll('[data-ic]').forEach((el) => { el.safeHTML = ic(el.dataset.ic); }); }

async function cookieCount(host) {
  try { return (await api.cookies.getAll({ domain: S.siteOf(host) })).length; } catch (e) { return 0; }
}

async function render() {
  const { host, supported, settings, cfg, paused, tab } = st;
  const na = !supported;
  $('#main').hidden = na; $('#tabs').hidden = na; $('#na').hidden = !na;
  if (na) { $('#host').textContent = 'This page'; $('#state').textContent = 'Not available'; $('#state').className = 'pill off'; return; }
  $('#host').textContent = host;
  $('#state').safeHTML = paused ? 'Paused' : ic('check') + ' Protected'; $('#state').className = 'pill' + (paused ? ' off' : '');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tabName));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'p-' + tabName));

  // ---- Shield tab
  const g = S.gradePage(tab, paused);
  $('#letter').textContent = paused ? '-' : g.letter;
  $('#ring').style.setProperty('--p', paused ? 0 : g.score);
  $('#title').textContent = paused ? 'Protection is off' : g.word;
  $('#sub').textContent = g.line;
  const co = companies(tab);
  const third = Object.keys(tab.scripts || {}).length;
  const cookies = await cookieCount(host);
  $('#tiles').safeHTML = [['ban', tab.count || 0, 'Blocked'], ['building', co.length, 'Companies'], ['cookie', cookies, 'Cookies'], ['code', third, 'Scripts']].map(([i, n, l]) => `<div class="tile">${ic(i)}<b>${n}</b><small>${l}</small></div>`).join('');
  let notes = '';
  if (tab.banner) notes += `<div class="note">${ic('cookie')}<div><b>Cookie banner declined</b><span>Shield pressed "reject" for you on this page.</span></div></div>`;
  if (!paused && g.leaked) notes += `<div class="note w">${ic('warn')}<div><b>${g.leaked} known tracker${g.leaked === 1 ? ' is' : 's are'} still running</b><span>You allowed ${g.leaked === 1 ? 'it' : 'them'}, or the site's scripts are open. See the Trackers tab.</span></div></div>`;
  const br = S.breachFor(host);
  if (br) notes = `<div class="note w">${ic('warn')}<div><b>${esc(br[0])} had a data breach${br[1] ? ' in ' + br[1] : ''}</b><span>${fmt(br[2])} accounts were exposed. Use a password here that you use nowhere else.</span></div></div>` + notes;
  $('#notes').safeHTML = notes;
  $('#topco').safeHTML = co.length
    ? co.slice(0, 3).map((c) => `<div class="t"><div class="ic">${ic(CAT_ICON[c.cat] || 'ban')}</div><div class="nm"><b>${esc(c.name)}</b><small>${CAT_NAME[c.cat] || c.cat} · ${c.n} request${c.n === 1 ? '' : 's'}</small></div><span class="tag">${ic('check2')}Blocked</span></div>`).join('')
    : `<p class="mut sm">${paused ? 'Nothing is blocked while protection is off.' : 'Nothing blocked yet. Reload the page to see what it tries.'}</p>`;
  $('#seeAll').hidden = co.length <= 3; $('#seeAll').textContent = `See all ${co.length}`;
  $('#tPause').classList.toggle('on', !paused);
  $('#tBan').classList.toggle('on', settings.banners !== false);
  $('#banNote').textContent = settings.banners !== false ? 'Presses "reject" for you on the next page you open' : 'Off. Banners stay for you to answer';
  $('#tGpc').classList.toggle('on', !!settings.gpc);
  $('#tFp').classList.toggle('on', !!settings.fingerprint);
  $('#fpNote').textContent = settings.fingerprint ? 'On. Reload a page to apply it' : 'Off. Hides canvas, audio and hardware probes';
  const mode = cfg.js || settings.jsDefault;
  document.querySelectorAll('#seg button').forEach((b) => { b.className = b.dataset.m === mode ? 'on' + (b.dataset.m === 'none' ? ' r' : '') : ''; });
  $('#jsNote').textContent = mode === 'all' ? 'Scripts run. Known trackers are still blocked.' : mode === 'third' ? "This site's own scripts run. Other sites' scripts are blocked." : 'No scripts run. Many pages will look plain.';
  const wk = Object.values(st.stats || {}).reduce((n, d) => n + Object.entries(d).reduce((a, [k, v]) => a + (k === 'banner' ? 0 : v), 0), 0);
  $('#week').textContent = wk ? `${wk.toLocaleString()} blocked in 14 days` : '';

  if (tabName === 'trackers') renderLog(co);
  if (tabName === 'vpn') renderVpn();
}

function renderLog(co) {
  const { cfg, tab } = st;
  const allow = cfg.allow || [], block = cfg.block || [];
  const blockedHosts = new Set((tab.blocked || []).map((b) => b.h));
  let h = '';
  h += co.length ? co.map((c) => `<div class="co"><b><span>${esc(c.name)} <small class="mut">${CAT_NAME[c.cat] || c.cat}</small></span><span class="tag">${ic('check2')}${c.n} blocked</span></b>${c.hosts.map((b) => `<div class="li"><div>${esc(b.h)}<small>${reqs(b)} request${reqs(b) === 1 ? '' : 's'}</small></div><button data-allow="${esc(b.h)}">Allow</button></div>`).join('')}</div>`).join('')
    : '<p class="mut sm">Nothing was blocked on this page.</p>';
  const scripts = Object.entries(tab.scripts || {}).filter(([x]) => !blockedHosts.has(x)).sort((a, b) => b[1] - a[1]).slice(0, 12);
  h += '<div class="sec" style="margin-top:12px"><span>Other sites running scripts</span></div>';
  h += scripts.length ? scripts.map(([x, n]) => `<div class="li"><div>${esc(x)}<small>${S.categoryOf(x) ? 'Known tracker, allowed' : 'Not on our tracker list'} · ${n} script${n > 1 ? 's' : ''}${block.includes(x) ? ' · blocked by you' : allow.includes(x) ? ' · allowed by you' : ''}</small></div><button data-block="${esc(x)}">${block.includes(x) ? 'Unblock' : 'Block'}</button></div>`).join('') : '<p class="mut sm">None.</p>';
  if (allow.length) h += '<div class="sec" style="margin-top:12px"><span>Allowed by you</span></div>' + allow.map((x) => `<div class="li"><div>${esc(x)}</div><button data-unallow="${esc(x)}">Undo</button></div>`).join('');
  $('#log').safeHTML = h;
}

// ---- VPN tab. The only network request in the popup: your address, from vpninsights.com, and only after you open this tab.
async function loadVpn() {
  vpnInfo = { loading: true }; renderVpn();
  try { const r = await fetch(SITE + '/api/tools/ip', { cache: 'no-store' }); const j = await r.json(); vpnInfo = { ip: j.ip, info: j.info || null }; } catch (e) { vpnInfo = { error: true }; }
  renderVpn();
}
function renderVpn() {
  if (!st) return;
  const el = $('#vpnCard'), v = st.settings.vpn || {};
  $('#tVpn').classList.toggle('on', !!v.on); $('#tRtc').classList.toggle('on', !!st.settings.webrtc);
  if (!vpnInfo) { loadVpn(); return; }
  if (vpnInfo.loading) { el.safeHTML = '<p class="mut">Checking your address...</p>'; return; }
  if (vpnInfo.error || !vpnInfo.ip) { el.safeHTML = '<p class="mut">Could not reach vpninsights.com. Check your connection and open this tab again.</p>'; return; }
  const i = vpnInfo.info || {};
  const place = [i.city, i.country].filter(Boolean).join(', ');
  const net = i.org || i.isp || '';
  const kind = i.hosting ? 'Looks like a data-centre network, typical for a VPN' : (net ? 'Looks like a home or mobile network' : '');
  const base = v.baseline;
  const match = !base ? ['na', 'Not set'] : base === vpnInfo.ip ? ['good', 'Matches'] : ['bad', 'Different'];
  el.safeHTML = `<div class="top"><div><small class="mut">Your address right now</small><div class="ip">${esc(vpnInfo.ip)}</div><small class="mut">${esc(place || 'Location unknown')}${net ? ' · ' + esc(net) : ''}</small></div></div>`
    + (kind ? `<small class="mut">${esc(kind)}</small>` : '')
    + `<div class="chk"><div class="good">${ic('check')}Address read</div><div class="${match[0]}">${ic(match[0] === 'bad' ? 'times' : match[0] === 'good' ? 'check' : 'pause')}VPN address: ${match[1]}</div><div class="${st.settings.webrtc ? 'good' : 'na'}">${ic(st.settings.webrtc ? 'check' : 'pause')}Local address ${st.settings.webrtc ? 'hidden' : 'visible'}</div></div>`;
}

async function refresh() {
  const r = await send({ type: 'getState' });
  if (!r) { $('#host').textContent = 'Starting...'; return; }
  st = r;
  try { const t = (await api.tabs.query({ active: true, currentWindow: true }))[0]; url = (t && t.url) || ''; } catch (e) { url = ''; }
  await render();
}
async function change(m, reload) { await send(m); await refresh(); if (reload && st && st.tabId) { try { await api.tabs.reload(st.tabId); } catch (e) { /* tab closed */ } } }
function flash(btn, text) { const s = btn.querySelector('span'); const old = s.textContent; s.textContent = text; setTimeout(() => { s.textContent = old; }, 1800); }

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button,a'); if (!t || !st) return;
  const host = st.host;
  if (t.dataset.tab) { tabName = t.dataset.tab; await render(); return; }
  if (t.id === 'seeAll') { e.preventDefault(); tabName = 'trackers'; await render(); return; }
  if (t.id === 'tPause') return change({ type: 'pause', host, off: st.paused }, true);
  if (t.id === 'tBan') return change({ type: 'settings', patch: { banners: st.settings.banners === false } });
  if (t.id === 'tFp') return change({ type: 'settings', patch: { fingerprint: !st.settings.fingerprint } });
  if (t.id === 'aReport') { e.preventDefault(); api.tabs.create({ url: api.runtime.getURL('report/report.html') }); window.close(); return; }
  if (t.id === 'tGpc') return change({ type: 'settings', patch: { gpc: !st.settings.gpc } });
  if (t.id === 'tRtc') return change({ type: 'settings', patch: { webrtc: !st.settings.webrtc } });
  if (t.id === 'tVpn') return change({ type: 'settings', patch: { vpn: Object.assign({}, st.settings.vpn, { on: !st.settings.vpn.on }) } });
  if (t.id === 'bBase') { await send({ type: 'baseline' }); vpnInfo = null; await refresh(); return; }
  if (t.id === 'bTest') { api.tabs.create({ url: SITE + '/tools/is-my-vpn-working' }); window.close(); return; }
  if (t.dataset.m) return change({ type: 'setSite', host, patch: { js: t.dataset.m === st.settings.jsDefault ? null : t.dataset.m } }, true);
  if (t.id === 'bClean') {
    const clean = S.cleanUrl(url);
    try { await navigator.clipboard.writeText(clean); flash(t, clean === url ? 'Already clean, copied' : 'Clean link copied'); } catch (err) { flash(t, 'Could not copy'); }
    return;
  }
  if (t.id === 'bWipe') {
    if (!t.classList.contains('warn')) { t.classList.add('warn'); t.querySelector('span').textContent = 'Tap again: this signs you out of ' + host; clearTimeout(t._r); t._r = setTimeout(() => { t.classList.remove('warn'); t.querySelector('span').textContent = "Clear this site's data"; }, 4000); return; }
    clearTimeout(t._r); t.classList.remove('warn');
    await send({ type: 'clean', host, everything: true });
    flash(t, 'Cleared. Reloading...');
    try { await api.tabs.reload(st.tabId); } catch (err) { /* tab closed */ }
    return;
  }
  if (t.id === 'bBroken') { $('#broken').hidden = !$('#broken').hidden; return; }
  if (t.dataset.allow) return change({ type: 'domain', host, list: 'allow', domain: t.dataset.allow, on: true }, true);
  if (t.dataset.unallow) return change({ type: 'domain', host, list: 'allow', domain: t.dataset.unallow, on: false }, true);
  if (t.dataset.block) { const on = !(st.cfg.block || []).includes(t.dataset.block); return change({ type: 'domain', host, list: 'block', domain: t.dataset.block, on }, true); }
  if (t.dataset.fix === 'third') return change({ type: 'setSite', host, patch: { js: 'third' } }, true);
  if (t.dataset.fix === 'ten') return change({ type: 'pause', host, minutes: 10 }, true);
  if (t.dataset.fix === 'off') return change({ type: 'pause', host }, true);
  if (t.id === 'bCopy') {
    const text = `Site: ${host}\nBlocked: ${st.tab.count}\nLevel: ${st.settings.level}\nJavaScript: ${st.cfg.js || st.settings.jsDefault}\nExtension: Shield by VPNInsights ${api.runtime.getManifest().version}\nBlocked hosts: ${(st.tab.blocked || []).map((b) => b.h).join(', ') || 'none'}`;
    try { await navigator.clipboard.writeText(text); t.textContent = 'Copied. Paste it in an email to us.'; } catch (err) { t.textContent = 'Could not copy'; }
    return;
  }
  if (t.id === 'bOpts' || t.id === 'aSet') { e.preventDefault(); api.runtime.openOptionsPage(); window.close(); return; }
});
hydrateIcons();
refresh();
