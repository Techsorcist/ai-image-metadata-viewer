// The "metadata source" layer: turns a File into a unified record
// regardless of the container. PNG only for now; EXIF/XMP for JPEG and WebP
// get added here as well, without touching the detector or generator parsers.
App.source = (() => {
  function sniffFormat(bytes) {
    if (App.png.isPng(bytes)) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
    if (String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF') return 'gif';
    return 'unknown';
  }

  // Image record:
  //   entries: [{ key, value, source, chunkType, json }] — json = parsed value or null
  //   warnings: human-readable parsing problems
  async function readFile(file) {
    const record = {
      id: `${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      size: file.size,
      url: URL.createObjectURL(file),
      format: null,
      width: null,
      height: null,
      entries: [],
      warnings: [],   // file reading problems, shown prominently
      notes: [],      // parser remarks, shown dimmed
      generator: null,
      card: null,
    };

    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      record.format = 'unknown';
      record.warnings.push(`Cannot read file: ${e.message}`);
      return record;
    }

    record.format = sniffFormat(bytes);

    if (record.format === 'png') {
      try {
        const png = await App.png.read(bytes);
        record.width = png.width;
        record.height = png.height;
        record.warnings.push(...png.warnings);
        record.entries = png.entries.map(e => ({
          key: e.key,
          value: e.value,
          source: `PNG ${e.chunkType}${e.compressed ? ' (compressed)' : ''}`,
          chunkType: e.chunkType,
          json: App.util.tryParseJson(e.value),
        }));
      } catch (e) {
        record.warnings.push(`PNG parse error: ${e.message}`);
      }
    } else if (record.format === 'jpeg' || record.format === 'webp') {
      record.warnings.push(`${record.format.toUpperCase()} metadata (EXIF UserComment) is not supported yet, PNG only for now`);
    } else {
      record.warnings.push('Unsupported file format');
    }

    record.generator = App.detect.detect(record);
    record.card = App.parsers.parse(record);
    if (record.card) record.notes.push(...record.card.notes);
    return record;
  }

  return { readFile, sniffFormat };
})();
