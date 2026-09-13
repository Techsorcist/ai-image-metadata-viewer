#!/usr/bin/env python3
"""Generates synthetic PNGs with metadata of generators for which no real samples
are at hand. The image is 8x8; only the text chunks matter.
Run: python3 tools/make-synthetic.py  (writes syn-*.png into tools/test/).
Standard library only."""
import json
import os
import struct
import zlib

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test")


def chunk(ctype, data):
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def text_chunk(kind, key, value):
    key_b = key.encode("latin1")
    value_b = value.encode("utf-8")
    if kind == "tEXt":
        return chunk(b"tEXt", key_b + b"\x00" + value_b)
    if kind == "zTXt":
        return chunk(b"zTXt", key_b + b"\x00\x00" + zlib.compress(value_b))
    if kind == "iTXt":
        return chunk(b"iTXt", key_b + b"\x00\x00\x00" + b"\x00" + b"\x00" + value_b)
    if kind == "iTXt+z":
        return chunk(b"iTXt", key_b + b"\x00\x01\x00" + b"\x00" + b"\x00" + zlib.compress(value_b))
    raise ValueError(kind)


def write_png(name, texts, size=8, color=(120, 80, 200)):
    w = h = size
    raw = b"".join(b"\x00" + bytes(color) * w for _ in range(h))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    for kind, key, value in texts:
        png += text_chunk(kind, key, value if isinstance(value, str) else json.dumps(value))
    png += chunk(b"IDAT", zlib.compress(raw))
    png += chunk(b"IEND", b"")
    with open(os.path.join(HERE, name), "wb") as f:
        f.write(png)
    print("wrote", name)


# --- Plain ComfyUI: KSampler, LoraLoader, text via a string node, hires second pass ---
comfy_prompt = {
    "4": {"inputs": {"ckpt_name": "sdxl/juggernautXL_v9.safetensors"}, "class_type": "CheckpointLoaderSimple", "_meta": {"title": "Load Checkpoint"}},
    "10": {"inputs": {"lora_name": "detail_tweaker_xl.safetensors", "strength_model": 0.8, "strength_clip": 0.8, "model": ["4", 0], "clip": ["4", 1]}, "class_type": "LoraLoader", "_meta": {"title": "Load LoRA"}},
    "20": {"inputs": {"string": "masterpiece, {red|blue|green} fox in the snow, (detailed fur:1.2), <lora:detail_tweaker_xl:0.8>"}, "class_type": "StringConstant", "_meta": {"title": "Positive text"}},
    "6": {"inputs": {"text": ["20", 0], "clip": ["10", 1]}, "class_type": "CLIPTextEncode", "_meta": {"title": "CLIP Text Encode (Positive)"}},
    "7": {"inputs": {"text": "worst quality, bad hands, blurry", "clip": ["10", 1]}, "class_type": "CLIPTextEncode", "_meta": {"title": "CLIP Text Encode (Negative)"}},
    "5": {"inputs": {"width": 1024, "height": 1024, "batch_size": 1}, "class_type": "EmptyLatentImage", "_meta": {"title": "Empty Latent Image"}},
    "3": {"inputs": {"seed": 123456789, "steps": 30, "cfg": 6.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0, "model": ["10", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}, "class_type": "KSampler", "_meta": {"title": "KSampler"}},
    "11": {"inputs": {"upscale_method": "nearest-exact", "scale_by": 1.5, "samples": ["3", 0]}, "class_type": "LatentUpscaleBy", "_meta": {"title": "Upscale Latent By"}},
    "12": {"inputs": {"seed": 987654321, "steps": 15, "cfg": 6.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 0.45, "model": ["10", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["11", 0]}, "class_type": "KSampler", "_meta": {"title": "KSampler (hires)"}},
    "15": {"inputs": {"vae_name": "sdxl_vae.safetensors"}, "class_type": "VAELoader", "_meta": {"title": "Load VAE"}},
    "13": {"inputs": {"samples": ["12", 0], "vae": ["15", 0]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}},
    "14": {"inputs": {"filename_prefix": "ComfyUI", "images": ["13", 0]}, "class_type": "SaveImage", "_meta": {"title": "Save Image"}},
}
comfy_workflow = {
    "id": "00000000-0000-0000-0000-000000000001", "revision": 0, "last_node_id": 99, "last_link_id": 20,
    "nodes": [
        {"id": int(k), "type": v["class_type"], "pos": [i * 200, 100], "size": [300, 100], "flags": {}, "order": i, "mode": 0,
         "inputs": [], "outputs": [], "properties": {"Node name for S&R": v["class_type"]}, "widgets_values": []}
        for i, (k, v) in enumerate(comfy_prompt.items())
    ] + [
        {"id": 98, "type": "PreviewImage", "pos": [0, 600], "size": [200, 100], "flags": {}, "order": 20, "mode": 2, "inputs": [], "outputs": [], "properties": {}, "widgets_values": []},
        {"id": 99, "type": "Note", "pos": [0, 800], "size": [300, 100], "flags": {}, "order": 21, "mode": 0, "inputs": [], "outputs": [],
         "properties": {}, "widgets_values": ["Models live in C:\\Users\\alice\\ComfyUI\\models, do not share this workflow"]},
    ],
    "links": [], "groups": [], "config": {}, "extra": {"ds": {"scale": 1, "offset": [0, 0]}}, "version": 0.4,
}
write_png("syn-comfyui.png", [("tEXt", "prompt", comfy_prompt), ("iTXt+z", "workflow", comfy_workflow)])

# --- ComfyUI with SamplerCustomAdvanced and BasicGuider (Flux-like graph) ---
flux_prompt = {
    "1": {"inputs": {"unet_name": "flux1-dev-fp8.safetensors", "weight_dtype": "fp8_e4m3fn"}, "class_type": "UNETLoader", "_meta": {"title": "Load Diffusion Model"}},
    "2": {"inputs": {"clip_name1": "t5xxl_fp16.safetensors", "clip_name2": "clip_l.safetensors", "type": "flux"}, "class_type": "DualCLIPLoader", "_meta": {"title": "DualCLIPLoader"}},
    "3": {"inputs": {"text": "a watercolor lighthouse at dusk, <random:calm,stormy> sea", "clip": ["2", 0]}, "class_type": "CLIPTextEncode", "_meta": {"title": "CLIP Text Encode (Positive Prompt)"}},
    "4": {"inputs": {"model": ["1", 0], "conditioning": ["3", 0]}, "class_type": "BasicGuider", "_meta": {"title": "BasicGuider"}},
    "5": {"inputs": {"noise_seed": 42}, "class_type": "RandomNoise", "_meta": {"title": "RandomNoise"}},
    "6": {"inputs": {"sampler_name": "euler"}, "class_type": "KSamplerSelect", "_meta": {"title": "KSamplerSelect"}},
    "7": {"inputs": {"scheduler": "simple", "steps": 20, "denoise": 1.0, "model": ["1", 0]}, "class_type": "BasicScheduler", "_meta": {"title": "BasicScheduler"}},
    "9": {"inputs": {"width": 1344, "height": 768, "batch_size": 1}, "class_type": "EmptySD3LatentImage", "_meta": {"title": "EmptySD3LatentImage"}},
    "8": {"inputs": {"noise": ["5", 0], "guider": ["4", 0], "sampler": ["6", 0], "sigmas": ["7", 0], "latent_image": ["9", 0]}, "class_type": "SamplerCustomAdvanced", "_meta": {"title": "SamplerCustomAdvanced"}},
    "10": {"inputs": {"vae_name": "ae.safetensors"}, "class_type": "VAELoader", "_meta": {"title": "Load VAE"}},
    "11": {"inputs": {"samples": ["8", 0], "vae": ["10", 0]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}},
    "12": {"inputs": {"filename_prefix": "flux", "images": ["11", 0]}, "class_type": "SaveImage", "_meta": {"title": "Save Image"}},
}
write_png("syn-comfyui-flux.png", [("tEXt", "prompt", flux_prompt)], color=(40, 120, 160))

# --- A1111 in zTXt, with LoRA, hires, VAE and postprocessing ---
a1111_text = (
    "a portrait of an old sailor, weathered face, (dramatic lighting:1.3), <lora:detail_tweaker:0.8>, "
    "[oil painting|photograph], BREAK, harbor background __weather__\n"
    "Negative prompt: (worst quality, low quality:1.4), bad anatomy, watermark, text\n"
    "Steps: 28, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 6, Seed: 3141592653, Size: 832x1216, "
    "Model hash: 1fe6c7ec54, Model: realisticVisionV60B1_v51HyperVAE, VAE hash: 235745af8d, VAE: vae-ft-mse-840000-ema-pruned.safetensors, "
    "Denoising strength: 0.4, Clip skip: 2, Hires upscale: 1.5, Hires steps: 10, Hires upscaler: 4x-UltraSharp, "
    "Lora hashes: \"detail_tweaker: 7c0b3b9a1c4d\", TI hashes: \"easynegative: c74b4e810b03\", Version: v1.10.1"
)
write_png("syn-a1111.png", [("zTXt", "parameters", a1111_text), ("tEXt", "postprocessing", "Postprocess upscale by: 2, Postprocess upscaler: R-ESRGAN 4x+")], color=(200, 120, 60))

# --- InvokeAI current format (from the docs, no real sample) ---
invoke_meta = {
    "generation_mode": "sdxl_txt2img",
    "positive_prompt": "isometric cozy cabin in the woods, autumn, warm light",
    "negative_prompt": "blurry, deformed",
    "width": 1024, "height": 1024, "seed": 2718281828, "rand_device": "cpu",
    "cfg_scale": 7.5, "cfg_rescale_multiplier": 0, "steps": 30, "scheduler": "dpmpp_2m_sde_k",
    "seamless_x": False, "seamless_y": False, "clip_skip": 0,
    "model": {"key": "6a1b2c3d", "hash": "blake3:ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12", "name": "juggernautXL_v9", "base": "sdxl", "type": "main"},
    "loras": [{"model": {"key": "9f8e7d6c", "hash": "blake3:0011223344556677", "name": "add-detail-xl", "base": "sdxl", "type": "lora"}, "weight": 0.6}],
    "vae": {"key": "vae01", "hash": "blake3:aa", "name": "sdxl-vae-fp16-fix", "base": "sdxl", "type": "vae"},
    "positive_style_prompt": "isometric cozy cabin in the woods, autumn, warm light",
    "negative_style_prompt": "blurry, deformed",
    "app_version": "5.4.2",
}
invoke_graph = {"id": "sdxl_graph", "nodes": {"noise": {"type": "noise", "seed": 2718281828}}, "edges": []}
write_png("syn-invokeai.png", [("iTXt", "invokeai_metadata", invoke_meta), ("tEXt", "invokeai_graph", invoke_graph)], color=(60, 160, 90))

# --- InvokeAI legacy format: sd-metadata and Dream ---
sd_meta = {
    "model": "stable diffusion", "model_weights": "stable-diffusion-1.5", "model_hash": "cc6cb27103417325ff94f52b7a5d2dde45a7515b25c255d8e396c90014281516",
    "app_id": "invoke-ai/InvokeAI", "app_version": "2.3.5",
    "image": {"prompt": [{"prompt": "a lonely robot reading a book [blurry, text]", "weight": 1.0}], "steps": 50, "cfg_scale": 7.5, "threshold": 0, "perlin": 0,
              "height": 512, "width": 512, "seed": 1618033988, "seamless": False, "hires_fix": False, "type": "txt2img", "postprocessing": None, "sampler": "k_lms", "variations": []},
}
dream = '"a lonely robot reading a book [blurry, text]" -s 50 -S 1618033988 -W 512 -H 512 -C 7.5 -A k_lms'
write_png("syn-invokeai-legacy.png", [("tEXt", "sd-metadata", sd_meta), ("tEXt", "Dream", dream)], color=(90, 90, 90))

# --- NovelAI: detection and raw display only ---
nai_comment = {"prompt": "1girl, silver hair, looking at viewer", "steps": 28, "height": 1216, "width": 832, "scale": 5.0, "seed": 1234567890,
               "sampler": "k_euler_ancestral", "uc": "lowres, bad anatomy", "noise_schedule": "native"}
write_png("syn-novelai.png", [("tEXt", "Title", "AI generated image"), ("tEXt", "Description", "1girl, silver hair, looking at viewer"),
                              ("tEXt", "Software", "NovelAI"), ("tEXt", "Source", "NovelAI Diffusion V3"), ("tEXt", "Comment", nai_comment)], color=(200, 200, 220))

# --- No metadata at all ---
write_png("syn-empty.png", [], color=(30, 30, 30))

