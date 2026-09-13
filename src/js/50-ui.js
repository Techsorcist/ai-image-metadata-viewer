// Renders the UI from state. No reactivity: data changes only when files are
// added or a list item is selected, so the whole thing is redrawn.
App.ui = (() => {
  const { h, clear, formatBytes, copyText, downloadText } = App.util;

  const state = {
    files: [],      // records from App.source.readFile
    selected: -1,   // index of the selected record
  };

  let els = {};

  function mount(root) {
    els.root = root;
    App.icons.install();
    const icon = App.icons.svg;
    els.input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true,
      onChange: e => { App.app.addFiles(e.target.files); e.target.value = ''; } });

    els.fileList = h('ul', { class: 'filelist' });
    els.fileListHead = h('div', { class: 'filelist-head' });
    els.preview = h('div', { class: 'preview' });
    els.fileInfo = h('div', { class: 'fileinfo' });
    els.right = h('section', { class: 'right' });

    const dropzone = h('div', { class: 'dropzone', onClick: () => els.input.click() },
      h('div', { class: 'dz-title' }, icon('upload'), ' Drop images here'),
      h('div', { class: 'dz-sub' }, 'or click to choose files. PNG for now.'));
    els.dropzone = dropzone;

    // Preview always sits right below the drop zone, the file list follows in opening order.
    const left = h('aside', { class: 'left' },
      dropzone,
      els.preview,
      els.fileInfo,
      els.fileListHead,
      els.fileList);

    els.themeBtn = h('button', { class: 'btn btn-icon', title: 'Toggle light / dark theme', onClick: () => { App.settings.toggleTheme(); updateThemeButton(); } });
    els.highlightBtn = h('button', { class: 'btn btn-icon', title: 'Toggle prompt syntax highlighting', onClick: () => { App.settings.highlight = !App.settings.highlight; updateHighlightButton(); render(); } }, icon('highlighter'));
    updateThemeButton();
    updateHighlightButton();

    root.append(
      h('header', { class: 'topbar' },
        h('button', { class: 'brand', title: 'About', onClick: openAbout }, App.about.name),
        h('div', { class: 'topbar-actions' },
          h('button', { class: 'btn', onClick: () => els.input.click() }, icon('image-plus'), 'Add files'),
          h('span', { class: 'topbar-sep' }),
          els.highlightBtn,
          els.themeBtn)),
      h('main', { class: 'app' }, left, els.right),
      els.input);

    render();
  }

  function updateThemeButton() {
    clear(els.themeBtn);
    // Show what the button switches to: a sun in dark theme, a moon in light theme.
    els.themeBtn.append(App.icons.svg(App.settings.effectiveTheme() === 'dark' ? 'sun' : 'moon'));
  }

  function updateHighlightButton() {
    els.highlightBtn.classList.toggle('active', App.settings.highlight);
  }

  function render() {
    const current = state.files[state.selected] || null;
    renderFileList();
    renderPreview(current);
    renderRight(current);
    els.root.classList.toggle('has-files', state.files.length > 0);
    els.root.classList.toggle('single-file', state.files.length === 1);
  }

  function renderFileList() {
    clear(els.fileList);
    clear(els.fileListHead);
    if (state.files.length > 1) {
      els.fileListHead.append(
        h('span', { class: 'block-title' }, `Files · ${state.files.length}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', title: 'Remove every file except the current one', onClick: () => App.app.clearOthers() }, App.icons.svg('x'), 'Clear history'),
        h('button', { class: 'btn btn-sm btn-ghost', title: 'Remove all files from the list', onClick: () => App.app.clearAll() }, App.icons.svg('trash'), 'Clear all'));
    }
    // Newest files on top, indices remain indices into state.files.
    state.files.map((rec, i) => [rec, i]).reverse().forEach(([rec, i]) => {
      els.fileList.append(h('li', {
        class: `fileitem${i === state.selected ? ' active' : ''}`,
        title: rec.name,
        onClick: () => select(i),
      },
        h('img', { src: rec.url, alt: '' }),
        h('div', { class: 'fileitem-text' },
          h('div', { class: 'fileitem-name' }, rec.name),
          h('div', { class: 'fileitem-sub' }, rec.generator ? rec.generator.name : '')),
        h('button', { class: 'fileitem-remove', title: 'Remove from the list', onClick: e => { e.stopPropagation(); App.app.removeFile(i); } }, App.icons.svg('x'))));
    });
  }

  function renderPreview(rec) {
    clear(els.preview);
    clear(els.fileInfo);
    if (!rec) return;
    els.preview.append(h('img', { src: rec.url, alt: rec.name, title: 'Click to enlarge', onClick: () => openLightbox(rec) }));
    els.fileInfo.append(infoRow('File', rec.name));
    if (rec.width) {
      els.fileInfo.append(
        infoRow('Pixels', `${rec.width} × ${rec.height}`),
        infoRow('Aspect', aspectLabel(rec.width, rec.height)));
    }
    els.fileInfo.append(
      infoRow('Size', formatBytes(rec.size)),
      infoRow('Format', rec.format.toUpperCase()));
  }

  function infoRow(label, value) {
    return h('div', { class: 'info-row' }, h('span', { class: 'info-label' }, label), h('span', { class: 'info-value' }, value));
  }

  // Aspect ratio the way generators show it: the simplest of the common fractions
  // within three percent (SwarmUI calls 1216×832 "3:2" although it is 1.46),
  // otherwise the exact fraction; the decimal value is shown next to it.
  const COMMON_RATIOS = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [5, 4], [4, 5], [21, 9], [9, 21], [7, 4], [4, 7], [5, 3], [3, 5], [16, 10], [10, 16], [7, 5], [5, 7], [2, 1], [1, 2]];
  function aspectLabel(w, h) {
    const value = w / h;
    let best = null;
    for (const [a, b] of COMMON_RATIOS) {
      const diff = Math.abs(a / b - value) / value;
      const exact = diff < 0.001;
      if (diff > 0.03) continue;
      // An exact match beats fraction simplicity; among approximations take the simplest.
      if (!best || (exact && best.diff >= 0.001) || (exact === best.diff < 0.001 && a + b < best.a + best.b)) best = { a, b, diff };
    }
    const decimal = value.toFixed(2);
    if (best) return `${best.a}:${best.b}${best.diff > 0.001 ? ' ≈' : ''} (${decimal})`;
    const g = gcd(w, h);
    const a = w / g, b = h / g;
    return a <= 64 && b <= 64 ? `${a}:${b} (${decimal})` : decimal;
  }
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  // "About" card shown on header click.
  function openAbout() {
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const a = App.about;
    const box = h('div', { class: 'lightbox about-backdrop', onClick: e => { if (e.target === box) close(); } },
      h('div', { class: 'about' },
        h('div', { class: 'about-title' }, a.name),
        h('div', { class: 'about-version' }, `version ${a.version}`),
        h('div', { class: 'about-row' }, 'by ', h('strong', a.author)),
        h('p', { class: 'about-text' }, 'Shows the generation metadata hidden inside AI images: prompts, models, seeds, samplers, LoRAs and the raw ComfyUI graph. Made for people who generate a lot and want to know, months later, how exactly a picture was made.'),
        h('p', { class: 'about-text' }, 'Everything runs in your browser. No image, prompt or metadata ever leaves your machine. Open it offline, it works the same.'),
        h('div', { class: 'about-links' },
          a.repo ? h('a', { href: a.repo, target: '_blank', rel: 'noopener' }, 'Source on GitHub') : null,
          a.demo ? h('a', { href: a.demo, target: '_blank', rel: 'noopener' }, 'Online demo') : null),
        h('p', { class: 'about-text' }, 'Thank you for using it.'),
        h('button', { class: 'btn', onClick: close }, 'Close')));
    document.addEventListener('keydown', onKey);
    document.body.append(box);
  }

  // Enlarged view over the page. A click anywhere or Esc closes it.
  function openLightbox(rec) {
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: 'lightbox', onClick: close },
      h('img', { src: rec.url, alt: rec.name }),
      h('div', { class: 'lightbox-caption' }, `${rec.name} · ${rec.width ? rec.width + ' × ' + rec.height : ''}`));
    document.addEventListener('keydown', onKey);
    document.body.append(box);
  }

  function renderRight(rec) {
    clear(els.right);
    if (!rec) {
      els.right.append(h('div', { class: 'empty' }, 'Metadata will appear here.'));
      return;
    }

    els.right.append(renderGenerator(rec));

    if (rec.warnings.length || rec.notes.length) {
      els.right.append(h('div', { class: 'warnings' },
        rec.warnings.map(w => h('div', { class: 'warning' }, w)),
        rec.notes.map(n => h('div', { class: 'note' }, n))));
    }

    if (rec.entries.length === 0) {
      els.right.append(h('div', { class: 'empty' }, 'No text chunks found in this file.'));
      return;
    }

    // Card on top if the generator was parsed; raw sections are collapsed then.
    // Without a card there is nothing else to show, so raw data is expanded right away.
    const hasCard = !!rec.card;
    if (hasCard) els.right.append(App.card.render(rec));
    els.right.append(h('div', { class: 'sections' },
      hasCard ? h('div', { class: 'block-title' }, 'Raw metadata') : null,
      rec.entries.map(e => renderEntry(e, !hasCard, rec))));
  }

  function renderGenerator(rec) {
    const g = rec.generator || { name: 'Unknown', keys: [] };
    return h('div', { class: `genbadge gen-${g.id}` },
      h('span', { class: 'gen-name' }, g.name),
      g.detail ? h('span', { class: 'gen-detail' }, g.detail) : null,
      g.keys.length ? h('span', { class: 'gen-keys' }, g.keys.map(k => h('code', k))) : null);
  }

  function renderEntry(entry, open, rec) {
    const isJson = entry.json !== null;
    const body = h('div', { class: 'sec-body' });
    let tree = null;
    if (isJson) {
      tree = App.tree.render(entry.json, { openDepth: 1, decorate: decoratorFor(entry, rec) });
      body.append(tree);
    } else {
      body.append(h('pre', { class: 'rawtext' }, entry.value));
    }

    const icon = App.icons.svg;
    const section = h('details', { class: 'sec', open });
    const actions = h('div', { class: 'sec-actions', onClick: e => e.preventDefault() },
      isJson ? h('button', { class: 'btn btn-sm', title: 'Expand all', onClick: () => { section.open = true; App.tree.expandAll(tree); } }, icon('chevrons-up-down'), 'Expand') : null,
      isJson ? h('button', { class: 'btn btn-sm', title: 'Collapse all', onClick: () => App.tree.collapseAll(tree) }, icon('chevrons-down-up'), 'Collapse') : null,
      h('button', { class: 'btn btn-sm', title: 'Copy to clipboard', onClick: e => flash(e.currentTarget, copyText(isJson ? JSON.stringify(entry.json, null, 2) : entry.value)) }, icon('copy'), 'Copy'),
      h('button', { class: 'btn btn-sm', title: 'Download as a file', onClick: () => downloadText(
        `${entry.key}.${isJson ? 'json' : 'txt'}`,
        isJson ? JSON.stringify(entry.json, null, 2) : entry.value,
        isJson ? 'application/json' : 'text/plain') }, icon('download'), 'Download'));

    section.append(
      h('summary', { class: 'sec-head' },
        h('span', { class: 'sec-key' }, entry.key),
        h('span', { class: 'sec-meta' }, `${entry.source} · ${isJson ? 'JSON' : 'text'} · ${formatBytes(entry.value.length)}`),
        actions),
      body);
    return section;
  }

  // For the ComfyUI UI graph, mark nodes missing from the executed prompt,
  // as well as bypass (mode 4) and mute (mode 2).
  function decoratorFor(entry, rec) {
    if (entry.key !== 'workflow' || !rec) return null;
    const executed = rec.card && rec.card.executed ? rec.card.executed : null;
    return (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('id' in value) || typeof value.type !== 'string') return null;
      const notes = [];
      if (value.mode === 4) notes.push('bypassed');
      if (value.mode === 2) notes.push('muted');
      if (executed && !executed.has(String(value.id))) notes.push('not executed');
      return notes.length ? { hint: notes.join(', '), className: 'jt-unused' } : null;
    };
  }

  // Brief feedback on the copy button: swap the content and restore it.
  async function flash(button, promise) {
    const saved = Array.from(button.childNodes);
    const ok = await promise;
    clear(button);
    button.append(App.icons.svg(ok ? 'check' : 'x'), ok ? 'Copied' : 'Failed');
    setTimeout(() => { clear(button); button.append(...saved); }, 1200);
  }

  function select(i) {
    state.selected = i;
    render();
  }

  return { state, mount, render, select, flash };
})();
