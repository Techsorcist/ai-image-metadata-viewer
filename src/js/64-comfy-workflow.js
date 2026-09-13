// Converts a ComfyUI UI graph (workflow: nodes[], links[], widgets_values) into an API-like
// graph { id: { class_type, inputs, _meta } } that analyzeComfyGraph understands.
//
// Rules:
//   - muted (mode 2) nodes are dropped and links through them are cut;
//   - bypassed (mode 4) nodes pass an input through to the output of matching type; the link
//     is redirected to their source; they themselves do not enter the graph;
//   - Note and MarkdownNote do not enter the graph and are returned separately;
//   - widget values are named from a table for known types, heuristically for the rest,
//     and a link into an input always takes precedence over the widget value.
App.comfyWorkflow = (() => {
  const MODE_MUTED = 2;
  const MODE_BYPASS = 4;
  const NOTE_TYPES = new Set(['Note', 'MarkdownNote']);

  // widgets_values order for standard nodes.
  const WIDGETS = {
    KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    KSamplerAdvanced: ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
    SamplerCustom: ['add_noise', 'noise_seed', 'control_after_generate', 'cfg'],
    SamplerCustomAdvanced: [],
    RandomNoise: ['noise_seed', 'control_after_generate'],
    KSamplerSelect: ['sampler_name'],
    BasicScheduler: ['scheduler', 'steps', 'denoise'],
    BasicGuider: [],
    CFGGuider: ['cfg'],
    CLIPTextEncode: ['text'],
    CLIPTextEncodeSDXL: ['width', 'height', 'crop_w', 'crop_h', 'target_width', 'target_height', 'text_g', 'text_l'],
    CLIPTextEncodeSDXLRefiner: ['ascore', 'width', 'height', 'text'],
    CheckpointLoaderSimple: ['ckpt_name'],
    CheckpointLoader: ['config_name', 'ckpt_name'],
    UNETLoader: ['unet_name', 'weight_dtype'],
    LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
    LoraLoaderModelOnly: ['lora_name', 'strength_model'],
    VAELoader: ['vae_name'],
    CLIPLoader: ['clip_name', 'type'],
    DualCLIPLoader: ['clip_name1', 'clip_name2', 'type'],
    CLIPSetLastLayer: ['stop_at_clip_layer'],
    EmptyLatentImage: ['width', 'height', 'batch_size'],
    EmptySD3LatentImage: ['width', 'height', 'batch_size'],
    LatentUpscale: ['upscale_method', 'width', 'height', 'crop'],
    LatentUpscaleBy: ['upscale_method', 'scale_by'],
    ImageScale: ['upscale_method', 'width', 'height', 'crop'],
    ImageScaleBy: ['upscale_method', 'scale_by'],
    UpscaleModelLoader: ['model_name'],
    ImageUpscaleWithModel: [],
    ControlNetLoader: ['control_net_name'],
    ControlNetApply: ['strength'],
    ControlNetApplyAdvanced: ['strength', 'start_percent', 'end_percent'],
    ModelMergeSimple: ['ratio'],
    CLIPMergeSimple: ['ratio'],
    ModelSamplingDiscrete: ['sampling', 'zsnr'],
    ModelSamplingFlux: ['max_shift', 'base_shift', 'width', 'height'],
    FluxGuidance: ['guidance'],
    LoadImage: ['image', 'upload'],
    SaveImage: ['filename_prefix'],
    PreviewImage: [],
    VAEDecode: [],
    VAEEncode: [],
    PrimitiveNode: ['value', 'control_after_generate'],
    PrimitiveString: ['value'],
    PrimitiveStringMultiline: ['value'],
    PrimitiveInt: ['value', 'control_after_generate'],
    PrimitiveFloat: ['value'],
    StringConstant: ['string'],
    StringConstantMultiline: ['string', 'strip_newlines'],
  };

  const SAMPLERS = /^(euler|euler_ancestral|euler_cfg_pp|heun|heunpp2|dpm_2|dpm_2_ancestral|lms|dpm_fast|dpm_adaptive|dpmpp_2s_ancestral|dpmpp_sde|dpmpp_sde_gpu|dpmpp_2m|dpmpp_2m_sde|dpmpp_2m_sde_gpu|dpmpp_3m_sde|dpmpp_3m_sde_gpu|ddpm|lcm|ddim|uni_pc|uni_pc_bh2|res_multistep|ipndm|deis|er_sde|seeds_2|gradient_estimation)/;
  const SCHEDULERS = new Set(['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta', 'linear_quadratic', 'kl_optimal', 'ays', 'gits']);

  // For an unknown node type, assign names based on the values' contents.
  function guessWidgetNames(node, values) {
    const outputsString = (node.outputs || []).some(o => o && /STRING|CONDITIONING/i.test(String(o.type)));
    const textual = outputsString || /text|prompt|string|note|wildcard/i.test(node.type);
    const names = [];
    let textGiven = false;
    values.forEach((v, i) => {
      if (typeof v === 'string' && !textGiven && textual && v.trim() !== '' && !SAMPLERS.test(v) && !SCHEDULERS.has(v)) {
        names.push('text');
        textGiven = true;
      } else if (typeof v === 'string' && SAMPLERS.test(v)) {
        names.push('sampler_name');
      } else if (typeof v === 'string' && SCHEDULERS.has(v)) {
        names.push('scheduler');
      } else if (typeof v === 'number' && Number.isInteger(v) && v > 1e9) {
        names.push('seed');
      } else {
        names.push(`widget_${i}`);
      }
    });
    return names;
  }

  function convert(workflow) {
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const rawLinks = Array.isArray(workflow.links) ? workflow.links : [];
    const byId = new Map(nodes.map(n => [String(n.id), n]));

    // links: [id, srcNode, srcSlot, dstNode, dstSlot, type] or objects in newer versions.
    const links = new Map();
    for (const l of rawLinks) {
      if (Array.isArray(l)) links.set(l[0], { src: String(l[1]), srcSlot: l[2], dst: String(l[3]), dstSlot: l[4], type: l[5] });
      else if (l && typeof l === 'object') links.set(l.id, { src: String(l.origin_id), srcSlot: l.origin_slot, dst: String(l.target_id), dstSlot: l.target_slot, type: l.type });
    }

    // Link source accounting for bypass: a bypassed node yields the input of the same type as the output.
    function resolve(linkId, depth = 0) {
      const link = links.get(linkId);
      if (!link || depth > 64) return null;
      const src = byId.get(link.src);
      if (!src || src.mode === MODE_MUTED) return null;
      if (src.mode === MODE_BYPASS) {
        const out = (src.outputs || [])[link.srcSlot];
        const wantType = out ? out.type : link.type;
        const inputs = src.inputs || [];
        let candidate = inputs.find(i => i && i.link != null && i.type === wantType);
        if (!candidate) candidate = inputs.find(i => i && i.link != null && String(i.type).toUpperCase() === String(wantType).toUpperCase());
        if (!candidate) candidate = inputs.find(i => i && i.link != null);
        return candidate ? resolve(candidate.link, depth + 1) : null;
      }
      return [link.src, link.srcSlot];
    }

    const graph = {};
    const notes = [];
    const status = {}; // id -> 'muted' | 'bypassed' | 'note' | 'active'

    for (const n of nodes) {
      const id = String(n.id);
      if (NOTE_TYPES.has(n.type)) {
        status[id] = 'note';
        const text = Array.isArray(n.widgets_values) ? n.widgets_values.find(v => typeof v === 'string') : null;
        notes.push({ id, classType: n.type, title: n.title || null, field: 'note', text: text || '', kind: 'note' });
        continue;
      }
      if (n.mode === MODE_MUTED) { status[id] = 'muted'; continue; }
      if (n.mode === MODE_BYPASS) { status[id] = 'bypassed'; continue; }
      status[id] = 'active';

      const inputs = {};
      const values = Array.isArray(n.widgets_values) ? n.widgets_values
        : (n.widgets_values && typeof n.widgets_values === 'object' ? Object.values(n.widgets_values) : []);
      const names = WIDGETS[n.type] || guessWidgetNames(n, values);
      values.forEach((v, i) => {
        const name = names[i] || `widget_${i}`;
        if (name === 'control_after_generate') return;
        if (v !== null && typeof v !== 'object') inputs[name] = v;
      });

      for (const inp of n.inputs || []) {
        if (!inp || inp.link == null) continue;
        const source = resolve(inp.link);
        const name = inp.name || (inp.widget && inp.widget.name);
        if (!name) continue;
        if (source) inputs[name] = source;
        else if (inp.widget) { /* widget converted to an input whose source is gone: keep the widget value */ }
        else delete inputs[name];
      }

      graph[id] = { class_type: n.type, inputs, _meta: { title: n.title || null } };
    }

    return { graph, notes, status };
  }

  // Nodes ComfyUI would actually execute: terminal active nodes and everything upstream of them.
  function executedSet(graph) {
    const consumed = new Set();
    for (const n of Object.values(graph)) {
      for (const v of Object.values(n.inputs)) if (Array.isArray(v) && v.length === 2) consumed.add(String(v[0]));
    }
    const executed = new Set();
    const stack = Object.keys(graph).filter(id => !consumed.has(id));
    while (stack.length) {
      const id = stack.pop();
      if (executed.has(id)) continue;
      executed.add(id);
      const n = graph[id];
      if (!n) continue;
      for (const v of Object.values(n.inputs)) if (Array.isArray(v) && v.length === 2) stack.push(String(v[0]));
    }
    return executed;
  }

  return { convert, executedSet };
})();
