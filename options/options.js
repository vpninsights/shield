// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
const api = globalThis.browser || globalThis.chrome;
const $ = (s) => document.querySelector(s);
// The background may still be waking up when this page opens, so try a few times before giving up.
async function send(m) {
  for (let i = 0; i < 5; i++) {
    try { const r = await api.runtime.sendMessage(m); if (r !== undefined) return r; } catch (e) { /* worker not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
let st = null;
const KEYMAP = { jsThird: (s) => s.jsDefault === 'third', vpnOn: (s) => s.vpn.on, banners: (s) => s.banners !== false, unwrap: (s) => s.unwrap !== false };

function render() {
  const s = st.settings;
  document.querySelectorAll('.tgl[data-key]').forEach((b) => { const k = b.dataset.key; b.classList.toggle('on', KEYMAP[k] ? KEYMAP[k](s) : !!s[k]); });
  document.querySelectorAll('#level button').forEach((b) => b.classList.toggle('on', b.dataset.l === s.level));
  $('#keep').value = (s.keep || []).join('\n');
  $('#ver').textContent = api.runtime.getManifest().version;
  const v = s.vpn;
  $('#vpnInfo').textContent = v.baseline ? `Your VPN address is ${v.baseline}. Last seen: ${v.lastIp || 'not checked yet'}.` : 'Connect your VPN, then press the button. You are warned if your address stops matching it.';
  const sites = Object.entries(s.sites);
  $('#sites').safeHTML = sites.length ? sites.map(([h, c]) => {
    const bits = [c.paused ? (c.pausedUntil ? 'Paused for a while' : 'Protection paused') : '', c.js ? ({ all: 'Scripts allowed', third: 'Block other sites\' scripts', none: 'All scripts blocked' })[c.js] : '', (c.allow || []).length ? `${c.allow.length} allowed` : '', (c.block || []).length ? `${c.block.length} blocked` : ''].filter(Boolean).join(' · ');
    return `<div class="site"><div><b>${h}</b><small>${bits}</small></div><button class="btn g" data-rm="${h}">Remove</button></div>`;
  }).join('') : '<p class="mut">No site has its own settings yet.</p>';
}
async function refresh() { const r = await send({ type: 'getState' }); if (!r) return; st = r; render(); }
async function set(patch) { await send({ type: 'settings', patch }); await refresh(); }

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.closest('#nav')) { document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b === t)); document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === t.dataset.p)); return; }
  if (t.dataset.l) return set({ level: t.dataset.l });
  if (t.dataset.key) {
    const k = t.dataset.key; const s = st.settings;
    if (k === 'jsThird') return set({ jsDefault: s.jsDefault === 'third' ? 'all' : 'third', level: 'custom' });
    if (k === 'vpnOn') return set({ vpn: Object.assign({}, s.vpn, { on: !s.vpn.on }) });
    const cleanup = ['gpc', 'webrtc', 'cleanupStorage', 'banners', 'fingerprint', 'weekly', 'pwned', 'unwrap'].includes(k) ? {} : { level: 'custom' };
    return set(Object.assign({ [k]: !s[k] }, cleanup));
  }
  if (t.id === 'saveKeep') return set({ keep: $('#keep').value.split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean) });
  if (t.id === 'setBase') { t.textContent = 'Checking...'; await send({ type: 'baseline' }); t.textContent = 'Use my current address as my VPN address'; return refresh(); }
  if (t.id === 'clrBase') return set({ vpn: Object.assign({}, st.settings.vpn, { baseline: null, lastWarned: null }) });
  if (t.dataset.rm) { await send({ type: 'removeSite', host: t.dataset.rm }); return refresh(); }
  if (t.id === 'exp') {
    const blob = new Blob([JSON.stringify(st.settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vpninsights-shield-settings.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return;
  }
  if (t.id === 'rst') { if (!confirm('Reset all settings and site choices?')) return; await send({ type: 'replace', settings: null }); $('#msg').textContent = 'Settings reset.'; return refresh(); }
});
$('#imp').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); await send({ type: 'replace', settings: j }); $('#msg').textContent = 'Settings imported.'; refresh(); } catch (err) { $('#msg').textContent = 'That file could not be read.'; }
});
refresh();

// ---- custom rules
async function loadCustom() {
  const c = await send({ type: 'customGet' }); if (!c) return;
  if (document.activeElement !== $('#mine')) $('#mine').value = c.mine || '';
  $('#mineInfo').textContent = `${c.mineParsed.block} blocked, ${c.mineParsed.allow} allowed${c.mineParsed.skipped ? ', ' + c.mineParsed.skipped + ' lines skipped' : ''}. ${c.total.toLocaleString()} domains blocked in all.`;
  $('#lists').safeHTML = c.lists.length ? c.lists.map((l) => `<div class="row"><div><b>${String(l.name).replace(/[<>&"]/g, '')}</b><small>${l.block.toLocaleString()} blocked, ${l.allow.toLocaleString()} allowed. Imported ${new Date(l.at).toLocaleDateString()}</small></div><button class="btn g" data-rmlist="${l.id}">Remove</button></div>`).join('') : '<p class="mut sm">None yet.</p>';
}
async function importText(name, text) {
  $('#listMsg').textContent = 'Importing...';
  const r = await send({ type: 'customImport', name, text });
  $('#listMsg').textContent = r && r.ok ? `Imported ${r.block.toLocaleString()} blocked and ${r.allow.toLocaleString()} allowed domains${r.skipped ? ` (${r.skipped.toLocaleString()} lines skipped: they need more than a domain)` : ''}.` : (r && r.error) || 'Could not import that list.';
  loadCustom();
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'saveMine') { t.textContent = 'Saving...'; await send({ type: 'customSave', text: $('#mine').value }); t.textContent = 'Save my rules'; loadCustom(); }
  if (t.dataset.rmlist) { await send({ type: 'customRemove', id: t.dataset.rmlist }); loadCustom(); }
  if (t.id === 'listGo') {
    const url = $('#listUrl').value.trim(); if (!/^https?:\/\//i.test(url)) { $('#listMsg').textContent = 'Enter a web address that starts with https://'; return; }
    try { const r = await fetch(url, { cache: 'no-store', credentials: 'omit' }); if (!r.ok) throw new Error(); importText(new URL(url).hostname + new URL(url).pathname.split('/').pop(), await r.text()); } catch (err) { $('#listMsg').textContent = 'Could not download that address.'; }
  }
});
$('#listFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => importText(f.name, String(rd.result || '')); rd.readAsText(f); e.target.value = ''; });
loadCustom();
