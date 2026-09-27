"""Console mode: generation metadata of AI images, read by the same parsers the browser uses.

Run as `python3 cli/aimeta.py ...`: cli/ then comes first on sys.path, so `import png`
finds cli/png.py and not whatever PyPI package happens to share the name.
"""
import argparse
import os
import sys

import render

try:
    from engine import Engine
except ModuleNotFoundError as e:
    # After a Python upgrade (3.11 -> 3.12 on a rolling distro) the venv runs the new
    # interpreter against the packages of the old one, and the stamp has no idea.
    sys.exit(f"aimeta: {e.name} is missing. If Python was upgraded, remove cli/.venv and run again.")
# After engine on purpose: record imports it too, and the hint above would never get a word in.
from record import read_record  # noqa: E402

# Python 3.12+ parses JSON nested deeper than json.dumps and the renderer can walk back out of.
TOO_DEEP = 'Metadata is nested too deep to render'


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
        try:
            text = render.to_text(model, color=color, is_private=is_private)
        except RecursionError:
            text = ''
            record['warnings'].append(TOO_DEEP)
        if i:
            print()
        sys.stdout.write(text)
        # Notes are already in the Notes section of the card level, stderr gets the warnings only.
        report(path, record['warnings'])
        failed = failed or bool(record['warnings'])
    return 1 if failed else 0


# --- extract ---

# A per-file output is the image path with its suffix replaced by this one.
SUFFIXES = {'text': '.txt', 'json': '.json'}


def open_output(path):
    # Same reason as stdout in main: a lone surrogate becomes \ud83d, which in JSON even
    # happens to be a valid escape. newline='\n' keeps the bytes the same on every OS.
    return open(path, 'w', encoding='utf-8', errors='backslashreplace', newline='\n')


def usage_error(message):
    print(render.clean_text(f'aimeta extract: error: {message}'), file=sys.stderr)
    return 2


def collect(paths, recursive, fail):
    """Files to extract in run order, as (file, base) pairs.

    base is the directory input the file was found under, None for a file given as is.
    fail(path, message) gets the inputs that do not exist or cannot be listed.
    """
    found = []
    seen = set()  # real paths: `dir dir/a.png` or overlapping globs name one file twice

    def add(path, base):
        key = os.path.realpath(path)
        if key not in seen:
            seen.add(key)
            found.append((path, base))

    for path in paths:
        if os.path.isdir(path):
            # os.walk swallows listing errors unless asked, and an unreadable folder would pass for an empty one.
            for root, dirs, files in os.walk(path, onerror=lambda e: fail(e.filename, e.strerror)):
                if recursive:
                    dirs.sort()
                else:
                    dirs.clear()
                for name in sorted(files):
                    if name.lower().endswith('.png'):
                        add(os.path.join(root, name), path)
        elif os.path.exists(path):
            add(path, None)
        else:
            fail(path, 'No such file or directory')
    return found


def output_path(path, base, out_dir, suffix):
    """Next to the image, or under out_dir with the tree below its directory input mirrored."""
    if out_dir is not None:
        path = os.path.join(out_dir, os.path.relpath(path, base) if base is not None else os.path.basename(path))
    return os.path.splitext(path)[0] + suffix


def to_output(model, fmt, compact=False):
    if fmt == 'json':
        return render.to_json(model, compact=compact) + '\n'
    # No ANSI and no [private] markers in files: extract writes the data as is.
    return render.to_text(model, color=False, is_private=None)


def write_file(path, target, text):
    """One per-file output; a failure is reported against the image and returns False."""
    try:
        os.makedirs(os.path.dirname(target) or os.curdir, exist_ok=True)
        with open_output(target) as f:
            f.write(text)
    except OSError as e:
        report(path, [f'Cannot write {target}: {e.strerror or e}'])
        return False
    return True


def extract(engine, inputs, args, out, counts):
    """The run itself. out is the --one stream, None means one output per image."""
    suffix = SUFFIXES[args.format]
    sources = {os.path.realpath(path) for path, _ in inputs}
    owners = {}  # real path of an output -> the image it belongs to in this run
    for path, base in inputs:
        record = read_record(engine, path)
        if record['format'] != 'png' and record['size'] is not None:
            # A readable file that is not a PNG: last run's sidecars under `dir/*`, a stray JPEG.
            # Skipped as the plan says, counted, and no reason to fail the run.
            counts['not png'] += 1
            continue
        # Whatever survived the warnings is still written, the exit code tells the rest.
        failed = bool(record['warnings'])
        model = render.select(record, args.level)
        text = None
        if render.has_content(model):
            try:
                text = to_output(model, args.format, compact=out is not None)
            except RecursionError:
                report(path, [TOO_DEEP])
                failed = True
        else:
            counts['empty'] += 1
        if text is None:
            pass
        elif out is not None:
            # A blank line between text blocks, as in view; JSONL needs none.
            if args.format == 'text' and counts['written']:
                out.write('\n')
            out.write(text)
            counts['written'] += 1
        else:
            target = output_path(path, base, args.out_dir, suffix)
            key = os.path.realpath(target)
            if key in owners:
                # Two 0001.png from different folders into one --out-dir: with or without
                # --force, the second one must not quietly land on top of the first.
                report(path, [f'{target} already belongs to {owners[key]}'])
                failed = True
            else:
                owners[key] = path
                if os.path.lexists(target) and not args.force:
                    counts['skipped'] += 1
                elif key in sources:
                    # An image named like the output of another one: --force is not a license to overwrite sources.
                    report(path, [f'{target} is an input file, not overwriting it'])
                    failed = True
                elif write_file(path, target, text):
                    counts['written'] += 1
                else:
                    failed = True
        # After the output, as in view: with --one - the messages follow the block they are about.
        report(path, record['warnings'])
        counts['errors'] += failed


def cmd_extract(args):
    # An unset shell variable must not quietly turn into "next to the images" or "the current directory".
    if args.one == '' or args.out_dir == '':
        return usage_error('empty --one or --out-dir')
    if args.one == '-':
        # JSONL is for machines, and they expect UTF-8 whatever the locale says.
        sys.stdout.reconfigure(encoding='utf-8')
    one_file = args.one if args.one != '-' else None
    if one_file and os.path.lexists(one_file) and not args.force:
        return usage_error(f'{one_file} exists, add --force to overwrite it')

    counts = {'written': 0, 'skipped': 0, 'not png': 0, 'empty': 0, 'errors': 0}

    def fail(path, message):
        report(path, [message])
        counts['errors'] += 1

    inputs = collect(args.paths, args.recursive, fail)
    if one_file and os.path.realpath(one_file) in {os.path.realpath(path) for path, _ in inputs}:
        return usage_error(f'{one_file} is one of the inputs')

    # One engine per process and one thread: the QuickJS context is bound to the thread that made it.
    engine = Engine()
    if one_file:
        try:
            with open_output(one_file) as out:
                extract(engine, inputs, args, out, counts)
        except OSError as e:
            # Everything else in the run reports its own failures, so this is the --one file,
            # and without it the rest has nowhere to go.
            fail(one_file, f'Cannot write: {e.strerror or e}')
    else:
        extract(engine, inputs, args, sys.stdout if args.one else None, counts)

    # stdout first, same as report: with --one - the summary belongs after the data.
    sys.stdout.flush()
    print(f"written {counts['written']}, skipped {counts['skipped']} (exist), not png {counts['not png']}, "
          f"empty {counts['empty']}, errors {counts['errors']}", file=sys.stderr)
    return 1 if counts['errors'] else 0


def add_level(parser):
    parser.add_argument('-l', '--level', choices=render.LEVELS, default='basic',
                        help='basic: prompts, params, models; card: + extra, passes, text nodes, notes; full: + raw metadata (default: basic)')


def build_parser():
    parser = argparse.ArgumentParser(prog='aimeta', description='Generation metadata of AI images, read-only.')
    commands = parser.add_subparsers(dest='command', required=True, metavar='COMMAND')

    view = commands.add_parser('view', help='print metadata to the terminal')
    view.add_argument('files', nargs='+', metavar='FILE')
    add_level(view)
    view.add_argument('--color', choices=('auto', 'always', 'never'), default='auto',
                      help='auto: only on a terminal and without NO_COLOR (default: auto)')
    view.set_defaults(func=cmd_view)

    extract = commands.add_parser('extract', help='write metadata into files')
    extract.add_argument('paths', nargs='+', metavar='PATH',
                         help='image files, taken as given, or directories to take the *.png files from')
    extract.add_argument('-f', '--format', choices=tuple(SUFFIXES), default='text',
                         help='text: same as view, without colors; json: the card model, JSONL with --one (default: text)')
    add_level(extract)
    where = extract.add_mutually_exclusive_group()
    where.add_argument('--out-dir', metavar='DIR',
                       help='outputs go into DIR instead of next to the images; the tree below a directory input is mirrored')
    where.add_argument('--one', metavar='FILE', help='everything into one FILE, - for stdout')
    extract.add_argument('-r', '--recursive', action='store_true', help='also look into subdirectories of a directory input')
    extract.add_argument('--force', action='store_true', help='overwrite existing outputs')
    extract.set_defaults(func=cmd_extract)

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
