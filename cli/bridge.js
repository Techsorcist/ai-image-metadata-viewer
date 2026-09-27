// Entry points for the console mode, evaluated by cli/engine.py after the non-UI modules.
// Python is one more metadata source: cli/record.py reads the file and builds the record,
// this side finishes it exactly like App.source.readFile does once the bytes are read.
// Everything crosses the boundary as a JSON string, in both directions.
App.bridge = (() => {
  // recordJson: the record from cli/record.py, entries without json yet.
  function readRecord(recordJson) {
    const record = JSON.parse(recordJson);
    for (const e of record.entries) e.json = App.util.tryParseJson(e.value);
    record.generator = App.detect.detect(record);
    record.card = App.parsers.parse(record);
    if (record.card) record.notes.push(...record.card.notes);
    // A string, not the object: quickjs-ng 0.16.2.1 cannot hand a concatenated (rope) string
    // over to Python, and JSON.stringify output happens to be flat. Yes, it was checked.
    // Sets (card.executed) would silently become {}, so they travel as arrays.
    return JSON.stringify(record, (_, v) => (v instanceof Set ? [...v] : v));
  }

  return { readRecord };
})();
