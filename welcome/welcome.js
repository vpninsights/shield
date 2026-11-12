// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// The welcome page: pick a level, switch on the password warning, open settings.
const api = globalThis.browser || globalThis.chrome;
const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-ic]').forEach((el) => { el.safeHTML = ic(el.dataset.ic); });

async function send(m) {
  for (let i = 0; i < 5; i++) {
    try { const r = await api.runtime.sendMessage(m); if (r !== undefined) return r; } catch (e) { /* the background is waking up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
function show(settings) {
  document.querySelectorAll('#lv button').forEach((b) => b.classList.toggle('on', b.dataset.l === (settings.level === 'strict' ? 'strict' : 'standard')));
  $('#tPwned').classList.toggle('on', !!settings.pwned);
}
(async () => { const st = await send({ type: 'getState' }); if (st && st.settings) show(st.settings); })();

document.querySelectorAll('#lv button').forEach((b) => {
  b.onclick = async () => { const r = await send({ type: 'settings', patch: { level: b.dataset.l, onboarded: true } }); if (r && r.settings) show(r.settings); };
});
$('#tPwned').onclick = async () => {
  const on = !$('#tPwned').classList.contains('on');
  const r = await send({ type: 'settings', patch: { pwned: on, onboarded: true } });
  if (r && r.settings) show(r.settings);
};
$('#aOpts').onclick = (e) => { e.preventDefault(); api.runtime.openOptionsPage(); };
