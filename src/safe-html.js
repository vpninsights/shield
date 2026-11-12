// Shield by VPNInsights. Made by VPNInsights. MIT licence, see LICENSE.
// Puts markup into a page the way browsers recommend: it is parsed in a separate document first (so no script can run), then the nodes are moved in.
// Use it as:  element.safeHTML = '<b>text</b>'   Any text that comes from a page or a person must be escaped before it is put in the markup.
Object.defineProperty(Element.prototype, 'safeHTML', {
  configurable: true,
  set(markup) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(markup), 'text/html');
    this.replaceChildren(...doc.body.childNodes);
  },
});
