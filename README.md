# AI Image Metadata Viewer

A single self-contained HTML file that shows the generation metadata embedded in AI images. Drop a PNG, see the prompt, the model, the seed, the LoRAs and the raw chunks as a collapsible JSON tree.

## Getting started

Download `ai-image-metadata-viewer.html` and open it in any modern browser. That is the whole installation: no server, no install, no account. Bookmark it, keep it on a USB stick, it works from a plain `file://` URL.

## Privacy first

Everything runs locally, inside your browser tab. The page makes no network requests: no analytics, no CDN, no update checks, no fonts from the internet. Your images, prompts and workflows never leave your machine. You can confirm it yourself: open the file, disconnect from the network, and it keeps working exactly the same.

The viewer also marks values that look like private data, such as local paths with your user name or personal notes, so you can see what travels inside an image before you share it. It never modifies your files.

## Features

- PNG text chunks: `tEXt`, `iTXt`, `zTXt` (inflated with the browser's `DecompressionStream`).
- Generators recognised: SwarmUI, ComfyUI (the API graph, or the UI workflow alone when that is all the file has: bypassed and muted nodes are resolved, notes and unconnected prompt nodes are kept apart), InvokeAI, AUTOMATIC1111 / Forge and compatible. Fooocus, NovelAI, Easy Diffusion, Draw Things and unknown files are shown as raw chunks.
- A card with Prompt, Negative, parameters, models (checkpoint, LoRA, VAE, ControlNet, upscaler with hashes and weights), and for ComfyUI a switch between sampler passes plus every text node in the graph.
- Original prompt for SwarmUI, before wildcards were expanded.
- Prompt syntax highlighting: weights, angle tags, `{a|b}` and `<random:...>` choices, `BREAK`, wildcards, SwarmUI comments. One button turns it off.
- Prompts are editable after pressing Edit, with live highlighting. Copy takes the edited text, Reset brings the original back. Edits stay in the page and are not written to the file.
- Raw metadata as a lazy JSON tree with expand, collapse, copy and download. In a ComfyUI workflow the nodes that were not executed, bypassed or muted are labelled.
- Several files at once, newest on top, with per-file removal, Clear history and Clear all.
- Light and dark theme, following the system by default.

JPEG and WebP (EXIF `UserComment`) are planned.

## Development

- `index.dev.html` loads the sources from `src/` directly, no build needed while working.
- `./build.sh` concatenates everything into `ai-image-metadata-viewer.html` in the repository root. Requires only a POSIX shell. The built file is committed, so the download link above always points at the latest build.
- `tools/test/` holds synthetic sample images written by `tools/make-synthetic.py`; `tools/check.html` runs every file there through the parsers at once (serve the project over HTTP first, `fetch` does not work from `file://`).

## Acknowledgements

This project was written from scratch, but it stands on the shoulders of three earlier tools whose code and ideas were studied closely:

- [receyuki/stable-diffusion-prompt-reader](https://github.com/receyuki/stable-diffusion-prompt-reader) by Rhys Yang (MIT). The per-generator format modules and the ComfyUI graph traversal from the sampler nodes.
- [erroralex/metadata-viewer](https://github.com/erroralex/metadata-viewer) by Alexander Nilsson (MIT with Commons Clause). The two-column layout, the parameter cards and the overall visual style.
- [Xypher7/ai-image-metadata-editor](https://github.com/Xypher7/ai-image-metadata-editor) by Xypher7. The single-HTML-file approach, the hand-written PNG/JPEG/WebP chunk readers and the collapsible raw metadata view.

Thank you to all three authors.

Icons are from [Lucide](https://lucide.dev) (ISC).
