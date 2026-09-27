"""Reading PNG text chunks: tEXt, zTXt, iTXt. Standard library only.

A line-by-line mirror of src/js/10-png.js: same chunk walk, same decoding, and read()
returns the shape of App.png.read. Knows nothing about generators.
"""
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'
TEXT_TYPES = ('tEXt', 'zTXt', 'iTXt')

# TextDecoder('latin1') is windows-1252 per the Encoding Standard, with the five bytes cp1252
# leaves undefined passed through. Python's latin-1 agrees everywhere except 0x80-0x9f.
_WIN1252 = {b: bytes([b]).decode('cp1252') for b in range(0x80, 0xA0) if b not in (0x81, 0x8D, 0x8F, 0x90, 0x9D)}


class PngError(Exception):
    """A malformed file or chunk. Messages follow the wording of 10-png.js."""


def _latin1(data):
    return data.decode('latin-1').translate(_WIN1252)


def _utf8(data):
    # TextDecoder('utf-8'): invalid bytes become U+FFFD and a leading BOM is dropped.
    return data.decode('utf-8-sig', 'replace')


def _byte(data, i):
    # Past the end JS reads undefined instead of raising.
    return data[i] if i < len(data) else None


def is_png(data):
    return len(data) >= 8 and data[:8] == SIGNATURE


def _chunks(data):
    """(type, data) pairs. Stops at IEND."""
    offset = 8
    while offset + 12 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], 'big')
        ctype = data[offset + 4:offset + 8].decode('latin-1')
        if offset + 12 + length > len(data):
            raise PngError(f'Chunk {ctype} at offset {offset} exceeds file size')
        yield ctype, data[offset + 8:offset + 8 + length]
        offset += 12 + length
        if ctype == 'IEND':
            break


def _inflate(data):
    # DecompressionStream('deflate') is zlib-wrapped (RFC 1950), same as the default wbits.
    # It also rejects a truncated stream and anything after its end; zlib.decompress would
    # quietly drop the latter, hence the decompressobj.
    d = zlib.decompressobj()
    out = d.decompress(data)
    if not d.eof:
        raise PngError('truncated zlib stream')
    if d.unused_data:
        raise PngError('data after the end of the zlib stream')
    return out


def _read_until_nul(data, start):
    """Bytes up to NUL starting at start. Returns (slice, position after NUL)."""
    end = data.find(0, start)
    if end < 0:
        raise PngError('missing NUL separator')
    return data[start:end], end + 1


def _decode_text(ctype, data):
    key_bytes, pos = _read_until_nul(data, 0)
    key = _latin1(key_bytes)

    if ctype == 'tEXt':
        # Latin-1 per the spec, but generators write UTF-8 there (SwarmUI, ComfyUI),
        # so we decode as UTF-8: for pure ASCII the result is the same.
        return {'key': key, 'value': _utf8(data[pos:]), 'chunkType': ctype, 'compressed': False}

    if ctype == 'zTXt':
        method = _byte(data, pos)
        if method != 0:
            raise PngError(f'unsupported zTXt compression method {"undefined" if method is None else method}')
        raw = _inflate(data[pos + 1:])
        return {'key': key, 'value': _utf8(raw), 'chunkType': ctype, 'compressed': True}

    if ctype == 'iTXt':
        compressed = _byte(data, pos) == 1
        method = _byte(data, pos + 1)
        pos += 2
        lang_bytes, pos = _read_until_nul(data, pos)
        translated_bytes, pos = _read_until_nul(data, pos)
        payload = data[pos:]
        if compressed:
            if method != 0:
                raise PngError(f'unsupported iTXt compression method {method}')
            payload = _inflate(payload)
        return {
            'key': key,
            'value': _utf8(payload),
            'chunkType': ctype,
            'compressed': compressed,
            'language': _latin1(lang_bytes) or None,
            'translatedKey': _utf8(translated_bytes) or None,
        }

    raise PngError(f'not a text chunk: {ctype}')


def read(data):
    """Dimensions from IHDR and the list of text entries.

    Errors in individual chunks do not abort parsing, they go to warnings.
    A broken chunk structure raises PngError, as App.png.read rejects.
    """
    result = {'width': None, 'height': None, 'bitDepth': None, 'colorType': None, 'entries': [], 'warnings': []}
    for ctype, chunk in _chunks(data):
        if ctype == 'IHDR':
            # In JS the DataView throws here, with a message only a DataView could love.
            if len(chunk) < 8:
                raise PngError('IHDR chunk is too short')
            result['width'] = int.from_bytes(chunk[0:4], 'big')
            result['height'] = int.from_bytes(chunk[4:8], 'big')
            result['bitDepth'] = _byte(chunk, 8)
            result['colorType'] = _byte(chunk, 9)
            continue
        if ctype not in TEXT_TYPES:
            continue
        try:
            result['entries'].append(_decode_text(ctype, chunk))
        except (PngError, zlib.error) as e:
            result['warnings'].append(f'Failed to read {ctype} chunk: {e}')
    return result
