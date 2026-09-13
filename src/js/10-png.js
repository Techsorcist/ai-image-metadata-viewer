// Reading PNG text chunks: tEXt, zTXt, iTXt.
// Knows nothing about generators, only extracts key/value pairs and dimensions.
App.png = (() => {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');

  function isPng(bytes) {
    return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
  }

  // Chunk generator: { type, data }. Stops at IEND.
  function* chunks(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (offset + 12 + length > bytes.length) {
        throw new Error(`Chunk ${type} at offset ${offset} exceeds file size`);
      }
      yield { type, data: bytes.subarray(offset + 8, offset + 8 + length) };
      offset += 12 + length;
      if (type === 'IEND') break;
    }
  }

  // A zlib stream (RFC 1950) is inflated with the native DecompressionStream('deflate').
  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream is not available in this browser');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Reads bytes up to NUL starting at from. Returns [slice, position after NUL].
  function readUntilNul(data, from) {
    const end = data.indexOf(0, from);
    if (end < 0) throw new Error('missing NUL separator');
    return [data.subarray(from, end), end + 1];
  }

  async function decodeText(chunk) {
    const { type, data } = chunk;
    let [keyBytes, pos] = readUntilNul(data, 0);
    const key = latin1.decode(keyBytes);

    if (type === 'tEXt') {
      // Latin-1 per the spec, but generators write UTF-8 there (SwarmUI, ComfyUI),
      // so we decode as UTF-8: for pure ASCII the result is the same.
      return { key, value: utf8.decode(data.subarray(pos)), chunkType: type, compressed: false };
    }

    if (type === 'zTXt') {
      const method = data[pos];
      if (method !== 0) throw new Error(`unsupported zTXt compression method ${method}`);
      const raw = await inflate(data.subarray(pos + 1));
      return { key, value: utf8.decode(raw), chunkType: type, compressed: true };
    }

    if (type === 'iTXt') {
      const compressed = data[pos] === 1;
      const method = data[pos + 1];
      pos += 2;
      let langBytes, translatedBytes;
      [langBytes, pos] = readUntilNul(data, pos);
      [translatedBytes, pos] = readUntilNul(data, pos);
      let payload = data.subarray(pos);
      if (compressed) {
        if (method !== 0) throw new Error(`unsupported iTXt compression method ${method}`);
        payload = await inflate(payload);
      }
      return {
        key,
        value: utf8.decode(payload),
        chunkType: type,
        compressed,
        language: latin1.decode(langBytes) || null,
        translatedKey: utf8.decode(translatedBytes) || null,
      };
    }

    throw new Error(`not a text chunk: ${type}`);
  }

  // Main entry point: dimensions from IHDR and the list of text entries.
  // Errors in individual chunks do not abort parsing, they go to warnings.
  async function read(bytes) {
    const result = { width: null, height: null, bitDepth: null, colorType: null, entries: [], warnings: [] };
    for (const chunk of chunks(bytes)) {
      if (chunk.type === 'IHDR') {
        const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        result.width = view.getUint32(0);
        result.height = view.getUint32(4);
        result.bitDepth = chunk.data[8];
        result.colorType = chunk.data[9];
        continue;
      }
      if (chunk.type !== 'tEXt' && chunk.type !== 'zTXt' && chunk.type !== 'iTXt') continue;
      try {
        result.entries.push(await decodeText(chunk));
      } catch (e) {
        result.warnings.push(`Failed to read ${chunk.type} chunk: ${e.message}`);
      }
    }
    return result;
  }

  return { isPng, read };
})();
