# Shield by VPNInsights

Full feature list for Shield 1.3.3 (Manifest V3).

Made by [VPNInsights](https://vpninsights.com). MIT licence (see `LICENSE`, third-party items in `NOTICE.md`).

## What it does
- Blocks ads, analytics, social trackers and session recorders from a bundled list of 168 well known services (`data/lists.json`).
- Removes tracking parts from links (utm_*, fbclid, gclid and 40 more).
- Sends the Global Privacy Control signal and sets `navigator.globalPrivacyControl`.
- NoScript-style script control per site: allow all, block other sites' scripts, block all. Allow or block single domains.
- Pause protection on one site, for 10 minutes or until you turn it back on.
- Hides WebRTC local addresses, and clears cookies when the last tab of a site closes (optional).
- Privacy grade (A to F) for each page, and a list of the companies tracking you, grouped (Google, Meta, Criteo...).
- Declines cookie banners: presses "reject all" or "necessary only" on common consent boxes, never "accept" (`src/cookie-banner.js`).
- Copy clean link: the current address with utm_*, fbclid, gclid and the rest removed.
- Weekly report (`report/`): trackers blocked per day, who tracked you most, the most tracked sites, a streak, one tip a week, and a shareable image with numbers only. A Monday notification (on by default, switch in Settings). All calculated on the device from the last 30 days.
- Data-breach strip: a warning when the site you are on is in the bundled list of public breaches (`src/breaches.js`, from Have I Been Pwned, CC BY 4.0, rebuild monthly with `node tools/build-breaches.mjs`). Checked on the device, nothing about your browsing is sent.
- Fingerprint shield (`src/fp-shield.js`): changes what a page can read from canvas and audio, reports common hardware numbers and a generic graphics card name. On in Strict, off in Standard, skipped on paused sites.
- Password breach check (off by default, `src/password-check.js`): when you finish typing a password, it is hashed on the page (SHA-1) and only the first 5 characters of the hash go, through the extension, to Have I Been Pwned (`api.pwnedpasswords.com/range/`, with padding). The page compares the rest of the hash itself. A warning card shows how many breaches. Neither the password nor the full hash is ever sent.
- Open the real link (`src/unwrap-links.js`, `rules/amp.json`): swaps in the real address for Google, Facebook, Instagram, YouTube, Reddit, LinkedIn, Steam and DuckDuckGo redirect links, removes the `ping` attribute, and redirects Google AMP addresses to the real page.
- Custom rules and imported lists (Settings, Custom rules): your own domains, hosts files and simple Adblock lines (`||domain^`, `@@||domain^`), up to 30,000 domains. Path and element rules are skipped and counted. Imported lists are data only and are not updated by themselves.
- Clear this site's data: one button in the popup (cookies, local storage, caches), with a second tap to confirm.
- VPN tab: shows your address, place and network, whether it matches the VPN address you saved, and links to the full leak test. The only request is to `https://vpninsights.com/api/tools/ip`, made when you open the tab. The optional address-change warning (off by default) asks every 5 minutes.
- Levels: Standard, Strict, Custom.

## Not in version 1
Per-site containers (Firefox only, so left out), cloud sync (left out on purpose), path-based Adblock rules. 

## Load it to try it
1. Chrome, Edge or Brave: open `chrome://extensions`, turn on Developer mode, press **Load unpacked**, choose this `extension` folder.
2. The source manifest is Chrome-clean. Firefox needs its own keys, which `node tools/package.mjs` adds in the Firefox zip.
3. Firefox: run `node tools/package.mjs`, then open `about:debugging`, **This Firefox**, **Load Temporary Add-on**, and choose `manifest.json` from an unzipped `dist/*-firefox.zip`.

## Develop
```bash
node tools/build-rules.mjs   # rebuild rules/ and src/categories.js after editing data/lists.json
node tools/test-unit.mjs     # 500+ checks on the rules, settings logic and manifest
node tools/test-chrome.mjs   # loads it into a real headless Chrome and checks blocking, GPC, link cleaning, pause, allow, script control, cleanup, WebRTC
node tools/errors-chrome.mjs # uses it on real sites, then prints what chrome://extensions lists under Errors. Fails on any error
node tools/package.mjs       # builds dist/vpninsights-shield-1.3.3-chrome.zip and -firefox.zip
node ../extension/tools/build-icons.mjs  # (run from the repo root) rebuilds popup/icons.js from Font Awesome
```
`test-chrome.mjs` needs Google Chrome (set `CHROME` to its path if it is not in /Applications).

## Rules to keep
- No affiliate links inside the extension. Chrome Web Store rejects them.
- No remote code, no analytics, no data leaving the device except the optional IP check.
- Describe it as privacy protection (one purpose) in the store listing.
- Do not copy uBlock Origin code. The list here is our own.
- It is not a VPN and does not hide your IP address. Say so in every listing.

## Before publishing
- Host `PRIVACY.md` at a public address and use it as the privacy policy URL.
- Chrome Web Store needs a developer account (one-time fee) in the owner's name. Firefox Add-ons is free.
- Supply screenshots (popup, script control, settings) and the listing text from the mockup.
