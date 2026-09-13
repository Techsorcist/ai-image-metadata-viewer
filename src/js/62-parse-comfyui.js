// ComfyUI: prompt = API graph { id: { class_type, inputs, _meta } }.
// If there is no prompt, the workflow UI graph is converted to the same shape (see 64-comfy-workflow.js).
// The strategy is structural, with no list of node types: a sampler is a node with
// positive and negative inputs (or guider for SamplerCustomAdvanced); text is found
// by following links from those inputs, model and LoRA via the model chain.
App.parsers.register('comfyui', (record) => {
  const { emptyCard } = App.parsers;
  const card = emptyCard();
  const promptEntry = record.entries.find(e => e.key === 'prompt');
  const workflowEntry = record.entries.find(e => e.key === 'workflow');

  let graph = null;
  let executed = null;
  let status = null;
  let notes = [];

  if (promptEntry && promptEntry.json) {
    graph = promptEntry.json;
    executed = new Set(Object.keys(graph));
  } else if (workflowEntry && workflowEntry.json && Array.isArray(workflowEntry.json.nodes)) {
    const converted = App.comfyWorkflow.convert(workflowEntry.json);
    graph = converted.graph;
    executed = App.comfyWorkflow.executedSet(graph);
    status = converted.status;
    notes = converted.notes;
    card.notes.push('No API graph (prompt) in the file, values are reconstructed from the UI workflow: widget names for custom nodes are guessed.');
  } else {
    card.notes.push('Neither prompt nor workflow JSON is readable.');
    return card;
  }

  const analysis = App.parsers.analyzeComfyGraph(graph);
  card.notes.push(...analysis.notes);

  // Text nodes: those used in generation, then unconnected ones, then canvas notes.
  const used = analysis.textNodes.filter(t => t.used).map(t => ({ ...t, kind: 'used' }));
  const unused = analysis.textNodes.filter(t => !t.used).map(t => ({ ...t, kind: 'unused' }));
  card.textNodes = [...used, ...unused, ...notes];

  if (analysis.passes.length === 0) {
    card.notes.push('No sampler node found in the graph, showing text nodes only.');
  } else {
    const main = analysis.passes[0];
    card.positive.text = main.positive;
    card.negative.text = main.negative;
    card.params = main.params.slice();
    if (analysis.passes.length > 1) card.passes = analysis.passes;
  }

  card.models = analysis.models;
  const checkpoint = analysis.models.find(m => m.role === 'checkpoint');
  if (checkpoint) card.params.unshift({ label: 'Model', value: checkpoint.name, sub: checkpoint.detail || null });

  // What on the canvas was actually executed: the workflow tree needs it for markers.
  card.executed = executed;
  card.nodeStatus = status;
  return card;
});

// Graph analysis is split out so tree highlighting and check.html can use it too.
App.parsers.analyzeComfyGraph = function analyzeComfyGraph(graph) {
  const TEXT_FIELDS = ['text', 'prompt', 'text_g', 'text_l', 'string', 'positive', 'negative', 'wildcard_text', 'populated_text', 'clip_l', 't5xxl', 'value'];
  // Do not walk up through these inputs: they lead to loaders and images, not text.
  const STOP_FIELDS = new Set(['clip', 'clip1', 'clip2', 'model', 'model1', 'model2', 'vae', 'latent', 'latent_image', 'samples', 'image', 'images', 'pixels', 'mask', 'upscale_model', 'control_net', 'style_model', 'clip_vision', 'clip_vision_output', 'sampler', 'sigmas', 'noise', 'guider']);
  const CONTROL_FIELDS = new Set(['sampler', 'sigmas', 'noise', 'guider', 'scheduler']);
  const CLIP_FIELDS = ['clip', 'clip1', 'clip2'];

  const notes = [];
  const node = id => graph[String(id)];
  const isLink = v => Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number');
  const title = n => (n && n._meta && n._meta.title) || null;

  // Scalar input value: either stored on the node or linked from a primitive.
  function scalar(n, key) {
    if (!n || !n.inputs || !(key in n.inputs)) return null;
    const v = n.inputs[key];
    if (!isLink(v)) return v;
    const src = node(v[0]);
    if (!src || !src.inputs) return null;
    for (const k of ['value', key, 'string', 'text', 'int', 'float', 'number']) {
      if (k in src.inputs && !isLink(src.inputs[k])) return src.inputs[k];
    }
    const firstScalar = Object.values(src.inputs).find(x => !isLink(x) && x !== null && typeof x !== 'object');
    return firstScalar === undefined ? null : firstScalar;
  }

  // All text nodes for the tabs; used is set while walking from the samplers.
  const textNodes = [];
  const textNodeIds = new Set();
  for (const [id, n] of Object.entries(graph)) {
    if (!n || !n.inputs) continue;
    for (const field of TEXT_FIELDS) {
      const v = n.inputs[field];
      if (typeof v === 'string' && v.trim() !== '') {
        textNodes.push({ id, classType: n.class_type, title: title(n), field, text: v, used: false });
        textNodeIds.add(id);
      }
    }
  }
  const markUsed = id => { for (const t of textNodes) if (t.id === String(id)) t.used = true; };

  // Text upstream of a node. For nodes with paired positive/negative inputs
  // (ControlNetApplyAdvanced and the like) follow only the branch whose output
  // we arrived through: slot 0 is positive, slot 1 is negative.
  function collectText(startId, startSlot, controlnets) {
    const found = [];
    const visited = new Set();
    const walk = (id, slot, depth) => {
      const key = String(id);
      if (visited.has(key) || depth > 24) return;
      visited.add(key);
      const n = node(key);
      if (!n || !n.inputs) return;
      const inp = n.inputs;
      const own = [];
      for (const field of TEXT_FIELDS) {
        const v = inp[field];
        if (typeof v === 'string' && v.trim() !== '') own.push({ field, text: v });
      }
      if (own.length) markUsed(key);
      if (own.length === 2 && own[0].field === 'text_g' && own[1].field === 'text_l' && own[0].text === own[1].text) own.pop();
      for (const o of own) found.push(o.field === 'text_l' || o.field === 'text_g' ? `[${o.field}] ${o.text}` : o.text);

      if (controlnets && isLink(inp.control_net)) {
        const loader = node(inp.control_net[0]);
        const name = loader && loader.inputs && (loader.inputs.control_net_name || loader.inputs.model_name);
        if (name) controlnets.push({ role: 'controlnet', name: String(name), hash: null, weight: inp.strength != null ? String(inp.strength) : null });
      }

      const paired = isLink(inp.positive) && isLink(inp.negative);
      for (const [field, v] of Object.entries(inp)) {
        if (!isLink(v) || STOP_FIELDS.has(field)) continue;
        if (paired && (field === 'positive' || field === 'negative')) {
          const want = slot === 1 ? 'negative' : 'positive';
          if (field !== want) continue;
        }
        walk(v[0], v[1], depth + 1);
      }
    };
    walk(startId, startSlot, 0);
    return found.join('\n');
  }

  // Parameter lookup: on the node itself, then upstream via control inputs (sampler, sigmas, noise, guider).
  function findParam(startId, keys) {
    const visited = new Set();
    const queue = [String(startId)];
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = node(id);
      if (!n || !n.inputs) continue;
      for (const k of keys) {
        if (k in n.inputs) {
          const v = scalar(n, k);
          if (v !== null && v !== undefined) return v;
        }
      }
      for (const [field, v] of Object.entries(n.inputs)) {
        if (isLink(v) && CONTROL_FIELDS.has(field)) queue.push(String(v[0]));
      }
    }
    return null;
  }

  // Upstream lookup over an arbitrary set of fields, for clip skip via the clip chain.
  function findUp(startId, fields, key, depth = 0, visited = new Set()) {
    const id = String(startId);
    if (visited.has(id) || depth > 32) return null;
    visited.add(id);
    const n = node(id);
    if (!n || !n.inputs) return null;
    if (key in n.inputs && !isLink(n.inputs[key])) return n.inputs[key];
    for (const f of fields) {
      if (isLink(n.inputs[f])) {
        const r = findUp(n.inputs[f][0], fields, key, depth + 1, visited);
        if (r !== null) return r;
      }
    }
    return null;
  }

  // Model chain: LoRAs along the way, checkpoint or UNET at the end, merges expanded recursively.
  function modelChain(startId, depth = 0) {
    const loras = [];
    let checkpoint = null;
    const visited = new Set();
    let id = startId != null ? String(startId) : null;
    while (id && !visited.has(id) && depth < 8) {
      visited.add(id);
      const n = node(id);
      if (!n || !n.inputs) break;
      const inp = n.inputs;
      if (typeof inp.lora_name === 'string') {
        loras.push({ role: 'lora', name: inp.lora_name, hash: null, weight: inp.strength_model != null ? String(inp.strength_model) : null });
      }
      const ckpt = inp.ckpt_name || inp.unet_name;
      if (typeof ckpt === 'string') { checkpoint = { role: 'checkpoint', name: ckpt, hash: null, weight: null }; break; }
      if (isLink(inp.model1) && isLink(inp.model2)) {
        const a = modelChain(inp.model1[0], depth + 1);
        const b = modelChain(inp.model2[0], depth + 1);
        loras.push(...a.loras, ...b.loras);
        checkpoint = {
          role: 'checkpoint',
          name: `${a.checkpoint ? a.checkpoint.name : '?'} + ${b.checkpoint ? b.checkpoint.name : '?'}`,
          hash: null, weight: null,
          detail: inp.ratio != null ? `merge @ ${inp.ratio}` : 'merge',
        };
        break;
      }
      const next = isLink(inp.model) ? inp.model : (isLink(inp.unet) ? inp.unet : null);
      id = next ? String(next[0]) : null;
    }
    return { loras, checkpoint };
  }

  // Latent size: EmptyLatentImage, upscale by factor, or the image feeding VAEEncode.
  function latentInfo(startId) {
    const visited = new Set();
    let id = startId != null ? String(startId) : null;
    while (id && !visited.has(id) && visited.size < 32) {
      visited.add(id);
      const n = node(id);
      if (!n || !n.inputs) break;
      const inp = n.inputs;
      const w = scalar(n, 'width'), h = scalar(n, 'height');
      if (typeof w === 'number' && typeof h === 'number') return { size: `${w} × ${h}`, sub: null, source: n.class_type };
      if (inp.scale_by != null && !isLink(inp.scale_by)) return { size: inp.upscale_method || 'upscale', sub: `× ${inp.scale_by}`, source: n.class_type };
      if (typeof inp.image === 'string') return { size: null, source: `image: ${inp.image}` };
      const next = ['latent_image', 'samples', 'latent', 'pixels', 'image', 'images'].map(f => inp[f]).find(isLink);
      id = next ? String(next[0]) : null;
    }
    return { size: null, sub: null, source: null };
  }

  // Samplers: positive+negative directly on the node, or via a guider.
  const samplers = [];
  for (const [id, n] of Object.entries(graph)) {
    if (!n || !n.inputs) continue;
    const inp = n.inputs;
    if (isLink(inp.positive) && isLink(inp.negative) && (isLink(inp.model) || isLink(inp.latent_image))) {
      samplers.push({ id, n, condNode: n });
    } else if (isLink(inp.guider) && isLink(inp.latent_image)) {
      const g = node(inp.guider[0]);
      samplers.push({ id, n, condNode: g && g.inputs ? g : null });
    }
  }

  const passes = samplers.map(({ id, n, condNode }) => {
    const inp = n.inputs;
    const cond = condNode ? condNode.inputs : {};
    const controlnets = [];
    const posLink = isLink(cond.positive) ? cond.positive : (isLink(cond.conditioning) ? cond.conditioning : null);
    const positive = posLink ? collectText(posLink[0], posLink[1], controlnets) : '';
    const negative = isLink(cond.negative) ? collectText(cond.negative[0], cond.negative[1], null) : '';
    const startStep = inp.start_at_step != null ? Number(scalar(n, 'start_at_step')) : 0;
    const modelLink = isLink(inp.model) ? inp.model[0] : (isLink(cond.model) ? cond.model[0] : null);
    const chain = modelChain(modelLink);
    const latent = latentInfo(isLink(inp.latent_image) ? inp.latent_image[0] : null);
    const clipSkip = posLink ? findUp(posLink[0], CLIP_FIELDS.concat(['positive', 'conditioning']), 'stop_at_clip_layer') : null;

    const params = [];
    // Numbers from JSON can look like 0.7000000000000001; round them for the card.
    const fmt = v => typeof v === 'number' ? String(Number(v.toFixed(4))) : String(v);
    const push = (label, value, sub) => { if (value !== null && value !== undefined && value !== '') params.push({ label, value: fmt(value), sub: sub == null ? null : String(sub) }); };
    push('Seed', findParam(id, ['seed', 'noise_seed']));
    push('Steps', findParam(id, ['steps']));
    push('CFG', findParam(id, ['cfg']));
    push('Sampler', findParam(id, ['sampler_name']));
    push('Scheduler', findParam(id, ['scheduler']));
    push('Denoise', findParam(id, ['denoise']));
    push('Size', latent.size, latent.sub);
    if (latent.source && !latent.size) push('Latent from', latent.source);
    push('Clip skip', clipSkip);
    // Show the step range only when it is actually truncated (refiner, hires).
    const endRaw = scalar(n, 'end_at_step');
    const totalSteps = Number(findParam(id, ['steps']));
    const endStep = endRaw != null && Number(endRaw) < 10000 && !(totalSteps && Number(endRaw) >= totalSteps) ? Number(endRaw) : null;
    if (startStep > 0 || endStep !== null) push('Step range', `${startStep} → ${endStep === null ? 'end' : endStep}`);

    return {
      id,
      label: `${title(n) && title(n) !== n.class_type ? title(n) : n.class_type} #${id}`,
      positive,
      negative,
      params,
      models: [chain.checkpoint, ...chain.loras, ...controlnets].filter(Boolean),
      startStep,
      fromEmptyLatent: latent.source ? /Empty/i.test(latent.source) : false,
    };
  });

  // Main pass: starts from an empty latent and step zero; refiner and hires come later.
  passes.sort((a, b) => (b.fromEmptyLatent - a.fromEmptyLatent) || (a.startStep - b.startStep) || (Number(a.id) - Number(b.id)));

  // Models: merged across passes without duplicates; VAE and upscalers searched over the whole graph.
  const models = [];
  const seen = new Set();
  const addModel = m => {
    const k = `${m.role}:${m.name}:${m.weight}`;
    if (!seen.has(k)) { seen.add(k); models.push(m); }
  };
  for (const p of passes) for (const m of p.models) addModel(m);
  for (const n of Object.values(graph)) {
    if (!n || !n.inputs) continue;
    if (typeof n.inputs.vae_name === 'string') addModel({ role: 'vae', name: n.inputs.vae_name, hash: null, weight: null });
    if (typeof n.inputs.model_name === 'string' && /upscale/i.test(n.class_type || '')) addModel({ role: 'upscaler', name: n.inputs.model_name, hash: null, weight: null });
  }

  return { passes, textNodes, models, notes };
};
