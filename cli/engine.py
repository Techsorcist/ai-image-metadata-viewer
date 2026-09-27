"""Runs the parsers from src/js inside QuickJS, so the console reads files the way the browser does.

Everything quickjs-specific lives in this file: swapping the engine (mini-racer is the
fallback) should not touch anything else.
"""
import json
import re
from pathlib import Path

import quickjs

CLI_DIR = Path(__file__).resolve().parent
ROOT = CLI_DIR.parent
DEV_HTML = ROOT / 'index.dev.html'
BRIDGE = CLI_DIR / 'bridge.js'

# UI modules: DOM all the way down and of no use for parsing. A new UI module must be added here.
UI_MODULES = frozenset({'05-icons', '07-settings', '40-tree', '50-ui', '70-card', '75-prompt-syntax', '90-app'})
# The metadata source layer that png.py and record.py replace. 10-png also creates
# a TextDecoder at load time, and QuickJS has none.
SOURCE_MODULES = frozenset({'10-png', '20-source'})


class JsError(Exception):
    """A JS exception while loading the modules or inside a bridge call."""


def module_paths():
    """src/js modules in load order, read from index.dev.html like build.sh does, minus the excluded ones."""
    html = DEV_HTML.read_text(encoding='utf-8')
    paths = [ROOT / p for p in re.findall(r'src="(src/[^"]*\.js)"', html)]
    return [p for p in paths if p.stem not in UI_MODULES | SOURCE_MODULES]


class Engine:
    """One QuickJS context with the non-UI modules and cli/bridge.js loaded. Create once per process."""

    def __init__(self):
        self._ctx = quickjs.Context()
        # 00-util.js starts with window.App, the only browser global the non-UI modules need.
        self._ctx.eval('globalThis.window = globalThis;')
        for path in module_paths() + [BRIDGE]:
            try:
                self._ctx.eval(path.read_text(encoding='utf-8'))
            except quickjs.JSException as e:
                raise JsError(f'{path.name}: {e}') from e

    def call(self, name, obj):
        """App.bridge[name](JSON of obj), the JSON string it returns parsed back."""
        try:
            fn = self._ctx.eval(f'App.bridge.{name}')
            return json.loads(fn(json.dumps(obj)))
        except quickjs.JSException as e:
            raise JsError(f'App.bridge.{name}: {e}') from e
