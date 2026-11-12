// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// VPNInsights Shield: background. Runs as a service worker in Chrome, Edge and Brave, and as an event page in Firefox.
if (typeof importScripts === 'function') { try { importScripts('categories.js', 'breaches.js', 'shared.js'); } catch (e) { /* Firefox loads these through manifest scripts */ } }
const api = globalThis.browser || globalThis.chrome;
const S = globalThis.Shield;

// A call that may fail because a tab closed or another change is running. It never throws.
const quiet = (p) => { try { return Promise.resolve(p).catch(() => {}); } catch (e) { return Promise.resolve(); } };

let settings = S.mergeSettings(null);
let ready = null;
// Per-tab record of what happened on the page. Kept in memory and mirrored to session storage so a sleeping worker does not lose it.
let tabData = {};
let tabHost = {};
let saveTimer = null;
// The weekly report data, per day, kept on the device only.
let report = {};
// The person's own rules and imported lists: { mine: 'text', lists: [{ id, name, at, block: [], allow: [] }] }
let custom = { mine: '', lists: [] };
let reportTimer = null;
function saveReport() {
  if (reportTimer) return;
  reportTimer = setTimeout(async () => { reportTimer = null; try { await api.storage.local.set({ report: S.trimReport(report, 30) }); } catch (e) { /* ignore */ } }, 1500);
}

const catLabel = { analytics: 'Analytics', ads: 'Ads', social: 'Social', replay: 'Session replay', fingerprint: 'Fingerprinting', other: 'Other' };

// ------------------------------------------------------------------ storage
async function load() {
  const got = await api.storage.local.get(['settings']);
  settings = S.mergeSettings(got.settings);
  try { report = (await api.storage.local.get(['report'])).report || {}; } catch (e) { report = {}; }
  try { const c = (await api.storage.local.get(['custom'])).custom; custom = c && typeof c === 'object' ? { mine: c.mine || '', lists: Array.isArray(c.lists) ? c.lists : [] } : { mine: '', lists: [] }; } catch (e) { custom = { mine: '', lists: [] }; }
  try {
    const s = await api.storage.session.get(['tabData', 'tabHost']);
    tabData = s.tabData || {}; tabHost = s.tabHost || {};
  } catch (e) { /* session storage not available */ }
}
function init() { if (!ready) ready = load(); return ready; }
async function saveSettings() { await api.storage.local.set({ settings }); }
function persistTabs() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => { saveTimer = null; try { await api.storage.session.set({ tabData, tabHost }); } catch (e) { /* ignore */ } }, 600);
}

// Next Monday at 09:00, local time.
function nextMonday() {
  const d = new Date(); d.setHours(9, 0, 0, 0);
  const add = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.getTime();
}
async function weeklyNote(force) {
  await init();
  if (!settings.weekly && !force) return;
  const w = S.weekSummary(report, S.shiftDay(S.dayKey(), -1));   // the 7 days that ended yesterday
  if (!w.blocked && !force) return;
  quiet(api.notifications.create('weekly', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Your privacy week', message: `${w.blocked.toLocaleString()} trackers blocked on ${w.sites} site${w.sites === 1 ? '' : 's'}.${w.streak > 1 ? ` ${w.streak} days in a row.` : ''} Tap to see your week.` }));
}

// ------------------------------------------------------------------ applying settings
function customMerged() {
  const mine = S.parseRuleList(custom.mine);
  const block = new Set(mine.block), allow = new Set(mine.allow);
  for (const l of custom.lists) { for (const d of l.block || []) block.add(d); for (const d of l.allow || []) allow.add(d); }
  for (const d of allow) block.delete(d);
  return { block: [...block], allow: [...allow] };
}

async function applyRules() {
  const want = S.enabledRulesets(settings);
  try {
    const on = await api.declarativeNetRequest.getEnabledRulesets();
    const enable = Object.keys(want).filter((k) => want[k] && !on.includes(k));
    const disable = Object.keys(want).filter((k) => !want[k] && on.includes(k));
    if (enable.length || disable.length) await api.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
  } catch (e) { console.debug('rulesets', e); }
  try {
    const old = await api.declarativeNetRequest.getDynamicRules();
    await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: S.buildDynamicRules(settings).concat(S.buildCustomRules(customMerged(), 100000)) });
  } catch (e) { console.debug('dynamic rules', e); }
}

async function applyWebRtc() {
  try {
    const p = api.privacy && api.privacy.network && api.privacy.network.webRTCIPHandlingPolicy;
    if (!p) return;
    if (settings.webrtc) await p.set({ value: 'default_public_interface_only' }); else await p.clear({});
  } catch (e) { /* another extension controls it */ }
}

async function applyGpcFlag() {
  try {
    const have = await api.scripting.getRegisteredContentScripts({ ids: ['gpc-flag'] });
    if (settings.gpc && !have.length) await api.scripting.registerContentScripts([{ id: 'gpc-flag', matches: ['<all_urls>'], js: ['src/gpc-flag.js'], runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: true }]);
    if (!settings.gpc && have.length) await api.scripting.unregisterContentScripts({ ids: ['gpc-flag'] });
  } catch (e) { /* older browsers */ }
}

async function applyBanner() {
  try {
    const have = await api.scripting.getRegisteredContentScripts({ ids: ['cookie-banner'] });
    if (settings.banners && !have.length) await api.scripting.registerContentScripts([{ id: 'cookie-banner', matches: ['http://*/*', 'https://*/*'], js: ['src/cookie-banner.js'], runAt: 'document_idle', allFrames: true, persistAcrossSessions: true }]);
    if (!settings.banners && have.length) await api.scripting.unregisterContentScripts({ ids: ['cookie-banner'] });
  } catch (e) { /* older browsers */ }
}

async function applyFingerprint() {
  try {
    const have = await api.scripting.getRegisteredContentScripts({ ids: ['fp-shield'] });
    if (have.length) await api.scripting.unregisterContentScripts({ ids: ['fp-shield'] });
    if (!settings.fingerprint) return;
    // A site the person paused is left out.
    const exclude = Object.entries(settings.sites).filter(([, c]) => S.isPaused(c)).flatMap(([h]) => [`*://${h}/*`]);
    const script = { id: 'fp-shield', matches: ['http://*/*', 'https://*/*'], js: ['src/fp-shield.js'], runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: true };
    if (exclude.length) script.excludeMatches = exclude;
    await api.scripting.registerContentScripts([script]);
  } catch (e) { /* older browsers */ }
}

async function applyPageScripts() {
  const want = [
    ['pwned-check', !!settings.pwned, { id: 'pwned-check', matches: ['http://*/*', 'https://*/*'], js: ['src/password-check.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }],
    ['unwrap-links', settings.unwrap !== false, { id: 'unwrap-links', matches: ['http://*/*', 'https://*/*'], js: ['src/shared.js', 'src/unwrap-links.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true }],
  ];
  for (const [id, on, def] of want) {
    try {
      const have = await api.scripting.getRegisteredContentScripts({ ids: [id] });
      if (on && !have.length) await api.scripting.registerContentScripts([def]);
      if (!on && have.length) await api.scripting.unregisterContentScripts({ ids: [id] });
    } catch (e) { /* older browsers */ }
  }
}

async function applyAlarms() {
  try {
    if (settings.vpn.on) await api.alarms.create('ipcheck', { periodInMinutes: 5, delayInMinutes: 0.1 }); else await api.alarms.clear('ipcheck');
    if (settings.weekly) { if (!(await api.alarms.get('weekly'))) await api.alarms.create('weekly', { when: nextMonday(), periodInMinutes: 7 * 24 * 60 }); } else await api.alarms.clear('weekly');
    // Timed pauses end by themselves.
    for (const [h, c] of Object.entries(settings.sites)) if (c.paused && c.pausedUntil) await api.alarms.create('resume:' + h, { when: Math.max(Date.now() + 1000, c.pausedUntil) });
  } catch (e) { /* ignore */ }
}

// Changes are applied one at a time. A second request waits for the one running, then runs once more, so rules never collide.
let running = null, again = false;
function applyAll() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        await init();
        await applyRules(); await applyWebRtc(); await applyGpcFlag(); await applyBanner(); await applyFingerprint(); await applyPageScripts(); await applyAlarms();
      } while (again);
    } catch (e) { console.debug('apply', e); } finally { running = null; }
  })();
  return running;
}

// ------------------------------------------------------------------ the toolbar badge
function badge(tabId) {
  const d = tabData[tabId]; if (!d) return;
  const host = d.host; const paused = host && S.isPaused(settings.sites[host]);
  const text = paused ? 'off' : d.count ? (d.count > 999 ? '999+' : String(d.count)) : '';
  quiet(api.action.setBadgeText({ tabId, text }));
  quiet(api.action.setBadgeBackgroundColor({ tabId, color: paused ? '#6b6788' : '#6d28d9' }));
}

function record(tabId, url, how) {
  if (tabId < 0) return;
  const d = tabData[tabId] || (tabData[tabId] = { host: '', count: 0, by: {}, blocked: [], scripts: {} });
  const host = S.hostOf(url); if (!host) return;
  if (how === 'blocked') {
    const cat = S.categoryOf(host) || 'other';
    d.count++; d.by[cat] = (d.by[cat] || 0) + 1;
    if (d.blocked.length < 150 && !d.blocked.some((b) => b.h === host)) d.blocked.push({ h: host, c: cat });
    else { const b = d.blocked.find((x) => x.h === host); if (b) b.n = (b.n || 1) + 1; }
    countDay(cat);
    S.addBlocked(report, S.dayKey(), d.host, cat, S.companyOf(host), 1); saveReport();
  } else if (how === 'script') {
    d.scripts[host] = (d.scripts[host] || 0) + 1;
  }
  badge(tabId); persistTabs();
}

async function countDay(cat) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const { stats = {} } = await api.storage.local.get(['stats']);
    stats[day] = stats[day] || {}; stats[day][cat] = (stats[day][cat] || 0) + 1;
    for (const k of Object.keys(stats).sort().slice(0, -14)) delete stats[k];   // keep two weeks
    await api.storage.local.set({ stats });
  } catch (e) { /* ignore */ }
}

// Blocked requests show up as errors. Chrome says ERR_BLOCKED_BY_CLIENT. Firefox says something else, so there we also require a known tracker host.
api.webRequest.onErrorOccurred.addListener((d) => {
  init().then(() => {
    const blocked = d.error === 'net::ERR_BLOCKED_BY_CLIENT' || (/NS_ERROR_(ABORT|FAILURE)/.test(d.error || '') && S.categoryOf(S.hostOf(d.url)));
    if (blocked && d.type !== 'main_frame') record(d.tabId, d.url, 'blocked');
  });
}, { urls: ['<all_urls>'] });

api.webRequest.onBeforeRequest.addListener((d) => {
  const h = S.hostOf(d.url); const t = tabData[d.tabId];
  if (t && h && h !== t.host) record(d.tabId, d.url, 'script');
}, { urls: ['<all_urls>'], types: ['script'] });

// A new page starts a fresh record for the tab.
api.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url || (info.status === 'loading' ? tab.url : '');
  if (!url) return;
  const host = S.hostOf(url);
  if (info.url) {
    tabHost[tabId] = host;
    if (host) { S.addVisit(report, S.dayKey(), host); saveReport(); }
    tabData[tabId] = { host, count: 0, by: {}, blocked: [], scripts: {} };
    quiet(api.action.setBadgeText({ tabId, text: '' }));
    badge(tabId); persistTabs();
  }
});

// ------------------------------------------------------------------ cleanup when the last tab of a site closes
async function cleanSite(site, everything) {
  try {
    const cookies = await api.cookies.getAll({ domain: site });
    for (const c of cookies) {
      const url = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`;
      try { await api.cookies.remove({ url, name: c.name, storeId: c.storeId }); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  if (settings.cleanupStorage || everything) {
    try {
      await api.browsingData.remove({ origins: [`https://${site}`, `https://www.${site}`, `http://${site}`] }, { localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true });
    } catch (e) { /* Firefox does not take origins */ }
  }
}

api.tabs.onRemoved.addListener((tabId) => quiet((async () => {
  await init();
  const host = tabHost[tabId]; delete tabHost[tabId]; delete tabData[tabId]; persistTabs();
  if (!settings.cleanup || !host) return;
  const site = S.siteOf(host);
  if (settings.keep.some((k) => k === host || k === site)) return;
  if (S.isPaused(settings.sites[host]) || S.isPaused(settings.sites[site])) return;
  const open = await api.tabs.query({});
  if (open.some((t) => t.id !== tabId && S.siteOf(S.hostOf(t.url || '')) === site)) return;
  await cleanSite(site);
})()));

// ------------------------------------------------------------------ VPN companion (opt in)
async function checkIp(manual) {
  await init();
  if (!settings.vpn.on && !manual) return null;
  let ip = null;
  try { const r = await fetch(S.SITE + '/api/tools/ip', { cache: 'no-store' }); ip = (await r.json()).ip || null; } catch (e) { return { error: 'offline' }; }
  if (!ip) return { error: 'no address' };
  const v = settings.vpn; const prev = v.lastIp;
  if (prev && ip !== prev) {
    v.lastChange = Date.now();
    const msg = v.baseline && ip !== v.baseline
      ? `Your address is now ${ip}, not your VPN address ${v.baseline}. If your VPN is on, it may have dropped.`
      : `Your address changed from ${prev} to ${ip}.`;
    if (settings.vpn.on && v.lastWarned !== ip) {
      v.lastWarned = ip;
      quiet(api.notifications.create('ipchange', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Your IP address changed', message: msg }));
    }
  }
  v.lastIp = ip; await saveSettings();
  return { ip, baseline: v.baseline };
}

api.notifications.onClicked.addListener((id) => { if (id === 'weekly') { quiet(api.tabs.create({ url: api.runtime.getURL('report/report.html') })); quiet(api.notifications.clear(id)); } });

api.alarms.onAlarm.addListener((a) => quiet((async () => {
  await init();
  if (a.name === 'ipcheck') checkIp(false);
  if (a.name === 'weekly') weeklyNote(false);
  if (a.name.startsWith('resume:')) {
    const h = a.name.slice(7); const c = settings.sites[h];
    if (c && c.paused && c.pausedUntil && c.pausedUntil <= Date.now() + 1500) { c.paused = false; c.pausedUntil = 0; await saveSettings(); await applyAll(); }
  }
})()));

// ------------------------------------------------------------------ password check (opt in)
// The page hashes what you typed and sends only the first 5 characters of the hash here. We ask Have I Been Pwned for every hash that starts the same
// (hundreds of them, so it cannot tell which one is yours) and hand the list back. The page compares the rest of the hash itself.
const pwnedCache = new Map();
async function pwnedRange(prefix) {
  if (!settings.pwned) return { error: 'off' };
  if (!/^[0-9A-F]{5}$/.test(String(prefix))) return { error: 'bad prefix' };
  const hit = pwnedCache.get(prefix);
  if (hit && Date.now() - hit.at < 600000) return { text: hit.text };
  try {
    const r = await fetch('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true' }, cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return { error: 'unavailable' };
    const text = await r.text();
    if (pwnedCache.size > 50) pwnedCache.clear();
    pwnedCache.set(prefix, { at: Date.now(), text });
    return { text };
  } catch (e) { return { error: 'offline' }; }
}

// ------------------------------------------------------------------ messages from the popup and the settings page
function siteCfg(h) { return settings.sites[h] || (settings.sites[h] = {}); }
function tidy(h) { const c = settings.sites[h]; if (c && !c.paused && !c.js && !(c.allow || []).length && !(c.block || []).length) delete settings.sites[h]; }

async function handle(msg, _sender) {
  await init();
  switch (msg.type) {
    case 'getState': {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0] || {}; const host = S.hostOf(tab.url || '');
      const d = tabData[tab.id] || { count: 0, by: {}, blocked: [], scripts: {} };
      const cfg = host ? settings.sites[host] || {} : {};
      const stats = (await api.storage.local.get(['stats'])).stats || {};
      return { tabId: tab.id, host, supported: !!host, settings, cfg, paused: S.isPaused(cfg), tab: d, stats, categories: catLabel };
    }
    case 'setSite': { Object.assign(siteCfg(msg.host), msg.patch); tidy(msg.host); break; }
    case 'pause': {
      const c = siteCfg(msg.host);
      if (msg.minutes) { c.paused = true; c.pausedUntil = Date.now() + msg.minutes * 60000; } else if (msg.off) { c.paused = false; c.pausedUntil = 0; } else { c.paused = true; c.pausedUntil = 0; }
      tidy(msg.host); break;
    }
    case 'domain': {
      const c = siteCfg(msg.host); const key = msg.list;   // 'allow' or 'block'
      const other = key === 'allow' ? 'block' : 'allow';
      c[other] = (c[other] || []).filter((x) => x !== msg.domain);
      c[key] = (c[key] || []).filter((x) => x !== msg.domain);
      if (msg.on) c[key].push(msg.domain);
      tidy(msg.host); break;
    }
    case 'settings': {
      const patch = Object.assign({}, msg.patch);
      if (patch.level && S.LEVELS[patch.level]) Object.assign(settings, S.LEVELS[patch.level]);
      Object.assign(settings, patch);
      break;
    }
    case 'removeSite': { delete settings.sites[msg.host]; break; }
    case 'replace': { settings = S.mergeSettings(msg.settings); break; }
    case 'bannerDeclined': {
      if (!_sender || !_sender.tab || _sender.tab.id < 0) return null;
      const d = tabData[_sender.tab.id] || (tabData[_sender.tab.id] = { host: S.hostOf(_sender.tab.url || ''), count: 0, by: {}, blocked: [], scripts: {} });
      if (!d.banner) { d.banner = true; countDay('banner'); S.addBanner(report, S.dayKey()); saveReport(); persistTabs(); }
      return { ok: true };
    }
    case 'pwnedRange': return pwnedRange(msg.prefix);
    case 'customGet': return { mine: custom.mine, lists: custom.lists.map((l) => ({ id: l.id, name: l.name, at: l.at, block: (l.block || []).length, allow: (l.allow || []).length })), mineParsed: (() => { const r = S.parseRuleList(custom.mine); return { block: r.block.length, allow: r.allow.length, skipped: r.skipped }; })(), total: customMerged().block.length };
    case 'customSave': { custom.mine = String(msg.text || '').slice(0, 200000); await api.storage.local.set({ custom }); await applyAll(); return { ok: true }; }
    case 'customImport': {
      const r = S.parseRuleList(msg.text);
      if (!r.block.length && !r.allow.length) return { error: 'No domains found in that list.', skipped: r.skipped };
      const total = customMerged().block.length + r.block.length;
      if (total > 30000) return { error: 'That would pass the limit of 30,000 blocked domains. Remove a list first.' };
      custom.lists = custom.lists.filter((l) => l.name !== msg.name).concat([{ id: Date.now().toString(36), name: String(msg.name || 'List').slice(0, 60), at: Date.now(), block: r.block, allow: r.allow }]);
      await api.storage.local.set({ custom }); await applyAll();
      return { ok: true, block: r.block.length, allow: r.allow.length, skipped: r.skipped };
    }
    case 'customRemove': { custom.lists = custom.lists.filter((l) => l.id !== msg.id); await api.storage.local.set({ custom }); await applyAll(); return { ok: true }; }
    case 'getReport': return { report, settings };
    case 'weeklyTest': await weeklyNote(true); return { ok: true };
    case 'checkIp': return checkIp(true);
    case 'baseline': { const r = await checkIp(true); if (r && r.ip) { settings.vpn.baseline = r.ip; settings.vpn.lastIp = r.ip; settings.vpn.lastWarned = null; } break; }
    case 'clean': { await cleanSite(S.siteOf(msg.host), !!msg.everything); return { ok: true }; }
    default: return null;
  }
  await saveSettings(); await applyAll();
  return { ok: true, settings };
}

api.runtime.onMessage.addListener((msg, sender, send) => { handle(msg, sender).then(send, (e) => send({ error: String(e) })); return true; });

// ------------------------------------------------------------------ install and start up
api.runtime.onInstalled.addListener((d) => quiet((async () => {
  await init();
  const got = await api.storage.local.get(['settings']);
  if (!got.settings) { settings = S.mergeSettings(null); await saveSettings(); }
  await applyAll();
  if (d.reason === 'install') quiet(api.tabs.create({ url: api.runtime.getURL('welcome/welcome.html') }));
})()));
api.runtime.onStartup.addListener(() => quiet(applyAll()));
api.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings && ready) { settings = S.mergeSettings(ch.settings.newValue); quiet(applyAll()); } });
init().then(() => applyAll()).catch(() => {});
