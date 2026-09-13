// Detecting the generator by the set of keys and their content.
// The order of checks matters: SwarmUI and Fooocus also write to parameters,
// ComfyUI via Swarm writes prompt/workflow next to parameters.
App.detect = (() => {
  function gen(id, name, keys, detail) {
    return { id, name, keys, detail: detail || null };
  }

  // ComfyUI API graph: an object whose values have class_type and inputs.
  function isComfyApiGraph(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
    const values = Object.values(json);
    return values.length > 0 && values.some(n => n && typeof n === 'object' && 'class_type' in n && 'inputs' in n);
  }

  // ComfyUI UI graph: nodes[] and links[].
  function isComfyWorkflow(json) {
    return !!json && typeof json === 'object' && Array.isArray(json.nodes) && Array.isArray(json.links);
  }

  // A1111 string: has a parameter block like "Steps: 20, Sampler: ...".
  function isA1111Text(text) {
    return typeof text === 'string' && /(^|\n)Steps:\s*\d+/.test(text);
  }

  function a1111Flavor(text) {
    const m = /Version:\s*([^,\n]+)/.exec(text);
    if (!m) return { name: 'A1111 / Forge', detail: null };
    const v = m[1].trim();
    if (/^f\d/.test(v)) return { name: 'Forge', detail: v };
    if (/^v?\d/.test(v)) return { name: 'AUTOMATIC1111', detail: v };
    return { name: 'A1111-compatible', detail: v };
  }

  // The ComfyUI frontend version lives in workflow.extra.frontendVersion; the backend version is not in the file.
  function comfyVersion(workflowEntry) {
    const extra = workflowEntry && workflowEntry.json && workflowEntry.json.extra;
    return extra && extra.frontendVersion ? `frontend ${extra.frontendVersion}` : null;
  }

  function detect(record) {
    const byKey = Object.fromEntries(record.entries.map(e => [e.key, e]));
    const has = k => k in byKey;
    const keysOf = (...ks) => ks.filter(has);
    const params = byKey.parameters;

    if (params && params.json && params.json.sui_image_params) {
      return gen('swarmui', 'SwarmUI', keysOf('parameters', 'prompt', 'workflow'), params.json.sui_image_params.swarm_version);
    }

    if (has('invokeai_metadata') || has('invokeai_graph') || has('invokeai_workflow')) {
      return gen('invokeai', 'InvokeAI', keysOf('invokeai_metadata', 'invokeai_graph', 'invokeai_workflow'));
    }
    if (has('sd-metadata') || has('Dream')) {
      return gen('invokeai-legacy', 'InvokeAI (legacy)', keysOf('sd-metadata', 'Dream'));
    }

    if (byKey.Software && /novelai/i.test(byKey.Software.value)) {
      return gen('novelai', 'NovelAI', keysOf('Software', 'Title', 'Description', 'Comment', 'Source'), byKey.Source && byKey.Source.value);
    }

    if (has('fooocus_scheme') || (byKey.Comment && byKey.Comment.json && 'full_prompt' in byKey.Comment.json)) {
      return gen('fooocus', 'Fooocus', keysOf('parameters', 'fooocus_scheme', 'Comment'), byKey.fooocus_scheme && byKey.fooocus_scheme.value);
    }

    if (params && isA1111Text(params.value)) {
      const flavor = a1111Flavor(params.value);
      const keys = keysOf('parameters', 'postprocessing');
      const name = has('prompt') && byKey.prompt.json && isComfyApiGraph(byKey.prompt.json)
        ? 'ComfyUI (A1111-compatible parameters)'
        : flavor.name;
      return gen('a1111', name, has('prompt') ? keys.concat(keysOf('prompt', 'workflow')) : keys, flavor.detail);
    }
    if (has('postprocessing')) {
      return gen('a1111', 'AUTOMATIC1111 Extras', ['postprocessing']);
    }

    if (byKey.prompt && isComfyApiGraph(byKey.prompt.json)) {
      return gen('comfyui', 'ComfyUI', keysOf('prompt', 'workflow'), comfyVersion(byKey.workflow));
    }
    if (byKey.workflow && isComfyWorkflow(byKey.workflow.json)) {
      return gen('comfyui', 'ComfyUI (workflow only)', ['workflow'], comfyVersion(byKey.workflow));
    }

    if (has('prompt') && has('negative_prompt')) {
      return gen('easydiffusion', 'Easy Diffusion', record.entries.map(e => e.key));
    }

    if (has('XML:com.adobe.xmp')) {
      const xmp = byKey['XML:com.adobe.xmp'].value;
      if (/drawthings|com\.liuliu/i.test(xmp)) return gen('drawthings', 'Draw Things', ['XML:com.adobe.xmp']);
      return gen('xmp', 'XMP metadata', ['XML:com.adobe.xmp']);
    }

    if (record.entries.length === 0) return gen('none', 'No metadata', []);
    return gen('unknown', 'Unknown', []);
  }

  return { detect, isComfyApiGraph, isComfyWorkflow, isA1111Text };
})();
