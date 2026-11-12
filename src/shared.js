// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// Shared logic. Plain functions with no browser calls, so they can be tested in Node.
(function (root) {
  const SITE = 'https://vpninsights.com';

  const DEFAULTS = {
    level: 'standard',
    blocking: true,        // ads, trackers, session recorders
    params: true,          // remove tracking parts from links
    https: false,          // open the secure version of a site (off: browsers now have their own HTTPS-first mode)
    referer: false,        // drop the Referer sent to other sites (can break image hotlink checks)
    gpc: true,             // Global Privacy Control
    banners: true,         // decline cookie banners for you
    fingerprint: false,    // hide canvas, audio and hardware probes (on in Strict)
    weekly: true,          // a notification each Monday with last week's numbers
    pwned: false,          // warn when a password you type is in a known breach (opt in; sends 5 characters of a hash to Have I Been Pwned)
    unwrap: true,          // open the real link instead of a search engine or social network's tracking redirect
    webrtc: true,          // hide local addresses from sites
    cleanup: false,        // clear cookies when the last tab of a site closes
    cleanupStorage: false, // and local storage, IndexedDB, caches
    keep: [],              // sites that are never cleaned
    jsDefault: 'all',      // 'all' or 'third' (block scripts from other sites)
    vpn: { on: false, baseline: null, lastIp: null, lastChange: null, lastWarned: null },
    sites: {},             // host -> { paused, pausedUntil, js, allow: [domains], block: [domains] }
    onboarded: false,
  };

  // Levels are presets for the switches above.
  const LEVELS = {
    standard: { blocking: true, params: true, gpc: true, webrtc: true, cleanup: false, jsDefault: 'all', fingerprint: false },
    strict: { blocking: true, params: true, gpc: true, webrtc: true, cleanup: true, jsDefault: 'third', fingerprint: true },
  };

  function mergeSettings(saved) {
    const s = Object.assign({}, DEFAULTS, saved || {});
    s.vpn = Object.assign({}, DEFAULTS.vpn, (saved && saved.vpn) || {});
    s.sites = (saved && saved.sites) || {};
    s.keep = Array.isArray(s.keep) ? s.keep : [];
    return s;
  }

  function hostOf(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''; } catch (e) { return ''; }
  }

  // The site part of a host: example.com for www.example.com. Handles the common two-part endings such as co.uk.
  const TWO = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.in', 'com.br', 'com.mx', 'com.tr', 'co.za', 'com.sg', 'com.hk', 'com.cn', 'com.ar', 'co.kr']);
  function siteOf(host) {
    if (!host || /^[\d.]+$/.test(host) || host.indexOf(':') >= 0) return host;
    const p = host.split('.');
    if (p.length <= 2) return host;
    const last2 = p.slice(-2).join('.');
    return TWO.has(last2) ? p.slice(-3).join('.') : last2;
  }

  // What kind of tracker is this host? Matches the host and any parent domain.
  function categoryOf(host, map) {
    const m = map || (typeof SHIELD_CATEGORIES !== 'undefined' ? SHIELD_CATEGORIES : {});
    let h = host;
    while (h && h.indexOf('.') >= 0) { if (m[h]) return m[h]; h = h.slice(h.indexOf('.') + 1); }
    return '';
  }

  // The company behind a tracker host: "Google" for stats.g.doubleclick.net. A host we do not know shows its own site name.
  function companyOf(host, map) {
    const m = map || (typeof SHIELD_COMPANIES !== 'undefined' ? SHIELD_COMPANIES : {});
    let h = host;
    while (h && h.indexOf('.') >= 0) { if (m[h]) return m[h]; h = h.slice(h.indexOf('.') + 1); }
    const site = siteOf(host || '');
    const name = (site.split('.')[0] || site || '').replace(/[-_]+/g, ' ');
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  }

  // The same link with the tracking parts removed (utm_*, fbclid, gclid and the rest). Anything that is not a web link comes back unchanged.
  function cleanUrl(url, params) {
    const list = new Set((params || (typeof SHIELD_PARAMS !== 'undefined' ? SHIELD_PARAMS : [])).map((x) => x.toLowerCase()));
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return url;
      let changed = false;
      for (const k of [...u.searchParams.keys()]) if (list.has(k.toLowerCase())) { u.searchParams.delete(k); changed = true; }
      return changed ? u.toString() : url;
    } catch (e) { return url; }
  }

  // A plain grade for one page. It rates how much the site tries to track you, so a page that sends many trackers scores low even though they were blocked.
  // Session replay and fingerprinting weigh most. A known tracker that was not blocked weighs more than one that was.
  // d: { blocked: [{h, c}], scripts: {host: n} } as kept by the background for the tab. open: true when protection is off, so nothing was blocked.
  function gradePage(d, open) {
    const blocked = (d && d.blocked) || []; const scripts = (d && d.scripts) || {};
    const W = { replay: 4, fingerprint: 4, ads: 2, analytics: 1.5, social: 1.2, other: 1 };
    let penalty = 0;
    for (const b of blocked) penalty += W[b.c] || 1;
    const blockedHosts = new Set(blocked.map((b) => b.h));
    let leaked = 0, unknown = 0;
    for (const h of Object.keys(scripts)) {
      if (blockedHosts.has(h)) continue;
      if (categoryOf(h)) { leaked++; penalty += 6; } else unknown++;
    }
    penalty += Math.min(unknown, 10) * 0.6;
    const score = Math.max(0, Math.round(100 - penalty));
    const letter = score >= 92 ? 'A' : score >= 85 ? 'B+' : score >= 75 ? 'B' : score >= 62 ? 'C' : score >= 45 ? 'D' : 'F';
    const n = blocked.length;
    const line = open ? 'Protection is off here, so nothing is being blocked.'
      : n === 0 && leaked === 0 ? 'No trackers found on this page so far.'
      : leaked ? `${n} blocked, ${leaked} known tracker${leaked === 1 ? '' : 's'} still running`
      : `${n} tracker${n === 1 ? '' : 's'} blocked, none got through`;
    const word = score >= 92 ? 'Clean page' : score >= 85 ? 'Mostly clean' : score >= 75 ? 'Some tracking' : score >= 62 ? 'A lot of tracking' : 'Heavy tracking';
    return { score, letter, word, line, tried: n, leaked, unknown };
  }

  // ------------------------------------------------------------------ weekly report
  // Per-day record kept on the device only: { 'YYYY-MM-DD': { blocked, banners, cats: {cat: n}, cos: {company: n}, sites: {host: {v: visits, n: blocked}} } }
  const dayKey = (t) => { const d = new Date(t == null ? Date.now() : t); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const dayOf = (r, day) => r[day] || (r[day] = { blocked: 0, banners: 0, cats: {}, cos: {}, sites: {} });
  function addBlocked(r, day, pageHost, cat, company, n) {
    const d = dayOf(r, day); const k = n || 1;
    d.blocked += k; d.cats[cat || 'other'] = (d.cats[cat || 'other'] || 0) + k;
    if (company) d.cos[company] = (d.cos[company] || 0) + k;
    if (pageHost) { const s = d.sites[pageHost] || (d.sites[pageHost] = { v: 0, n: 0 }); s.n += k; }
  }
  function addVisit(r, day, pageHost) { if (!pageHost) return; const d = dayOf(r, day); const s = d.sites[pageHost] || (d.sites[pageHost] = { v: 0, n: 0 }); s.v += 1; }
  function addBanner(r, day) { dayOf(r, day).banners += 1; }
  function trimReport(r, keep) { for (const k of Object.keys(r).sort().slice(0, -(keep || 30))) delete r[k]; return r; }
  const shiftDay = (day, by) => { const [y, m, d] = day.split('-').map(Number); return dayKey(new Date(y, m - 1, d + by).getTime()); };

  // Days in a row, ending today (or yesterday, if today has nothing yet), on which at least one tracker was blocked.
  function streakOf(r, today) {
    let day = today || dayKey(); let n = 0;
    if (!(r[day] && r[day].blocked > 0)) day = shiftDay(day, -1);
    while (r[day] && r[day].blocked > 0) { n++; day = shiftDay(day, -1); }
    return n;
  }

  // The numbers for one week: the 7 days ending on endDay.
  function weekSummary(r, endDay) {
    const end = endDay || dayKey(); const days = []; for (let i = 6; i >= 0; i--) days.push(shiftDay(end, -i));
    let blocked = 0, banners = 0; const cos = {}, sites = {}, cats = {};
    const bars = days.map((day) => {
      const d = r[day]; if (!d) return { day, n: 0 };
      blocked += d.blocked; banners += d.banners || 0;
      for (const [c, n] of Object.entries(d.cos || {})) cos[c] = (cos[c] || 0) + n;
      for (const [c, n] of Object.entries(d.cats || {})) cats[c] = (cats[c] || 0) + n;
      for (const [h, v] of Object.entries(d.sites || {})) { const s = sites[h] || (sites[h] = { v: 0, n: 0 }); s.v += v.v || 0; s.n += v.n || 0; }
      return { day, n: d.blocked };
    });
    const visited = Object.keys(sites).filter((h) => sites[h].v > 0).length;
    const topCompanies = Object.entries(cos).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n }));
    const topSites = Object.entries(sites).filter(([, v]) => v.v > 0 && v.n > 0).map(([host, v]) => ({ host, n: v.n, v: v.v, per: Math.round(v.n / v.v) })).sort((a, b) => b.per - a.per).slice(0, 4);
    return { days, bars, blocked, banners, sites: visited, topCompanies, topSites, cats, streak: streakOf(r, end), from: days[0], to: end };
  }

  // One tip a week, chosen from what the week actually showed. Links go to our Learn guides.
  function pickTip(w) {
    const tracked = (n) => (w.cats && w.cats[n]) || 0;
    if (tracked('replay') >= 10 && w.topSites[0]) return { text: `Session replay recorded your visits to ${w.topSites[0].host} and other sites. Block all scripts on sites you do not trust, or read how replay works.`, label: 'Read the guide', path: '/learn/vpn-leak-test' };
    if (tracked('fingerprint') >= 5) return { text: 'Some sites tried to identify your browser. Turn on the Fingerprint shield in Settings.', label: 'Open settings', path: '' };
    if (w.banners >= 5) return { text: `Shield declined ${w.banners} cookie banners for you this week. Sites also track through logins, so use a unique password for each.`, label: 'Check a password', path: '/tools/password-breach-checker' };
    if (w.blocked >= 100) return { text: 'Blocking trackers hides what you read from advertisers, but not your address. A VPN hides your address from the sites. Check yours is working.', label: 'Test my VPN', path: '/tools/is-my-vpn-working' };
    return { text: 'Check whether your email address appeared in a data breach.', label: 'Check my email', path: '/tools/email-breach-checker' };
  }

  // Is this site on the bundled list of public data breaches? Matches the site name and its parent domains.
  function breachFor(host, map) {
    const m = map || (typeof SHIELD_BREACHES !== 'undefined' ? SHIELD_BREACHES : {});
    let h = host;
    while (h && h.indexOf('.') >= 0) { if (m[h]) return m[h]; h = h.slice(h.indexOf('.') + 1); }
    return null;
  }

  // ------------------------------------------------------------------ custom rules and imported lists
  // Reads a list of domains in the plain forms people share: one domain per line, hosts files ("0.0.0.0 ads.example.com"), and the simple Adblock form
  // ("||ads.example.com^", "@@||ok.example.com^"). Anything that needs more than a domain (paths, wildcards, element hiding) is counted and skipped.
  const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  function parseRuleList(text) {
    const block = new Set(), allow = new Set(); let skipped = 0, lines = 0;
    for (let raw of String(text || '').split(/\r?\n/)) {
      let line = raw.trim(); if (!line) continue; lines++;
      if (line[0] === '!' || line[0] === '[' || (line[0] === '#' && !/^#\s*\S+\.\S+\s*$/.test(line) )) { lines--; continue; }
      if (line[0] === '#') { lines--; continue; }
      let isAllow = false;
      if (line.startsWith('@@')) { isAllow = true; line = line.slice(2); }
      let host = '';
      let m;
      if ((m = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+(\S+)(?:\s+#.*)?$/))) host = m[1];
      else if ((m = line.match(/^\|\|([^\/\^\$\*\|]+)\^?(?:\$([a-z0-9,~-]+))?$/i))) { host = m[1]; const o = m[2]; if (o && !/^(third-party|important|3p)(,(third-party|important|3p))*$/.test(o)) { skipped++; continue; } }
      else if (/^[a-z0-9.-]+$/i.test(line)) host = line;
      else { skipped++; continue; }
      host = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      if (!HOST_RE.test(host) || host === 'localhost') { skipped++; continue; }
      (isAllow ? allow : block).add(host);
    }
    for (const h of allow) block.delete(h);
    return { block: [...block], allow: [...allow], skipped, lines };
  }

  // Turns the saved custom rules into browser rules. Hosts go into groups, because one rule can hold many domains.
  // Priority 850: above the built-in lists (800), below a person's own Allow for one site (900) and a paused site (1000).
  const CHUNK = 500, MAX_DOMAINS = 30000;
  function buildCustomRules(custom, firstId) {
    const rules = []; let id = firstId || 1000;
    const c = custom || {};
    const blocks = [...new Set(c.block || [])].slice(0, MAX_DOMAINS), allows = [...new Set(c.allow || [])].slice(0, MAX_DOMAINS);
    const TYPES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'stylesheet', 'font', 'media', 'websocket', 'other'];
    for (let i = 0; i < blocks.length; i += CHUNK) rules.push({ id: id++, priority: 850, action: { type: 'block' }, condition: { requestDomains: blocks.slice(i, i + CHUNK), resourceTypes: TYPES } });
    for (let i = 0; i < allows.length; i += CHUNK) rules.push({ id: id++, priority: 860, action: { type: 'allow' }, condition: { requestDomains: allows.slice(i, i + CHUNK) } });
    return rules;
  }

  // Search engines and social networks send a click through their own address so they can log it. These pull the real address out.
  const REDIRECTORS = [
    { re: /^(?:www\.)?google\.[a-z.]+$/, path: /^\/url$/, params: ['q', 'url'] },
    { re: /^(?:l|lm)\.facebook\.com$/, path: /^\/l\.php$/, params: ['u'] },
    { re: /^l\.instagram\.com$/, path: /^\/$/, params: ['u'] },
    { re: /^(?:www\.)?youtube\.com$/, path: /^\/redirect$/, params: ['q'] },
    { re: /^out\.reddit\.com$/, path: /^\/.*$/, params: ['url'] },
    { re: /^(?:www\.)?linkedin\.com$/, path: /^\/safety\/go\/?$/, params: ['url'] },
    { re: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, params: ['u', 'url'] },
    { re: /^duckduckgo\.com$/, path: /^\/l\/?$/, params: ['uddg'] },
    { re: /^(?:www\.)?bing\.com$/, path: /^\/ck\/a$/, params: [] },
  ];
  function unwrapUrl(url) {
    try {
      const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return url;
      for (const r of REDIRECTORS) {
        if (!r.re.test(u.hostname) || !r.path.test(u.pathname)) continue;
        for (const k of r.params) {
          const v = u.searchParams.get(k);
          if (v && /^https?:\/\//i.test(v)) { const t = new URL(v); if (t.hostname !== u.hostname) return t.toString(); }
        }
      }
    } catch (e) { /* not a link */ }
    return url;
  }

  function isPaused(cfg, now) {
    if (!cfg || !cfg.paused) return false;
    return !cfg.pausedUntil || cfg.pausedUntil > (now || Date.now());
  }

  // The rules that depend on a person's choices. Higher priority wins:
  // 1000 paused site, 900 a person's own Allow or Block, 800 tracker lists, 500 per-site scripts, 400 default scripts.
  function buildDynamicRules(settings, now) {
    const rules = []; let id = 1;
    const add = (priority, action, condition) => rules.push({ id: id++, priority, action, condition });
    const hosts = Object.keys(settings.sites || {});

    if (settings.jsDefault === 'third') add(400, { type: 'block' }, { resourceTypes: ['script'], domainType: 'thirdParty' });

    for (const h of hosts) {
      const c = settings.sites[h] || {};
      if (isPaused(c, now)) { add(1000, { type: 'allowAllRequests' }, { requestDomains: [h], resourceTypes: ['main_frame', 'sub_frame'] }); continue; }
      const js = c.js || null;
      if (js === 'all' && settings.jsDefault === 'third') add(500, { type: 'allow' }, { resourceTypes: ['script'], initiatorDomains: [h] });
      if (js === 'third' && settings.jsDefault !== 'third') add(500, { type: 'block' }, { resourceTypes: ['script'], domainType: 'thirdParty', initiatorDomains: [h] });
      if (js === 'none') {
        add(500, { type: 'block' }, { resourceTypes: ['script'], initiatorDomains: [h] });
        add(500, { type: 'modifyHeaders', responseHeaders: [{ header: 'Content-Security-Policy', operation: 'append', value: "script-src 'none'" }] }, { requestDomains: [h], resourceTypes: ['main_frame', 'sub_frame'] });
      }
      for (const d of c.allow || []) add(900, { type: 'allow' }, { requestDomains: [d], initiatorDomains: [h] });
      for (const d of c.block || []) add(900, { type: 'block' }, { requestDomains: [d], initiatorDomains: [h], resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other'] });
    }
    return rules;
  }

  // Which of the static rule files should be on.
  function enabledRulesets(s) {
    return { trackers: !!s.blocking, params: !!s.params, gpc: !!s.gpc, https: !!s.https, referer: !!s.referer, amp: !!s.unwrap };
  }

  const api = { SITE, DEFAULTS, LEVELS, mergeSettings, hostOf, siteOf, categoryOf, companyOf, cleanUrl, gradePage, dayKey, addBlocked, addVisit, addBanner, trimReport, shiftDay, streakOf, weekSummary, pickTip, breachFor, parseRuleList, buildCustomRules, unwrapUrl, REDIRECTORS, isPaused, buildDynamicRules, enabledRulesets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Shield = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
