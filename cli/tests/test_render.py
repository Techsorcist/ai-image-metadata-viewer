"""Render and view: render.py in process, `aimeta view` as a subprocess for what only a real run shows."""
import json
import os
import re
import subprocess
import unittest

from fixtures import (ROOT, SAMPLES, EngineCase, comfy_prompt, nested, overlong, png, text, view, view_command,
                      view_env)
import render  # after fixtures: that import is what puts cli/ on sys.path

try:
    import pty
except ImportError:  # Windows
    pty = None

PRIVATE_PATH = '/home/alice/models/x.safetensors'
PRIVATE_PNG = png(text('parameters', f'a cat\nSteps: 20, Seed: 1, Model path: {PRIVATE_PATH}'))
# Only the codes render.py writes itself; ESC in the test prompt is followed by a space, so this cannot eat it.
SGR = re.compile(r'\x1b\[[0-9;]*m')


class RenderTest(EngineCase):
    def test_full_level_survives_deep_raw_json(self):
        r = self.record('deep600.png', png(text('prompt', nested(600))))
        self.assertIsNotNone(r['entries'][0]['json'])
        self.assertIn('Raw', render.to_text(render.select(r, 'full')))

    def test_integer_class_type(self):
        r = self.record('int-class.png', png(text('prompt', {'1': {'class_type': 5, 'inputs': {'text': 'lonely node'}}})))
        self.assertEqual(r['generator']['id'], 'comfyui')
        self.assertIn('lonely node', render.to_text(render.select(r, 'card')))

    def test_generator_detail(self):
        r = self.sample('syn-a1111.png')
        detail = r['generator']['detail']
        self.assertTrue(detail)
        model = render.select(r, 'basic')
        # The header block: ruler, file, generator and size, ruler.
        self.assertIn(detail, render.to_text(model).splitlines()[2])
        self.assertEqual(json.loads(render.to_json(model))['generator']['detail'], detail)

    def test_control_characters_escaped(self):
        r = self.record('controls.png', png(text('prompt', comfy_prompt('red \x1b fox \x9b2J', 'line one\r\nline two'))))
        for color in (False, True):
            with self.subTest(color=color):
                out = render.to_text(render.select(r, 'basic'), color=color)
                self.assertIn('red \\x1b fox \\x9b2J', out)
                self.assertNotIn('\x9b', out)
                self.assertNotIn('\x1b', SGR.sub('', out))
                # CR/LF prompts exist and are no business of the terminal police.
                self.assertIn('\nline one\nline two\n', out)
                self.assertNotIn('\\x0d', out)

    def test_has_content(self):
        r = self.record('invoke-notes.png', png(text('invokeai_graph', {'id': 'g', 'nodes': {}, 'edges': []})))
        self.assertEqual(r['generator']['id'], 'invokeai')
        self.assertTrue(r['card']['notes'])
        empty = self.sample('syn-empty.png')
        # A card of notes alone is empty; at full the raw entries count, and syn-empty has none.
        for level, notes_only in (('basic', False), ('card', False), ('full', True)):
            with self.subTest(level=level):
                self.assertEqual(render.has_content(render.select(r, level)), notes_only)
                self.assertFalse(render.has_content(render.select(empty, level)))

    def test_no_private_marker_without_callback(self):
        out = render.to_text(render.select(self.record('private.png', PRIVATE_PNG), 'card'), is_private=None)
        self.assertIn(PRIVATE_PATH, out)
        self.assertNotIn('[private]', out)


class ViewTest(EngineCase):
    SAMPLE_ARGS = sorted(str(p.relative_to(ROOT)) for p in SAMPLES.glob('*.png'))

    def assertClean(self, run):
        self.assertNotIn('Traceback', run.stderr)
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_lone_surrogate(self):
        path = self.write('surrogate.png', png(text('prompt', comfy_prompt('cute cat \ud83d'))))
        run = view(path, 'tools/test/syn-a1111.png')
        self.assertClean(run)
        self.assertIn(f'\n{path}\n', run.stdout)
        self.assertIn('\ntools/test/syn-a1111.png\n', run.stdout)
        self.assertIn('cute cat \\ud83d', run.stdout)

    def test_file_name_not_utf8(self):
        try:
            path = self.write(os.fsdecode(b'caf\xe9.png'), (SAMPLES / 'syn-a1111.png').read_bytes())
        except (OSError, UnicodeError):
            self.skipTest('this file system accepts UTF-8 names only')
        run = view(path, 'tools/test/syn-a1111.png')
        self.assertClean(run)
        self.assertIn('caf\\udce9.png', run.stdout)
        self.assertIn('\ntools/test/syn-a1111.png\n', run.stdout)

    def test_control_characters_in_warning(self):
        run = view(self.write('esc-chunk.png', png(overlong(b'\x1b[2J'))))
        self.assertIn('Stopped reading chunks', run.stderr)
        self.assertIn('\\x1b', run.stderr)
        self.assertNotIn('\x1b', run.stderr)

    def test_color_on_pipe(self):
        self.assertNotIn('\x1b', view(*self.SAMPLE_ARGS).stdout)
        self.assertIn('\x1b[', view('--color', 'always', *self.SAMPLE_ARGS).stdout)

    @unittest.skipIf(pty is None, 'no pty module here')
    def test_no_color_on_tty(self):
        # The control run proves the pty is a tty to the child, or the NO_COLOR check proves nothing.
        self.assertIn('\x1b[', self._on_tty())
        self.assertNotIn('\x1b', self._on_tty(NO_COLOR='1'))

    def _on_tty(self, **env):
        try:
            master, slave = pty.openpty()
        except OSError:
            self.skipTest('no pty here')
        with subprocess.Popen(view_command(*self.SAMPLE_ARGS), cwd=ROOT, env=view_env(**env),
                              stdout=slave, stderr=subprocess.DEVNULL):
            os.close(slave)
            out = b''
            while True:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break  # EIO on Linux once the child is gone
                if not data:
                    break
                out += data
        os.close(master)
        return out.decode('utf-8', 'replace')

    def test_closed_stdout(self):
        # `| head -1` without the race: the reader is gone before the first byte is written.
        read_end, write_end = os.pipe()
        os.close(read_end)
        try:
            run = subprocess.run(view_command('tools/test/syn-a1111.png'), cwd=ROOT, env=view_env(), stdout=write_end,
                                 stderr=subprocess.PIPE, encoding='utf-8', errors='replace', timeout=60)
        finally:
            os.close(write_end)
        self.assertNotIn('Traceback', run.stderr)
        self.assertNotIn('BrokenPipeError', run.stderr)

    def test_private_marker(self):
        run = view('-l', 'card', self.write('private.png', PRIVATE_PNG))
        self.assertClean(run)
        self.assertRegex(run.stdout, re.compile(re.escape(f'{PRIVATE_PATH} [private]') + '$', re.M))



class A1111Test(EngineCase):
    """-f a1111: the parameters text A1111 itself writes, so that it pastes back in."""

    def test_round_trip_through_our_own_parser(self):
        # What we write, the A1111 parser in src/js must read back as the same prompts and settings.
        source = self.sample('syn-a1111.png')
        written = render.to_a1111(render.select(source, 'card'))
        again = self.record('again.png', png(text('parameters', written)))
        self.assertEqual(again['generator']['id'], 'a1111')
        for key in ('positive', 'negative'):
            self.assertEqual(again['card'][key]['text'], source['card'][key]['text'])
        values = lambda r: {p['label']: p['value'] for p in r['card']['params']}
        self.assertEqual(values(again), values(source))

    def test_names_and_quoting(self):
        r = self.record('names.png', png(text('prompt', comfy_prompt('a cat', 'blurry \x1b[2J'))))
        out = render.to_a1111(render.select(r, 'card'))
        # view -f a1111 prints this to the terminal as well: control characters come out escaped.
        self.assertEqual(out.splitlines()[:2], ['a cat', 'Negative prompt: blurry \\x1b[2J'])
        self.assertIn('CFG scale: 7', out)
        self.assertIn('Size: 512x512', out)
        self.assertNotIn('\x1b', out)
        params = [{'label': 'Steps', 'value': '20', 'sub': None}, {'label': 'Note', 'value': 'a, b: c', 'sub': None}]
        self.assertIn('Note: "a, b: c"', render.to_a1111(dict(render.select(r, 'card'), params=params)))

    def test_no_steps_no_a1111(self):
        # Without `Steps: <digits>` our own detector (30-detect.js) would not know the text for A1111.
        prompt = comfy_prompt('a cat')
        del prompt['5']['inputs']['steps']
        model = render.select(self.record('no-steps.png', png(text('prompt', prompt))), 'card')
        with self.assertRaisesRegex(ValueError, 'needs a Steps value'):
            render.to_a1111(model)
        with self.assertRaises(ValueError):
            render.to_a1111(dict(model, params=[{'label': 'Steps', 'value': 'twenty', 'sub': None}]))

    def test_passes_are_counted_not_shown(self):
        out = render.to_a1111(render.select(self.sample('syn-comfyui.png'), 'card'))
        self.assertIn('Passes: 2 (first shown)', out)
        self.assertEqual(len(out.splitlines()), 3)

    def test_view_and_levels(self):
        run = view('-f', 'a1111', SAMPLES / 'syn-a1111.png')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn(f"\n{SAMPLES / 'syn-a1111.png'}\n", run.stdout)
        self.assertIn('Negative prompt:', run.stdout)
        run = view('-f', 'a1111', '-l', 'card', SAMPLES / 'syn-a1111.png')
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn('basic level only', run.stderr)

if __name__ == '__main__':
    unittest.main()
