// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// VPNInsights Shield: password breach check (opt in). When you finish typing a password, this checks whether that password has appeared in a known data breach.
// The password never leaves the page. It is turned into a SHA-1 hash here, and only the first 5 characters of the hash are sent (through the extension, to
// Have I Been Pwned). Their answer is a list of hundreds of hashes that start the same way, and this script looks for the rest of yours in that list.
(() => {
  if (window.__shieldPwned) return; window.__shieldPwned = true;
  const api = globalThis.browser || globalThis.chrome;
  const seen = new Set();
  const hex = async (text) => {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  // Parse markup in a separate document and move the nodes in, so no script can run (browsers recommend this over innerHTML).
  const setMarkup = (target, markup) => { const doc = new DOMParser().parseFromString('<!doctype html><body>' + markup, 'text/html'); target.replaceChildren(...doc.body.childNodes); };

  function toast(count) {
    let host = document.getElementById('shield-pwned-host'); if (host) host.remove();
    host = document.createElement('div'); host.id = 'shield-pwned-host';
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    setMarkup(root, `<style>
      .c{font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;width:300px;background:#fff;color:#1c1735;border:1px solid #e4e1f2;border-left:4px solid #b45309;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(40,20,90,.25)}
      b{display:block;margin-bottom:3px}small{color:#6b6788;display:block;margin-top:6px}button{margin-top:8px;border:1px solid #e4e1f2;background:#f3efff;color:#5b21b6;border-radius:8px;padding:5px 12px;font:inherit;font-weight:700;cursor:pointer}
      @media (prefers-color-scheme:dark){.c{background:#1c1830;color:#efecff;border-color:#322c52}small{color:#a19cc4}button{background:#2b2250;color:#a78bfa;border-color:#322c52}}
    </style><div class="c" role="alert"><b>This password was found in ${count.toLocaleString('en-US')} data breach${count === 1 ? '' : 'es'}</b>Choose a different one for this site and never reuse it.<small>Shield checked it on your device. Your password was not sent anywhere.</small><button>Dismiss</button></div>`);
    root.querySelector('button').addEventListener('click', () => host.remove());
    (document.documentElement || document.body).appendChild(host);
    setTimeout(() => host.remove(), 15000);
  }

  async function check(value) {
    if (!value || value.length < 6 || value.length > 128) return;
    const h = await hex(value); value = '';
    if (seen.has(h)) return; seen.add(h);
    const prefix = h.slice(0, 5), suffix = h.slice(5);
    let r; try { r = await api.runtime.sendMessage({ type: 'pwnedRange', prefix }); } catch (e) { return; }
    if (!r || !r.text) return;
    for (const line of r.text.split('\n')) {
      const [s, c] = line.trim().split(':');
      if (s === suffix && Number(c) > 0) { toast(Number(c)); return; }
    }
  }

  let timer = null;
  const onField = (e) => { const t = e.target; if (t && t.matches && t.matches('input[type="password"]')) { clearTimeout(timer); const v = t.value; timer = setTimeout(() => check(v), e.type === 'change' ? 50 : 1800); } };
  document.addEventListener('change', onField, true);
  document.addEventListener('input', onField, true);
})();
