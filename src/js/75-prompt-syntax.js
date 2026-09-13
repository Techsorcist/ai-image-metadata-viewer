// Prompt syntax tokenizer. One shared scheme for A1111, ComfyUI and SwarmUI,
// not tied to any generator. Separate from rendering: tokenize() returns a list of
// { type, text, alt } and knows nothing about the DOM.
//
// Token types:
//   text      plain text
//   tag       angle-bracket tags: <lora:...>, <segment:...>, <weight[1.2]:...>, opening and closing parts
//   tagname   tag name together with its [parameter] and colon
//   brace     { } of choice blocks
//   sep       alternative separator: | inside {}, | or , inside <random:...>
//   paren     ( ) of emphasis
//   bracket   [ ] of de-emphasis, alternation and scheduling
//   weight    weight number: :1.2 before a closing bracket or in <lora:name:0.8>
//   break     the word BREAK
//   wildcard  __name__
//   embedding embedding:name
//   escape    escaped brackets \( \)
//   comment   # to end of line, only at the start of a line
// For tokens inside a choice block, the alt field alternates 0/1 per alternative.
App.promptSyntax = (() => {
  const TAG_OPEN = /^<([a-zA-Z_][\w-]*)(\[[^\]<>]*\])?(:|>)/;
  const WEIGHT_TAIL = /:\s*-?\d*\.?\d+\s*$/;
  const RANDOM_TAGS = new Set(['random', 'wildcard', 'alternate', 'fromto']);

  function tokenize(text) {
    const tokens = [];
    const stack = [];   // contexts: { kind, sep, alt, name }
    let buf = '';
    let i = 0;
    let lineStart = true;

    const top = () => stack[stack.length - 1] || null;
    const altOf = () => { const t = top(); return t && t.sep ? t.alt : null; };
    const push = (type, s) => { if (s) tokens.push({ type, text: s, alt: altOf() }); };
    const flush = () => { if (buf) { splitText(buf, altOf(), tokens); buf = ''; } };

    // Split a trailing weight number off the buffer text: "(fur:1.2)" -> text "fur", weight ":1.2".
    const flushWithWeight = () => {
      const m = WEIGHT_TAIL.exec(buf);
      if (m) {
        const head = buf.slice(0, m.index);
        buf = head;
        flush();
        tokens.push({ type: 'weight', text: m[0], alt: altOf() });
      } else {
        flush();
      }
    };

    // For <random:...> the separator depends on the content: | if present, otherwise a comma.
    const randomSeparator = (from) => {
      let depth = 0;
      for (let j = from; j < text.length; j++) {
        const c = text[j];
        if (c === '<') depth++;
        else if (c === '>') { if (depth === 0) return text.slice(from, j).includes('|') ? '|' : ','; depth--; }
      }
      return '|';
    };

    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '\\' && next && '()[]{}<>\\'.includes(next)) {
        flush(); push('escape', c + next); i += 2; lineStart = false; continue;
      }

      if (c === '#' && lineStart) {
        flush();
        let j = text.indexOf('\n', i);
        if (j < 0) j = text.length;
        push('comment', text.slice(i, j));
        i = j;
        continue;
      }

      if (c === '<') {
        const m = TAG_OPEN.exec(text.slice(i));
        if (m) {
          flush();
          const name = m[1].toLowerCase();
          push('tag', '<');
          push('tagname', m[0].slice(1));
          if (m[3] === '>') {
            // A tag without content, like <clear> or <break>.
            tokens.pop(); tokens.pop();
            push('tag', m[0]);
          } else {
            stack.push({ kind: 'tag', name, sep: RANDOM_TAGS.has(name) ? randomSeparator(i + m[0].length) : null, alt: 0 });
          }
          i += m[0].length; lineStart = false; continue;
        }
      }
      if (c === '>' && top() && top().kind === 'tag') {
        flushWithWeight(); stack.pop(); push('tag', '>'); i++; lineStart = false; continue;
      }

      if (c === '{') { flush(); stack.push({ kind: 'brace', sep: '|', alt: 0 }); push('brace', c); i++; lineStart = false; continue; }
      if (c === '}' && top() && top().kind === 'brace') { flush(); stack.pop(); push('brace', c); i++; lineStart = false; continue; }

      if (c === '(') { flush(); stack.push({ kind: 'paren', sep: null, alt: 0 }); push('paren', c); i++; lineStart = false; continue; }
      if (c === ')' && top() && top().kind === 'paren') { flushWithWeight(); stack.pop(); push('paren', c); i++; lineStart = false; continue; }

      if (c === '[') { flush(); stack.push({ kind: 'bracket', sep: '|', alt: 0 }); push('bracket', c); i++; lineStart = false; continue; }
      if (c === ']' && top() && top().kind === 'bracket') { flushWithWeight(); stack.pop(); push('bracket', c); i++; lineStart = false; continue; }

      const ctx = top();
      if (ctx && ctx.sep && c === ctx.sep) {
        flush(); push('sep', c); ctx.alt++; i++; lineStart = false; continue;
      }

      buf += c;
      lineStart = c === '\n' || (lineStart && (c === ' ' || c === '\t'));
      i++;
    }
    flush();
    return tokens;
  }

  // Within plain text, pick out BREAK, __wildcard__ and embedding:name.
  const INLINE = /(\bBREAK\b|__[\w\-./ ]+__|\bembedding:[\w\-.]+)/g;
  function splitText(s, alt, out) {
    let last = 0;
    for (const m of s.matchAll(INLINE)) {
      if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index), alt });
      const t = m[0];
      out.push({ type: t === 'BREAK' ? 'break' : t.startsWith('__') ? 'wildcard' : 'embedding', text: t, alt });
      last = m.index + t.length;
    }
    if (last < s.length) out.push({ type: 'text', text: s.slice(last), alt });
  }

  return { tokenize };
})();

// Highlight rendering: a fragment with a <span class="ps-..."> per token.
// The toggle is global and lasts until the page reloads.
App.card.renderPromptText = function renderPromptText(text) {
  if (!App.settings.highlight) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  for (const t of App.promptSyntax.tokenize(text)) {
    if (t.type === 'text' && t.alt === null) { frag.append(document.createTextNode(t.text)); continue; }
    const span = document.createElement('span');
    span.className = `ps-${t.type}${t.alt !== null ? ` ps-alt-${t.alt % 2}` : ''}`;
    span.textContent = t.text;
    frag.append(span);
  }
  return frag;
};
