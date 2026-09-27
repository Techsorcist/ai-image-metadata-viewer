"""extract: batch runs as a subprocess over trees in a temporary directory, the too-deep guard in process."""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zlib
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from fixtures import CLI, SAMPLES, chunk, comfy_prompt, png, run_aimeta, text
import aimeta  # after fixtures: that import is what puts cli/ on sys.path
import render

# Nothing to say at basic: syn-empty has no metadata, NovelAI is detected but not parsed yet.
EMPTY_AT_BASIC = {'syn-empty.png', 'syn-novelai.png'}
PRIVATE_PATH = '/home/alice/models/x.safetensors'
PRIVATE_PNG = png(text('parameters', f'a cat\nSteps: 20, Seed: 1, Model path: {PRIVATE_PATH}'))
SUMMARY = 'written {}, skipped {} (exist), not png {}, empty {}, errors {}'


class ExtractCase(unittest.TestCase):
    """A fresh temporary directory per test: every run changes the tree it works on."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def put(self, rel, data):
        path = self.tmp / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def copy(self, rel, sample):
        return self.put(rel, (SAMPLES / sample).read_bytes())

    def samples(self):
        """A copy of tools/test: sidecars have no business in the repository."""
        for p in SAMPLES.glob('*.png'):
            self.copy(f'samples/{p.name}', p.name)
        return self.tmp / 'samples'

    def assertRun(self, run, written=0, skipped=0, empty=0, errors=0, not_png=0):
        """The summary line, and the exit code it implies."""
        self.assertNotIn('Traceback', run.stderr)
        self.assertEqual((run.stderr.splitlines() or [''])[-1], SUMMARY.format(written, skipped, not_png, empty, errors))
        self.assertEqual(run.returncode, 1 if errors else 0, run.stderr)


class SidecarTest(ExtractCase):
    def test_written_then_skipped_then_forced(self):
        d = self.samples()
        wanted = {p.stem + '.txt' for p in SAMPLES.glob('*.png') if p.name not in EMPTY_AT_BASIC}
        n = len(wanted)
        self.assertRun(run_aimeta('extract', d), written=n, empty=len(EMPTY_AT_BASIC))
        self.assertEqual({p.name for p in d.glob('*.txt')}, wanted)

        sidecar = d / 'syn-a1111.txt'
        fresh = sidecar.read_text(encoding='utf-8')
        sidecar.write_text('stale\n', encoding='utf-8')
        self.assertRun(run_aimeta('extract', d), skipped=n, empty=len(EMPTY_AT_BASIC))
        self.assertEqual(sidecar.read_text(encoding='utf-8'), 'stale\n')
        self.assertRun(run_aimeta('extract', '--force', d), written=n, empty=len(EMPTY_AT_BASIC))
        self.assertEqual(sidecar.read_text(encoding='utf-8'), fresh)


class OutDirTest(ExtractCase):
    def setUp(self):
        super().setUp()
        self.a = self.copy('in/a/0001.png', 'syn-a1111.png')
        self.b = self.copy('in/b/0001.png', 'syn-comfyui.png')
        self.out = self.tmp / 'out'

    def test_recursive_mirrors_subfolders(self):
        self.assertRun(run_aimeta('extract', '-r', '--out-dir', self.out, self.tmp / 'in'), written=2)
        for image in (self.a, self.b):
            sub = image.parent.name
            self.assertTrue((self.out / sub / '0001.txt').read_text(encoding='utf-8').startswith(f'== {image} ·'))
            self.assertFalse(image.with_suffix('.txt').exists())

    def test_same_name_from_two_files(self):
        target = self.out / '0001.txt'
        for force in ((), ('--force',)):
            with self.subTest(force=force):
                run = run_aimeta('extract', *force, '--out-dir', self.out, self.a, self.b)
                self.assertRun(run, written=1, errors=1)
                clashes = [line for line in run.stderr.splitlines() if 'already belongs to' in line]
                self.assertEqual(clashes, [f'{self.b}: {target} already belongs to {self.a}'])
                self.assertTrue(target.read_text(encoding='utf-8').startswith(f'== {self.a} ·'))


class SourceProtectionTest(ExtractCase):
    def test_input_named_like_an_output(self):
        image = self.copy('a.png', 'syn-a1111.png')
        # A PNG called a.txt: a.png's output, and its own as well.
        impostor = self.copy('a.txt', 'syn-comfyui.png')
        for order in ((image, impostor), (impostor, image)):
            with self.subTest(first=order[0].name):
                run = run_aimeta('extract', '--force', *order)
                self.assertRun(run, errors=2)
                self.assertIn('is not a plain text file, not overwriting it', run.stderr)
                self.assertEqual(impostor.read_bytes(), (SAMPLES / 'syn-comfyui.png').read_bytes())

    def test_one_onto_an_input(self):
        image = self.copy('in/a.png', 'syn-a1111.png')
        # --force, or the "exists" check answers first and this one is never asked.
        run = run_aimeta('extract', '--force', '--one', image, image.parent)
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn(f'{image} is not a plain text file, not overwriting it', run.stderr)
        self.assertEqual(image.read_bytes(), (SAMPLES / 'syn-a1111.png').read_bytes())

    def test_binary_nobody_parses(self):
        # An AVIF called a.txt: not a PNG, not text either, so an image all the same.
        avif = b'\x00\x00\x00\x1cftypavif' + bytes(64)
        self.copy('a.png', 'syn-a1111.png')
        impostor = self.put('a.txt', avif)
        run = run_aimeta('extract', '--force', self.tmp / 'a.png', impostor)
        self.assertIn('is not a plain text file, not overwriting it', run.stderr)
        self.assertEqual(impostor.read_bytes(), avif)

    def test_first_glob_item_as_one(self):
        # `--force --one shots/*.png`: the shell hands the first image to --one.
        first = self.copy('shots/1.png', 'syn-a1111.png')
        second = self.copy('shots/2.png', 'syn-comfyui.png')
        run = run_aimeta('extract', '--force', '--one', first, second)
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertEqual(first.read_bytes(), (SAMPLES / 'syn-a1111.png').read_bytes())

    def test_hard_link(self):
        # b.txt is a.png under another name: realpath cannot tell, the inode can.
        a = self.copy('d/a.png', 'syn-a1111.png')
        self.copy('d/b.png', 'syn-comfyui.png')
        os.link(a, self.tmp / 'd' / 'b.txt')
        run = run_aimeta('extract', '--force', self.tmp / 'd')
        self.assertIn('is not a plain text file, not overwriting it', run.stderr)
        self.assertEqual(a.read_bytes(), (SAMPLES / 'syn-a1111.png').read_bytes())

    def test_pipe_input(self):
        # The guard must not read a pipe: the bytes would be gone before read_record gets them.
        data = (SAMPLES / 'syn-a1111.png').read_bytes()
        run = subprocess.run([sys.executable, str(CLI / 'aimeta.py'), 'extract', '-f', 'json', '--one', '-', '/dev/stdin'],
                             input=data, capture_output=True, env=dict(os.environ, PYTHONIOENCODING='utf-8'), timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)['generator']['id'], 'a1111')
        run = subprocess.run([sys.executable, str(CLI / 'aimeta.py'), 'extract', '--out-dir', str(self.tmp / 'o'), '/dev/stdin'],
                             input=data, capture_output=True, env=dict(os.environ, PYTHONIOENCODING='utf-8'), timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertTrue((self.tmp / 'o' / 'stdin.txt').exists(), run.stderr)

    def test_target_links_to_an_image(self):
        # a.txt -> other.png, and other.png is not even an input: the bytes decide, not the list.
        other = self.copy('other.png', 'syn-comfyui.png')
        self.copy('s/a.png', 'syn-a1111.png')
        os.symlink(other, self.tmp / 's' / 'a.txt')
        run = run_aimeta('extract', '--force', self.tmp / 's' / 'a.png')
        self.assertIn('is not a plain text file, not overwriting it', run.stderr)
        self.assertEqual(other.read_bytes(), (SAMPLES / 'syn-comfyui.png').read_bytes())

    def test_binary_sidecar_name_under_a_directory_input(self):
        # Same AVIF as above, but the directory only hands over *.png: a.txt is no input now.
        avif = b'\x00\x00\x00\x1cftypavif' + bytes(64)
        self.copy('d/a.png', 'syn-a1111.png')
        impostor = self.put('d/a.txt', avif)
        run_aimeta('extract', '--force', self.tmp / 'd')
        self.assertEqual(impostor.read_bytes(), avif)


class OneTest(ExtractCase):
    def test_jsonl_to_stdout(self):
        run = run_aimeta('extract', '--one', '-', '-f', 'json', '-l', 'card', self.samples())
        self.assertEqual(run.returncode, 0, run.stderr)
        models = [json.loads(line) for line in run.stdout.splitlines()]
        written = re.fullmatch(r'written (\d+), .*', run.stderr.splitlines()[-1])
        self.assertTrue(written, run.stderr)
        self.assertTrue(models)
        self.assertEqual(len(models), int(written.group(1)))
        self.assertEqual(len({m['file'] for m in models}), len(models))
        self.assertEqual(list(self.tmp.rglob('*.json')), [])

    def test_jsonl_ignores_the_locale(self):
        # Outside the BMP, backslashreplace in latin-1 writes \U0001f600, which JSON does not know.
        path = self.put('emoji.png', png(text('prompt', comfy_prompt('a cat \U0001f600'))))
        run = run_aimeta('extract', '--one', '-', '-f', 'json', path, PYTHONIOENCODING='latin-1')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('\U0001f600', json.loads(run.stdout)['positive']['text'])

    def test_existing_file_without_force(self):
        target = self.put('all.txt', b'keep me\n')
        run = run_aimeta('extract', '--one', target, self.copy('a.png', 'syn-a1111.png'))
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn(f'{target} exists, add --force to overwrite it', run.stderr)
        self.assertEqual(target.read_bytes(), b'keep me\n')

    def test_one_into_a_pipe(self):
        # /dev/stdout on a pipe exists but stores nothing: no --force needed, and nothing to read (it used to hang).
        for force in ((), ('--force',)):
            with self.subTest(force=bool(force)):
                run = run_aimeta('extract', *force, '-f', 'json', '--one', '/dev/stdout', self.copy('a.png', 'syn-a1111.png'))
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual(json.loads(run.stdout)['generator']['id'], 'a1111')

    def test_utf16_previous_run(self):
        # PowerShell 5.1 redirects in UTF-16: NUL bytes everywhere, and still text.
        target = self.put('all.jsonl', '{"a": 1}\n'.encode('utf-16'))
        run = run_aimeta('extract', '--force', '--one', target, self.copy('a.png', 'syn-a1111.png'))
        self.assertEqual(run.returncode, 0, run.stderr)


class OutputContentTest(ExtractCase):
    def test_text_file_is_plain(self):
        self.assertRun(run_aimeta('extract', '-l', 'card', self.put('private.png', PRIVATE_PNG)), written=1)
        out = (self.tmp / 'private.txt').read_text(encoding='utf-8')
        self.assertIn(PRIVATE_PATH, out)
        self.assertNotIn('\x1b', out)
        self.assertNotIn('[private]', out)

    def test_lone_surrogate_in_json_file(self):
        path = self.put('surrogate.png', png(text('prompt', comfy_prompt('cute cat \ud83d'))))
        self.assertRun(run_aimeta('extract', '-f', 'json', path), written=1)
        # Strict UTF-8 on the way back: a surrogate smuggled in as bytes would not get past this.
        with open(path.with_suffix('.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['positive']['text'], 'cute cat \ud83d')


class WarningTest(ExtractCase):
    def test_broken_chunk_next_to_good_one(self):
        stream = zlib.compress(b'Steps: 20, Seed: 1')
        path = self.put('half.png', png(chunk(b'zTXt', b'parameters\x00\x00' + stream[:-6]),
                                        text('prompt', comfy_prompt('a fox in the snow'))))
        run = run_aimeta('extract', path)
        self.assertRun(run, written=1, errors=1)
        self.assertIn(f'{path}: Failed to read zTXt chunk:', run.stderr)
        self.assertIn('a fox in the snow', path.with_suffix('.txt').read_text(encoding='utf-8'))

    def test_rerun_over_a_glob(self):
        # `extract dir/*` the second time: last run's sidecars are inputs now, and they are not PNG.
        d = self.samples()
        n = len(list(d.glob('*.png'))) - len(EMPTY_AT_BASIC)
        self.assertRun(run_aimeta('extract', *sorted(d.glob('*'))), written=n, empty=len(EMPTY_AT_BASIC))
        self.assertRun(run_aimeta('extract', *sorted(d.glob('*'))), skipped=n, not_png=n, empty=len(EMPTY_AT_BASIC))
        # With --force the sidecars in the glob are what gets replaced, they are not images to protect.
        self.assertRun(run_aimeta('extract', '--force', *sorted(d.glob('*'))), written=n, not_png=n, empty=len(EMPTY_AT_BASIC))

    def test_same_file_twice(self):
        d = self.samples()
        n = len(list(d.glob('*.png'))) - len(EMPTY_AT_BASIC)
        self.assertRun(run_aimeta('extract', d, d / 'syn-a1111.png'), written=n, empty=len(EMPTY_AT_BASIC))

    def test_empty_destination(self):
        # An unset shell variable, not a wish to write into the current directory.
        for flag in ('--one', '--out-dir'):
            with self.subTest(flag=flag):
                run = run_aimeta('extract', flag, '', self.samples())
                self.assertEqual(run.returncode, 2, run.stderr)
                self.assertEqual(list(self.tmp.rglob('*.txt')), [])

    def test_stale_venv_hint(self):
        # No quickjs on the path, as after a Python upgrade: a hint, not a traceback.
        # -S keeps the venv's site-packages out, the empty PYTHONPATH the rest.
        run = subprocess.run([sys.executable, '-S', str(CLI / 'aimeta.py'), 'view', str(SAMPLES / 'syn-a1111.png')],
                             env=dict(os.environ, PYTHONPATH=''), capture_output=True, text=True, timeout=60)
        self.assertNotIn('Traceback', run.stderr)
        self.assertIn('remove cli/.venv', run.stderr)

    def test_missing_path(self):
        missing = self.tmp / 'missing.png'
        good = self.copy('good.png', 'syn-a1111.png')
        run = run_aimeta('extract', missing, good)
        self.assertRun(run, written=1, errors=1)
        self.assertIn(f'{missing}: No such file or directory', run.stderr)
        self.assertTrue(good.with_suffix('.txt').exists())


class TooDeepTest(ExtractCase):
    """The guard for metadata nested deeper than rendering survives.

    How deep that is depends on the Python: 3.11 cannot even get such a record out of json.loads,
    3.14 renders a few thousand levels without blinking. So the renderer is made to give up on
    one file instead, which is the case the guard exists for, whatever the version.
    """

    def setUp(self):
        super().setUp()
        self.deep = self.copy('deep.png', 'syn-a1111.png')
        self.good = self.copy('good.png', 'syn-comfyui.png')

    def run_in_process(self, *argv):
        deep = str(self.deep)

        def giving_up(original):
            def render_or_overflow(model, *a, **kw):
                if model['file'] == deep:
                    raise RecursionError('maximum recursion depth exceeded')
                return original(model, *a, **kw)
            return render_or_overflow

        out, err = io.StringIO(), io.StringIO()
        args = aimeta.build_parser().parse_args([*argv, deep, str(self.good)])
        with mock.patch.object(render, 'to_text', giving_up(render.to_text)), \
                mock.patch.object(render, 'to_json', giving_up(render.to_json)), \
                redirect_stdout(out), redirect_stderr(err):
            code = args.func(args)
        return code, out.getvalue(), err.getvalue()

    def test_extract(self):
        for fmt, suffix in aimeta.SUFFIXES.items():
            with self.subTest(format=fmt):
                code, _, err = self.run_in_process('extract', '-l', 'full', '-f', fmt)
                self.assertEqual(code, 1)
                self.assertIn(f'{self.deep}: Metadata is nested too deep to render', err)
                self.assertEqual(err.splitlines()[-1], SUMMARY.format(1, 0, 0, 0, 1))
                self.assertFalse(self.deep.with_suffix(suffix).exists())
                self.assertTrue(self.good.with_suffix(suffix).exists())

    def test_view(self):
        code, out, err = self.run_in_process('view', '-l', 'full', '--color', 'never')
        self.assertEqual(code, 1)
        self.assertIn(f'{self.deep}: Metadata is nested too deep to render', err)
        self.assertIn(f'== {self.good} ·', out)


if __name__ == '__main__':
    unittest.main()
