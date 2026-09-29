"""Shared parts of the console tests: cli/ on sys.path, PNGs assembled in memory, `aimeta view` as a subprocess.

No binary fixtures in the repository: every broken or odd file is built here, byte by byte,
the same way tools/make-synthetic.py builds the good ones.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'cli'
SAMPLES = ROOT / 'tools' / 'test'

# cli/ first, so `import png` finds cli/png.py and not a PyPI namesake.
sys.path.insert(0, str(CLI))

from engine import Engine  # noqa: E402
from record import read_record  # noqa: E402

SIGNATURE = b'\x89PNG\r\n\x1a\n'


def chunk(ctype, data):
    """One chunk with a correct CRC. ctype is raw bytes, the reader takes whatever it is given."""
    return struct.pack('>I', len(data)) + ctype + data + struct.pack('>I', zlib.crc32(ctype + data))


def text(key, value):
    """A tEXt chunk. A non-string value goes through json.dumps: ASCII only, so \\u escapes survive as written."""
    if not isinstance(value, str):
        value = json.dumps(value)
    return chunk(b'tEXt', key.encode('latin-1') + b'\x00' + value.encode('utf-8'))


def overlong(ctype):
    """A chunk header that promises far more data than any test file holds."""
    return struct.pack('>I', 1 << 20) + ctype


IHDR = chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0))
_PIXELS = chunk(b'IDAT', zlib.compress((b'\x00' + b'\x80' * 24) * 8))
_IEND = chunk(b'IEND', b'')


def png(*chunks, ihdr=IHDR):
    """An 8x8 PNG: signature, IHDR, the given chunks, pixels, IEND."""
    return SIGNATURE + ihdr + b''.join(chunks) + _PIXELS + _IEND


def nested(depth):
    """A JSON array nested depth levels deep, as text."""
    return '[' * depth + ']' * depth


def comfy_prompt(positive, negative=''):
    """The smallest ComfyUI API graph with one sampler, so the prompts land in the card at basic."""
    return {
        '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'model.safetensors'}},
        '2': {'class_type': 'CLIPTextEncode', 'inputs': {'text': positive, 'clip': ['1', 1]}},
        '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': negative, 'clip': ['1', 1]}},
        '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 512, 'height': 512, 'batch_size': 1}},
        '5': {'class_type': 'KSampler', 'inputs': {
            'seed': 1, 'steps': 20, 'cfg': 7, 'sampler_name': 'euler', 'scheduler': 'normal', 'denoise': 1,
            'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0]}},
    }


class EngineCase(unittest.TestCase):
    """One Engine and one temporary directory per test class."""

    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        cls.tmp = tmp.name

    @classmethod
    def write(cls, name, data):
        path = os.path.join(cls.tmp, name)
        with open(path, 'wb') as f:
            f.write(data)
        return path

    def record(self, name, data):
        """read_record of a PNG built in memory."""
        return read_record(self.engine, self.write(name, data))

    def sample(self, name):
        return read_record(self.engine, SAMPLES / name)

    def assertWarning(self, record, prefix):
        self.assertTrue(any(w.startswith(prefix) for w in record['warnings']),
                        f'no warning starting with {prefix!r} in {record["warnings"]!r}')


def view_command(*args):
    return [sys.executable, str(CLI / 'aimeta.py'), 'view', *map(os.fspath, args)]


def view_env(**overrides):
    """The inherited environment (PYTHONPATH with quickjs included) minus NO_COLOR, which each test sets itself."""
    env = {k: v for k, v in os.environ.items() if k != 'NO_COLOR'}
    env['PYTHONIOENCODING'] = 'utf-8'
    env.update(overrides)
    return env


def view(*args, **env):
    """`aimeta view ARGS` from the repository root, output decoded as UTF-8."""
    return subprocess.run(view_command(*args), cwd=ROOT, env=view_env(**env), capture_output=True,
                          encoding='utf-8', errors='replace', timeout=60)


def run_aimeta(*args, cwd=ROOT, **env):
    """`aimeta ARGS` for any command, same environment and decoding as view."""
    return subprocess.run([sys.executable, str(CLI / 'aimeta.py'), *map(os.fspath, args)], cwd=cwd,
                          env=view_env(**env), capture_output=True, encoding='utf-8', errors='replace', timeout=60)
