// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// Builds the two store packages into dist/. Run: node tools/package.mjs
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const FILES = ['src', 'popup', 'options', 'welcome', 'report', 'rules', 'icons', 'LICENSE', 'NOTICE.md'];
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
for (const target of ['chrome', 'firefox']) {
  const tmp = fs.mkdtempSync(path.join(root, 'dist', target + '-'));
  for (const f of FILES) fs.cpSync(path.join(root, f), path.join(tmp, f), { recursive: true });
  const mm = JSON.parse(JSON.stringify(m));
  if (target === 'firefox') {
    mm.name = 'Shield by VPNInsights: Tracker Blocker';   // Firefox Add-ons allows 50 characters
    mm.background = { scripts: ['src/categories.js', 'src/breaches.js', 'src/shared.js', 'src/background.js'] };
    mm.browser_specific_settings = { gecko: { id: 'shield@vpninsights.com', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } }, gecko_android: { strict_min_version: '142.0' } };
    delete mm.minimum_chrome_version;
  }
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(mm, null, 2));
  const out = path.join(root, 'dist', `vpninsights-shield-${m.version}-${target}.zip`);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-qr', out, '.'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(path.relative(root, out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
}
