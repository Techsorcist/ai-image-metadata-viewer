// Renders the generation card: prompts, parameters, models, other nodes.
App.card = (() => {
  const { h, clear, copyText } = App.util;

  // The "Final / Original" toggles and pass selection live inside the card,
  // so it can re-render itself.
  function render(record) {
    const card = record.card;
    const root = h('div', { class: 'card' });
    const view = { pass: 0, original: { positive: false, negative: false } };

    const draw = () => {
      clear(root);
      const pass = card.passes ? card.passes[view.pass] : null;
      // Pass prompt objects are created once and kept on the pass itself,
      // otherwise editor changes would be lost on every re-render.
      if (pass && !pass.prompts) pass.prompts = { positive: { text: pass.positive, original: null }, negative: { text: pass.negative, original: null } };
      const positive = pass ? pass.prompts.positive : card.positive;
      const negative = pass ? pass.prompts.negative : card.negative;
      const params = pass ? withModel(pass.params, card) : card.params;

      if (card.passes) root.append(passSwitcher(card.passes, view, draw));
      root.append(promptBlock('Prompt', positive, 'positive', view, draw));
      root.append(promptBlock('Negative', negative, 'negative', view, draw));

      // Parameters and Models in two columns on wide screens, stacked on narrow ones.
      const left = (params.length || card.extra.length) ? h('div', { class: 'split-col' },
        h('div', { class: 'block-title' }, 'Parameters'),
        params.length ? paramGrid(params) : null,
        card.extra.length ? extraTable(card.extra) : null) : null;
      const right = card.models.length ? h('div', { class: 'split-col' },
        h('div', { class: 'block-title' }, 'Models'),
        modelList(card.models)) : null;
      if (left || right) root.append(h('div', { class: `split${left && right ? '' : ' split-single'}` }, left, right));
      if (card.textNodes && card.textNodes.length) {
        root.append(h('div', { class: 'block-title' }, 'Other nodes'));
        root.append(nodeGroups(card.textNodes));
      }
    };
    draw();
    return root;
  }

  function withModel(params, card) {
    const checkpoint = card.models.find(m => m.role === 'checkpoint');
    return checkpoint ? [{ label: 'Model', value: checkpoint.name, sub: checkpoint.detail || null }, ...params] : params;
  }

  function passSwitcher(passes, view, redraw) {
    return h('div', { class: 'seg' },
      h('span', { class: 'seg-label' }, 'Sampler pass'),
      passes.map((p, i) => h('button', {
        class: `seg-btn${i === view.pass ? ' active' : ''}`,
        onClick: () => { view.pass = i; redraw(); },
      }, p.label)));
  }

  function promptBlock(label, prompt, kind, view, redraw) {
    const hasOriginal = prompt.original != null;
    const showOriginal = hasOriginal && view.original[kind];
    const field = showOriginal ? 'original' : 'text';

    const toggle = hasOriginal ? h('div', { class: 'seg seg-inline' },
      h('button', { class: `seg-btn${!showOriginal ? ' active' : ''}`, onClick: () => { view.original[kind] = false; redraw(); } }, 'Final'),
      h('button', { class: `seg-btn${showOriginal ? ' active' : ''}`, onClick: () => { view.original[kind] = true; redraw(); } }, 'Original')) : null;

    // Edits live in the prompt object until the page reloads; the original is kept
    // alongside so the Reset button can restore it.
    const pristine = prompt.pristine || (prompt.pristine = { text: prompt.text, original: prompt.original });
    const edited = () => prompt[field] !== pristine[field];

    const editedTag = h('span', { class: 'edited-tag', hidden: !edited() }, 'edited');
    const resetBtn = h('button', { class: 'btn btn-sm', title: 'Discard edits', hidden: !edited(),
      onClick: () => { prompt[field] = pristine[field]; redraw(); } }, App.icons.svg('x'), 'Reset');
    const copyBtn = h('button', { class: 'btn btn-sm', onClick: e => App.ui.flash(e.currentTarget, copyText(prompt[field])) }, App.icons.svg('copy'), 'Copy');
    // Text is read-only by default; the editor is enabled by a button and remembers its state.
    const editBtn = h('button', { class: `btn btn-sm${prompt.editing ? ' active' : ''}`, title: prompt.editing ? 'Finish editing' : 'Edit text',
      onClick: () => { prompt.editing = !prompt.editing; redraw(); } }, App.icons.svg(prompt.editing ? 'check' : 'pencil'), prompt.editing ? 'Done' : 'Edit');

    const body = prompt.editing
      ? promptEditor(prompt, field, () => { editedTag.hidden = !edited(); resetBtn.hidden = !edited(); })
      : (prompt[field] ? promptText(prompt[field]) : h('div', { class: 'prompt-empty' }, '(empty)'));

    return h('div', { class: `prompt-block prompt-${kind}${prompt.editing ? ' editing' : ''}` },
      h('div', { class: 'prompt-head' },
        h('span', { class: 'prompt-label' }, label),
        toggle,
        editedTag,
        h('span', { class: 'spacer' }),
        resetBtn,
        editBtn,
        copyBtn),
      body);
  }

  // Editor: a colorized <pre> sets the height and draws the highlighting; on top of it
  // sits a transparent textarea with the same font and padding. Cursor and selection
  // come from the textarea, colors from the pre; the pre is redrawn on input.
  function promptEditor(prompt, field, onChange) {
    const under = h('pre', { class: 'prompt-text prompt-under' });
    const input = h('textarea', { class: 'prompt-input', spellcheck: 'false', placeholder: '(empty)' });
    input.value = prompt[field] || '';

    const paint = () => {
      clear(under);
      const text = input.value;
      under.append(App.card.renderPromptText ? App.card.renderPromptText(text) : text);
      // A trailing newline adds no height in pre but does in textarea: even them out.
      if (text.endsWith('\n') || text === '') under.append('\u200b');
    };
    input.addEventListener('input', () => {
      prompt[field] = input.value;
      paint();
      onChange();
    });
    paint();
    // Move the cursor to the end of the text right after enabling the editor.
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
    return h('div', { class: 'prompt-edit' }, under, input);
  }

  // Syntax highlighting is plugged in at stage three via App.card.renderPromptText.
  function promptText(text) {
    return h('pre', { class: 'prompt-text' }, App.card.renderPromptText ? App.card.renderPromptText(text) : text);
  }

  // Short numbers fit in half the card; everything else gets the normal width.
  const NARROW = new Set(['CFG', 'Steps', 'Clip skip']);
  function paramWidth(label) {
    return NARROW.has(label) ? ' param-narrow' : '';
  }

  function paramGrid(params) {
    return h('div', { class: 'param-grid' }, params.map(p =>
      h('div', { class: `param${paramWidth(p.label)}`, title: p.sub ? `${p.value} ${p.sub}` : p.value },
        h('div', { class: 'param-label' }, p.label),
        // A suffix like "× 2" on the same line; the name gets truncated, the suffix is always visible.
        h('div', { class: 'param-value' },
          h('span', { class: 'param-main' }, p.value),
          p.sub ? h('span', { class: 'param-sub' }, p.sub) : null),
        h('button', { class: 'hover-copy', title: 'Copy value', onClick: e => flashIcon(e.currentTarget, copyText(p.value)) }, App.icons.svg('copy')))));
  }

  // The button icon turns into a checkmark for a second.
  async function flashIcon(button, promise) {
    const ok = await promise;
    clear(button);
    button.append(App.icons.svg(ok ? 'check' : 'x'));
    setTimeout(() => { clear(button); button.append(App.icons.svg('copy')); }, 1200);
  }

  function modelList(models) {
    return h('div', { class: 'models' },
      models.map(m => h('div', { class: 'model-row' },
        h('span', { class: `role role-${m.role}` }, m.role),
        h('span', { class: 'model-name', title: m.name }, m.name),
        m.weight != null ? h('span', { class: 'model-weight' }, `× ${m.weight}`) : null,
        m.detail ? h('span', { class: 'model-weight' }, m.detail) : null,
        m.hash ? h('span', { class: 'model-hash', title: m.hash }, String(m.hash)) : null)));
  }

  // Other graph nodes in three collapsible groups: used in generation,
  // not connected to a sampler, canvas notes.
  const GROUPS = [
    { kind: 'used', title: 'Feeding samplers', open: false, hint: 'every string input reachable from a sampler, positive and negative included' },
    { kind: 'unused', title: 'Not connected', open: false, hint: 'text nodes on the canvas that no sampler reads' },
    { kind: 'note', title: 'Canvas notes', open: false, hint: 'Note and MarkdownNote nodes, never part of generation' },
  ];

  function nodeGroups(nodes) {
    return h('div', { class: 'sections' }, GROUPS.map(g => {
      const items = nodes.filter(n => (n.kind || 'used') === g.kind);
      if (items.length === 0) return null;
      return h('details', { class: 'sec sec-flat', open: g.open },
        h('summary', { class: 'sec-head' },
          h('span', { class: 'sec-key' }, g.title),
          h('span', { class: 'sec-meta' }, `${items.length} · ${g.hint}`)),
        h('div', { class: 'sec-body' }, nodeTabs(items)));
    }));
  }

  function nodeTabs(nodes) {
    let active = 0;
    const body = h('div');
    const strip = h('div', { class: 'tabs' });
    const draw = () => {
      clear(strip);
      nodes.forEach((n, i) => strip.append(h('button', {
        class: `tab${i === active ? ' active' : ''}`,
        title: `${n.classType} · ${n.field}`,
        onClick: () => { active = i; draw(); },
      }, `#${n.id} ${n.title || n.classType}`, App.privacy.isSensitive(null, n.text) ? App.icons.svg('lock', 'tab-lock') : null)));
      clear(body);
      body.append(promptText(nodes[active].text));
    };
    draw();
    return [strip, body];
  }

  function extraTable(extra) {
    return h('details', { class: 'sec sec-flat' },
      h('summary', { class: 'sec-head' },
        h('span', { class: 'sec-key' }, 'Other parameters'),
        h('span', { class: 'sec-meta' }, `${extra.length} values`)),
      h('div', { class: 'sec-body' },
        h('table', { class: 'kv' }, extra.map(e => h('tr',
          h('td', { class: 'kv-key' }, e.key),
          h('td', { class: 'kv-val' }, e.value, App.privacy.isSensitive(e.key, e.value) ? App.privacy.badge() : null))))));
  }

  return { render };
})();
