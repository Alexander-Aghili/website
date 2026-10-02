# CUDA optimization source history

Source: https://github.com/Alexander-Aghili/BLAS-GPU

Patches are unmodified `git show --format=fuller` output for the relevant source/build/benchmark files, extracted from the local repository. They preserve original commit metadata. Timings remain historical profiler observations; commit contents establish the code changes, not a new performance measurement.

| Article step                                          | Revision | Relationship to experiment                                                                             |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| DOT baseline                                          | 4da826e  | Per-product atomic source                                                                              |
| DOT fixed block, shared reduction, contiguous threads | 3affd9b  | Combined in one commit; fixed-block-only and initial interleaved reduction states not separately saved |
| DOT sequential addressing                             | 47a65d8  | Exact reduction-loop diff                                                                              |
| DOT multiple elements                                 | 7099f40  | Exact grid-only diff                                                                                   |
| DOT shuffle                                           | 98cc847  | Exact kernel diff                                                                                      |
| cuBLAS reference                                      | f52cdda  | Benchmark addition                                                                                     |
| GEMV baseline                                         | 051d7c3  | Eight blocks for 4096 rows                                                                             |
| GEMV shared vector and launch sweep                   | cca54d1  | Retains 128 × 512; other tested settings not separately saved                                          |
| GEMV row/column split                                 | 15e6bc6  | Exact kernel and launch diff                                                                           |
| GEMM baseline                                         | 15e6bc6  | Source immediately before tiling                                                                       |
| GEMM shared tiles                                     | 89b175b  | Exact kernel diff                                                                                      |
| GEMM 4 × 4 register tile                              | a44068e  | Exact kernel and launch diff                                                                           |
| GEMM 8 × 8 register tile                              | 6d1f43a  | One constant changed                                                                                   |
| GEMM double buffer                                    | c11b4fd  | Exact kernel diff                                                                                      |

The full-function listings in the blog are the current working implementation. In GEMM they include a later reduction-depth/load-count refactor that is not part of these historical commits. No historical screenshot is claimed to measure that refactor.
