// Text format of AUTOMATIC1111 / Forge / SD.Next and compatible tools:
//   prompt
//   Negative prompt: negative
//   Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 1, Size: 512x512, Model hash: abc, Model: x, ...
App.parsers.register('a1111', (record) => {
  const { emptyCard, addParam, addExtra } = App.parsers;
  const card = emptyCard();
  const entry = record.entries.find(e => e.key === 'parameters');
  const post = record.entries.find(e => e.key === 'postprocessing');
  if (!entry) {
    if (post) card.extra.push({ key: 'postprocessing', value: post.value });
    return card;
  }

  const { positive, negative, pairs } = App.parsers.parseA1111Text(entry.value);
  card.positive.text = positive;
  card.negative.text = negative;

  // Card order is fixed, the rest goes to extra.
  const take = (key) => {
    if (!(key in pairs)) return null;
    const v = pairs[key];
    delete pairs[key];
    return v;
  };

  const model = take('Model');
  const modelHash = take('Model hash');
  const vae = take('VAE');
  const vaeHash = take('VAE hash');

  addParam(card, 'Model', model);
  addParam(card, 'Seed', take('Seed'));
  addParam(card, 'Steps', take('Steps'));
  addParam(card, 'CFG', take('CFG scale'));
  addParam(card, 'Sampler', take('Sampler'));
  addParam(card, 'Scheduler', take('Schedule type'));
  addParam(card, 'Size', take('Size'));
  addParam(card, 'Clip skip', take('Clip skip'));
  addParam(card, 'Denoise', take('Denoising strength'));
  addParam(card, 'Hires upscale', take('Hires upscale'));
  addParam(card, 'Hires upscaler', take('Hires upscaler'));
  addParam(card, 'Hires steps', take('Hires steps'));
  addParam(card, 'Version', take('Version'));

  if (model || modelHash) card.models.push({ role: 'checkpoint', name: model || '(unknown)', hash: modelHash || null, weight: null });
  if (vae) card.models.push({ role: 'vae', name: vae, hash: vaeHash || null, weight: null });

  // LoRA: weights from <lora:name:w> tags in the prompt, hashes from "Lora hashes".
  const loraWeights = {};
  for (const m of positive.matchAll(/<lora:([^:>]+)(?::([\d.]+))?[^>]*>/g)) loraWeights[m[1]] = m[2] || null;
  const loraHashes = App.parsers.parseHashList(take('Lora hashes'));
  const loraNames = new Set([...Object.keys(loraWeights), ...Object.keys(loraHashes)]);
  for (const name of loraNames) {
    card.models.push({ role: 'lora', name, hash: loraHashes[name] || null, weight: loraWeights[name] || null });
  }
  const tiHashes = App.parsers.parseHashList(take('TI hashes'));
  for (const [name, hash] of Object.entries(tiHashes)) card.models.push({ role: 'embedding', name, hash, weight: null });

  for (const [k, v] of Object.entries(pairs)) addExtra(card, k, v);
  if (post) card.extra.push({ key: 'postprocessing', value: post.value });
  return card;
});

// Parsing of the string itself, kept separate: Fooocus in A1111 mode uses it too,
// and EXIF UserComment will in the future.
App.parsers.parseA1111Text = function parseA1111Text(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paramIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^Steps:\s*\d+/.test(lines[i])) { paramIdx = i; break; }
  }
  const head = (paramIdx >= 0 ? lines.slice(0, paramIdx) : lines).join('\n');
  const paramLine = paramIdx >= 0 ? lines[paramIdx] : '';

  let positive = head;
  let negative = '';
  const negMatch = /(^|\n)Negative prompt:\s?/.exec(head);
  if (negMatch) {
    positive = head.slice(0, negMatch.index);
    negative = head.slice(negMatch.index + negMatch[0].length);
  }

  // "Key: value" pairs; the value runs either up to a comma or is quoted (may contain commas and JSON).
  const pairs = {};
  const re = /\s*([^,:]+?):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g;
  let m;
  while ((m = re.exec(paramLine)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    const key = m[1].trim();
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch (_) { value = value.slice(1, -1); }
    }
    if (key) pairs[key] = value;
  }

  return { positive: positive.trim(), negative: negative.trim(), pairs };
};

// "name: hash, name2: hash2" or a JSON object -> { name: hash }
App.parsers.parseHashList = function parseHashList(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  const out = {};
  for (const part of String(value).split(',')) {
    const i = part.lastIndexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};
