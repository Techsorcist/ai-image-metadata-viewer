# AI Image Metadata Viewer

You generated a great picture three months ago. Or not you — you just found it in the deep dark web. What was the prompt? Which model? Which of the six LoRAs on the canvas were actually on? The answers are inside the PNG metadata, and this is the tool that reads them out: drop an image, get the prompt, the negative, the seed, the sampler, the models, and the raw ComfyUI graph as a tree you can actually unfold.

One HTML file. No install, no server, no account, no network.

## Getting started

Grab [`ai-image-metadata-viewer.html`](https://github.com/Techsorcist/ai-image-metadata-viewer/releases/latest) from the latest release and open it in a browser. That is the entire installation. Keep it in Downloads, on a USB stick, bookmark it from `file://`, it does not care.

Prefer not to download anything? The [online demo](https://techsorcist.github.io/ai-image-metadata-viewer/) is the same file served from GitHub Pages. Your images are still processed inside your browser and go nowhere.

## Privacy first

Everything happens in your browser tab. The page makes no network requests at all: no analytics, no CDN, no update checks, no fonts from somewhere else. Unplug the network and it keeps working exactly the same, which is the easiest audit you will do this year.

It also flags values that look like private data, such as local paths with your user name or personal notes, so you can see what a PNG carries before you post it. It never modifies your files.

## What it reads

- PNG text chunks: `tEXt`, `iTXt`, `zTXt`, inflated right in the browser.
- **SwarmUI**, including the original prompt before wildcards were expanded.
- **ComfyUI**, from the API graph or from the UI workflow alone when that is all the file has. Bypassed and muted nodes are resolved, notes and unconnected prompt nodes are kept out of the prompt, and a second sampler pass shows up as a second pass, not as noise.
- **InvokeAI**, current and legacy formats.
- **AUTOMATIC1111 / Forge** and everything that writes the same `parameters` text.
- Fooocus, NovelAI, Easy Diffusion, Draw Things and unknown files are recognised and shown as raw chunks.

JPEG and WebP via EXIF `UserComment` are planned. Maybe.

## What it shows

- A card with Prompt, Negative, parameters, and models: checkpoint, LoRA, VAE, ControlNet, upscaler, with weights and hashes (if possible).
- For ComfyUI: a switch between sampler passes and every text node in the graph, grouped into the ones feeding samplers, the ones not connected to anything, and canvas notes.
- Syntax highlighting for prompts: weights, angle tags, `{a|b}` and `<random:...>` choices, `BREAK`, wildcards, comments. One button turns it off if you find it too cheerful.
- In-place editing after pressing Edit, with live highlighting. Copy takes the edited text, Reset brings the original back. Edits live in the page and never touch the file.
- Raw metadata as a lazy JSON tree with expand, collapse, copy and download. Nodes a ComfyUI workflow did not execute are labelled as such, so you stop wondering.
- Several files at once, newest on top, with per-file removal, Clear history and Clear all.
- Light and dark theme, following the system by default.

## Development

- `index.dev.html` loads the sources from `src/` directly. Edit, reload, no build step.
- `./build.sh` glues everything into `ai-image-metadata-viewer.html` in the repository root. It needs a POSIX shell and nothing else. The built file is committed.
- `tools/test/` holds synthetic sample images from `tools/make-synthetic.py`; `tools/check.html` runs all of them through the parsers at once. Serve the project over HTTP first, `fetch` refuses to work from `file://`, as it should.
- Every push to `master` redeploys the demo on GitHub Pages. Pushing a tag like `v1.2.0` creates a GitHub Release with the built file attached; the tag must match the version in `src/js/07-settings.js`, or the release job will tell you so and quit.

## Acknowledgements

Written from scratch, but on the shoulders of three earlier tools whose code and ideas were studied:

- [receyuki/stable-diffusion-prompt-reader](https://github.com/receyuki/stable-diffusion-prompt-reader) by Rhys Yang (MIT). The per-generator format modules and the ComfyUI graph traversal from the sampler nodes.
- [erroralex/metadata-viewer](https://github.com/erroralex/metadata-viewer) by Alexander Nilsson (MIT with Commons Clause). The two-column layout, the parameter cards and the overall visual style.
- [Xypher7/ai-image-metadata-editor](https://github.com/Xypher7/ai-image-metadata-editor) by Xypher7. The single-HTML-file approach, the hand-written PNG/JPEG/WebP chunk readers and the collapsible raw metadata view.

Thank you to all three authors :heart:

Icons are from [Lucide](https://lucide.dev) (ISC).
