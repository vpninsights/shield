// VPNInsights Shield. Made by VPNInsights. MIT licence, see LICENSE.
// Runs in the page itself so that sites reading navigator.globalPrivacyControl see true.
try { Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get() { return true; }, configurable: true }); } catch (e) { /* ignore */ }
