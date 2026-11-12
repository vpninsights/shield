// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// VPNInsights Shield: declines cookie banners for you. Runs in every page, in the page's own isolated world.
// It only ever presses a "reject" or "necessary only" button, never "accept". It stops after the first banner it declines, or after 12 seconds.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  let done = false;

  // Buttons that the common consent tools use for "reject all". Checked first because they are exact.
  const SELECTORS = [
    '#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', 'button.ot-bnr-reject-all',
    '#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '#didomi-notice-disagree-button', '.didomi-continue-without-agreeing',
    '[data-testid="uc-deny-all-button"]', 'button[data-action="deny"]',
    '.cky-btn-reject', '.cmplz-deny', '.iubenda-cs-reject-btn', '.osano-cm-denyAll', '.cm-btn-decline',
    '#cn-refuse-cookie', '#ccc-reject-settings', '.cc-deny', '.cc-btn.cc-dismiss[data-role="necessary"]',
    '[data-tid="banner-decline"]', '#truste-consent-required', '#sp-cc-rejectall-link',
    'button[title="Reject All"]', 'button[aria-label="Reject all"]', 'button[aria-label="Reject All"]',
    '.qc-cmp2-summary-buttons button[mode="secondary"]', '#cookie-reject', '#cookies-reject', '.cookie-reject',
    '.js-cookie-reject', '.cookie-consent-reject', 'button#reject-all', 'button.reject-all',
  ];

  // Words for "reject" in the languages we see most. The whole button text must be one of these, so "Accept and close" never matches.
  const WORDS = /^(reject all( cookies)?|reject( non[- ]essential)?( cookies)?|decline( all)?( cookies)?|deny( all)?|refuse( all)?|only (necessary|essential|required)( cookies)?|necessary (cookies )?only|essential (cookies )?only|continue without (accepting|agreeing)|no,? thanks|i do not accept|do not accept|disagree|alle ablehnen|ablehnen|nur notwendige( cookies)?|nur essenzielle( cookies)?|tout refuser|refuser( tout)?|continuer sans accepter|rechazar( todo| todas)?|solo necesarias|rifiuta( tutto| tutti)?|solo necessari|alles weigeren|weigeren|alleen noodzakelijke|rejeitar( tudo| todos)?|recusar( tudo| todos)?|odrzuć( wszystkie)?|avvisa alla|afvis alle|avslå alle)\.?$/i;

  // Only buttons inside something that looks like a consent box are considered. This keeps us away from a "Decline" button elsewhere on a page.
  const BOX = /cookie|consent|gdpr|cmp|privacy|banner|didomi|onetrust|usercentrics|cookiebot|sp_message|truste|quantcast|osano|iubenda/i;
  function inBox(el) {
    for (let e = el, i = 0; e && i < 8; e = e.parentElement, i++) {
      if (BOX.test((e.id || '') + ' ' + (typeof e.className === 'string' ? e.className : '') + ' ' + (e.getAttribute && e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute && e.getAttribute('role') || ''))) return true;
      if (e.getAttribute && e.getAttribute('role') === 'dialog' && BOX.test((e.textContent || '').slice(0, 400))) return true;
    }
    return false;
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };

  function find() {
    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (el && visible(el)) return el;
    }
    const cand = document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]');
    for (const el of cand) {
      const t = ((el.value || el.textContent || '') + '').replace(/\s+/g, ' ').trim();
      if (t.length < 3 || t.length > 40 || !WORDS.test(t)) continue;
      if (visible(el) && inBox(el)) return el;
    }
    return null;
  }

  function tell() { try { api.runtime.sendMessage({ type: 'bannerDeclined', host: location.hostname }); } catch (e) { /* the page may be closing */ } }

  function attempt() {
    if (done) return true;
    const el = find();
    if (!el) return false;
    done = true;
    try { el.click(); } catch (e) { return false; }
    tell();
    return true;
  }

  function start() {
    // Respect the settings. A paused site is left alone.
    let host = location.hostname;
    Promise.resolve(api.storage.local.get(['settings'])).then((got) => {
      const s = got && got.settings;
      if (s && s.banners === false) return;
      const c = s && s.sites && s.sites[host];
      if (c && c.paused && (!c.pausedUntil || c.pausedUntil > Date.now())) return;
      if (attempt()) return;
      const obs = new MutationObserver(() => { if (attempt()) obs.disconnect(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 12000);
    }).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
