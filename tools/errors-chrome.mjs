// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// Loads the extension into real Chrome, uses it on real sites, then prints the same errors and warnings chrome://extensions shows.
// Run: node tools/errors-chrome.mjs
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const EXT = process.env.EXT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-err-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--enable-unsafe-extension-debugging', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let wsUrl = ''; chrome.stderr.on('data', (d) => { const m = String(d).match(/ws:\/\/\S+/); if (m) wsUrl = m[0]; });
for (let i = 0; i < 60 && !wsUrl; i++) await sleep(250);
const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push(['exception', m.sessionId, m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text]);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push([m.params.type, m.sessionId, m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 300)]);
  if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) logs.push(['log-' + m.params.entry.level, m.sessionId, (m.params.entry.text + ' ' + (m.params.entry.url || '')).slice(0, 300)]);
});
const cdp = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const attach = async (targetId) => { const s = (await cdp('Target.attachToTarget', { targetId, flatten: true })).result.sessionId; await cdp('Runtime.enable', {}, s); await cdp('Log.enable', {}, s); return s; };
const ev = async (s, expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); return r.result?.result?.value; };
const names = {};

const loaded = await cdp('Extensions.loadUnpacked', { path: EXT });
const extId = loaded.result?.id; console.log('loaded', extId || JSON.stringify(loaded));
let sw = null;
for (let i = 0; i < 30 && !sw; i++) { const t = (await cdp('Target.getTargets')).result.targetInfos.filter((x) => x.type === 'service_worker' && x.url.includes(extId)); if (t[0]) sw = t[0]; else await sleep(300); }
const swS = sw ? await attach(sw.targetId) : null; if (swS) names[swS] = 'background';
await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

// use it on real sites
const sites = ['https://news.ycombinator.com/', 'https://www.bbc.com/news', 'https://www.theguardian.com/international', 'https://en.wikipedia.org/wiki/Privacy', 'https://example.com/?utm_source=a&fbclid=b'];
const pages = [];
for (const url of sites) { const t = (await cdp('Target.createTarget', { url })).result.targetId; const s = await attach(t); names[s] = 'page ' + url.slice(8, 30); pages.push({ t, s, url }); await sleep(3500); }
// popup and settings, opened the way the browser opens them
const pop = (await cdp('Target.createTarget', { url: `chrome-extension://${extId}/popup/popup.html` })).result.targetId; const popS = await attach(pop); names[popS] = 'popup'; await sleep(1500);
const optT = (await cdp('Target.createTarget', { url: `chrome-extension://${extId}/options/options.html` })).result.targetId; const optS = await attach(optT); names[optS] = 'options'; await sleep(1500);
const welT = (await cdp('Target.createTarget', { url: `chrome-extension://${extId}/welcome/welcome.html` })).result.targetId; const welS = await attach(welT); names[welS] = 'welcome'; await sleep(800);
// click things in the settings page
await ev(optS, `(async()=>{for(const b of document.querySelectorAll('.tgl[data-key]')){b.click();await new Promise(r=>setTimeout(r,150));}for(const b of document.querySelectorAll('#level button')){b.click();await new Promise(r=>setTimeout(r,200));}document.querySelector('#level button[data-l=standard]').click();})()`);
// drive the background the way the popup does, against a real page's tab
const tabs = await ev(swS, `chrome.tabs.query({}).then(t=>t.map(x=>[x.id,x.url]))`);
await ev(swS, `handle({type:'pause',host:'news.ycombinator.com'})`); await sleep(500);
await ev(swS, `handle({type:'pause',host:'news.ycombinator.com',off:true})`);
await ev(swS, `handle({type:'setSite',host:'www.bbc.com',patch:{js:'third'}})`);
await ev(swS, `handle({type:'setSite',host:'www.bbc.com',patch:{js:'none'}})`);
await ev(swS, `handle({type:'setSite',host:'www.bbc.com',patch:{js:null}})`);
await ev(swS, `handle({type:'settings',patch:{level:'strict'}})`); await sleep(500);
await ev(swS, `handle({type:'settings',patch:{level:'standard'}})`);
await ev(swS, `handle({type:'settings',patch:{vpn:Object.assign({},settings.vpn,{on:true})}})`); await sleep(1500);
await ev(swS, `handle({type:'baseline'})`); await sleep(2000);
await ev(swS, `handle({type:'settings',patch:{vpn:Object.assign({},settings.vpn,{on:false})}})`);
// welcome page buttons
await ev(welS, `(async()=>{for(const b of document.querySelectorAll('#lv button')){b.click();await new Promise(r=>setTimeout(r,250));}})()`);
// the popup, against a real page: make that page the active tab, then use every control
await cdp('Target.activateTarget', { targetId: pages[2].t }); await sleep(700);
await ev(popS, `refresh()`); await sleep(700);
await ev(popS, `(async()=>{const w=()=>new Promise(r=>setTimeout(r,500));for(const sel of ['#bLog','[data-m=third]','[data-m=none]','[data-m=all]','#tGpc','#tGpc','#bBroken','[data-fix=ten]']){const e=document.querySelector(sel);if(e)e.click();await w();}const a=document.querySelector('[data-allow]');if(a){a.click();await w();}const b=document.querySelector('[data-block]');if(b){b.click();await w();}document.querySelector('#tPause').click();await w();document.querySelector('#tPause').click();await w();})()`);
await sleep(1500);
// tab churn: open and close pages quickly while they load, so counters and badges meet closed tabs
for (let i = 0; i < 6; i++) { const t = (await cdp('Target.createTarget', { url: 'https://www.theguardian.com/international' })).result.targetId; await sleep(700); await cdp('Target.closeTarget', { targetId: t }); }
await sleep(1500);
// close a tab, so the tab clean-up runs
for (const p of pages.slice(0, 2)) await cdp('Target.closeTarget', { targetId: p.t });
await sleep(2000);

// what Chrome itself lists as errors and warnings
const ext = (await cdp('Target.createTarget', { url: 'chrome://extensions' })).result.targetId; const extS = await attach(ext); await sleep(2000);
const info = await ev(extS, `chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true}).then(a=>JSON.stringify(a.filter(x=>x.id==='${extId}').map(x=>({manifestErrors:x.manifestErrors.map(e=>e.message),runtimeErrors:x.runtimeErrors.map(e=>({msg:e.message,src:e.source,ctx:e.contextUrl,count:e.occurrences,sev:e.severity})),runtimeWarnings:x.runtimeWarnings}))))`);
console.log('\n== chrome://extensions says ==\n' + (info ? JSON.stringify(JSON.parse(info), null, 1) : '(could not read)'));
console.log('\n== console and exceptions seen ==');
const seen = new Set(); for (const [k, s, m] of logs) { const key = k + (names[s] || s) + m; if (!seen.has(key) && !/ERR_NAME_NOT_RESOLVED|Failed to load resource|favicon|net::ERR/.test(m)) { seen.add(key); console.log(`[${names[s] || '?'}] ${k}: ${m}`); } }
const ours = [...seen].filter((k) => !/^(\w+-?\w*)page /.test(k) && !k.startsWith('warning') ).length;
const bad = JSON.parse(info || '[{}]')[0] || {};
const problems = (bad.manifestErrors || []).length + (bad.runtimeErrors || []).length + [...logs].filter(([k, sid, m]) => names[sid] && !names[sid].startsWith('page') && (k === 'exception' || k === 'error' || k === 'log-error' || /unique ID|Unchecked|Uncaught/.test(m))).length;
console.log(problems ? `\nFAILED: ${problems} problem(s) in the extension` : '\nPASSED: no errors from the extension');
ws.close(); chrome.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(typeof problems === 'number' && problems ? 1 : 0);
