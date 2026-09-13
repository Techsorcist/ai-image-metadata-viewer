// InvokeAI: invokeai_metadata (current JSON), sd-metadata and Dream (older versions).
// Written from documentation and reference code, no real sample was available:
// verified only on synthetic fixtures.
App.parsers.register('invokeai', (record) => {
  const { emptyCard, addParam, addExtra } = App.parsers;
  const card = emptyCard();
  const entry = record.entries.find(e => e.key === 'invokeai_metadata');
  if (!entry || !entry.json) {
    card.notes.push('invokeai_metadata is missing or not JSON, only graph/workflow are present.');
    return card;
  }
  const m = Object.assign({}, entry.json);
  const take = (key) => { if (!(key in m)) return null; const v = m[key]; delete m[key]; return v; };
  const name = obj => (obj && typeof obj === 'object') ? (obj.name || obj.model_name || obj.key || null) : (obj == null ? null : String(obj));

  card.positive.text = String(take('positive_prompt') || '');
  card.negative.text = String(take('negative_prompt') || '');
  const styleP = take('positive_style_prompt');
  const styleN = take('negative_style_prompt');
  if (styleP && styleP !== card.positive.text) addExtra(card, 'positive_style_prompt', styleP);
  if (styleN && styleN !== card.negative.text) addExtra(card, 'negative_style_prompt', styleN);

  const model = take('model');
  const width = take('width');
  const height = take('height');

  addParam(card, 'Model', name(model));
  addParam(card, 'Seed', take('seed'));
  addParam(card, 'Steps', take('steps'));
  addParam(card, 'CFG', take('cfg_scale'));
  addParam(card, 'CFG rescale', take('cfg_rescale_multiplier'));
  addParam(card, 'Scheduler', take('scheduler'));
  addParam(card, 'Size', width && height ? `${width} × ${height}` : null);
  addParam(card, 'Clip skip', take('clip_skip'));
  addParam(card, 'Denoise', take('strength'));
  addParam(card, 'Mode', take('generation_mode'));
  addParam(card, 'Version', take('app_version'));

  if (model) card.models.push({ role: 'checkpoint', name: name(model), hash: model.hash || null, weight: null });
  const vae = take('vae');
  if (vae) card.models.push({ role: 'vae', name: name(vae), hash: vae.hash || null, weight: null });
  const refiner = take('refiner_model');
  if (refiner) card.models.push({ role: 'refiner', name: name(refiner), hash: refiner.hash || null, weight: null });
  const loras = take('loras');
  if (Array.isArray(loras)) {
    for (const l of loras) {
      const lm = l && (l.model || l.lora || l);
      card.models.push({ role: 'lora', name: name(lm), hash: (lm && lm.hash) || null, weight: l && l.weight != null ? String(l.weight) : null });
    }
  }

  for (const [k, v] of Object.entries(m)) addExtra(card, k, v);
  return card;
});

App.parsers.register('invokeai-legacy', (record) => {
  const { emptyCard, addParam, addExtra } = App.parsers;
  const card = emptyCard();
  const sd = record.entries.find(e => e.key === 'sd-metadata');
  const dream = record.entries.find(e => e.key === 'Dream');

  if (sd && sd.json) {
    const j = sd.json;
    const img = Object.assign({}, j.image || {});
    const take = (key) => { if (!(key in img)) return null; const v = img[key]; delete img[key]; return v; };
    const prompt = take('prompt');
    if (Array.isArray(prompt)) {
      card.positive.text = prompt.map(p => (p && typeof p === 'object') ? p.prompt : String(p)).filter(Boolean).join('\n');
    } else if (prompt != null) {
      card.positive.text = String(prompt);
    }
    // Old InvokeAI kept the negative in square brackets inside the prompt.
    const neg = [...card.positive.text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    if (neg.length) card.negative.text = neg.join(', ');

    addParam(card, 'Model', j.model_weights || j.model);
    addParam(card, 'Seed', take('seed'));
    addParam(card, 'Steps', take('steps'));
    addParam(card, 'CFG', take('cfg_scale'));
    addParam(card, 'Sampler', take('sampler'));
    const w = take('width'), h = take('height');
    addParam(card, 'Size', w && h ? `${w} × ${h}` : null);
    addParam(card, 'Version', j.app_version);
    if (j.model_weights || j.model) card.models.push({ role: 'checkpoint', name: j.model_weights || j.model, hash: j.model_hash || null, weight: null });
    for (const [k, v] of Object.entries(img)) addExtra(card, k, v);
    for (const k of ['app_id', 'model', 'model_hash']) if (k in j) addExtra(card, k, j[k]);
    return card;
  }

  if (dream) {
    // "prompt text" -s 50 -S 12345 -W 512 -H 512 -C 7.5 -A k_lms
    const m = /^"([\s\S]*?)"\s*(.*)$/.exec(dream.value.trim());
    if (m) {
      card.positive.text = m[1];
      const flags = {};
      for (const f of m[2].matchAll(/-(\w)\s+(\S+)/g)) flags[f[1]] = f[2];
      addParam(card, 'Seed', flags.S);
      addParam(card, 'Steps', flags.s);
      addParam(card, 'CFG', flags.C);
      addParam(card, 'Sampler', flags.A);
      addParam(card, 'Size', flags.W && flags.H ? `${flags.W} × ${flags.H}` : null);
      for (const [k, v] of Object.entries(flags)) if (!'SsCAWH'.includes(k)) addExtra(card, `-${k}`, v);
    } else {
      card.positive.text = dream.value;
    }
  }
  return card;
});
