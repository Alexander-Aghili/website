#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["manim==0.21.0"]
# ///
"""Render the CUDA article animations and their poster frames.

    uv run bin/cuda_animations/render.py              # every scene
    uv run bin/cuda_animations/render.py gemm-tiles   # selected slugs

Each module lists SCENES as (slug, class name). The finished clip goes to
assets/video/CUDAOptimization/<slug>.mp4 (H.264, faststart, no audio) and the
poster to assets/img/CUDAOptimization/animations/<slug>.png. The poster is the
frame 1.4 s before the end, inside the hold that CudaScene.finish provides.
"""
import importlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VIDEO = ROOT / "assets/video/CUDAOptimization"
POSTER = ROOT / "assets/img/CUDAOptimization/animations"
MODULES = ["dot_atomics", "dot_tree", "gemv", "gemm"]


def scenes():
    sys.path.insert(0, str(HERE))
    for name in MODULES:
        if (HERE / f"{name}.py").exists():
            for slug, cls in importlib.import_module(name).SCENES:
                yield name, slug, cls


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return float(json.loads(out)["format"]["duration"])


def render(module, slug, cls, media):
    subprocess.run([sys.executable, "-m", "manim", "render", "-r", "1280,720", "--fps", "30",
                    "--media_dir", media, "--disable_caching", "--progress_bar", "none", "-v", "WARNING", "-o", slug,
                    str(HERE / f"{module}.py"), cls], check=True, cwd=HERE)
    raw = next(Path(media).rglob(f"{slug}.mp4"))
    VIDEO.mkdir(parents=True, exist_ok=True)
    POSTER.mkdir(parents=True, exist_ok=True)
    out = VIDEO / f"{slug}.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-an", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], check=True)
    at = max(duration(out) - 1.4, 0)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(out), "-frames:v", "1",
                    str(POSTER / f"{slug}.png")], check=True)
    print(f"{slug}: {duration(out):.1f} s, {out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    with tempfile.TemporaryDirectory() as media:
        for module, slug, cls in scenes():
            if not wanted or slug in wanted:
                render(module, slug, cls, media)
