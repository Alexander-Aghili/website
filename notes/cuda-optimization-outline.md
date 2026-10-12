# CUDA optimization article: outline and evidence plan

Post: `_posts/2026-09-26-optimizing-cuda-kernels.md`. Moved into the blog at the user’s request for local review; walkthroughs and the measured roofline remain in progress.

## Narrative

1. **Hook: similar math, different limits.** DOT reads 128 MiB for roughly 33.6 MFLOP; GEMM reuses inputs. Explain the motivation to understand cuBLAS through implementation.
2. **Contract before speed.** Column-major views, `ld`, strided vectors, transpose dispatch, beta-zero avoiding NaN reads, floating-point reduction order. Describe the actual Netlib tests; do not claim BLAT conformance from aspirational notes.
3. **Build the roofline.** Derive the time bound, arithmetic intensity, ridge point, and precision-specific ceilings. Clearly distinguish useful bytes, requested bytes, and measured traffic at DRAM/L2/shared memory.
4. **DOT: remove contention.** Per-element atomics → block reduction → sequential addressing → multiple elements per thread → warp shuffles. Explain why contention can dominate a nominally bandwidth-bound operation.
5. **GEMV: map threads to storage.** Derive the intensity limit; compare row/column mappings, coalescing, launch geometry, and the unsuccessful shared-X experiment. Make the transpose path explicit.
6. **GEMM: reuse hierarchy.** Naive → shared tiles → 4×4 registers → 8×8 registers → double buffering. Show an outer product for one reduction step and count its shared operands and FMAs.
7. **When a prediction misses.** Historical shared tiling reduced global requests far more than runtime; register tiling improved time despite lower occupancy. Distinguish observation from a causal hypothesis requiring counters.
8. **Continue GEMM.** Compare small blocks with depth 8 and depth 16; retain evidence even for failed experiments. Then independently tune reduction depth, load mapping, and precision-specific dispatch.
9. **Application performance.** Separate kernel-only CUDA events from the host-pointer wrapper's allocation/transfers. Present cuBLAS only with matched dimensions, precision, math mode, warmup, timing scope, and clock conditions.

## Derivations to include

- `t >= max(F/Pmax, Q/B)`, hence `P <= min(Pmax, B I)` and `I* = Pmax/B`. Annotate units.
- DOT: `F ≈ 2n`, useful input `Q ≈ 2sn`, intensity `1/s`. Account separately for reduction partials/atomics.
- AXPY: `2n/(3sn) = 2/(3s)`.
- GEMV: `2mn / {s[mn+n+(1+delta_beta)m]}`, tending to `2/s` for large dimensions.
- GEMM ideal compulsory traffic: `2mnk / {s[mk+kn+(1+delta_beta)mn]}`. Square beta-zero FP32 at N=2048: about 341 FLOP/byte.
- Naive GEMM issued input-load model: `2mnk/(2smnk) = 1/s`. Do not use this as a measured DRAM roofline point.
- Block stage: `2 BM BN BK / {s BK(BM+BN)}`; square output tile gives `T/s`, **not `T/(2s)`**. Include output traffic when modeling the whole kernel.
- Register tile: `RM+RN` scalar shared operands feed `RM RN` FMAs; operands/FMA `1/RM+1/RN`.
- Double-buffered shared footprint: `2s BK(BM+BN)`. Current 128×128×16 FP32 = 32 KiB; 64×64×8 = 8 KiB; 64×64×16 = 16 KiB.
- Resource bounds: active blocks limited by registers, shared memory, threads, and architectural block limits. Include allocation granularity; do not infer occupancy solely from a register-count division.
- Speedup: `t_old/t_new`; achieved GFLOP/s: `2mnk/(t_ms*10^6)`.
- Optional Amdahl section: `S = 1/[(1-f)+f/S_kernel]` connects kernel speedups to total call time.

## Images and provenance

All 31 original PNGs are copied without modification under `assets/img/CUDAOptimization/`, preserving relative paths. The adjacent README records SHA-256 hashes. The draft embeds six selected captures; use the others for detailed sections or an appendix.

| Section           | Primary images                                                     | Caption requirement                                                         |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| DOT               | `Dot/FirstPass/ncu_summary.png`, `Dot/WarpShuffle/ncu_summary.png` | State vector size and distinguish atomic removal from bandwidth utilization |
| GEMV              | `Gemv/WarpRowColumnSplit/ncu_memory_chart_vs_cublas.png`           | Current = cuBLAS; Baseline 1 = custom kernel                                |
| Shared tiling     | `Gemm/SharedMemTiling/ncu_memory_chart_vs_baseline.png`            | Compare global requests with actual memory traffic                          |
| Register blocking | `Gemm/RegisterBlocking/ncu_speed_of_light_vs_tiled.png`            | Include elapsed time alongside utilization                                  |
| 8×8 registers     | `Gemm/RegisterTile8x8/ncu_speed_of_light_vs_4x4.png`               | Explain lower occupancy without assuming causality                          |
| Double buffering  | `Gemm/DoubleBuffering/ncu_speed_of_light_vs_singlebuf.png`         | Current 4.91 ms versus baseline 5.47 ms; historical capture                 |

Useful additional figures: (1) a publication-ready roofline with measured ceilings and points at the same memory boundary, (2) a column-major lane mapping diagram, and (3) a 4×4 register outer-product diagram. Do not invent GPU peaks to finish the roofline. Use a standard plotting library and retain raw measurements with the figure.

## Historical evidence

Source: `~/Projects/GPULinAlg/BLAS/report_notes.txt`, section 15, plus PNG captures. Baseline source revision `c11b4fd` contains double buffering. Prior stages: `15e6bc6`, `89b175b`, `a44068e`, `6d1f43a`.

The notes are raw material, not authoritative proof for every sentence. Correct the tile-intensity factor of two and the proposed small-block shared footprint; avoid inferring proprietary cuBLAS internals from a kernel name. Do not equate an aggregate Nsight SOL number with useful FP32 FLOP/s. Historical runs have no statistical spread and should remain labeled as individual profiling captures.

## Before publication

- Complete the DOT/GEMV explanatory prose, with each claim tied to the correct capture.
- Record GPU/power/clock conditions, compiler flags, precision, and revisions for new comparisons.
- Measure bandwidth and precision-matched compute ceilings before drawing numerical roofs.
- Collect DRAM/L2 bytes for the plotted point, rather than substituting the source-level load estimate.
- Add cuBLAS timing in the same harness and explicitly set/report its arithmetic mode.
- Verify the blog visually once the missing Jekyll dependencies are installed. `bundle check` currently reports missing gems; a full site render has not been performed.

References: [NERSC roofline methodology](https://docs.nersc.gov/tools/performance/roofline/), [NVIDIA CUDA best practices](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/).

## New experiment: September 26, 2026

CUDA 13.3.73, `nvcc -O3 -arch=sm_89 -lineinfo`, RTX 4060 Laptop GPU. Direct kernel launches with padded leading dimensions, preallocated device memory, five warmups, median of nine batches of ten launches. Deterministic inputs, beta=0 timing, CPU checks for beta=0/1; clocks were not locked and runs were sequential. These are exploratory measurements, not comparable directly to the historical Nsight times. The harness currently measures warm repeated inputs; it does not flush caches or benchmark cuBLAS.

| Block width / K depth                        | NN ms | NT ms | TN ms | TT ms |
| -------------------------------------------- | ----- | ----- | ----- | ----- |
| Original 16 / 16                             | 3.907 | 4.018 | 4.076 | 4.177 |
| Candidate 8 / 8                              | 4.635 | 4.643 | 5.044 | 4.818 |
| Candidate 8 / 16                             | 4.733 | 4.618 | 5.546 | 5.425 |
| Configurable implementation, default 16 / 16 | 3.965 | 4.125 | 4.193 | 4.180 |

Both small-block candidates regressed in this run; neither was selected as the FP32 default. No new speedup is claimed. Retain the original 256-thread FP32 configuration and independently tune K depth next. To establish a small speed difference, repeat in alternating order and record variance and clock behavior.

The existing FP64 kernel failed compilation: its double-buffered 128×128×16 tiles need 64 KiB of static shared memory. The configurable implementation defaults FP64 to reduction depth 8, using 32 KiB, while retaining FP32 depth 16. Full CPU checks on ragged padded shapes and all four transpose combinations passed in the standalone harness (FP32 129×132×134; FP64 65×68×70). Large 2048³ cases use deterministic sampled CPU comparisons, not full reference validation.

The reusable harness is `~/Projects/GPULinAlg/BLAS/gemm_experiment.cu`; experiment instructions and CSVs are kept alongside the BLAS repository. Known remaining checks include alpha-zero semantics, sanitizer coverage, and a fair cuBLAS comparison. These checks are not implied by passing the tests above.

Final validation: clean Release builds and all 12 existing CTest tests passed in both FP32 and FP64, including the four Netlib GEMM comparisons. Build trees: `/tmp/cuda-blog-experiment/build-fp32` and `/tmp/cuda-blog-experiment/build-fp64`. All 31 website PNGs match their source hashes; all six embedded image paths resolve. A full Jekyll render remains unverified because dependencies are missing.
