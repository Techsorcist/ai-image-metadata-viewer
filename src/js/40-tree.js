// JSON tree on <details>/<summary>: collapsing is native, no handlers.
// Object children are rendered lazily on first expansion so that ComfyUI graphs
// with hundreds of nodes do not build thousands of DOM elements for nothing.
App.tree = (() => {
  const { h } = App.util;

  function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function formatScalar(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    return String(value);
  }

  // Short hint in the header of a collapsed object: for ComfyUI nodes
  // it is class_type and title, for the UI graph it is type and id.
  function hint(value) {
    if (Array.isArray(value) || value === null || typeof value !== 'object') return null;
    if (typeof value.class_type === 'string') {
      const title = value._meta && typeof value._meta.title === 'string' ? value._meta.title : null;
      return title && title !== value.class_type ? `${value.class_type} · ${title}` : value.class_type;
    }
    if (typeof value.type === 'string' && 'id' in value) return `${value.type} #${value.id}`;
    if (typeof value.name === 'string') return value.name;
    return null;
  }

  function keyEl(key) {
    if (key === null) return null;
    return [h('span', { class: 'jt-key' }, String(key)), h('span', { class: 'jt-colon' }, ': ')];
  }

  function node(key, value, depth, opts) {
    const kind = typeOf(value);
    if (kind !== 'object' && kind !== 'array') {
      const sensitive = kind === 'string' && App.privacy.isSensitive(key, value);
      return h('div', { class: `jt-row${sensitive ? ' jt-private' : ''}` },
        keyEl(key),
        h('span', { class: `jt-val jt-${kind}` }, formatScalar(value)),
        sensitive ? App.privacy.badge() : null);
    }

    const isArray = kind === 'array';
    const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    const open = isArray ? '[' : '{';
    const close = isArray ? ']' : '}';

    if (entries.length === 0) {
      return h('div', { class: 'jt-row' }, keyEl(key), h('span', { class: 'jt-brace' }, open + close));
    }

    // decorate(value, key) may return { hint, className } for a specific object:
    // this is how workflow marks nodes that are absent from the executed prompt.
    const deco = opts.decorate ? opts.decorate(value, key) : null;
    const details = h('details', { class: `jt${deco && deco.className ? ' ' + deco.className : ''}`, open: depth < opts.openDepth });
    const summary = h('summary', { class: 'jt-sum' },
      keyEl(key),
      h('span', { class: 'jt-brace' }, open),
      h('span', { class: 'jt-count' }, `${entries.length} ${isArray ? 'items' : 'keys'}`),
      hint(value) ? h('span', { class: 'jt-hint' }, hint(value)) : null,
      deco && deco.hint ? h('span', { class: 'jt-deco' }, deco.hint) : null,
      h('span', { class: 'jt-brace jt-close' }, close));
    const body = h('div', { class: 'jt-body' });

    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      for (const [k, v] of entries) body.append(node(k, v, depth + 1, opts));
    };
    details._fill = fill;
    if (details.open) fill();
    else details.addEventListener('toggle', fill, { once: true });

    details.append(summary, body);
    return details;
  }

  // render(value, { openDepth }) — the root element of the tree.
  function render(value, options) {
    const opts = Object.assign({ openDepth: 1 }, options);
    return h('div', { class: 'jt-root' }, node(null, value, 0, opts));
  }

  // Expands all levels taking lazy rendering into account: open layer by layer
  // until no closed details remain.
  function expandAll(root) {
    for (;;) {
      const closed = root.querySelectorAll('details.jt:not([open])');
      if (closed.length === 0) break;
      closed.forEach(d => { if (d._fill) d._fill(); d.open = true; });
    }
  }

  function collapseAll(root) {
    root.querySelectorAll('details.jt[open]').forEach(d => { d.open = false; });
    // Keep the root level open, otherwise only a single brace is visible.
    const first = root.querySelector('details.jt');
    if (first) first.open = true;
  }

  return { render, expandAll, collapseAll };
})();
