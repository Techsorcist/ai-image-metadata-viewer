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

_ANSI = {'header': '\x1b[1m', 'title': '\x1b[36m', 'label': '\x1b[2m', 'private': '\x1b[33m'}
_RESET = '\x1b[0m'
_INDENT = '  '
_PRIVATE = '[private]'

# Same groups and titles as the card in the browser (70-card.js).
_NODE_GROUPS = (('used', 'Feeding samplers'), ('unused', 'Not connected'), ('note', 'Canvas notes'))


def to_text(model, color=False, is_private=None):
    """Human-readable block for a model of any level, ending with a newline.

    color: ANSI codes; without it the text has no escape codes at all.
    is_private: optional callable [[key, value], ...] -> [bool], called once per model;
    without it nothing is marked.
    """
    # Raw JSON can be nested deeper than recursion allows, so it is cleaned after json.dumps instead.
    raw_entries = model.get('raw') or []
    model = _clean({k: v for k, v in model.items() if k != 'raw'})
    if color:
        def paint(style, s):
            return f'{_ANSI[style]}{s}{_RESET}'
    else:
        def paint(style, s):
            return s

    extra = model.get('extra') or []
    nodes = model.get('textNodes') or []
    extra_flags, node_flags = _private_flags(extra, nodes, is_private)
    mark = f" {paint('private', _PRIVATE)}"

    def section(title, body):
        return [paint('title', title)] + _indent(body) if body else []

    def prompt_sections(positive, negative):
        return section('Positive', _lines(positive)) + section('Negative', _lines(negative))

    def aligned(rows, flags=None):
        # rows: [(label, value)]; continuation lines of a multi-line value go under the value column.
        if not rows:
            return []
        width = max(len(label) for label, _ in rows)
        out = []
        for i, (label, value) in enumerate(rows):
            first, *rest = _lines(value) or ['']
            flag = mark if flags and flags[i] else ''
            out.append(f"{paint('label', label)}{' ' * (width - len(label) + 2)}{first}{flag}".rstrip())
            out += [' ' * (width + 2) + line for line in rest]
        return out

    def params(items):
        return aligned([(p['label'], f"{p['value']} {p['sub']}" if p.get('sub') else str(p['value'])) for p in items])

    def models(items):
        if not items:
            return []
        width = max(len(m['role']) for m in items)
        out = []
        for m in items:
            weight = f"× {m['weight']}" if m.get('weight') is not None else None
            fields = [str(f) for f in (m.get('name'), weight, m.get('hash'), m.get('detail')) if f not in (None, '')]
            out.append(f"{paint('label', m['role'])}{' ' * (width - len(m['role']) + 2)}{'  '.join(fields)}")
        return out

    def passes(items):
        out = []
        for p in items:
            body = prompt_sections(p['positive'], p['negative']) + section('Params', params(p['params']))
            out += [paint('title', p['label'])] + _indent(body)
        return out

    def text_nodes():
        out = []
        flagged = list(zip(nodes, node_flags))
        for kind, title in _NODE_GROUPS:
            group = [(n, f) for n, f in flagged if (n.get('kind') or 'used') == kind]
            body = []
            for n, flag in group:
                head = [f"#{n['id']}", n.get('classType'), f'"{n["title"]}"' if n.get('title') else None, f"({n['field']})" if n.get('field') else None]
                body.append(paint('label', ' '.join(str(h) for h in head if h)) + (mark if flag else ''))
                body += _indent(_lines(n.get('text')))
            out += section(f'{title} ({len(group)})', body)
        return out

    def raw(entries):
        out = []
        for e in entries:
            value = json.dumps(e['json'], ensure_ascii=False, indent=2) if 'json' in e else e['value']
            out.append(paint('label', clean_text(f"{e['key']} ({e['source']})")))
            out += _indent(_lines(clean_text(value)))
        return out

    body = []
    if 'positive' in model:
        body += prompt_sections(model['positive']['text'], model['negative']['text'])
        body += section('Original positive', _lines(model['positive'].get('original')))
        body += section('Original negative', _lines(model['negative'].get('original')))
    body += section('Params', params(model.get('params') or []))
    body += section('Models', models(model.get('models') or []))
    body += section('Extra', aligned([(e['key'], e['value']) for e in extra], extra_flags))
    if len(model.get('passes') or []) > 1:
        body += section('Passes', passes(model['passes']))
    body += section('Text nodes', text_nodes())
    body += section('Notes', [line for note in model.get('notes') or [] for line in _lines(note)])
    if not body:
        body.append(paint('label', 'no parsed metadata'))
    body += section('Raw', raw(raw_entries))

    return '\n'.join([paint('header', _header(model))] + body) + '\n'


def _header(model):
    gen = model.get('generator') or {}
    parts = [model['file'], ' '.join(str(p) for p in (gen.get('name') or 'unknown', gen.get('detail')) if p)]
    if model.get('width') is not None and model.get('height') is not None:
        parts.append(f"{model['width']}×{model['height']}")
    return '== ' + ' · '.join(str(p) for p in parts)


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


def _indent(lines):
    # Empty lines stay empty: trailing whitespace helps nobody.
    return [_INDENT + line if line else line for line in lines]
