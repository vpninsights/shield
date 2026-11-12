# Contributing

1. Open an issue first for anything bigger than a small fix.
2. Keep to the rules: no analytics, no remote code, no accounts, no new permissions without a written reason.
3. Do not edit generated files by hand (`src/categories.js`, `src/breaches.js`, `popup/icons.js`, `rules/*.json`). Change `data/` or the tools and rebuild.
4. Run `node tools/test-unit.mjs` and `node tools/test-chrome.mjs` before opening a pull request.
5. Icons are Font Awesome Free only. No emoji, no custom illustrations.
