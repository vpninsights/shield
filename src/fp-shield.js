// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// VPNInsights Shield: fingerprint shield. Runs inside the page (MAIN world) before the page's own scripts.
// Sites identify a browser by reading tiny differences in how it draws a canvas, plays audio, and what hardware it reports. This changes what the page
// can read: canvas and audio readings get a few invisible changes that are different on every page load, and the hardware numbers are the common ones.
// What you see and hear is not affected. The shield is off in Standard and on in Strict, and a paused site is left out (see the background script).
(() => {
  if (window.__shieldFp) return; window.__shieldFp = true;
  const seed = crypto.getRandomValues(new Uint32Array(2));
  // A small seeded generator, so the same page load gives consistent answers but a new load gives new ones.
  let a = seed[0] | 0, b = seed[1] | 0;
  const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const def = (obj, name, fn) => { try { const o = obj[name]; Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true, enumerable: o ? Object.getOwnPropertyDescriptor(obj, name).enumerable : false }); } catch (e) { /* locked by the page */ } };

  // ---- canvas: change the lowest bit of a few colour values in what the page reads back
  const noisify = (img) => {
    const d = img.data; const step = 4 * (7 + Math.floor(rand() * 13));
    for (let i = (b & 3) * 4; i < d.length; i += step) { d[i] ^= 1; if (d[i + 1] !== undefined) d[i + 1] ^= (rand() < 0.5 ? 1 : 0); }
    return img;
  };
  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (C2D) {
    const orig = C2D.getImageData;
    def(C2D, 'getImageData', function getImageData(...args) { const r = orig.apply(this, args); try { return noisify(r); } catch (e) { return r; } });
    const readCopy = (canvas) => {
      try {
        const w = canvas.width, h = canvas.height; if (!w || !h || w * h > 8e6) return null;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.drawImage(canvas, 0, 0);
        x.putImageData(noisify(orig.call(x, 0, 0, w, h)), 0, 0);
        return c;
      } catch (e) { return null; }   // a canvas holding another site's image cannot be read back, so leave it alone
    };
    const HC = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
    if (HC) {
      const toData = HC.toDataURL, toBlob = HC.toBlob;
      def(HC, 'toDataURL', function toDataURL(...args) { const c = readCopy(this); return toData.apply(c || this, args); });
      def(HC, 'toBlob', function toBlob(cb, ...args) { const c = readCopy(this); return toBlob.call(c || this, cb, ...args); });
    }
  }

  // ---- audio: a very small change to what the page reads from a rendered sound
  const seen = new WeakSet();
  if (window.AudioBuffer) {
    const gcd = AudioBuffer.prototype.getChannelData;
    def(AudioBuffer.prototype, 'getChannelData', function getChannelData(ch) {
      const data = gcd.call(this, ch);
      if (!seen.has(data)) { seen.add(data); for (let i = 0; i < data.length; i += 97) data[i] += (rand() - 0.5) * 1e-7; }
      return data;
    });
  }
  if (window.AnalyserNode) {
    const gff = AnalyserNode.prototype.getFloatFrequencyData;
    def(AnalyserNode.prototype, 'getFloatFrequencyData', function getFloatFrequencyData(arr) { gff.call(this, arr); for (let i = 0; i < arr.length; i += 13) arr[i] += (rand() - 0.5) * 1e-3; });
  }

  // ---- hardware and graphics card names: the common values, so you look like many other people
  try { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true }); } catch (e) { /* ignore */ }
  try { if ('deviceMemory' in Navigator.prototype) Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, configurable: true }); } catch (e) { /* ignore */ }
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!G) continue;
    const gp = G.prototype.getParameter;
    def(G.prototype, 'getParameter', function getParameter(p) { if (p === 37445) return 'Google Inc.'; if (p === 37446) return 'ANGLE (Generic Renderer)'; return gp.call(this, p); });
  }
})();
