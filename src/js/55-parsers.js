// Registry of generator parsers and the unified card model.
//
// Each parser receives a record (see 20-source.js) and returns a card:
// {
//   positive: { text, original },      // original: the source prompt before wildcard expansion, or null
//   negative: { text, original },
//   params:   [{ label, value, sub }], // card grid in display order, sub is the second line
//   models:   [{ role, name, hash, weight, detail }],   // role: checkpoint | lora | vae | upscaler | embedding | refiner | controlnet
//   extra:    [{ key, value }],        // everything that did not fit the card, as a table
//   passes:   [{ label, positive, negative, params }] | null,   // ComfyUI: multiple samplers
//   textNodes:[{ id, classType, title, field, text }] | null,   // ComfyUI: all text nodes
//   notes:    [string],                // parser remarks, shown as warnings
// }
App.parsers = (() => {
  const registry = {};

  function register(generatorId, fn) {
    registry[generatorId] = fn;
  }

  function emptyCard() {
    return {
      positive: { text: '', original: null },
      negative: { text: '', original: null },
      params: [],
      models: [],
      extra: [],
      passes: null,
      textNodes: null,
      notes: [],
    };
  }

  // Adds a parameter, skipping empty values. sub is the card's second line
  // for a numeric suffix like "× 1.5" or "@ 0.75".
  function addParam(card, label, value, sub) {
    if (value === null || value === undefined || value === '') return;
    card.params.push({ label, value: String(value), sub: sub == null ? null : String(sub) });
  }

  function addExtra(card, key, value) {
    if (value === null || value === undefined || value === '') return;
    card.extra.push({ key, value: typeof value === 'object' ? JSON.stringify(value) : String(value) });
  }

  function parse(record) {
    const id = record.generator && record.generator.id;
    const fn = registry[id];
    if (!fn) return null;
    try {
      return fn(record);
    } catch (e) {
      record.warnings.push(`Parser for ${record.generator.name} failed: ${e.message}`);
      return null;
    }
  }

  return { register, parse, emptyCard, addParam, addExtra };
})();
