# CUDA article animations

Manim scenes for `_posts/2026-09-26-optimizing-cuda-kernels.md`. They replace the earlier Figma diagrams.

| Module           | Slugs                                                      |
| ---------------- | ---------------------------------------------------------- |
| `dot_atomics.py` | `dot-atomic-contention`, `reduction-tree`                  |
| `dot_tree.py`    | `dot-divergence`, `dot-bank-conflicts`, `dot-warp-shuffle` |
| `gemv.py`        | `gemv-launch`, `gemv-mapping`                              |
| `gemm.py`        | `gemm-tiles`, `register-outer-product`, `double-buffer`    |

Render everything, or only some slugs, with:

```sh
uv run bin/cuda_animations/render.py
uv run bin/cuda_animations/render.py gemm-tiles double-buffer
```

The script needs cairo, pango, LaTeX and ffmpeg on the system; uv installs Manim 0.21.0 from the inline metadata. Each clip is written to `assets/video/CUDAOptimization/<slug>.mp4` (1280 × 720, 30 fps, H.264, no audio) and its poster, the completed diagram held just before the loop fades out, to `assets/img/CUDAOptimization/animations/<slug>.png`. The article embeds them with `{% include cuda-diagram.liquid name="<slug>" %}`, and `assets/js/cuda-charts.js` plays each clip only while it is on screen and never under reduced motion.

`style.py` holds the palette and text helpers. Build text through `T`, `code` or `M`: Pango spaces small text poorly, so text is set at four times its size and scaled down, with the layout width widened so long lines do not wrap. Displayed values are computed from the kernels' real indexing, and every count or timing on screen comes from the article.
