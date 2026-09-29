"""What the console shows of a record: the detail levels, and the text and JSON built from them.

Pure functions, no I/O: the caller prints the result or writes it into files, the text is the same.
"""
import json
import re

LEVELS = ('basic', 'card', 'full')
ENVELOPE = ('file', 'generator', 'width', 'height')

# Card fields per level, cumulative. At basic, positive and negative also lose `original`.
_BASIC = ('positive', 'negative', 'params', 'models')
_CARD = _BASIC + ('extra', 'passes', 'textNodes', 'notes')
CARD_FIELDS = {'basic': _BASIC, 'card': _CARD, 'full': _CARD + ('executed',)}


def select(record, level):
    """The output model for a record: the envelope, then the card fields of the level, then raw at full.

    The single definition of the levels, text and JSON are both rendered from it.
    Without a card the model is the envelope alone (plus raw at full).
    """
    if level not in LEVELS:
        raise ValueError(f'unknown level: {level}')
    gen = record.get('generator') or {}
    model = {
        'file': record['path'],
        # detail is the generator version and the like: parsers drop it from extra because the header shows it.
        'generator': {'id': gen.get('id'), 'name': gen.get('name'), 'detail': gen.get('detail')},
        'width': record['width'],
        'height': record['height'],
    }
    card = record.get('card')
    if card:
        for key in CARD_FIELDS[level]:
            if key in card:
                model[key] = card[key]
        if level == 'basic':
            for key in ('positive', 'negative'):
                model[key] = {'text': card[key]['text']}
    if level == 'full':
        model['raw'] = [
            {'key': e['key'], 'source': e['source'], 'json': e['json']} if e.get('json') is not None
            else {'key': e['key'], 'source': e['source'], 'value': e['value']}
            for e in record['entries']
        ]
    return model


def has_content(model):
    """True if the model carries anything beyond the envelope: an empty one is not worth an output file.

    Notes do not count: a file whose only content is "metadata is missing" is still empty.
    """
    for key, value in model.items():
        if key in ENVELOPE or key == 'notes':
            continue
        if key in ('positive', 'negative'):
            if value.get('text') or value.get('original'):
                return True
        elif value:
            return True
    return False


def to_json(model, compact=False):
    """Pretty JSON, or one line per model when compact (JSONL)."""
    return json.dumps(model, ensure_ascii=False, indent=None if compact else 2)


# --- Text ---

_ANSI = {
    'rule': '\x1b[1;36m', 'header': '\x1b[1m', 'title': '\x1b[36m', 'subtitle': '\x1b[2;36m',
    'label': '\x1b[2m', 'private': '\x1b[33m',
}
_RESET = '\x1b[0m'
_RULE = '=' * 72
_PRIVATE = '[private]'

# Same groups and titles as the card in the browser (70-card.js).
_NODE_GROUPS = (('used', 'feeding samplers'), ('unused', 'not connected'), ('note', 'canvas notes'))


def _painter(color):
    if color:
        return lambda style, s: f'{_ANSI[style]}{s}{_RESET}'
    return lambda style, s: s


def header(model, color=False):
    """The block that opens every image: a ruler, the file, the generator and size, a ruler."""
    paint = _painter(color)
    model = _clean({k: model.get(k) for k in ENVELOPE})
    gen = model.get('generator') or {}
    about = [' '.join(str(p) for p in (gen.get('name') or 'unknown', gen.get('detail')) if p)]
    if model.get('width') is not None and model.get('height') is not None:
        about.append(f"{model['width']}×{model['height']}")
    return '\n'.join([paint('rule', _RULE), paint('header', str(model['file'])),
                      paint('header', ' · '.join(about)), paint('rule', _RULE)])


def to_text(model, color=False, is_private=None):
    """Human-readable block for a model of any level, ending with a newline.

    No indentation anywhere: a prompt copied out of the terminal comes without leading spaces.
    Structure is carried by the headings instead, --- for a section, ··· for one inside it.
    color: ANSI codes; without it the text has no escape codes at all.
    is_private: optional callable [[key, value], ...] -> [bool], called once per model;
    without it nothing is marked.
    """
    # Raw JSON can be nested deeper than recursion allows, so it is cleaned after json.dumps instead.
    raw_entries = model.get('raw') or []
    model = _clean({k: v for k, v in model.items() if k != 'raw'})
    paint = _painter(color)

    extra = model.get('extra') or []
    nodes = model.get('textNodes') or []
    extra_flags, node_flags = _private_flags(extra, nodes, is_private)
    mark = f" {paint('private', _PRIVATE)}"

    def heading(title, sub=False, flag=False):
        line = paint('subtitle', f'··· {title} ···') if sub else paint('title', f'--- {title} ---')
        return line + (mark if flag else '')

    def section(title, lines, sub=False):
        # An empty heading helps nobody: no body, no section.
        return [heading(title, sub)] + lines if lines else []

    def field(label, value, flag=False):
        first, *rest = _lines(value) or ['']
        return [f"{paint('label', f'{label}:')} {first}".rstrip() + (mark if flag else '')] + rest

    def params(items):
        return [line for p in items
                for line in field(p['label'], f"{p['value']} {p['sub']}" if p.get('sub') else p['value'])]

    def models(items):
        out = []
        for m in items:
            name = ' '.join(str(f) for f in (m.get('name'), f"× {m['weight']}" if m.get('weight') is not None else None)
                            if f not in (None, ''))
            fields = [str(f) for f in (name, m.get('hash'), m.get('detail')) if f not in (None, '')]
            out += field(m.get('role') or 'model', '  '.join(fields))
        return out

    def prompts(positive, negative, sub=False):
        return section('Positive', _lines(positive), sub) + section('Negative', _lines(negative), sub)

    sections = []
    if 'positive' in model:
        sections += [section('Positive', _lines(model['positive']['text'])),
                     section('Negative', _lines(model['negative']['text'])),
                     section('Original positive', _lines(model['positive'].get('original'))),
                     section('Original negative', _lines(model['negative'].get('original')))]
    sections.append(section('Params', params(model.get('params') or [])))
    sections.append(section('Models', models(model.get('models') or [])))
    sections.append(section('Extra', [line for e, flag in zip(extra, extra_flags)
                                      for line in field(e['key'], e['value'], flag)]))
    passes = model.get('passes') or []
    if len(passes) > 1:
        for i, p in enumerate(passes, 1):
            body = prompts(p['positive'], p['negative'], sub=True) + section('Params', params(p['params']), sub=True)
            sections.append(section(f"Pass {i}: {p['label']}", body))
    flagged = list(zip(nodes, node_flags))
    for kind, title in _NODE_GROUPS:
        group = [(n, f) for n, f in flagged if (n.get('kind') or 'used') == kind]
        body = []
        for n, flag in group:
            head = [f"#{n['id']}", n.get('classType'), f'"{n["title"]}"' if n.get('title') else None,
                    f"({n['field']})" if n.get('field') else None]
            body += [heading(' '.join(str(h) for h in head if h), sub=True, flag=flag)] + _lines(n.get('text'))
        sections.append(section(f'Text nodes: {title} ({len(group)})', body))
    sections.append(section('Notes', [line for note in model.get('notes') or [] for line in _lines(note)]))
    sections = [s for s in sections if s]
    if not sections:
        sections.append([paint('label', 'no parsed metadata')])

    raw = []
    for e in raw_entries:
        value = json.dumps(e['json'], ensure_ascii=False, indent=2) if 'json' in e else e['value']
        raw += [heading(clean_text(f"{e['key']} ({e['source']})"), sub=True)] + _lines(clean_text(value))
    sections.append(section('Raw', raw))

    blocks = [header(model, color)] + ['\n'.join(s) for s in sections if s]
    return '\n\n'.join(blocks) + '\n'


# --- A1111 ---

# Card labels that A1111 spells differently; the rest already match or have no A1111 name at all.
_A1111_KEYS = {'CFG': 'CFG scale', 'Scheduler': 'Schedule type', 'Denoise': 'Denoising strength'}
# A1111's own order. Steps must come first: readers, ours included, spot the parameter line by it.
_A1111_ORDER = ('Steps', 'Sampler', 'Schedule type', 'CFG scale', 'Seed', 'Size', 'Model', 'Denoising strength', 'Clip skip')


def to_a1111(model):
    """The main prompt and settings the way A1111 writes its `parameters` chunk, or '' if there are none.

    Takes a card-level model but uses only prompts, params and the number of passes: pasted into
    A1111 or Forge (Read generation parameters) it fills the fields they know and stores the rest.
    Extra passes are not shown, only counted, in a key A1111 keeps without understanding.
    Raises ValueError when there is something to write but no numeric Steps: our own reader
    (30-detect.js) spots the text by `Steps: <digits>`, and what it cannot read back is no A1111 text.
    """
    model = _clean(model)
    lines = []
    if 'positive' in model:
        lines += _lines(model['positive']['text'])
        negative = _lines(model['negative']['text'])
        if negative:
            lines += [f'Negative prompt: {negative[0]}'] + negative[1:]
    pairs = []
    for p in model.get('params') or []:
        key = _A1111_KEYS.get(p['label'], p['label'])
        value = str(p['value'])
        if key == 'Size':
            value = value.replace(' × ', 'x')
        pairs.append((key, value))
    # A stable sort: the known keys in A1111's order, everything else after them as the card had it.
    pairs.sort(key=lambda kv: _A1111_ORDER.index(kv[0]) if kv[0] in _A1111_ORDER else len(_A1111_ORDER))
    if (lines or pairs) and not any(k == 'Steps' and re.fullmatch('[0-9]+', v) for k, v in pairs):
        raise ValueError('A1111 format needs a Steps value, use -f text')
    passes = model.get('passes') or []
    if len(passes) > 1:
        pairs.append(('Passes', f'{len(passes)} (first shown)'))
    if pairs:
        lines.append(', '.join(f'{k}: {_a1111_quote(v)}' for k, v in pairs))
    return '\n'.join(lines) + '\n' if lines else ''


def _a1111_quote(value):
    # The same rule as quote() in A1111's infotext: only what would break the line gets JSON quotes.
    if ',' not in value and '\n' not in value and ':' not in value:
        return value
    return json.dumps(value, ensure_ascii=False)


def _private_flags(extra, nodes, is_private):
    """Flags for extra rows and text nodes, from one is_private call. Text nodes are judged by value only, like the card."""
    if not is_private or not (extra or nodes):
        return [False] * len(extra), [False] * len(nodes)
    flags = is_private([[e['key'], e['value']] for e in extra] + [[None, n.get('text')] for n in nodes])
    return flags[:len(extra)], flags[len(extra):]


# C0 controls except tab, newline and CR (CRLF prompts exist), DEL and C1. A metadata value is
# somebody else's text, and ESC or CSI inside it would talk to the terminal: shown as \x1b instead.
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]')


def clean_text(s):
    """Control characters of a string made visible; also for messages that go to stderr."""
    return _CONTROL.sub(lambda m: f'\\x{ord(m.group()):02x}', s)


def _clean(obj):
    if isinstance(obj, str):
        return clean_text(obj)
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    return obj


def _lines(text):
    return str(text).splitlines() if text else []
