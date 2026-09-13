// Shared utilities: DOM building, formatting, clipboard.
// All modules live in a single App namespace because the scripts
// are loaded as classic <script> tags without modules or a bundler.
window.App = window.App || {};

App.util = (() => {
  // h('div', { class: 'x', onClick: fn }, ...children) — a small DOM helper.
  // on* attributes are attached as event handlers, boolean true yields an empty attribute,
  // null/false are skipped. Children: nodes, strings, numbers, nested arrays.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (name.startsWith('on') && typeof value === 'function') {
          el.addEventListener(name.slice(2).toLowerCase(), value);
        } else if (name === 'dataset') {
          Object.assign(el.dataset, value);
        } else {
          el.setAttribute(name, value === true ? '' : value);
        }
      }
    } else if (attrs != null) {
      children.unshift(attrs);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // From file:// the clipboard API is sometimes unavailable; fall back to a textarea.
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // Downloads a string as a file. This is the only "write" inside the app,
  // and it never touches the source image.
  function downloadText(name, text, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Exception-free JSON parsing: returns null if the string is not JSON.
  function tryParseJson(text) {
    if (typeof text !== 'string') return null;
    const s = text.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return null;
    try { return JSON.parse(s); } catch (_) { /* try to repair below */ }
    // Python writes NaN and Infinity unquoted, JSON.parse fails on them.
    const fixed = s.replace(/(:\s*)(-?Infinity|NaN)(?=\s*[,}\]])/g, '$1null');
    if (fixed === s) return null;
    try { return JSON.parse(fixed); } catch (_) { return null; }
  }

  return { h, append, clear, formatBytes, copyText, downloadText, tryParseJson };
})();
