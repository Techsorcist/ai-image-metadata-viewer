"""Source layer and engine: png.py, record.py and the bridge, on files that are broken in instructive ways."""
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
            'ihdr-short': (png(ihdr=chunk(b'IHDR', b'\x00\x00\x00\x08')), 'PNG parse error:'),
            'chunk-past-eof': (png(overlong(b'tEXt')), 'PNG parse error:'),
            'text-without-nul': (png(chunk(b'tEXt', b'parameters only')), 'Failed to read tEXt chunk:'),
        }
        for name, (data, prefix) in cases.items():
            with self.subTest(name):
                self.assertWarning(self.record(f'{name}.png', data), prefix)


if __name__ == '__main__':
    unittest.main()
