// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// Unit checks for the rule logic and the generated rule files. Run: node tools/test-unit.mjs
import fs from 'fs'; import { createRequire } from 'module'; import assert from 'assert';
const require = createRequire(import.meta.url);
const S = require('../src/shared.js');
const J = (f) => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url)));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// hosts
ok(S.siteOf('www.example.com') === 'example.com', 'siteOf www');
ok(S.siteOf('a.b.example.co.uk') === 'example.co.uk', 'siteOf co.uk');
ok(S.hostOf('https://News.Example.com/x?y=1') === 'news.example.com', 'hostOf');
ok(S.hostOf('chrome://settings') === '', 'hostOf browser page');
const map = { 'doubleclick.net': 'ads' };
ok(S.categoryOf('stats.g.doubleclick.net', map) === 'ads', 'category via parent');
ok(S.categoryOf('example.com', map) === '', 'category none');

// settings
const d = S.mergeSettings(null);
ok(d.gpc && d.blocking && d.params && !d.https && !d.cleanup, 'defaults');
ok(S.mergeSettings({ gpc: false }).gpc === false, 'merge keeps saved');
ok(S.LEVELS.strict.jsDefault === 'third' && S.LEVELS.strict.cleanup, 'strict level');

// dynamic rules
const idsUnique = (rs) => new Set(rs.map((r) => r.id)).size === rs.length;
let s = S.mergeSettings({ sites: { 'a.com': { paused: true }, 'b.com': { js: 'none', allow: ['cdn.x.com'], block: ['y.com'] }, 'c.com': { js: 'third' } } });
let rs = S.buildDynamicRules(s, 1000);
ok(idsUnique(rs), 'unique ids');
ok(rs.some((r) => r.action.type === 'allowAllRequests' && r.condition.requestDomains[0] === 'a.com' && r.priority === 1000), 'paused rule');
ok(rs.some((r) => r.action.type === 'modifyHeaders' && r.condition.requestDomains[0] === 'b.com'), 'CSP rule for block all');
ok(rs.some((r) => r.action.type === 'allow' && r.priority === 900 && r.condition.requestDomains[0] === 'cdn.x.com' && r.condition.initiatorDomains[0] === 'b.com'), 'allow domain');
ok(rs.some((r) => r.action.type === 'block' && r.condition.domainType === 'thirdParty' && r.condition.initiatorDomains[0] === 'c.com'), 'third-party per site');
ok(!rs.some((r) => r.priority === 400), 'no default script rule in standard');
s = S.mergeSettings({ jsDefault: 'third', sites: { 'd.com': { js: 'all' } } });
rs = S.buildDynamicRules(s);
ok(rs.some((r) => r.priority === 400 && r.action.type === 'block') && rs.some((r) => r.priority === 500 && r.action.type === 'allow'), 'strict default plus allow site');
ok(S.buildDynamicRules(S.mergeSettings({ sites: { 'e.com': { paused: true, pausedUntil: 5 } } }), 10).length === 0, 'expired pause ends');
ok(S.isPaused({ paused: true, pausedUntil: 50 }, 10) && !S.isPaused({ paused: true, pausedUntil: 5 }, 10), 'isPaused');

// the static rule files
const VALID = new Set(['block', 'allow', 'allowAllRequests', 'redirect', 'upgradeScheme', 'modifyHeaders']);
for (const f of ['trackers', 'params', 'gpc', 'https', 'referer']) {
  const r = J(`rules/${f}.json`);
  ok(Array.isArray(r) && r.length > 0, f + ' not empty');
  ok(idsUnique(r), f + ' unique ids');
  for (const x of r) {
    ok(VALID.has(x.action.type), f + ' action type');
    ok(Number.isInteger(x.id) && x.id > 0 && Number.isInteger(x.priority), f + ' id and priority');
    if (x.condition.regexFilter) ok(x.condition.regexFilter.length < 2000, f + ' regex under 2KB');
    for (const d of x.condition.requestDomains || []) ok(d === d.toLowerCase() && !/[\s/]/.test(d), f + ' domain ' + d);
  }
}
const t = J('rules/trackers.json'); const all = t.flatMap((r) => r.condition.requestDomains || []);
ok(all.length > 150 && new Set(all).size === all.length, 'tracker domains unique, ' + all.length);
ok(all.includes('google-analytics.com') && all.includes('hotjar.com') && all.includes('doubleclick.net'), 'known trackers present');
ok(!all.some((d) => /^(google|youtube|facebook|twitter|github|cloudflare|gstatic)\.com$/.test(d)), 'no everyday sites blocked');
ok(J('rules/params.json')[0].action.redirect.transform.queryTransform.removeParams.includes('fbclid') && J('rules/params.json').length > 1, 'params list');

// manifest
const m = J('manifest.json');
ok(m.manifest_version === 3 && m.declarative_net_request.rule_resources.length === 6, 'manifest');
for (const r of m.declarative_net_request.rule_resources) ok(fs.existsSync(new URL('../' + r.path, import.meta.url)), 'ruleset file ' + r.path);
for (const p of Object.values(m.icons)) ok(fs.existsSync(new URL('../' + p, import.meta.url)), 'icon ' + p);
ok(!m.background.scripts && !m.browser_specific_settings, 'Chrome manifest has no Firefox-only keys');
for (const p of [m.action.default_popup, m.options_ui.page, m.background.service_worker]) ok(fs.existsSync(new URL('../' + p, import.meta.url)), 'file ' + p);

// Phase 1: company names, clean links, page grade, cookie banner script
const comps = J('data/companies.json'); const cmap = {}; for (const [nm, ds] of Object.entries(comps)) { if (nm.startsWith('_')) continue; for (const d of ds) cmap[d] = cmap[d] || nm; }
ok(S.companyOf('stats.g.doubleclick.net', cmap) === 'Google', 'company via parent domain');
ok(S.companyOf('cdn.example-news.com', cmap) === 'Example news', 'company falls back to the site name');
for (const d of all) ok(!!S.companyOf(d, cmap), 'company for ' + d);
const P = ['utm_source', 'fbclid', 'gclid'];
ok(S.cleanUrl('https://a.com/x?utm_source=n&id=5&fbclid=z', P) === 'https://a.com/x?id=5', 'clean link keeps real parameters');
ok(S.cleanUrl('https://a.com/x?id=5', P) === 'https://a.com/x?id=5', 'clean link leaves a clean link');
ok(S.cleanUrl('chrome://settings', P) === 'chrome://settings', 'clean link ignores browser pages');
ok(S.cleanUrl('https://a.com/?UTM_SOURCE=n', P) === 'https://a.com/', 'clean link is not case sensitive');
const clean0 = S.gradePage({ blocked: [], scripts: {} }, false);
ok(clean0.letter === 'A' && clean0.score === 100, 'grade of a page with no trackers is A');
const many = S.gradePage({ blocked: Array.from({ length: 12 }, (_, i) => ({ h: 'h' + i + '.com', c: i < 3 ? 'replay' : 'ads' })), scripts: {} }, false);
ok(many.letter !== 'A' && many.score < 80, 'grade drops with many trackers: ' + many.letter + ' ' + many.score);
globalThis.SHIELD_CATEGORIES = { 'doubleclick.net': 'ads' };
const leaky = S.gradePage({ blocked: [], scripts: { 'doubleclick.net': 2 } }, false);
ok(leaky.leaked === 1, 'a known tracker that was not blocked is counted');
ok(S.gradePage({ blocked: [], scripts: {} }, true).line.includes('off'), 'grade line when protection is off');
ok(['A', 'B+', 'B', 'C', 'D', 'F'].includes(S.gradePage({ blocked: Array.from({ length: 80 }, (_, i) => ({ h: 'x' + i, c: 'replay' })), scripts: {} }).letter), 'grade always a letter');
ok(S.mergeSettings(null).banners === true, 'banners on by default');
const cb = fs.readFileSync(new URL('../src/cookie-banner.js', import.meta.url), 'utf8');
const WORDS = new Function('return ' + cb.match(/const WORDS = (\/.*\/i);/)[1])();
for (const t of ['Accept all', 'Accept and close', 'Allow all', 'I agree', 'Agree', 'Accept all cookies', 'OK', 'Alle akzeptieren', 'Tout accepter']) ok(!WORDS.test(t), 'banner words never press: ' + t);
for (const t of ['Reject all', 'Only necessary cookies', 'Decline', 'Alle ablehnen', 'Tout refuser', 'Continue without accepting', 'Rechazar todo']) ok(WORDS.test(t), 'banner words press: ' + t);
ok(cb.includes('onetrust-reject-all-handler') && cb.includes('MutationObserver'), 'banner script has known buttons and watches late banners');

// Phase 2: weekly report, streak, tips, breaches, fingerprint shield file
const rp = {};
S.addVisit(rp, '2026-11-09', 'news.example'); S.addVisit(rp, '2026-11-10', 'news.example'); S.addVisit(rp, '2026-11-10', 'shop.example');
S.addBlocked(rp, '2026-11-09', 'news.example', 'ads', 'Google', 10); S.addBlocked(rp, '2026-11-10', 'news.example', 'replay', 'Hotjar', 30); S.addBlocked(rp, '2026-11-10', 'shop.example', 'ads', 'Google', 4); S.addBanner(rp, '2026-11-10');
const w = S.weekSummary(rp, '2026-11-11');
ok(w.blocked === 44 && w.banners === 1 && w.sites === 2, 'week totals ' + JSON.stringify([w.blocked, w.banners, w.sites]));
ok(w.bars.length === 7 && w.bars[w.bars.length - 1].day === '2026-11-11' && w.bars[w.bars.length - 2].n === 34, 'week bars end on the last day');
ok(w.topCompanies[0].name === 'Hotjar' && w.topCompanies[0].n === 30 && w.topCompanies[1].name === 'Google' && w.topCompanies[1].n === 14, 'top companies in order');
ok(w.topSites[0].host === 'news.example' && w.topSites[0].per === 20, 'most tracked site per visit');
ok(S.streakOf(rp, '2026-11-11') === 2, 'streak counts from yesterday when today is empty');
ok(S.streakOf(rp, '2026-11-13') === 0, 'streak is zero after a gap');
S.addBlocked(rp, '2026-11-11', 'news.example', 'ads', 'Google', 1);
ok(S.streakOf(rp, '2026-11-11') === 3, 'streak includes today');
ok(S.shiftDay('2026-03-01', -1) === '2026-02-28' && S.shiftDay('2026-12-31', 1) === '2027-01-01', 'shiftDay crosses month and year');
const old = {}; for (let i = 0; i < 40; i++) S.addBlocked(old, S.shiftDay('2026-01-01', i), 'a', 'ads', 'X', 1);
ok(Object.keys(S.trimReport(old, 30)).length === 30, 'report keeps 30 days');
ok(S.pickTip(w).label.length > 0 && typeof S.pickTip({ blocked: 0, banners: 0, cats: {}, topSites: [] }).text === 'string', 'a tip is always chosen');
ok(S.pickTip({ blocked: 0, banners: 0, cats: { replay: 40 }, topSites: [{ host: 'x.com' }] }).text.includes('x.com'), 'replay tip names the site');
const BR = { 'adobe.com': ['Adobe', 2013, 152445165] };
ok(S.breachFor('account.adobe.com', BR)[1] === 2013 && S.breachFor('example.org', BR) === null, 'breach lookup via parent domain');
const bsrc = fs.readFileSync(new URL('../src/breaches.js', import.meta.url), 'utf8');
ok(/"adobe\.com"/.test(bsrc) && bsrc.length > 10000, 'bundled breach list has known sites');
const fp = fs.readFileSync(new URL('../src/fp-shield.js', import.meta.url), 'utf8');
ok(fp.includes('toDataURL') && fp.includes('hardwareConcurrency') && fp.includes('getChannelData'), 'fingerprint shield covers canvas, hardware and audio');
ok(S.LEVELS.strict.fingerprint === true && S.LEVELS.standard.fingerprint === false && S.mergeSettings(null).weekly === true, 'fingerprint on only in Strict; weekly report on by default');
for (const p of ['report/report.html', 'report/report.js', 'src/fp-shield.js', 'src/cookie-banner.js', 'src/breaches.js']) ok(fs.existsSync(new URL('../' + p, import.meta.url)), 'file ' + p);

// Phase 3: list parsing, custom rules, link unwrapping, AMP rules, password script
const pr = S.parseRuleList('! title\n[Adblock Plus 2.0]\n||ads.example.com^\n@@||ok.example.com^\n0.0.0.0 track.evil.net\n127.0.0.1 localhost\nplain.example.org\n||cdn.x.com/path^\n||a.b.com^$script\n##.banner\nexample.com##.ad\n||c.com^$third-party\n192.168.1.1\nnot a domain');
ok(pr.block.includes('ads.example.com') && pr.block.includes('track.evil.net') && pr.block.includes('plain.example.org') && pr.block.includes('c.com'), 'list parser reads the common forms');
ok(pr.allow.includes('ok.example.com') && !pr.block.includes('localhost') && !pr.block.includes('cdn.x.com') && !pr.block.includes('a.b.com'), 'list parser allows, ignores localhost, paths and unsupported options');
ok(pr.skipped >= 4, 'list parser counts skipped lines (' + pr.skipped + ')');
ok(S.parseRuleList('@@||x.com^\n||x.com^').block.length === 0, 'an allow beats a block for the same domain');
const big = Array.from({ length: 1201 }, (_, i) => 'h' + i + '.example.com');
const cr = S.buildCustomRules({ block: big, allow: ['ok.example.com'] }, 5000);
ok(cr.length === 4 && cr[0].condition.requestDomains.length === 500 && cr[0].priority === 850 && cr[3].priority === 860 && cr[0].id === 5000, 'custom rules are grouped and prioritised');
ok(new Set(cr.map((r) => r.id)).size === cr.length, 'custom rule ids are unique');
ok(S.unwrapUrl('https://www.google.com/url?sa=t&q=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&u=1') === 'https://example.org/a?b=1', 'Google redirect link unwrapped');
ok(S.unwrapUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fnews.example%2Fx&h=AT0') === 'https://news.example/x', 'Facebook redirect link unwrapped');
ok(S.unwrapUrl('https://www.youtube.com/redirect?q=https%3A%2F%2Fa.example%2F&event=video') === 'https://a.example/', 'YouTube redirect link unwrapped');
ok(S.unwrapUrl('https://www.google.com/url?q=javascript:alert(1)') === 'https://www.google.com/url?q=javascript:alert(1)', 'a javascript: target is never followed');
ok(S.unwrapUrl('https://www.google.com/search?q=https%3A%2F%2Fa.example') === 'https://www.google.com/search?q=https%3A%2F%2Fa.example', 'a normal search page is not touched');
ok(S.unwrapUrl('https://example.com/?q=https%3A%2F%2Fb.example') === 'https://example.com/?q=https%3A%2F%2Fb.example', 'other sites are not touched');
const amp = J('rules/amp.json');
ok(amp.length === 2 && new RegExp(amp[0].condition.regexFilter).test('https://www.google.com/amp/s/example.com/a'), 'AMP rule matches the Google AMP address');
ok(new RegExp(amp[1].condition.regexFilter).test('https://www-example-com.cdn.ampproject.org/c/s/www.example.com/a'), 'AMP rule matches the AMP cache address');
ok(S.enabledRulesets({ unwrap: true }).amp === true && S.enabledRulesets({ unwrap: false }).amp === false, 'AMP rules follow the switch');
const pw = fs.readFileSync(new URL('../src/password-check.js', import.meta.url), 'utf8');
ok(pw.includes('SHA-1') && pw.includes('prefix') && !/sendMessage\([^)]*suffix/.test(pw) && !/sendMessage\([^)]*value/.test(pw), 'password script sends only the hash prefix');
ok(S.mergeSettings(null).pwned === false && S.mergeSettings(null).unwrap === true, 'password check is opt in; link unwrapping is on');

// Authorship, licence and the welcome page
ok(m.author === 'VPNInsights' && /vpninsights\.com/.test(m.homepage_url) && m.version === '1.3.3' && m.name.startsWith('Shield by VPNInsights') && m.name.length <= 75 && m.description.length <= 132 && m.short_name === 'Shield', 'manifest names the author, home page and version');
ok(fs.existsSync(new URL('../LICENSE', import.meta.url)) && /VPNInsights/.test(fs.readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')), 'LICENSE names the holder');
ok(/Font Awesome/.test(fs.readFileSync(new URL('../NOTICE.md', import.meta.url), 'utf8')) && /CC BY 4\.0/.test(fs.readFileSync(new URL('../NOTICE.md', import.meta.url), 'utf8')), 'NOTICE credits Font Awesome and Have I Been Pwned');
for (const f of ['src/background.js', 'src/shared.js', 'src/cookie-banner.js', 'src/fp-shield.js', 'src/unwrap-links.js', 'src/password-check.js', 'popup/popup.js', 'options/options.js', 'report/report.js', 'welcome/welcome.js']) ok(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').startsWith('// VPNInsights Shield. Made by VPNInsights'), 'header in ' + f);
const wh = fs.readFileSync(new URL('../welcome/welcome.html', import.meta.url), 'utf8');
ok(/Iam Waqas/.test(wh) && wh.includes('tPwned') && wh.includes('Strict') && wh.includes('Weekly report') && wh.includes('Cookie banners'), 'welcome page covers the levels, the password switch, the report and banners');
const allText = ['src/background.js', 'src/shared.js', 'src/cookie-banner.js', 'src/fp-shield.js', 'popup/popup.js', 'options/options.js', 'report/report.js', 'welcome/welcome.html', 'README.md', 'PRIVACY.md'].map((f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
ok(!/claude|anthropic|chatgpt|openai|copilot|gemini|language model|ai-generated/i.test(allText), 'no AI tool names anywhere in the code or docs');

// No innerHTML assignments in the shipped code (Mozilla flags them); markup goes through src/safe-html.js
for (const f of ['popup/popup.js', 'options/options.js', 'report/report.js', 'welcome/welcome.js', 'src/password-check.js', 'src/background.js', 'src/cookie-banner.js', 'src/unwrap-links.js']) ok(!/\.innerHTML\s*=/.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')), 'no innerHTML assignment in ' + f);
ok(/DOMParser/.test(fs.readFileSync(new URL('../src/safe-html.js', import.meta.url), 'utf8')), 'safe-html parses markup in a separate document');
for (const f of ['popup/popup.html', 'options/options.html', 'report/report.html', 'welcome/welcome.html']) ok(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').includes('src/safe-html.js'), 'safe-html loaded by ' + f);
console.log(`${n} checks passed, ${all.length} tracker domains`);
