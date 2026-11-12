// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// Loads the extension into a real headless Chrome and checks what it does. Run: node tools/test-chrome.mjs
import { spawn } from 'child_process'; import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const EXT = process.env.EXT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// A tiny site that records what the browser sends it.
const seen = [];
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, gpc: req.headers['sec-gpc'] });
  if (req.url.startsWith('/a.js')) { res.setHeader('content-type', 'text/javascript'); return res.end('window.ranScript = true;'); }
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/banner')) {
    const box = '<div id="cookie-consent-box" class="cookie-banner"><p>We use cookies</p><button id="acc" onclick="window.__choice=\'accept\'">Accept all</button><button id="onetrust-reject-all-handler" onclick="window.__choice=\'reject\'">Reject all</button></div>';
    return res.end('<!doctype html><title>b</title><p>page</p>' + (req.url.startsWith('/banner-late') ? '<script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend",' + JSON.stringify(box) + ')},1500)</script>' : box));
  }
  if (req.url.startsWith('/textonly')) return res.end('<!doctype html><title>t</title><div class="privacy-notice"><button onclick="window.__choice=\'accept\'">Accept and close</button><button onclick="window.__choice=\'reject\'">Only necessary cookies</button></div>');
  if (req.url.startsWith('/links')) return res.end('<!doctype html><title>l</title><a id="g" href="https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&sa=U" ping="https://t.example/p">g</a><a id="n" href="https://example.net/plain">n</a>');
  if (req.url.startsWith('/pw')) return res.end('<!doctype html><title>p</title><form><input id="pw" type="password"></form>');
  if (req.url.startsWith('/decoy')) return res.end('<!doctype html><title>d</title><form><button type="button" onclick="window.__choice=\'decoy\'">Decline</button></form>');
  res.end('<!doctype html><title>t</title><script src="/a.js"></script><p>hello</p>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port; const BASE = `http://localhost:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--enable-unsafe-extension-debugging', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = ''; chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/\S+/); if (m) wsUrl = m[0]; });
for (let i = 0; i < 60 && !wsUrl; i++) await sleep(250);
if (!wsUrl) { console.log('Chrome did not start'); chrome.kill(); process.exit(2); }

const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const evalIn = async (sessionId, expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails)); return r.result?.result?.value; };

const loaded = await cdp('Extensions.loadUnpacked', { path: EXT });
console.log('  loadUnpacked ->', JSON.stringify(loaded.result || loaded.error));
// the extension's worker. Chrome also runs its own built-in extensions, so pick ours by name.
let sw = null, swS = '';
for (let i = 0; i < 40 && !sw; i++) {
  const t = (await cdp('Target.getTargets')).result.targetInfos.filter((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'));
  for (const x of t) {
    const s = (await cdp('Target.attachToTarget', { targetId: x.targetId, flatten: true })).result.sessionId;
    const name = await evalIn(s, 'chrome.runtime.getManifest().name').catch(() => '');
    if (name === 'Shield by VPNInsights: Tracker & Cookie Banner Blocker') { sw = x; swS = s; break; }
  }
  if (!sw) await sleep(400);
}
ok(!!sw, 'extension service worker started');
if (!sw) { chrome.kill(); server.close(); process.exit(1); }
await sleep(1500);
const sv = (e) => evalIn(swS, e);

console.log('Rulesets and settings');
const enabled = await sv('chrome.declarativeNetRequest.getEnabledRulesets()');
ok(['trackers', 'params', 'gpc', 'amp'].every((x) => enabled.includes(x)) && !enabled.includes('https') && !enabled.includes('referer'), 'default rulesets: ' + enabled.join(','));

const openPage = async (url) => { const t = (await cdp('Target.createTarget', { url })).result.targetId; const s = (await cdp('Target.attachToTarget', { targetId: t, flatten: true })).result.sessionId; await sleep(1500); return { t, s }; };
const probe = (s) => evalIn(s, `Promise.allSettled([fetch('https://www.google-analytics.com/analytics.js',{mode:'no-cors',cache:'no-store'}),fetch('https://static.hotjar.com/c/hotjar-1.js',{mode:'no-cors',cache:'no-store'}),fetch('https://www.gstatic.com/generate_204',{mode:'no-cors',cache:'no-store'})]).then(r=>r.map(x=>x.status))`);

console.log('Blocking, the privacy signal and link cleaning');
seen.length = 0;
console.log('  match test:', JSON.stringify(await sv(`chrome.declarativeNetRequest.testMatchOutcome({url:'${BASE}/?utm_source=spam&keep=1',type:'main_frame'})`)));
let pg = await openPage(`${BASE}/?utm_source=spam&keep=1&fbclid=abc`);
ok(seen.length && seen.every((r) => !/utm_source|fbclid/.test(r.url)), 'tracking parts removed from the link (server saw ' + (seen[0] && seen[0].url) + ')');
ok(seen.some((r) => r.gpc === '1'), 'Sec-GPC: 1 sent with requests');
const r1 = await probe(pg.s);
ok(r1[0] === 'rejected' && r1[1] === 'rejected', 'Google Analytics and Hotjar blocked (' + r1.join(',') + ')');
ok(r1[2] === 'fulfilled', 'a normal site still loads (control request ' + r1[2] + ')');
await sleep(800);
const cnt = await sv(`Object.values(tabData).reduce((n,d)=>n+d.count,0)`);
ok(cnt >= 2, 'blocked requests are counted (' + cnt + ')');
const pageGpc = await evalIn(pg.s, 'navigator.globalPrivacyControl');
ok(pageGpc === true, 'navigator.globalPrivacyControl is true in the page');

console.log('Pausing a site');
await sv(`handle({type:'pause',host:'localhost'})`); await sleep(800);
pg = await openPage(`${BASE}/?paused=1`);
const r2 = await probe(pg.s);
ok(r2[0] === 'fulfilled' && r2[1] === 'fulfilled', 'protection off for the site: trackers load (' + r2.join(',') + ')');
await sv(`handle({type:'pause',host:'localhost',off:true})`); await sleep(800);
pg = await openPage(`${BASE}/?on=1`);
const r3 = await probe(pg.s);
ok(r3[0] === 'rejected', 'protection back on: blocked again');

console.log('Allow and block one domain');
await sv(`handle({type:'domain',host:'localhost',list:'allow',domain:'google-analytics.com',on:true})`); await sleep(800);
const r4 = await probe(pg.s);
ok(r4[0] === 'fulfilled' && r4[1] === 'rejected', 'one tracker allowed on this site, the other still blocked (' + r4.join(',') + ')');
await sv(`handle({type:'domain',host:'localhost',list:'allow',domain:'google-analytics.com',on:false})`);

console.log('JavaScript control');
await sv(`handle({type:'setSite',host:'localhost',patch:{js:'none'}})`); await sleep(800);
pg = await openPage(`${BASE}/`);
ok((await evalIn(pg.s, 'window.ranScript === true')) === false, 'block all: the site\'s own script did not run');
await sv(`handle({type:'setSite',host:'localhost',patch:{js:null}})`); await sleep(800);
pg = await openPage(`${BASE}/?again=1`);
ok((await evalIn(pg.s, 'window.ranScript === true')) === true, 'allow all: the script runs again');

console.log('Strict level and cleanup');
await sv(`handle({type:'settings',patch:{level:'strict'}})`); await sleep(800);
const st = await sv(`settings`);
ok(st.jsDefault === 'third' && st.cleanup === true, 'strict level sets third-party scripts and cleanup');
await sv(`handle({type:'settings',patch:{level:'standard'}})`);
await evalIn(pg.s, `document.cookie='shield_test=1; path=/'`);
const before = await sv(`chrome.cookies.getAll({domain:'localhost'}).then(c=>c.length)`);
await sv(`cleanSite('localhost')`); await sleep(500);
const after = await sv(`chrome.cookies.getAll({domain:'localhost'}).then(c=>c.length)`);
ok(before >= 1 && after === 0, `cookies cleared (${before} to ${after})`);


console.log('Cookie banners');
await sv(`handle({type:'settings',patch:{banners:true}})`); await sleep(1200);
let bp = await openPage(`${BASE}/banner`); await sleep(1500);
ok((await evalIn(bp.s, 'window.__choice')) === 'reject', 'a known consent button is pressed to reject');
bp = await openPage(`${BASE}/banner-late`); await sleep(4000);
ok((await evalIn(bp.s, 'window.__choice')) === 'reject', 'a banner that appears late is declined');
bp = await openPage(`${BASE}/textonly`); await sleep(1500);
ok((await evalIn(bp.s, 'window.__choice')) === 'reject', 'a consent box with only text buttons: "only necessary" is pressed, "accept" is not');
bp = await openPage(`${BASE}/decoy`); await sleep(1500);
ok((await evalIn(bp.s, 'window.__choice')) === undefined, 'a "Decline" button outside a consent box is left alone');
const declined = await sv(`Object.values(tabData).some(d=>d.banner===true)`);
ok(declined === true, 'the popup data records that a banner was declined');
await sv(`handle({type:'settings',patch:{banners:false}})`); await sleep(1500);
bp = await openPage(`${BASE}/banner`); await sleep(1500);
ok((await evalIn(bp.s, 'window.__choice')) === undefined, 'with the switch off nothing is pressed');
await sv(`handle({type:'settings',patch:{banners:true}})`); await sleep(1200);

console.log('Fingerprint shield and weekly report');
const canvasJs = `(()=>{const c=document.createElement('canvas');c.width=200;c.height=60;const x=c.getContext('2d');x.fillStyle='#f60';x.fillRect(10,10,100,40);x.fillStyle='#069';x.font='16px Arial';x.fillText('Shield fingerprint test',12,32);return c.toDataURL()})()`;
let fpOff = await openPage(`${BASE}/?fp=off`);
const offA = await evalIn(fpOff.s, canvasJs), offB = await evalIn(fpOff.s, canvasJs);
ok(offA === offB, 'shield off: the same drawing reads back the same each time');
await sv(`handle({type:'settings',patch:{fingerprint:true}})`); await sleep(1500);
const fpOn = await openPage(`${BASE}/?fp=on`);
const onA = await evalIn(fpOn.s, canvasJs);
ok(onA !== offA, 'shield on: the canvas reading is different from the plain one');
const fpOn2 = await openPage(`${BASE}/?fp=on2`);
const onB = await evalIn(fpOn2.s, canvasJs);
ok(onA !== onB, 'shield on: a new page load gives a new reading, so it cannot be used to follow you');
ok((await evalIn(fpOn.s, 'navigator.hardwareConcurrency')) === 4, 'shield on: common hardware number reported');
ok((await evalIn(fpOn.s, `(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,20,20);const d=x.getImageData(0,0,20,20).data;return d[0]>=250&&d[1]<=3&&d[2]<=3})()`)) === true, 'shield on: colours still look right (changes are invisible)');
await sv(`handle({type:'pause',host:'localhost'})`); await sleep(1500);
const fpPaused = await openPage(`${BASE}/?fp=paused`);
ok((await evalIn(fpPaused.s, canvasJs)) === offA, 'a paused site is left alone by the shield');
await sv(`handle({type:'pause',host:'localhost',off:true})`);
await sv(`handle({type:'settings',patch:{fingerprint:false}})`); await sleep(1200);
const rep = await sv(`Object.values(report).reduce((n,d)=>n+d.blocked,0)`);
ok(rep >= 2, 'the weekly report counted blocked trackers (' + rep + ')');
const repHosts = await sv(`Object.values(report).some(d=>Object.values(d.sites).some(s=>s.v>0))`);
ok(repHosts === true, 'the weekly report counted visits');
const wk = await sv(`handle({type:'weeklyTest'})`);
ok(wk && wk.ok === true, 'the Monday notification can be built');
const rpt = await openPage(`chrome-extension://${new URL(sw.url).host}/report/report.html`); await sleep(1200);
const kp = await evalIn(rpt.s, `document.querySelectorAll('#kpis .kpi').length`);
ok(kp === 4, 'report page shows its four numbers');
ok((await evalIn(rpt.s, `document.querySelectorAll('#bars div').length`)) === 7, 'report page shows seven days');
ok(/\d/.test(await evalIn(rpt.s, `document.querySelector('#kpis b').textContent`)), 'report page shows a real number');
const img = await evalIn(rpt.s, `(()=>{const c=makeImage();return c.width+'x'+c.height+':'+(c.toDataURL('image/png').length>5000)})()`);
ok(img === '1200x630:true', 'share image is made (' + img + ')');

console.log('Custom rules, link unwrapping, AMP and the password check');
const cs = await sv(`handle({type:'customSave',text:'||custom-blocked.example^\\n@@||custom-ok.example^\\nlisted.example'})`); await sleep(1500);
const m1 = await sv(`chrome.declarativeNetRequest.testMatchOutcome({url:'https://custom-blocked.example/x.js',type:'script',initiator:'${BASE}'})`);
ok(m1.matchedRules.some((r) => r.rulesetId === '_dynamic'), 'a domain in My rules is blocked');
const m2 = await sv(`chrome.declarativeNetRequest.testMatchOutcome({url:'https://www.google-analytics.com/a.js',type:'script',initiator:'${BASE}'})`);
ok(m2.matchedRules.length > 0, 'built-in blocking still works with custom rules on');
const imp = await sv(`handle({type:'customImport',name:'test list',text:'0.0.0.0 imported-ad.example\\n0.0.0.0 imported-two.example\\n! x'})`); await sleep(1500);
ok(imp.ok === true && imp.block === 2, 'a list can be imported (' + JSON.stringify(imp) + ')');
const m3 = await sv(`chrome.declarativeNetRequest.testMatchOutcome({url:'https://imported-ad.example/p.gif',type:'image',initiator:'${BASE}'})`);
ok(m3.matchedRules.some((r) => r.rulesetId === '_dynamic'), 'a domain from an imported list is blocked');
const got = await sv(`handle({type:'customGet'})`);
ok(got.lists.length === 1 && got.total >= 4, 'imported list is listed with the total (' + got.total + ')');
await sv(`handle({type:'customRemove',id:custom.lists[0].id})`); await sleep(1500);
const m4 = await sv(`chrome.declarativeNetRequest.testMatchOutcome({url:'https://imported-ad.example/p.gif',type:'image',initiator:'${BASE}'})`);
ok(!m4.matchedRules.some((r) => r.rulesetId === '_dynamic'), 'removing a list unblocks its domains');
await sv(`handle({type:'customSave',text:''})`); await sleep(800);

const amp1 = await sv(`chrome.declarativeNetRequest.testMatchOutcome({url:'https://www.google.com/amp/s/example.com/story',type:'main_frame'})`);
ok(amp1.matchedRules.some((r) => r.rulesetId === 'amp'), 'a Google AMP address is redirected');

const lk = await openPage(`${BASE}/links`); await sleep(1500);
await evalIn(lk.s, `document.getElementById('g').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
ok((await evalIn(lk.s, `document.getElementById('g').href`)) === 'https://example.org/a?b=1', 'a Google tracking link opens the real address');
ok((await evalIn(lk.s, `document.getElementById('g').hasAttribute('ping')`)) === false, 'the ping attribute is removed');
await evalIn(lk.s, `document.getElementById('n').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
ok((await evalIn(lk.s, `document.getElementById('n').href`)) === 'https://example.net/plain', 'a normal link is left alone');

const sent = [];
await sv(`globalThis.__fetchLog=[];globalThis.__realFetch=globalThis.fetch;globalThis.fetch=async(u)=>{globalThis.__fetchLog.push(String(u));return {ok:true,text:async()=>'0018A45C4D1DEF81644B54AB7F969B88D65:3\\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'}}`);
const off = await sv(`pwnedRange('5BAA6')`);
ok(off && off.error === 'off', 'password lookup is refused while the setting is off');
await sv(`handle({type:'settings',patch:{pwned:true}})`); await sleep(1500);
let pwp = await openPage(`${BASE}/pw`); await sleep(1200);
await evalIn(pwp.s, `(()=>{const i=document.getElementById('pw');i.value='password';i.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(1800);
ok((await evalIn(pwp.s, `!!document.getElementById('shield-pwned-host')`)) === true, 'a known breached password shows the warning');
ok((await evalIn(pwp.s, `document.getElementById('shield-pwned-host').shadowRoot.textContent.includes('3,861,493')`)) === true, 'the warning shows how many breaches');
const log = await sv(`globalThis.__fetchLog`);
ok(log.length >= 1 && log.every((u) => u === 'https://api.pwnedpasswords.com/range/5BAA6'), 'only the 5-character hash prefix was sent (' + log.join(',') + ')');
ok(!log.join('').replace('pwnedpasswords','').toLowerCase().includes('password') && !log.join('').includes('1E4C9B93'), 'neither the password nor the rest of its hash was sent');
pwp = await openPage(`${BASE}/pw`); await sleep(1200);
await evalIn(pwp.s, `(()=>{const i=document.getElementById('pw');i.value='Zq7!vK2#pL9wXt4Rm';i.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(1800);
ok((await evalIn(pwp.s, `!!document.getElementById('shield-pwned-host')`)) === false, 'a password that is not in the list shows no warning');
await sv(`globalThis.fetch=globalThis.__realFetch`);
await sv(`handle({type:'settings',patch:{pwned:false}})`); await sleep(1200);

console.log('Welcome page');
const wel = await openPage(`chrome-extension://${new URL(sw.url).host}/welcome/welcome.html`); await sleep(1500);
ok((await evalIn(wel.s, `document.querySelectorAll('.tour .t').length`)) === 6, 'welcome page shows the six-item tour');
ok((await evalIn(wel.s, `document.querySelectorAll('.tour .ic svg').length`)) === 6, 'welcome page icons are drawn');
ok((await evalIn(wel.s, `document.body.textContent.includes('Iam Waqas')`)) === true, 'welcome page names the author');
ok((await evalIn(wel.s, `document.getElementById('tPwned').classList.contains('on')`)) === false, 'password warning starts off');
await evalIn(wel.s, `document.getElementById('tPwned').click()`); await sleep(1200);
ok((await sv(`settings.pwned`)) === true && (await evalIn(wel.s, `document.getElementById('tPwned').classList.contains('on')`)) === true, 'the welcome page switch turns the password warning on');
await evalIn(wel.s, `document.getElementById('tPwned').click()`); await sleep(1000);
await evalIn(wel.s, `document.querySelector('#lv [data-l=strict]').click()`); await sleep(1500);
const lv = await sv(`[settings.level, settings.jsDefault, settings.fingerprint, settings.cleanup]`);
ok(lv[0] === 'strict' && lv[1] === 'third' && lv[2] === true && lv[3] === true, 'Strict from the welcome page: third-party scripts, fingerprint shield and cleanup (' + lv.join(',') + ')');
await evalIn(wel.s, `document.querySelector('#lv [data-l=standard]').click()`); await sleep(1500);
ok((await sv(`settings.level`)) === 'standard' && (await sv(`settings.fingerprint`)) === false, 'Standard from the welcome page turns those back off');
const about = await openPage(`chrome-extension://${new URL(sw.url).host}/options/options.html`); await sleep(1000);
ok((await evalIn(about.s, `document.body.textContent.includes('Author: Iam Waqas')`)) === true, 'the settings About page names the author');
ok((await sv(`chrome.runtime.getManifest().author`)) === 'VPNInsights', 'the extension reports its author');
console.log('WebRTC and pages');
const rtc = await sv(`chrome.privacy.network.webRTCIPHandlingPolicy.get({}).then(x=>x.value)`);
ok(rtc === 'default_public_interface_only', 'WebRTC address handling set (' + rtc + ')');
const popup = await openPage(`chrome-extension://${new URL(sw.url).host}/popup/popup.html`);
const state = await evalIn(popup.s, `document.getElementById('state').textContent`);
ok(typeof state === 'string' && state.length > 0 && state !== '...', 'popup opens and shows a state (' + state + ')');
ok((await evalIn(popup.s, `document.querySelectorAll('#tabs button').length`)) === 3, 'popup has the Shield, Trackers and VPN tabs');
const opt = await openPage(`chrome-extension://${new URL(sw.url).host}/options/options.html`);
ok((await evalIn(opt.s, `document.querySelectorAll('.tgl[data-key]').length`)) >= 8, 'settings page shows its switches');

console.log(`\n${pass} passed, ${fail} failed`);
ws.close(); chrome.kill(); server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Chrome still closing */ }
process.exit(fail ? 1 : 0);
