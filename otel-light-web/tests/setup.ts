// Test-environment workaround for happy-dom issue #1810:
// DOMPurify caches `Node.prototype.nodeName`'s getter at module load and calls
// it unapplied to read node names. happy-dom v20's `Node.prototype.nodeName`
// returns an empty string (the real value lives on `Element.prototype`), so
// DOMPurify treats every element as unknown and strips/filters everything.
// Restore spec-like per-nodeType behavior before DOMPurify is imported.
// Remove this shim once happy-dom ships the fix (PR #2183).
const nodePrototype = globalThis.Node?.prototype;

if (nodePrototype) {
  Object.defineProperty(nodePrototype, "nodeName", {
    configurable: true,
    get(this: Node) {
      switch (this.nodeType) {
        case 1:
          return String((this as Element).tagName).toUpperCase();
        case 3:
          return "#text";
        case 8:
          return "#comment";
        case 9:
          return "#document";
        case 11:
          return "#document-fragment";
        default:
          return "";
      }
    },
  });
}
