// SwarmUI: parameters = JSON { sui_image_params, sui_extra_data, sui_models }.
App.parsers.register('swarmui', (record) => {
  const { emptyCard, addParam, addExtra } = App.parsers;
  const card = emptyCard();
  const json = record.entries.find(e => e.key === 'parameters').json;
  const p = Object.assign({}, json.sui_image_params || {});
  const extraData = Object.assign({}, json.sui_extra_data || {});
  const models = Array.isArray(json.sui_models) ? json.sui_models : [];

  const take = (key) => {
    if (!(key in p)) return null;
    const v = p[key];
    delete p[key];
    return v;
  };
  const takeExtra = (key) => {
    if (!(key in extraData)) return null;
    const v = extraData[key];
    delete extraData[key];
    return v;
  };

  card.positive.text = String(take('prompt') || '');
  card.negative.text = String(take('negativeprompt') || '');
  const originalPrompt = takeExtra('original_prompt');
  const originalNegative = takeExtra('original_negativeprompt');
  if (originalPrompt != null && originalPrompt !== card.positive.text) card.positive.original = String(originalPrompt);
  if (originalNegative != null && originalNegative !== card.negative.text) card.negative.original = String(originalNegative);

  // Checkpoint name: either the explicit model field or the parameter referenced by sui_models.
  const hashes = {};
  let modelName = take('model');
  for (const m of models) {
    if (m && m.name) hashes[stripExt(m.name)] = m.hash || null;
    if (!modelName && m && m.param && m.param !== 'loras' && m.param in p) modelName = take(m.param);
  }

  const width = take('width');
  const height = take('height');
  const size = width && height ? `${width} × ${height}` : null;
  const aspect = take('aspectratio');

  addParam(card, 'Model', modelName);
  addParam(card, 'Seed', take('seed'));
  addParam(card, 'Steps', take('steps'));
  addParam(card, 'CFG', take('cfgscale'));
  addParam(card, 'Sampler', take('sampler'));
  addParam(card, 'Scheduler', take('scheduler'));
  addParam(card, 'Size', size ? (aspect ? `${size} (${aspect})` : size) : aspect);
  addParam(card, 'Clip skip', take('clipstopatlayer'));
  addParam(card, 'Init creativity', take('initimagecreativity'));
  const refinerUpscale = take('refinerupscale');
  if (refinerUpscale) {
    const method = take('refinerupscalemethod');
    addParam(card, 'Refiner upscale', method || `× ${refinerUpscale}`, method ? `× ${refinerUpscale}` : null);
    addParam(card, 'Refiner control', take('refinercontrolpercentage'));
    addParam(card, 'Refiner method', take('refinermethod'));
  }
  addParam(card, 'Batch', take('batchsize'));
  take('swarm_version'); // version is already in the card header

  if (modelName) card.models.push({ role: 'checkpoint', name: modelName, hash: hashes[stripExt(modelName)] || null, weight: null });

  const refinerModel = take('refinermodel');
  if (refinerModel) card.models.push({ role: 'refiner', name: refinerModel, hash: hashes[stripExt(refinerModel)] || null, weight: null });

  const vae = take('vae');
  if (vae) card.models.push({ role: 'vae', name: vae, hash: hashes[stripExt(vae)] || null, weight: null });
  else if (take('automaticvae')) addExtra(card, 'vae', 'automatic');

  // LoRA: comma-separated strings or arrays, weights as a parallel list.
  const loras = toList(take('loras'));
  const weights = toList(take('loraweights'));
  loras.forEach((name, i) => {
    card.models.push({ role: 'lora', name, hash: hashes[stripExt(name)] || null, weight: weights[i] != null ? String(weights[i]) : null });
  });

  const wildcards = takeExtra('used_wildcards');
  if (wildcards) addExtra(card, 'used_wildcards', Array.isArray(wildcards) ? wildcards.join(', ') : wildcards);

  // Internal generation timings are of no use in the card, they stay in the raw JSON.
  for (const k of ['prep_time', 'generation_time', 'intermediate']) delete extraData[k];
  for (const [k, v] of Object.entries(p)) addExtra(card, k, v);
  for (const [k, v] of Object.entries(extraData)) addExtra(card, k, v);
  return card;

  function stripExt(name) {
    return String(name).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '');
  }
  function toList(v) {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v;
    return String(v).split(',').map(s => s.trim()).filter(Boolean);
  }
});
