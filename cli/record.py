"""The metadata source layer for the console: a file path turned into the record
App.source.readFile builds in the browser, then finished by the JS detector and parsers.
"""
import os

import png
from engine import JsError


def sniff_format(data):
    if png.is_png(data):
        return 'png'
    if data[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if len(data) > 12 and data[0:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[:3] == b'GIF':
        return 'gif'
    return 'unknown'


def read_record(engine, path):
    """Mirror of App.source.readFile, without the browser-only id and url, plus path as given.

    entries: [{key, value, source, chunkType, json}], json = parsed value or None.
    """
    record = {
        'name': os.path.basename(path),
        'path': os.fspath(path),
        'size': None,
        'format': None,
        'width': None,
        'height': None,
        'entries': [],
        'warnings': [],   # file reading problems, shown prominently
        'notes': [],      # parser remarks, shown dimmed
        'generator': None,
        'card': None,
    }

    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError as e:
        record['format'] = 'unknown'
        record['warnings'].append(f'Cannot read file: {e.strerror or e}')
        return record

    record['size'] = len(data)
    record['format'] = sniff_format(data)

    if record['format'] == 'png':
        try:
            parsed = png.read(data)
        except png.PngError as e:
            record['warnings'].append(f'PNG parse error: {e}')
        else:
            record['width'] = parsed['width']
            record['height'] = parsed['height']
            record['warnings'].extend(parsed['warnings'])
            record['entries'] = [{
                'key': e['key'],
                'value': e['value'],
                'source': f"PNG {e['chunkType']}{' (compressed)' if e['compressed'] else ''}",
                'chunkType': e['chunkType'],
            } for e in parsed['entries']]
    elif record['format'] in ('jpeg', 'webp'):
        record['warnings'].append(f"{record['format'].upper()} metadata (EXIF UserComment) is not supported yet, PNG only for now")
    else:
        record['warnings'].append('Unsupported file format')

    try:
        return engine.call('readRecord', record)
    except (JsError, RecursionError) as e:
        # JSON nested a few thousand levels deep: the browser copes, QuickJS and Python's
        # json run out of stack. One such file must not take the whole batch down with it.
        record['warnings'].append(f'Cannot parse metadata: {e}')
        return record
