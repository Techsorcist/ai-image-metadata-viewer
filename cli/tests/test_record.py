"""Source layer and engine: png.py, record.py and the bridge, on files that are broken in instructive ways."""
import time
import unittest
import zlib

from fixtures import SAMPLES, EngineCase, chunk, nested, overlong, png, text

# The generator per sample: the cheapest canary for the module list in engine.py.
# A new file in tools/test goes here too, the test insists.
EXPECTED_GENERATORS = {
    'syn-a1111.png': 'a1111',
    'syn-comfyui-flux.png': 'comfyui',
    'syn-comfyui.png': 'comfyui',
    'syn-empty.png': 'none',
    'syn-invokeai-legacy.png': 'invokeai-legacy',
    'syn-invokeai.png': 'invokeai',
    'syn-novelai.png': 'novelai',
}


class DeepJsonTest(EngineCase):
    def test_deep_json_becomes_a_warning(self):
        # 2000 runs Python's json out of stack on the way back, 9000 does the same to QuickJS in JSON.stringify.
        for depth in (2000, 9000):
            with self.subTest(depth=depth):
                r = self.record(f'deep{depth}.png', png(text('prompt', nested(depth))))
                self.assertIsNone(r['card'])
                # Newer Pythons may well digest 2000 levels; then there is nothing to warn about.
                if r['entries'][0].get('json') is None:
                    self.assertWarning(r, 'Cannot parse metadata')


class BridgeTest(EngineCase):
    def test_executed_set_crosses_as_list(self):
        executed = self.sample('syn-comfyui.png')['card']['executed']
        self.assertIsInstance(executed, list)
        self.assertTrue(executed)

    def test_samples_detect_expected_generator(self):
        found = sorted(p.name for p in SAMPLES.glob('*.png'))
        self.assertEqual(found, sorted(EXPECTED_GENERATORS), 'tools/test changed, update EXPECTED_GENERATORS')
        for name, gen_id in EXPECTED_GENERATORS.items():
            with self.subTest(name=name):
                self.assertEqual(self.sample(name)['generator']['id'], gen_id)


class MalformedPngTest(EngineCase):
    def test_malformed_png_gives_warning(self):
        stream = zlib.compress(b'Steps: 20, Seed: 1')
        ztxt = b'parameters\x00\x00'
        cases = {
            'ztxt-truncated': (png(chunk(b'zTXt', ztxt + stream[:-6])), 'Failed to read zTXt chunk:'),
            'ztxt-trailing': (png(chunk(b'zTXt', ztxt + stream + b'junk')), 'Failed to read zTXt chunk:'),
            'ztxt-method-1': (png(chunk(b'zTXt', b'parameters\x00\x01' + stream)), 'Failed to read zTXt chunk:'),
            'ztxt-not-zlib': (png(chunk(b'zTXt', ztxt + b'definitely not deflate')), 'Failed to read zTXt chunk:'),
            'ihdr-short': (png(ihdr=chunk(b'IHDR', b'\x00\x00\x00\x08')), 'Stopped reading chunks: IHDR chunk is too short'),
            'chunk-past-eof': (png(overlong(b'tEXt')), 'Stopped reading chunks:'),
            'text-without-nul': (png(chunk(b'tEXt', b'parameters only')), 'Failed to read tEXt chunk:'),
        }
        for name, (data, prefix) in cases.items():
            with self.subTest(name):
                self.assertWarning(self.record(f'{name}.png', data), prefix)

    def test_truncated_file_keeps_text_before_the_cut(self):
        # A1111, ComfyUI and PIL write their text before IDAT, so a file cut off in the pixels still has it.
        r = self.record('cut.png', png(text('parameters', 'a cat\nSteps: 20, Seed: 1'), overlong(b'IDAT')))
        self.assertEqual(r['generator']['id'], 'a1111')
        self.assertEqual(r['card']['positive']['text'], 'a cat')
        self.assertEqual((r['width'], r['height']), (8, 8))
        self.assertWarning(r, 'Stopped reading chunks:')


class A1111TextTest(EngineCase):
    def test_padded_parameter_line(self):
        # The old pair regexp overlapped on spaces: cubic time, half a minute for 3000 of them in QuickJS,
        # and the browser ran the same regexp synchronously on drop.
        padded = 'cat\nNegative prompt: bad\nSteps: 1, ' + ' ' * 3000 + 'x, Seed: 5'
        start = time.perf_counter()
        r = self.record('padded.png', png(text('parameters', padded)))
        self.assertLess(time.perf_counter() - start, 3)
        self.assertEqual(r['generator']['id'], 'a1111')
        params = {p['label']: p['value'] for p in r['card']['params']}
        self.assertEqual((params['Steps'], params['Seed']), ('1', '5'))


if __name__ == '__main__':
    unittest.main()
