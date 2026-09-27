"""Console mode: generation metadata of AI images, read by the same parsers the browser uses.

Run as `python3 cli/aimeta.py ...`: cli/ then comes first on sys.path, so `import png`
finds cli/png.py and not whatever PyPI package happens to share the name.
"""
import argparse
import os
import sys

import render
from engine import Engine
from record import read_record


def color_enabled(mode):
    if mode == 'always':
        return True
    if mode == 'never':
        return False
    # no-color.org: NO_COLOR set to anything but an empty string turns colors off.
    return sys.stdout.isatty() and not os.environ.get('NO_COLOR')


def report(path, messages):
    # stdout first, or the messages of a file land in the middle of its block when both go to one terminal.
    sys.stdout.flush()
    for text in messages:
        print(render.clean_text(f'{path}: {text}'), file=sys.stderr)


def cmd_view(args):
    engine = Engine()
    color = color_enabled(args.color)

    def is_private(pairs):
        return engine.call('privateFlags', pairs)

    failed = False
    for i, path in enumerate(args.files):
        record = read_record(engine, path)
        model = render.select(record, args.level)
        if i:
            print()
        sys.stdout.write(render.to_text(model, color=color, is_private=is_private))
        # Notes are already in the Notes section of the card level, stderr gets the warnings only.
        report(path, record['warnings'])
        failed = failed or bool(record['warnings'])
    return 1 if failed else 0


def build_parser():
    parser = argparse.ArgumentParser(prog='aimeta', description='Generation metadata of AI images, read-only.')
    commands = parser.add_subparsers(dest='command', required=True, metavar='COMMAND')

    view = commands.add_parser('view', help='print metadata to the terminal')
    view.add_argument('files', nargs='+', metavar='FILE')
    view.add_argument('-l', '--level', choices=render.LEVELS, default='basic',
                      help='basic: prompts, params, models; card: + extra, passes, text nodes, notes; full: + raw metadata (default: basic)')
    view.add_argument('--color', choices=('auto', 'always', 'never'), default='auto',
                      help='auto: only on a terminal and without NO_COLOR (default: auto)')
    view.set_defaults(func=cmd_view)

    # Every command is one add_parser block here plus its cmd_* function.
    return parser


def main(argv=None):
    # A lone surrogate from a cut-in-half emoji in the metadata, or a file name that is not UTF-8,
    # must not kill the whole run on print: they come out as \ud83d instead.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors='backslashreplace')
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        # `aimeta view ... | head` closed the pipe early, which is its right. Python would
        # still try to flush stdout at exit and complain, so point it at /dev/null.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(1)
