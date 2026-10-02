---
layout: post
date: 2026-09-26 12:00:00 -0400
title: "Developing a GPU Accelerated BLAS"
description: "An illustrated walkthrough of DOT, GEMV, and GEMM, with the profiler evidence behind each optimization."
categories: Software Mathematics CUDA Parallelization
thumbnail: assets/img/CUDAOptimization/animations/gemm-tiles.png
giscus_comments: true
---

<link rel="stylesheet" href="{{ '/assets/css/cuda-article.css' | relative_url }}">
<script src="{{ '/assets/js/cuda-charts.js' | relative_url }}" defer></script>
<div class="cuda-article" markdown="1">

<p class="cuda-intro">I wrote these CUDA kernels to understand how BLAS accelerates linear algebra. Implementing these operations on a GPU involves distributing work across threads, accessing memory, and combining partial results. Writing these routines in CUDA gave me a way to connect the mathematics to the work the hardware actually performs.</p>

BLAS, the Basic Linear Algebra Subprograms, provides the familiar operations underneath scientific computing and many machine-learning workloads. My goal was to understand the implementation choices that make those operations fast: how data is laid out, how work is divided, and where a value can be reused before another memory access is needed.

I worked through three routines: **DOT**, a vector reduction; **GEMV**, a matrix-vector product; and **GEMM**, a matrix-matrix product. The walkthrough follows my optimization process, including experiments that barely helped or made things slower.

<nav class="cuda-nav" aria-label="Article sections">
<a href="#reading-ncu">Reading the profiler</a>
<a href="#the-model">The mathematical model</a>
<a href="#dot">I. DOT</a>
<a href="#gemv">II. GEMV</a>
<a href="#gemm">III. GEMM</a>
<a href="#scaling">Scaling with size</a>
<a href="#what-i-learned">What I learned</a>
</nav>

<p class="cuda-note">The measurements in this article are saved Nsight Compute captures from an NVIDIA GeForce RTX 4060 using FP32. DOT uses 2<sup>24</sup> elements, GEMV uses a 4096 × 4096 matrix, and GEMM uses 2048 × 2048 matrices. These are historical kernel measurements, not repeated-run statistical estimates or end-to-end API timings. Supporting screenshots are expandable, and every screenshot can be enlarged. The animations play while they are on screen; use their controls to pause or scrub.</p>

## Profiler components {#reading-ncu}

[NVIDIA Nsight Compute](https://developer.nvidia.com/tools-overview/nsight-compute/get-started) is the kernel profiler used throughout this article. Its command-line tool, `ncu`, launches the program and collects GPU performance counters for selected kernel launches. `ncu-ui` opens the saved report as the tables and charts shown below. Counters describe what the hardware did, helping connect a code change to a possible bottleneck.

For example, from the BLAS repository, the project's profiling workflow can be written as:

```bash
mkdir -p reports
ncu --kernel-name 'regex:gemm' --launch-skip 1 --launch-count 7 \
    --set full -o reports/gemm_example ./build/bench
ncu-ui reports/gemm_example.ncu-rep
```

The name filter selects matching kernels; the next flags skip one matching launch and collect up to seven. `--set full` requests a broad collection of metrics, and `-o` saves the report. This is an example invocation, not a reconstruction of every historical capture. See NVIDIA's [CLI guide](https://docs.nvidia.com/nsight-compute/NsightComputeCli/) for filtering and collection options.

The profiler reports several core components:

- **Kernel and duration.** The kernel name identifies the implementation being measured. Duration is its execution time, excluding allocation and host-transfer costs.
- **Speed Of Light (SOL).** Compute and memory throughput are expressed relative to hardware ceilings. The breakdown distinguishes activity in caches, shared memory, and DRAM; high utilization in one does not imply high utilization in the others.
- **Memory chart.** The chart shows traffic through L1/TEX, L2, and device memory. Requests count memory operations, transferred bytes measure traffic, and throughput measures the rate of transfer. Cache reuse can reduce DRAM traffic without changing the number of source-level loads.
- **Launch, occupancy, and scheduler statistics.** Blocks and threads describe how work is distributed. Occupancy measures resident warps, while eligible warps are ready to issue an instruction. Register use, shared-memory use, and stalls help explain the difference. NVIDIA's [profiling guide](https://docs.nvidia.com/nsight-compute/ProfilingGuide/) describes these metrics.

**Comparison labels.** “Current” is the selected result and “Baseline 1” is its comparison result. In the final GEMV comparison, Current is cuBLAS and Baseline 1 is the custom kernel. Percentage changes are relative to that selection. See NVIDIA's [baseline documentation](https://docs.nvidia.com/nsight-compute/NsightCompute/#baselines).

Nsight Compute may replay a kernel to collect counters that cannot be gathered together. Profiling therefore takes longer than normal execution; timing the entire `ncu` command is not a kernel benchmark. Cache and clock controls also affect the measurement conditions. These reports help diagnose kernel behavior under comparable measurement conditions. Repeated unprofiled timings provide a separate performance check. See [replay and measurement controls](https://docs.nvidia.com/nsight-compute/ProfilingGuide/).

## The mathematical model {#the-model}

Before optimizing a kernel, redundant work should be identified. Counting the required arithmetic and data movement provides a baseline for evaluating changes. Let $$F$$ be the number of floating-point operations, $$Q$$ the bytes crossing a chosen memory boundary, and $$t$$ the kernel time. A multiply-add counts as two FLOPs. Arithmetic intensity and achieved performance are

$$
\begin{aligned}
I &= \frac{F}{Q} && [\mathrm{FLOP/byte}],\\
P &= \frac{F}{t} && [\mathrm{FLOP/s}].
\end{aligned}
$$

With compute ceiling $$P_{\max}$$ and bandwidth $$B$$, executing the arithmetic takes at least $$F/P_{\max}$$ seconds and moving the data takes at least $$Q/B$$ seconds. Therefore,

$$
\begin{aligned}
t &\geq \max\!\left(\frac{F}{P_{\max}},\frac{Q}{B}\right),\\[4pt]
P &\leq \min\!\left(P_{\max}, B I\right),\\[4pt]
I_* &= \frac{P_{\max}}{B}.
\end{aligned}
$$

This is the roofline model. Below the ridge point $$I_*$$, the bandwidth ceiling is lower; above it, the compute ceiling is lower. Neither is a promise of performance. Contention, dependencies, and synchronization can keep a kernel well below both. [NERSC's roofline guide](https://docs.nersc.gov/tools/performance/roofline/) describes the measurement methodology.

The important qualification is **which bytes we count**. A source-level load may hit in L1 or L2 instead of reaching DRAM. Reducing load instructions can help even when DRAM traffic hardly changes. Conversely, a DRAM roofline cannot be built from a count of source-level loads without accounting for cache reuse.

Let $$s$$ be bytes per element and let $$\delta_\beta=1$$ when $$\beta\ne0$$, otherwise zero. The ideal useful traffic counts each required input once and includes an output read only when the old output matters.

<div class="cuda-table-wrap"><table class="cuda-table"><caption>Table 1. Work and ideal useful traffic. Scalars, reduction overhead, and lower-order arithmetic are omitted.</caption><thead><tr><th scope="col">Operation</th><th scope="col" class="num">Work \(F\)</th><th scope="col" class="num">Bytes \(Q\)</th><th scope="col" class="num">Intensity \(F/Q\)</th></tr></thead><tbody>

<tr><td>DOT</td><td class="num">\(2n\)</td><td class="num">\(2sn\)</td><td class="num">\(\frac{1}{s}\)</td></tr>

<tr><td>GEMV</td><td class="num">\(2mn\)</td><td class="num">\(s[mn+n+(1+\delta_\beta)m]\)</td><td class="num">\(\longrightarrow\frac{2}{s}\)</td></tr>

<tr><td>GEMM</td><td class="num">\(2mnk\)</td><td class="num">\(s[mk+kn+(1+\delta_\beta)mn]\)</td><td class="num">\(\frac{2mnk}{Q}\)</td></tr>

</tbody></table></div>

DOT stays near $$0.25\,\mathrm{FLOP/byte}$$ in FP32. Large GEMV approaches $$0.5\,\mathrm{FLOP/byte}$$. Square GEMM can increase its intensity with matrix size because each input participates in many output values. That reuse is the opportunity; the kernel still has to realize it.

The implementation also has to preserve the linear-algebra contract. Matrices are column-major, so $$A_{ij}=A[i+j\,ld]$$. A leading dimension can exceed the logical row count. Transpose flags change the access pattern. When $$\beta=0$$, an old NaN in the output must not leak into the result. These details stay relevant even as the kernels become more complicated.

## I. DOT {#dot}

The dot product is

$$d=\boldsymbol{x}^{\mathsf T}\boldsymbol{y}=\sum_{i=0}^{n-1}x_i y_i.$$

The products can be computed independently, then reduced to a single sum. The reduction sequence follows the ideas in Mark Harris's [Optimizing Parallel Reduction in CUDA](https://developer.download.nvidia.com/assets/cuda/files/reduction.pdf). The times below are measurements from this implementation, not numbers from that tutorial.

### DOT 0. Atomic baseline

The first implementation lets each thread multiply a pair of elements and atomically add the result to one global scalar. That is easy to write, but every update competes for the same destination. At $$n=2^{24}$$, we request roughly 16.8 million updates to one answer.

Every product reaches the same atomic destination:

```cpp
__global__ void dot_kernel(const Vector x, const Vector y, real_t* result) {
    const real_t* __restrict__ xp = x.data;
    const real_t* __restrict__ yp = y.data;
    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < x.n; i+= (long)gridDim.x * blockDim.x) {
	atomicAdd(result, xp[i * x.inc] * yp[i * y.inc]);
    }
}
```

{% include cuda-diagram.liquid name="dot-atomic-contention" alt="Eight threads multiply their pairs at the same time, then their atomic updates to the single result are applied one after another along a timeline." caption="The multiplications run in parallel, but every atomic update targets the same float, so the updates are applied one at a time. At 2²⁴ elements that is 16,777,216 updates to one address." %}

<div class="cuda-change">Baseline: \(33.60\,\mathrm{ms}\). Useful input bandwidth: approximately \(4.00\,\mathrm{GB/s}\).</div>

{% include cuda-evidence.liquid path="Dot/FirstPass/ncu_summary.png" alt="DOT baseline. Read the kernel duration: 33.60 ms. This is the reference for the entire reduction sequence." caption="DOT baseline. Read the kernel duration: 33.60 ms. This is the reference for the entire reduction sequence." %}

<details class="cuda-support"><summary>Read the baseline memory and utilization evidence</summary>

{% include cuda-evidence.liquid path="Dot/FirstPass/ncu_memory_chart.png" alt="The first DOT reads about 134.71 MB from device memory. Its poor runtime is not explained by an unusually large useful input." caption="The first DOT reads about 134.71 MB from device memory. Its poor runtime is not explained by an unusually large useful input." %}

{% include cuda-evidence.liquid path="Dot/FirstPass/ncu_speed_of_light.png" alt="The baseline reports low compute and memory utilization and a latency issue. Many parallel threads do not guarantee useful parallel progress when their atomic updates contend." caption="The baseline reports low compute and memory utilization and a latency issue. Many parallel threads do not guarantee useful parallel progress when their atomic updates contend." %}

</details>

### DOT 1. Fixed block size

I replaced the occupancy API's 768-thread block with a fixed 256-thread block. Achieved occupancy rose from about 64% to 77%, but the contended update was still there.

The launch uses a fixed block size of 256 threads. The snippet isolates this change from the reduction improvements that follow.

```cpp
#define DOT_BLOCK_SIZE 256

    const int grid = (x.n + DOT_BLOCK_SIZE - 1) / DOT_BLOCK_SIZE;
    real_t* d_result = nullptr;
    CUDA_ERROR_CHECK(cudaMalloc(&d_result, sizeof(real_t)));
    CUDA_ERROR_CHECK(cudaMemset(d_result, 0, sizeof(real_t)));
    dot_kernel<<<grid, DOT_BLOCK_SIZE>>>(dx, dy, d_result);
```

<div class="cuda-change">\(33.60 \rightarrow 33.64\,\mathrm{ms}\): essentially unchanged.</div>

{% include cuda-evidence.liquid path="Dot/ConstantBlockSize/ncu_summary.png" alt="Changing to 256 threads per block leaves the duration near 33.6 ms. This change improves a resource-usage metric without removing the bottleneck." caption="Changing to 256 threads per block leaves the duration near 33.6 ms. This change improves a resource-usage metric without removing the bottleneck." %}

This was a useful failed experiment. Occupancy tells me how many warps are resident, not how much independent work they can complete. More threads waiting for the same destination do not solve the serialization problem.

### DOT 2. Block reduction

Each thread now accumulates a private sum, then the block combines its partial sums in shared memory. Only thread zero performs a global atomic update. With 256 threads per block, the initial configuration reduces the number of atomic updates by a factor of 256.

{% include cuda-diagram.liquid name="reduction-tree" alt="Eight private sums are written to shared memory, combined in place over three barrier-separated stages, and thread 0 adds the block total to the global result with one atomic update." caption="The block reduction, shown with 8 threads instead of 256. Each stage adds pairs in place and ends at a barrier; only thread 0 performs an atomic update, so the kernel issues 65,536 atomics instead of 16,777,216." %}

Each thread accumulates a private sum, then the block reduces those sums in shared memory and issues one atomic update. The full diff below also includes the contiguous-thread indexing explained in the next step.

```cpp
    real_t sum = 0;
    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < x.n; i += (long)gridDim.x * blockDim.x) {
	sum += xp[i * x.inc] * yp[i * y.inc];
    }
    sdata[tid] = sum;
    __syncthreads();
```

```cpp
    if (tid == 0) {
	atomicAdd(result, sdata[0]);
    }
```

<details class="cuda-support" markdown="1"><summary>Read the complete kernel diff</summary>

```diff
@@ -2,6 +2,8 @@

 #include <cmath>

+#define DOT_BLOCK_SIZE 256
+
 static long span_of(int n, int inc) {
     return n > 0 ? 1 + (long)(n - 1) * (inc < 0 ? -inc : inc) : 0;
 }
@@ -158,27 +160,42 @@ void swap(Vector& x, Vector& y) {
 __global__ void dot_kernel(const Vector x, const Vector y, real_t* result) {
     const real_t* __restrict__ xp = x.data;
     const real_t* __restrict__ yp = y.data;
-    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < x.n; i+= (long)gridDim.x * blockDim.x) {
-	atomicAdd(result, xp[i * x.inc] * yp[i * y.inc]);
+    __shared__ real_t sdata[DOT_BLOCK_SIZE];
+    unsigned int tid = threadIdx.x;
+
+    real_t sum = 0;
+    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < x.n; i += (long)gridDim.x * blockDim.x) {
+	sum += xp[i * x.inc] * yp[i * y.inc];
+    }
+    sdata[tid] = sum;
+    __syncthreads();
+
+    for (unsigned int s = 1; s < blockDim.x; s *= 2) {
+	int index = 2 * s * tid;
+	if (index < blockDim.x) {
+	    sdata[index] += sdata[index + s];
+	}
+	__syncthreads();
+    }
+
+    if (tid == 0) {
+	atomicAdd(result, sdata[0]);
     }
 }

 real_t dot(const Vector& x, const Vector& y) {
     if (x.n <= 0 || y.n <= 0) return 0;

-    int min_grid = 0, block = 0;
-    GET_MAX_POTENTIAL_BLOCKS_SIZE(min_grid, block, dot_kernel);
-
     real_t* sx = nullptr;
     real_t* sy = nullptr;
     const Vector dx = stage_vector(x, sx);
     const Vector dy = stage_vector(y, sy);

-    const int grid = (x.n + block - 1) / block;
+    const int grid = (x.n + DOT_BLOCK_SIZE - 1) / DOT_BLOCK_SIZE;
     real_t* d_result = nullptr;
     CUDA_ERROR_CHECK(cudaMalloc(&d_result, sizeof(real_t)));
     CUDA_ERROR_CHECK(cudaMemset(d_result, 0, sizeof(real_t)));
-    dot_kernel<<<grid, block>>>(dx, dy, d_result);
+    dot_kernel<<<grid, DOT_BLOCK_SIZE>>>(dx, dy, d_result);
     CUDA_ERROR_CHECK(cudaGetLastError());
     real_t result = 0;
     CUDA_ERROR_CHECK(cudaMemcpy(&result, d_result, sizeof(real_t), cudaMemcpyDeviceToHost));
```

</details>

<div class="cuda-change">\(33.64 \rightarrow 1.56\,\mathrm{ms}\), approximately \(21.6\times\) faster for this change.</div>

{% include cuda-evidence.liquid path="Dot/ParallelReduction/ncu_summary.png" alt="The block reduction cuts kernel time to 1.56 ms. Most of the improvement comes before tuning the reduction tree itself." caption="The block reduction cuts kernel time to 1.56 ms. Most of the improvement comes before tuning the reduction tree itself." %}

The input bytes have barely changed. The expensive coordination has: instead of one global update per product, there is one update per block. The arithmetic intensity estimate did not identify this contention cost, but it still tells us where the kernel might end up after removing it.

### DOT 3. Contiguous active threads

The first tree uses interleaved participation: threads whose indices are multiples of the current stride remain active. Reindexing the tree keeps the active threads contiguous instead of scattering them across each warp. Late stages still have fewer active lanes; this change reduces unnecessary divergence earlier in the tree.

The code below keeps participating threads contiguous. The earlier interleaved tree illustrates the experiment; the full kernel diff above includes this indexing improvement.

```cpp
    for (unsigned int s = 1; s < blockDim.x; s *= 2) {
	int index = 2 * s * tid;
	if (index < blockDim.x) {
	    sdata[index] += sdata[index + s];
	}
	__syncthreads();
    }
```

<div class="cuda-change">\(1{,}560 \rightarrow 979.78\,\mu\mathrm{s}\), approximately \(1.59\times\) faster.</div>

{% include cuda-diagram.liquid name="dot-divergence" alt="A 256-thread block drawn as 8 warps of 32 lanes for the interleaved and reindexed trees, stepping the stride from 1 to 128. Active lanes are scattered across all warps in the interleaved tree and packed into the lowest warps in the reindexed tree, giving 47 versus 12 warp-steps." caption="Both trees perform the same additions on the same data. Packing the active threads into the lowest warps lets whole warps skip each stage: 12 warp-steps instead of 47." %}

{% include cuda-evidence.liquid path="Dot/ReductionNoDivergence/ncu_summary.png" alt="The reindexed tree reaches 979.78 microseconds. Read the shared-memory warnings as the next problem to investigate, not as evidence that this change failed." caption="The reindexed tree reaches 979.78 microseconds. Read the shared-memory warnings as the next problem to investigate, not as evidence that this change failed." %}

<details class="cuda-support"><summary>Inspect the newly exposed shared-memory bottleneck</summary>

{% include cuda-evidence.liquid path="Dot/ReductionNoDivergence/ncu_memory_chart.png" alt="The memory view shows the shared-load and shared-store traffic of the reduction tree. The input stream still has little data reuse." caption="The memory view shows the shared-load and shared-store traffic of the reduction tree. The input stream still has little data reuse." %}

{% include cuda-evidence.liquid path="Dot/ReductionNoDivergence/ncu_pipe_utilization.png" alt="The load/store unit is the busiest pipeline, near 85% in this capture. Reindexing improved lane participation but left expensive shared-memory access patterns." caption="The load/store unit is the busiest pipeline, near 85% in this capture. Reindexing improved lane participation but left expensive shared-memory access patterns." %}

</details>

### DOT 4. Sequential shared-memory addressing

I reversed the tree traversal. At stride $$s$$, thread $$i<s$$ adds shared entries $$i$$ and $$i+s$$. Adjacent active threads now access adjacent shared words, reducing the bank conflicts found in the previous profile.

{% include cuda-diagram.liquid name="dot-bank-conflicts" alt="Warp 0's 32 lanes mapped onto shared-memory words under 32 bank columns with per-bank hit counts. Reindexed reads at strides 1, 2, 4 and 8 give 2-, 4-, 8- and 8-way conflicts; sequential reads at strides 128, 64 and 16 hit each bank at most once." caption="With reindexed addressing, neighboring lanes read words 2s apart, so several lanes share a bank and their accesses are serialized. Sequential addressing gives each lane its own bank." %}

```cpp
for (unsigned stride = blockDim.x / 2; stride > 0; stride >>= 1) {
    if (tid < stride)
        partial[tid] += partial[tid + stride];
    __syncthreads();
}
```

Every thread reaches the barrier, including threads whose arithmetic is inactive.

The reduction now starts with a large stride and halves it at each stage, keeping shared-memory accesses adjacent.

```diff
@@ -170,10 +170,9 @@ __global__ void dot_kernel(const Vector x, const Vector y, real_t* result) {
     sdata[tid] = sum;
     __syncthreads();

-    for (unsigned int s = 1; s < blockDim.x; s *= 2) {
-	int index = 2 * s * tid;
-	if (index < blockDim.x) {
-	    sdata[index] += sdata[index + s];
+    for (unsigned int s = blockDim.x / 2; s > 0; s >>= 1) {
+	if (tid < s) {
+	    sdata[tid] += sdata[tid + s];
 	}
 	__syncthreads();
     }
```

<div class="cuda-change">\(979.78 \rightarrow 933.98\,\mu\mathrm{s}\), approximately \(1.05\times\) faster.</div>

{% include cuda-evidence.liquid path="Dot/ReductionSequentialAddressing/ncu_summary.png" alt="Sequential addressing removes the earlier shared-access warnings and lowers time to 933.98 microseconds. The improvement is real but much smaller than removing per-element atomics." caption="Sequential addressing removes the earlier shared-access warnings and lowers time to 933.98 microseconds. The improvement is real but much smaller than removing per-element atomics." %}

### DOT 5. More elements per thread

The next change halves the grid. Each thread processes two input positions in its grid-stride loop before joining the reduction tree. A block now amortizes its tree, barriers, and final atomic update over twice as many products.

Only the grid calculation changes. The existing grid-stride loop makes a second pass at this input size without manually unrolling another load.

```diff
@@ -190,7 +190,7 @@ real_t dot(const Vector& x, const Vector& y) {
     const Vector dx = stage_vector(x, sx);
     const Vector dy = stage_vector(y, sy);

-    const int grid = (x.n + DOT_BLOCK_SIZE - 1) / DOT_BLOCK_SIZE;
+    const int grid = (x.n + 2L * DOT_BLOCK_SIZE - 1) / (2L * DOT_BLOCK_SIZE);
     real_t* d_result = nullptr;
     CUDA_ERROR_CHECK(cudaMalloc(&d_result, sizeof(real_t)));
     CUDA_ERROR_CHECK(cudaMemset(d_result, 0, sizeof(real_t)));
```

<div class="cuda-change">\(933.98 \rightarrow 566.24\,\mu\mathrm{s}\), approximately \(1.65\times\) faster.</div>

{% include cuda-evidence.liquid path="Dot/MultipleElementsPerThread/ncu_memory_chart_vs_iter4.png" alt="Compare shared-memory requests: they fall by 50%, while the useful global inputs remain the same. The reduction overhead is paid half as often." caption="Compare shared-memory requests: they fall by 50%, while the useful global inputs remain the same. The reduction overhead is paid half as often." %}

<details class="cuda-support"><summary>See the duration and throughput measurements for two elements per thread</summary>

{% include cuda-evidence.liquid path="Dot/MultipleElementsPerThread/ncu_summary.png" alt="The summary records the 566.24 microsecond duration for the smaller grid." caption="The summary records the 566.24 microsecond duration for the smaller grid." %}

{% include cuda-evidence.liquid path="Dot/MultipleElementsPerThread/ncu_speed_of_light_vs_iter4.png" alt="The comparison with sequential addressing shows duration falling about 39.4% and memory utilization reaching 93.46%. Less coordination lets input bandwidth become the dominant constraint." caption="The comparison with sequential addressing shows duration falling about 39.4% and memory utilization reaching 93.46%. Less coordination lets input bandwidth become the dominant constraint." %}

</details>

### DOT 6. Warp reduction

Finally, each warp combines its partial sums with shuffle instructions. One lane per warp writes a partial result to shared memory; the first warp combines those results after a block barrier. The shared array shrinks from one entry per thread to one entry per warp.

{% include cuda-diagram.liquid name="dot-warp-shuffle" alt="Five shuffle-down steps with offsets 16, 8, 4, 2 and 1 move values between the 32 registers of a warp until lane 0 holds the warp sum. The eight warp sums go to an 8-word shared array, and after a barrier warp 0 shuffles them into one value for a single atomic update." caption="Each warp sums its 32 registers with five shuffles, with no shared memory and no barrier. Only one word per warp reaches shared memory, and warp 0 combines those 8 before a single atomic update." %}

The kernel stores one shared partial per warp and uses shuffle instructions for both reduction stages. The diff below shows the synchronization and final atomic update.

<details class="cuda-support" markdown="1"><summary>Read the complete kernel diff</summary>

```diff
@@ -160,25 +160,32 @@ void swap(Vector& x, Vector& y) {
 __global__ void dot_kernel(const Vector x, const Vector y, real_t* result) {
     const real_t* __restrict__ xp = x.data;
     const real_t* __restrict__ yp = y.data;
-    __shared__ real_t sdata[DOT_BLOCK_SIZE];
-    unsigned int tid = threadIdx.x;
+    __shared__ real_t sdata[DOT_BLOCK_SIZE / 32];
+    unsigned int warp = threadIdx.x / 32;
+    unsigned int lane = threadIdx.x % 32;

     real_t sum = 0;
     for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < x.n; i += (long)gridDim.x * blockDim.x) {
 	sum += xp[i * x.inc] * yp[i * y.inc];
     }
-    sdata[tid] = sum;
+    sum += __shfl_down_sync(0xffffffff, sum, 16);
+    sum += __shfl_down_sync(0xffffffff, sum, 8);
+    sum += __shfl_down_sync(0xffffffff, sum, 4);
+    sum += __shfl_down_sync(0xffffffff, sum, 2);
+    sum += __shfl_down_sync(0xffffffff, sum, 1);
+    if (lane == 0)
+	sdata[warp] = sum;
     __syncthreads();

-    for (unsigned int s = blockDim.x / 2; s > 0; s >>= 1) {
-	if (tid < s) {
-	    sdata[tid] += sdata[tid + s];
-	}
-	__syncthreads();
-    }
-
-    if (tid == 0) {
-	atomicAdd(result, sdata[0]);
+    if (warp == 0) {
+	sum = lane < DOT_BLOCK_SIZE / 32 ? sdata[lane] : 0;
+	sum += __shfl_down_sync(0xffffffff, sum, 16);
+	sum += __shfl_down_sync(0xffffffff, sum, 8);
+	sum += __shfl_down_sync(0xffffffff, sum, 4);
+	sum += __shfl_down_sync(0xffffffff, sum, 2);
+	sum += __shfl_down_sync(0xffffffff, sum, 1);
+	if (lane == 0)
+	    atomicAdd(result, sum);
     }
 }
```

</details>

<div class="cuda-change">\(566.24 \rightarrow 543.55\,\mu\mathrm{s}\), approximately \(1.04\times\) faster.</div>

{% include cuda-evidence.liquid path="Dot/WarpShuffle/ncu_summary.png" alt="The final DOT capture reaches 543.55 microseconds and 97.38% memory utilization. Compute utilization decreases because less reduction machinery is executed." caption="The final DOT capture reaches 543.55 microseconds and 97.38% memory utilization. Compute utilization decreases because less reduction machinery is executed." %}

Using useful input bytes, the effective bandwidth is

$$B_{\mathrm{eff}}=\frac{2\cdot 4\cdot 2^{24}}{543.55\cdot10^{-6}}\approx246.9\,\mathrm{GB/s}.$$

The small final gain makes sense: the preceding version was already moving data efficiently. Across the entire sequence, DOT improved by about $$61.8\times$$. Floating-point addition order changed along the way, so correctness checks use numerical tolerances rather than demand identical bits across different reduction trees.

{% include cuda-chart.liquid name="dot-steps" title="DOT kernel time at each step, 2²⁴ elements" alt="Horizontal bar chart of DOT kernel time on a log scale for the seven implementations listed in Table 2." caption="The same measurements as Table 2 on a logarithmic axis. Removing per-element atomics is the decisive step; the later changes refine a kernel that is already close to the bandwidth limit." %}

<div class="cuda-table-wrap"><table class="cuda-table"><caption>Table 2. DOT, change by change. Times are kernel durations from the saved captures.</caption><thead><tr><th scope="col">Implementation</th><th scope="col" class="num">Time <span class="unit">\(\mu\mathrm{s}\)</span></th><th scope="col" class="num">Previous / current</th></tr></thead><tbody>

<tr><td>Per-element atomics</td><td class="num">\(33{,}600\)</td><td class="num">\(\cdot\)</td></tr>

<tr><td>256-thread blocks</td><td class="num">\(33{,}640\)</td><td class="num">\(1.00\times\)</td></tr>

<tr><td>Block reduction</td><td class="num">\(1{,}560\)</td><td class="num">\(21.56\times\)</td></tr>

<tr><td>Contiguous active threads</td><td class="num">\(979.78\)</td><td class="num">\(1.59\times\)</td></tr>

<tr><td>Sequential addressing</td><td class="num">\(933.98\)</td><td class="num">\(1.05\times\)</td></tr>

<tr><td>Two elements per thread</td><td class="num">\(566.24\)</td><td class="num">\(1.65\times\)</td></tr>

<tr class="best"><td>Warp shuffles</td><td class="num">\(543.55\)</td><td class="num">\(1.04\times\)</td></tr>

</tbody></table></div>

### Complete DOT implementation

Both the warp-shuffle kernel and the host entry point are shown below. The wrapper stages the inputs and copies the scalar result back; those transfers are outside the kernel timings above. The shared types, constants, and memory helpers are listed [at the end](#shared-code).

```cpp
__global__ void dot_kernel(const Vector x, const Vector y, real_t* result) {
    const real_t* __restrict__ xp = x.data;
    const real_t* __restrict__ yp = y.data;
    __shared__ real_t sdata[BLOCK_SIZE / 32];
    unsigned int warp = threadIdx.x / 32;
    unsigned int lane = threadIdx.x % 32;

    real_t sum = 0;
    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < x.n; i += (long)gridDim.x * blockDim.x) {
	sum += xp[i * x.inc] * yp[i * y.inc];
    }
    sum += __shfl_down_sync(0xffffffff, sum, 16);
    sum += __shfl_down_sync(0xffffffff, sum, 8);
    sum += __shfl_down_sync(0xffffffff, sum, 4);
    sum += __shfl_down_sync(0xffffffff, sum, 2);
    sum += __shfl_down_sync(0xffffffff, sum, 1);
    if (lane == 0)
	sdata[warp] = sum;
    __syncthreads();

    if (warp == 0) {
	sum = lane < BLOCK_SIZE / 32 ? sdata[lane] : 0;
	sum += __shfl_down_sync(0xffffffff, sum, 16);
	sum += __shfl_down_sync(0xffffffff, sum, 8);
	sum += __shfl_down_sync(0xffffffff, sum, 4);
	sum += __shfl_down_sync(0xffffffff, sum, 2);
	sum += __shfl_down_sync(0xffffffff, sum, 1);
	if (lane == 0)
	    atomicAdd(result, sum);
    }
}

real_t dot(const Vector& x, const Vector& y) {
    if (x.n <= 0 || y.n <= 0) return 0;

    real_t* sx = nullptr;
    real_t* sy = nullptr;
    const Vector dx = stage_vector(x, sx);
    const Vector dy = stage_vector(y, sy);

    const int grid = (x.n + 2L * BLOCK_SIZE - 1) / (2L * BLOCK_SIZE);
    real_t* d_result = nullptr;
    CUDA_ERROR_CHECK(cudaMalloc(&d_result, sizeof(real_t)));
    CUDA_ERROR_CHECK(cudaMemset(d_result, 0, sizeof(real_t)));
    dot_kernel<<<grid, BLOCK_SIZE>>>(dx, dy, d_result);
    CUDA_ERROR_CHECK(cudaGetLastError());
    real_t result = 0;
    CUDA_ERROR_CHECK(cudaMemcpy(&result, d_result, sizeof(real_t), cudaMemcpyDeviceToHost));
    CUDA_ERROR_CHECK(cudaFree(d_result));
    release(sx);
    release(sy);
    return result;
}
```

## II. GEMV {#gemv}

GEMV computes

$$
\boldsymbol{y}\leftarrow\alpha A\boldsymbol{x}+\beta\boldsymbol{y},\qquad
y_i\leftarrow\alpha\sum_{j=0}^{n-1}A_{ij}x_j+\beta y_i.
$$

Each output is a dot product, but the matrix dominates input traffic. Reusing $$\boldsymbol{x}$$ helps only so much: each matrix element still contributes to just one multiply-add. For large dimensions,

$$I_{\mathrm{GEMV}}=\frac{2mn}{s[mn+n+(1+\delta_\beta)m]}\longrightarrow\frac{2}{s}.$$

### GEMV 0. Baseline launch

The first kernel launched only eight blocks of 256 threads for 4096 output rows. On a GPU with 24 streaming multiprocessors, eight blocks cannot occupy every multiprocessor at once. Threads loop over more rows, but that does not create more independent blocks.

A fixed block size of 256 produces just eight blocks for 4096 rows, replacing the occupancy-based launch.

```diff
@@ -309,11 +307,11 @@ void gemv(const char* trans, real_t alpha, const Matrix& A, const Vector& x, rea
     const Vector dx = stage_vector(x, sx);
     const Vector dy = stage_vector(y, sy);

-    const int grid = (m + block - 1) / block;
+    const int grid = (m + 2L * BLOCK_SIZE - 1) / (2L * BLOCK_SIZE);
     if (notrans) {
-	gemv_kernel<<<grid, block>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
+	gemv_kernel<<<grid, BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
     } else {
-	gemv_kernel<<<grid, block>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
+	gemv_kernel<<<grid, BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
     }
     CUDA_ERROR_CHECK(cudaGetLastError());
     unstage_vector(y, sy);
```

<div class="cuda-change">Baseline: \(770.75\,\mu\mathrm{s}\), approximately \(87.1\,\mathrm{GB/s}\) of useful traffic.</div>

{% include cuda-diagram.liquid name="gemv-launch" alt="Eight blocks land on 8 of the GPU's 24 streaming multiprocessors while 16 stay idle; one thread then walks rows 0 and 2048, 8,192 multiply-adds in sequence." caption="The baseline launch creates eight blocks for a GPU with 24 SMs, so at most eight SMs have work. Each thread then walks two full rows: 8,192 multiply-adds in sequence." %}

{% include cuda-evidence.liquid path="Gemv/FirstPass/ncu_speed_of_light.png" alt="The GEMV baseline shows low memory utilization, 34.64%. Its launch has too little independent block-level work to use the whole GPU." caption="The GEMV baseline shows low memory utilization, 34.64%. Its launch has too little independent block-level work to use the whole GPU." %}

### GEMV reference. cuBLAS

The reference kernel took $$279.62\,\mu\mathrm{s}$$ in the same profiling report, roughly $$2.76\times$$ faster. It moved a similar amount of matrix data but approached the DRAM throughput ceiling. That made a bandwidth-oriented implementation a plausible target.

The benchmark calls cuBLAS on device buffers with the same matrix dimensions and scalar parameters.

```cpp
    const real_t alpha = 1, beta = 0;
    for (int i = 0; i < ITERS; ++i)
        CUBLAS_GEMV(handle, CUBLAS_OP_N, GEMV_N, GEMV_N, &alpha, dA, GEMV_N, dv, 1, &beta, dw, 1);
    CUDA_ERROR_CHECK(cudaDeviceSynchronize());
```

{% include cuda-evidence.liquid path="Gemv/CublasReference/ncu_speed_of_light_vs_baseline.png" alt="The cuBLAS reference reaches about 95.45% memory utilization versus 34.64% for the custom baseline. Compare elapsed time as well as the percentage bars." caption="The cuBLAS reference reaches about 95.45% memory utilization versus 34.64% for the custom baseline. Compare elapsed time as well as the percentage bars." %}

<details class="cuda-support"><summary>Compare how much matrix data the two GEMV kernels move</summary>

{% include cuda-evidence.liquid path="Gemv/CublasReference/ncu_memory_chart_vs_baseline.png" alt="The two kernels have similar device-memory traffic. cuBLAS is primarily moving that traffic faster, rather than avoiding the matrix read." caption="The two kernels have similar device-memory traffic. cuBLAS is primarily moving that traffic faster, rather than avoiding the matrix read." %}

</details>

### GEMV 1. Shared-memory vector cache

I cooperatively loaded chunks of $$\boldsymbol{x}$$ into shared memory so the threads could reuse them. This added barriers around each chunk, while keeping the same eight-block launch.

The code caches the input vector in shared memory. The full implementation uses 128 blocks of 512 threads; the screenshot measures the earlier eight-block configuration.

```cpp
__device__ real_t row_dot(const Matrix& A, const Vector& x, long i, long m, long len, Access at)
{
  __shared__ real_t xs[GEMV_BLOCK_SIZE];
  real_t sum = 0;
  for (long tile = 0; tile < len; tile += GEMV_BLOCK_SIZE) {
      long j = tile + threadIdx.x;
      if (j < len)
	  xs[threadIdx.x] = x.data[j * x.inc];
      __syncthreads();
      const long lim = (len - tile < GEMV_BLOCK_SIZE) ? len - tile : GEMV_BLOCK_SIZE;
      if (i < m) {
	for (long k = 0; k < lim; k++) {
	    sum += at(A, i, tile+k) * xs[k];
	}
      }
      __syncthreads();
  }
  return sum;
}
```

This historical excerpt is shown unchanged. Its caller guards `row_dot` with `i < m` even though the helper contains block barriers. The displayed square benchmark avoids a partial row block; this is not a general tail-safe implementation. The later row/column split moves the barriers outside that guard.

<div class="cuda-change">\(770.75 \rightarrow 794.30\,\mu\mathrm{s}\): about \(3.1\%\) slower.</div>

{% include cuda-evidence.liquid path="Gemv/SharedMemXTile/ncu_details.png" alt="The shared-vector version takes 794.30 microseconds and still triggers the small-grid finding. Staging the vector does not fix the lack of independent blocks." caption="The shared-vector version takes 794.30 microseconds and still triggers the small-grid finding. Staging the vector does not fix the lack of independent blocks." %}

Threads already read the same vector entries in a cache-friendly pattern. The extra staging did not save enough expensive traffic to pay for its synchronization. Meanwhile, the larger issue identified by the first profile remained unchanged.

### GEMV 2. Launch geometry

I kept the shared-vector implementation and changed the number of blocks and threads. This isolates an important distinction: larger blocks are not the same as a larger supply of independent blocks.

The listing uses 128 blocks of 512 threads. The sweep below also tests other launch configurations, including the faster 512 × 256 trial.

```diff
@@ -307,11 +323,11 @@ void gemv(const char* trans, real_t alpha, const Matrix& A, const Vector& x, rea
     const Vector dx = stage_vector(x, sx);
     const Vector dy = stage_vector(y, sy);

-    const int grid = (m + 2L * BLOCK_SIZE - 1) / (2L * BLOCK_SIZE);
+    const int grid = 128;
     if (notrans) {
-	gemv_kernel<<<grid, BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
+	gemv_kernel<<<grid, GEMV_BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
     } else {
-	gemv_kernel<<<grid, BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
+	gemv_kernel<<<grid, GEMV_BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
     }
     CUDA_ERROR_CHECK(cudaGetLastError());
     unstage_vector(y, sy);
```

{% include cuda-chart.liquid name="gemv-steps" title="GEMV kernel time at each step, 4096 × 4096" alt="Horizontal bar chart of GEMV kernel time for the baseline, the shared-memory vector, three launch configurations, and the row and column split, with a cuBLAS reference line at 280 microseconds." caption="Every GEMV measurement from this section, including the launch sweep in Table 3. Only the row and column split reaches the cuBLAS reference line." %}

<div class="cuda-table-wrap"><table class="cuda-table"><caption>Table 3. GEMV launch sweep. The 2 × 1024 result is recorded in the report notes; no screenshot was saved for it.</caption><thead><tr><th scope="col">Blocks \(\times\) threads</th><th scope="col" class="num">Time <span class="unit">\(\mu\mathrm{s}\)</span></th><th scope="col" class="num">Memory SOL</th><th scope="col" class="num">Useful BW <span class="unit">\(\mathrm{GB/s}\)</span></th></tr></thead><tbody>

<tr><td>\(2\times1024\)</td><td class="num">\(816.77\)</td><td class="num">\(32.7\%\)</td><td class="num">\(82.2\)</td></tr>

<tr class="best"><td>\(512\times256\)</td><td class="num">\(428.03\)</td><td class="num">\(62.4\%\)</td><td class="num">\(156.8\)</td></tr>

<tr><td>\(128\times512\)</td><td class="num">\(497.82\)</td><td class="num">\(53.6\%\)</td><td class="num">\(134.8\)</td></tr>

</tbody></table></div>

{% include cuda-evidence.liquid path="Gemv/SizeSweep/ncu_details_512x256.png" alt="512 blocks of 256 threads give the best result in this launch sweep: 428.03 microseconds. More blocks expose more work to the GPU." caption="512 blocks of 256 threads give the best result in this launch sweep: 428.03 microseconds. More blocks expose more work to the GPU." %}

<details class="cuda-support"><summary>Compare the larger-block launch and its cuBLAS reference</summary>

{% include cuda-evidence.liquid path="Gemv/SizeSweep/ncu_details_128x512.png" alt="128 blocks of 512 threads take 497.82 microseconds. Increasing threads per block loses ground relative to the 512 × 256 configuration." caption="128 blocks of 512 threads take 497.82 microseconds. Increasing threads per block loses ground relative to the 512 × 256 configuration." %}

{% include cuda-evidence.liquid path="Gemv/CublasReference/ncu_details_20260818.png" alt="The cuBLAS reference in this later session takes 278.75 microseconds. Better launch geometry narrows the gap but does not yet close it." caption="The cuBLAS reference in this later session takes 278.75 microseconds. Better launch geometry narrows the gap but does not yet close it." %}

</details>

The best sweep result is about $$1.86\times$$ faster than the shared-vector version's $$794.30\,\mu\mathrm{s}$$. It is also faster than the $$128\times512$$ configuration retained at that intermediate point in the project. Both measurements show how much launch geometry affects performance.

### GEMV 3. Row and column splitting

The final change uses a two-dimensional block. The x coordinate selects one of 32 adjacent rows, while the y coordinate splits the columns into 16 chunks. Each thread computes a partial sum for its row and column chunk; those partials are combined before writing the output.

This is not one warp reading across a row. At a fixed column, adjacent lanes read adjacent rows, matching column-major storage. Splitting the reduction across column chunks also shortens the serial dependency chain within each thread.

{% include cuda-diagram.liquid name="gemv-mapping" alt="A 32-row band of A split into 16 column chunks, one warp per chunk. Each warp reads 32 adjacent rows of one column as a single 128-byte segment, writes partial sums to shared memory, and warp 0 combines the 16 partials per row into y." caption="Each warp owns one column chunk and reads 32 adjacent rows of one column at a time, a single contiguous 128-byte segment in column-major storage. The 16 partial sums per row meet in shared memory, and warp 0 writes y." %}

Each block covers 32 rows and 16 column splits. Every split writes a partial sum; after synchronization, split zero combines the partials for each row.

```cpp
    __shared__ real_t partial[GEMV_SPLITS][GEMV_ROWS];
    real_t* __restrict__ yp = y.data;
    const long chunk = (n + GEMV_SPLITS - 1) / GEMV_SPLITS;
    const long c0 = threadIdx.y * chunk;
    const long c1 = (c0 + chunk < n) ? c0 + chunk : n;
    for (long base = blockIdx.x * (long)GEMV_ROWS; base < m; base += (long)gridDim.x * GEMV_ROWS) {
	const long i = base + threadIdx.x;
	partial[threadIdx.y][threadIdx.x] = (i < m) ? row_dot(A, x, i, c0, c1, at) : real_t(0);
	__syncthreads();
	if (threadIdx.y == 0 && i < m) {
	    real_t sum = 0;
	    for (int t = 0; t < GEMV_SPLITS; t++)
		sum += partial[t][threadIdx.x];
	    yp[i * y.inc] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * yp[i * y.inc]);
	}
	__syncthreads();
    }
}
```

<details class="cuda-support" markdown="1"><summary>Read the complete kernel diff</summary>

```diff
@@ -3,7 +3,9 @@
 #include <cmath>

 #define BLOCK_SIZE 256
-#define GEMV_BLOCK_SIZE 512
+#define GEMV_BLOCK_SIZE BLOCK_SIZE
+#define GEMV_ROWS 32
+#define GEMV_SPLITS 16

 static long span_of(int n, int inc) {
     return n > 0 ? 1 + (long)(n - 1) * (inc < 0 ? -inc : inc) : 0;
@@ -275,35 +277,32 @@ real_t asum(const Vector& x) {


 template <typename Access>
-__device__ real_t row_dot(const Matrix& A, const Vector& x, long i, long m, long len, Access at)
+__device__ real_t row_dot(const Matrix& A, const Vector& x, long i, long c0, long c1, Access at)
 {
-  __shared__ real_t xs[GEMV_BLOCK_SIZE];
   real_t sum = 0;
-  for (long tile = 0; tile < len; tile += GEMV_BLOCK_SIZE) {
-      long j = tile + threadIdx.x;
-      if (j < len)
-	  xs[threadIdx.x] = x.data[j * x.inc];
-      __syncthreads();
-      const long lim = (len - tile < GEMV_BLOCK_SIZE) ? len - tile : GEMV_BLOCK_SIZE;
-      if (i < m) {
-	for (long k = 0; k < lim; k++) {
-	    sum += at(A, i, tile+k) * xs[k];
-	}
-      }
-      __syncthreads();
-  }
+  for (long j = c0; j < c1; j++)
+      sum += at(A, i, j) * x.data[j * x.inc];
   return sum;
 }

 template <typename Access>
 __global__ void gemv_kernel(real_t alpha, const Matrix A, const Vector x, real_t beta, Vector y, long m, long n, Access at) {
+    __shared__ real_t partial[GEMV_SPLITS][GEMV_ROWS];
     real_t* __restrict__ yp = y.data;
-    for (long base = blockIdx.x * (long)blockDim.x; base < m; base += (long)gridDim.x * blockDim.x) {
+    const long chunk = (n + GEMV_SPLITS - 1) / GEMV_SPLITS;
+    const long c0 = threadIdx.y * chunk;
+    const long c1 = (c0 + chunk < n) ? c0 + chunk : n;
+    for (long base = blockIdx.x * (long)GEMV_ROWS; base < m; base += (long)gridDim.x * GEMV_ROWS) {
 	const long i = base + threadIdx.x;
-	if (i < m) {
-	    real_t sum = row_dot(A, x, i, m, n, at);
+	partial[threadIdx.y][threadIdx.x] = (i < m) ? row_dot(A, x, i, c0, c1, at) : real_t(0);
+	__syncthreads();
+	if (threadIdx.y == 0 && i < m) {
+	    real_t sum = 0;
+	    for (int t = 0; t < GEMV_SPLITS; t++)
+		sum += partial[t][threadIdx.x];
 	    yp[i * y.inc] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * yp[i * y.inc]);
 	}
+	__syncthreads();
     }
 }

@@ -323,11 +322,12 @@ void gemv(const char* trans, real_t alpha, const Matrix& A, const Vector& x, rea
     const Vector dx = stage_vector(x, sx);
     const Vector dy = stage_vector(y, sy);

-    const int grid = 128;
+    const dim3 block(GEMV_ROWS, GEMV_SPLITS);
+    const int grid = (m + GEMV_ROWS - 1) / GEMV_ROWS;
     if (notrans) {
-	gemv_kernel<<<grid, GEMV_BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
+	gemv_kernel<<<grid, block>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
     } else {
-	gemv_kernel<<<grid, GEMV_BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
+	gemv_kernel<<<grid, block>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
     }
     CUDA_ERROR_CHECK(cudaGetLastError());
     unstage_vector(y, sy);
@@ -339,7 +339,7 @@ template <typename Access>
 __global__ void symv_kernel(real_t alpha, const Matrix A, const Vector x, real_t beta, const Vector y, Access at) {
     real_t* __restrict__ yp = y.data;
     for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < A.rows; i+= (long)gridDim.x * blockDim.x) {
-	real_t sum = row_dot(A, x, i, A.rows, A.cols, at);
+	real_t sum = row_dot(A, x, i, 0, A.cols, at);
 	yp[i * y.inc] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * yp[i * y.inc]);
     }
 }
@@ -358,7 +358,7 @@ void symv(const char* uplo, real_t alpha, const Matrix& A, const Vector& x, real
     const Vector dx = stage_vector(x, sx);
     const Vector dy = stage_vector(y, sy);

-    const int grid = 128;
+    const int grid = 512;
     if (upper) {
 	symv_kernel<<<grid, GEMV_BLOCK_SIZE>>>(alpha, dA, dx, beta, dy, UpperAt());
     } else {
```

</details>

<div class="cuda-change">\(428.03 \rightarrow 277.50\,\mu\mathrm{s}\), about \(1.54\times\) faster than the best launch-sweep result. The same-session cuBLAS result is \(280.0\,\mu\mathrm{s}\).</div>

{% include cuda-evidence.liquid path="Gemv/WarpRowColumnSplit/ncu_speed_of_light_vs_cublas.png" alt="Read the comparison labels carefully: Current is cuBLAS; Baseline 1 is the custom kernel. The measured times are approximately 280.0 and 277.5 microseconds, respectively." caption="Read the comparison labels carefully: Current is cuBLAS; Baseline 1 is the custom kernel. The measured times are approximately 280.0 and 277.5 microseconds, respectively." %}

<details class="cuda-support"><summary>Verify that the final GEMV comparison moves similar data</summary>

{% include cuda-evidence.liquid path="Gemv/WarpRowColumnSplit/ncu_memory_chart_vs_cublas.png" alt="Current is cuBLAS and Baseline 1 is the custom kernel. Both move roughly 67 MB of matrix data and achieve similar memory throughput." caption="Current is cuBLAS and Baseline 1 is the custom kernel. Both move roughly 67 MB of matrix data and achieve similar memory throughput." %}

</details>

This capture shows comparable kernel performance, not a statistically established win over cuBLAS. Relative to the original custom kernel, the recorded improvement is about $$2.78\times$$. The successful change makes the matrix stream easier to serve and exposes more independent reduction work; it does not change GEMV's limited arithmetic intensity.

### Complete GEMV implementation

This includes the complete partial-row helper, the kernel that combines column chunks, and the host entry point with transpose dispatch. The shared types, constants, and memory helpers are listed [at the end](#shared-code).

```cpp
template <typename Access>
__device__ real_t row_dot(const Matrix& A, const Vector& x, long i, long c0, long c1, Access at)
{
  real_t sum = 0;
  for (long j = c0; j < c1; j++)
      sum += at(A, i, j) * x.data[j * x.inc];
  return sum;
}

template <typename Access>
__global__ void gemv_kernel(real_t alpha, const Matrix A, const Vector x, real_t beta, Vector y, long m, long n, Access at) {
    __shared__ real_t partial[GEMV_SPLITS][GEMV_ROWS];
    real_t* __restrict__ yp = y.data;
    const long chunk = (n + GEMV_SPLITS - 1) / GEMV_SPLITS;
    const long c0 = threadIdx.y * chunk;
    const long c1 = (c0 + chunk < n) ? c0 + chunk : n;
    for (long base = blockIdx.x * (long)GEMV_ROWS; base < m; base += (long)gridDim.x * GEMV_ROWS) {
	const long i = base + threadIdx.x;
	partial[threadIdx.y][threadIdx.x] = (i < m) ? row_dot(A, x, i, c0, c1, at) : real_t(0);
	__syncthreads();
	if (threadIdx.y == 0 && i < m) {
	    real_t sum = 0;
	    for (int t = 0; t < GEMV_SPLITS; t++)
		sum += partial[t][threadIdx.x];
	    yp[i * y.inc] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * yp[i * y.inc]);
	}
	__syncthreads();
    }
}


void gemv(const char* trans, real_t alpha, const Matrix& A, const Vector& x, real_t beta, Vector& y) {
    if (A.rows <= 0 || A.cols <= 0 || (alpha == real_t(0) && beta == real_t(1))) return;

    const bool notrans = (trans[0] == 'N' || trans[0] == 'n');
    const long m = notrans ? A.rows : A.cols;
    const long n = notrans ? A.cols : A.rows;


    real_t* sa = nullptr;
    real_t* sx = nullptr;
    real_t* sy = nullptr;
    const Matrix dA = stage_matrix(A, sa);
    const Vector dx = stage_vector(x, sx);
    const Vector dy = stage_vector(y, sy);

    const dim3 block(GEMV_ROWS, GEMV_SPLITS);
    const int grid = (m + GEMV_ROWS - 1) / GEMV_ROWS;
    if (notrans) {
	gemv_kernel<<<grid, block>>>(alpha, dA, dx, beta, dy, m, n, NoTransAt());
    } else {
	gemv_kernel<<<grid, block>>>(alpha, dA, dx, beta, dy, m, n, TransAt());
    }
    CUDA_ERROR_CHECK(cudaGetLastError());
    unstage_vector(y, sy);
    release(sx);
    release(sa);
}
```

## III. GEMM {#gemm}

GEMM computes

$$
C\leftarrow\alpha AB+\beta C,\qquad
C_{ij}\leftarrow\alpha\sum_{k=0}^{K-1}A_{ik}B_{kj}+\beta C_{ij}.
$$

Unlike GEMV, each value of $$A$$ can contribute to many columns of $$C$$, and each value of $$B$$ to many rows. For square matrices of order $$N$$, the ideal useful traffic model gives

$$
I_{\mathrm{ideal}}=\frac{2N^3}{s(3+\delta_\beta)N^2}
=\frac{2N}{s(3+\delta_\beta)}.
$$

At $$N=2048$$ and $$s=4$$, that is approximately $$341\,\mathrm{FLOP/byte}$$ when $$\beta=0$$. Achieving this input reuse is the implementation problem.

### GEMM 0. Baseline

The first kernel assigns one $$C_{ij}$$ to each thread and loops over the reduction dimension. For each multiply-add, it issues a load from $$A$$ and a load from $$B$$. Ignoring output traffic, the source-level input-load intensity is only

$$I_{\mathrm{naive,loads}}\approx\frac{2MNK}{2sMNK}=\frac1s.$$

This is a load-request model, not a measured DRAM intensity: caches can reuse some of those values. However, the instructions requesting them still have to execute.

The baseline loads both inputs directly from global memory:

```cpp
template <typename AccessA, typename AccessB>
__global__ void gemm_kernel(real_t alpha, const Matrix A, const Matrix B, real_t beta, Matrix C, long m, long n, long k, AccessA at_a, AccessB at_b) {
    real_t* __restrict__ cp = C.data;
    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < m; i += (long)gridDim.x * blockDim.x) {
	for (long j = blockIdx.y * (long)blockDim.y + threadIdx.y; j < n; j += (long)gridDim.y * blockDim.y) {
	    real_t sum = 0;
	    for (long l = 0; l < k; l++) {
		sum += at_a(A, i, l) * at_b(B, l, j);
	    }
	    cp[i + j * C.ld] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * cp[i + j * C.ld]);
	}
    }
}
```

<div class="cuda-change">Baseline: \(27.94\,\mathrm{ms}\), about \(0.615\,\mathrm{TFLOP/s}\). The recorded cuBLAS reference is approximately \(2.89\,\mathrm{ms}\).</div>

{% include cuda-evidence.liquid path="Gemm/FirstPass/ncu_summary.png" alt="The first GEMM takes 27.94 ms despite reporting very high aggregate utilization. Busy hardware can still be spending most of its effort on an inefficient instruction stream." caption="The first GEMM takes 27.94 ms despite reporting very high aggregate utilization. Busy hardware can still be spending most of its effort on an inefficient instruction stream." %}

### GEMM 1. Shared-memory tiling

Each block now stages tiles of $$A$$ and $$B$$ in shared memory. Threads cooperate on the loads, synchronize, and reuse the staged values for their output elements. The first tiled version uses a $$16\times16$$ output tile with one output per thread.

{% include cuda-diagram.liquid name="gemm-tiles" alt="A 16 by 16 tile of A and of B is staged in shared memory at each reduction stage. One staged A value feeds a whole row of 16 threads in the C tile, and the tiles slide along K while each thread's sum stays in a register." caption="Each block stages a 16 × 16 tile of A and of B in shared memory, synchronizes, and runs 16 multiply-add steps from it, so every staged value feeds 16 threads. Load requests fall 16 times, while time improves only 1.31 times because caches already reused data and shared loads and barriers remain." %}

For a $$B_M\times B_N$$ output tile and reduction depth $$B_K$$,

$$
\begin{aligned}
F_{\mathrm{stage}} &= 2B_MB_NB_K,\\
Q_{\mathrm{stage}} &= sB_K(B_M+B_N),\\
I_{\mathrm{tile,loads}} &= \frac{2B_MB_N}{s(B_M+B_N)}.
\end{aligned}
$$

For a square tile of width $$T$$, this becomes $$T/s$$. With $$T=16$$ and FP32, the stage's input-load intensity rises from roughly $$0.25$$ to $$4\,\mathrm{FLOP/byte}$$. Output traffic and edge waste are omitted in this stage-level estimate.

Two 16 × 16 shared tiles hold the inputs. Each stage loads guarded values, synchronizes, reuses the tiles, and synchronizes again before overwriting them.

```diff
@@ -373,14 +374,24 @@ void symv(const char* uplo, real_t alpha, const Matrix& A, const Vector& x, real

 template <typename AccessA, typename AccessB>
 __global__ void gemm_kernel(real_t alpha, const Matrix A, const Matrix B, real_t beta, Matrix C, long m, long n, long k, AccessA at_a, AccessB at_b) {
+    __shared__ real_t as[GEMM_TILE][GEMM_TILE];
+    __shared__ real_t bs[GEMM_TILE][GEMM_TILE];
     real_t* __restrict__ cp = C.data;
-    for (long i = blockIdx.x * (long)blockDim.x + threadIdx.x; i < m; i += (long)gridDim.x * blockDim.x) {
-	for (long j = blockIdx.y * (long)blockDim.y + threadIdx.y; j < n; j += (long)gridDim.y * blockDim.y) {
+    for (long ib = blockIdx.x * (long)GEMM_TILE; ib < m; ib += (long)gridDim.x * GEMM_TILE) {
+	for (long jb = blockIdx.y * (long)GEMM_TILE; jb < n; jb += (long)gridDim.y * GEMM_TILE) {
+	    const long i = ib + threadIdx.x;
+	    const long j = jb + threadIdx.y;
 	    real_t sum = 0;
-	    for (long l = 0; l < k; l++) {
-		sum += at_a(A, i, l) * at_b(B, l, j);
+	    for (long t = 0; t < k; t += GEMM_TILE) {
+		as[threadIdx.y][threadIdx.x] = (i < m && t + threadIdx.y < k) ? at_a(A, i, t + threadIdx.y) : real_t(0);
+		bs[threadIdx.y][threadIdx.x] = (t + threadIdx.x < k && j < n) ? at_b(B, t + threadIdx.x, j) : real_t(0);
+		__syncthreads();
+		for (int l = 0; l < GEMM_TILE; l++)
+		    sum += as[l][threadIdx.x] * bs[threadIdx.y][l];
+		__syncthreads();
 	    }
-	    cp[i + j * C.ld] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * cp[i + j * C.ld]);
+	    if (i < m && j < n)
+		cp[i + j * C.ld] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * cp[i + j * C.ld]);
 	}
     }
 }
```

<div class="cuda-change">\(27.94 \rightarrow 21.33\,\mathrm{ms}\), approximately \(1.31\times\) faster.</div>

{% include cuda-evidence.liquid path="Gemm/SharedMemTiling/ncu_memory_chart_vs_baseline.png" alt="Global-load requests fall by about 93.75%, matching the intended factor-of-16 reuse. Read that reduction separately from the actual device-memory traffic." caption="Global-load requests fall by about 93.75%, matching the intended factor-of-16 reuse. Read that reduction separately from the actual device-memory traffic." %}

<details class="cuda-support"><summary>Why did 16-fold reuse produce only a modest time improvement?</summary>

{% include cuda-evidence.liquid path="Gemm/SharedMemTiling/ncu_details_vs_baseline.png" alt="The tiled kernel still shows heavy L1/TEX activity while DRAM utilization is low. Shared-memory instructions and synchronization remain costly after global requests are reduced." caption="The tiled kernel still shows heavy L1/TEX activity while DRAM utilization is low. Shared-memory instructions and synchronization remain costly after global requests are reduced." %}

</details>

The runtime did not improve by 16 times because the eliminated requests were not all DRAM misses. Caches already provided some reuse. The kernel also now executes many shared-memory loads and barriers. Shared tiling creates the foundation for reuse, but one output per thread still consumes two shared operands for each multiply-add.

### GEMM 2. 4 × 4 register tile

Each thread now owns 16 output values. At one reduction index, it loads four values from the A tile and four from the B tile into registers, then forms their outer product.

$$
\begin{bmatrix}a_0\\a_1\\a_2\\a_3\end{bmatrix}
\begin{bmatrix}b_0&b_1&b_2&b_3\end{bmatrix}
=\begin{bmatrix}
a_0b_0&a_0b_1&a_0b_2&a_0b_3\\
a_1b_0&a_1b_1&a_1b_2&a_1b_3\\
a_2b_0&a_2b_1&a_2b_2&a_2b_3\\
a_3b_0&a_3b_1&a_3b_2&a_3b_3
\end{bmatrix}.
$$

{% include cuda-diagram.liquid name="register-outer-product" alt="A 64 by 64 block tile drawn as 4 by 4 sub-tiles. One thread owns the same position in each sub-tile, 16 apart, and at every reduction step loads four A values and four B values into registers to form a 4 by 4 outer product into 16 accumulators." caption="Each thread owns 16 outputs spaced 16 apart in the block tile. At every reduction step it loads four A values and four B values into registers and forms their outer product: 16 independent FMAs for 8 shared loads." %}

For an $$R_M\times R_N$$ register tile, the scalar shared operands per FMA are

$$\frac{R_M+R_N}{R_MR_N}=\frac1{R_M}+\frac1{R_N}.$$

A $$1\times1$$ tile needs two operands per FMA; a $$4\times4$$ tile needs only one half. The block still has 256 threads, so its output footprint grows to $$64\times64$$.

A 4 × 4 accumulator array expands each block’s output to 64 × 64. Threads share the input loads across this larger tile, then reuse the values in the inner loop below.

```cpp
		for (int l = 0; l < GEMM_TILE; l++) {
		    real_t ra[GEMM_THREAD_TILE];
		    real_t rb[GEMM_THREAD_TILE];
		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
			ra[u] = as[l][threadIdx.x + u * GEMM_TILE];
		    for (int v = 0; v < GEMM_THREAD_TILE; v++)
			rb[v] = bs[threadIdx.y + v * GEMM_TILE][l];
		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
			for (int v = 0; v < GEMM_THREAD_TILE; v++)
			    acc[u][v] += ra[u] * rb[v];
		}
```

<details class="cuda-support" markdown="1"><summary>Read the complete kernel diff</summary>

```diff
@@ -7,6 +7,8 @@
 #define GEMV_ROWS 32
 #define GEMV_SPLITS 16
 #define GEMM_TILE 16
+#define GEMM_THREAD_TILE 4
+#define GEMM_BLOCK_TILE (GEMM_TILE * GEMM_THREAD_TILE)

 static long span_of(int n, int inc) {
     return n > 0 ? 1 + (long)(n - 1) * (inc < 0 ? -inc : inc) : 0;
@@ -374,24 +376,45 @@ void symv(const char* uplo, real_t alpha, const Matrix& A, const Vector& x, real

 template <typename AccessA, typename AccessB>
 __global__ void gemm_kernel(real_t alpha, const Matrix A, const Matrix B, real_t beta, Matrix C, long m, long n, long k, AccessA at_a, AccessB at_b) {
-    __shared__ real_t as[GEMM_TILE][GEMM_TILE];
-    __shared__ real_t bs[GEMM_TILE][GEMM_TILE];
+    __shared__ real_t as[GEMM_TILE][GEMM_BLOCK_TILE];
+    __shared__ real_t bs[GEMM_BLOCK_TILE][GEMM_TILE];
     real_t* __restrict__ cp = C.data;
-    for (long ib = blockIdx.x * (long)GEMM_TILE; ib < m; ib += (long)gridDim.x * GEMM_TILE) {
-	for (long jb = blockIdx.y * (long)GEMM_TILE; jb < n; jb += (long)gridDim.y * GEMM_TILE) {
-	    const long i = ib + threadIdx.x;
-	    const long j = jb + threadIdx.y;
-	    real_t sum = 0;
+    const int tid = threadIdx.y * GEMM_TILE + threadIdx.x;
+    for (long ib = blockIdx.x * (long)GEMM_BLOCK_TILE; ib < m; ib += (long)gridDim.x * GEMM_BLOCK_TILE) {
+	for (long jb = blockIdx.y * (long)GEMM_BLOCK_TILE; jb < n; jb += (long)gridDim.y * GEMM_BLOCK_TILE) {
+	    real_t acc[GEMM_THREAD_TILE][GEMM_THREAD_TILE] = {};
 	    for (long t = 0; t < k; t += GEMM_TILE) {
-		as[threadIdx.y][threadIdx.x] = (i < m && t + threadIdx.y < k) ? at_a(A, i, t + threadIdx.y) : real_t(0);
-		bs[threadIdx.y][threadIdx.x] = (t + threadIdx.x < k && j < n) ? at_b(B, t + threadIdx.x, j) : real_t(0);
+		for (int q = 0; q < GEMM_THREAD_TILE; q++) {
+		    const int e = tid + q * GEMM_TILE * GEMM_TILE;
+		    const int ar = e % GEMM_BLOCK_TILE;
+		    const int ak = e / GEMM_BLOCK_TILE;
+		    as[ak][ar] = (ib + ar < m && t + ak < k) ? at_a(A, ib + ar, t + ak) : real_t(0);
+		    const int bk = e % GEMM_TILE;
+		    const int bc = e / GEMM_TILE;
+		    bs[bc][bk] = (t + bk < k && jb + bc < n) ? at_b(B, t + bk, jb + bc) : real_t(0);
+		}
 		__syncthreads();
-		for (int l = 0; l < GEMM_TILE; l++)
-		    sum += as[l][threadIdx.x] * bs[threadIdx.y][l];
+		for (int l = 0; l < GEMM_TILE; l++) {
+		    real_t ra[GEMM_THREAD_TILE];
+		    real_t rb[GEMM_THREAD_TILE];
+		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
+			ra[u] = as[l][threadIdx.x + u * GEMM_TILE];
+		    for (int v = 0; v < GEMM_THREAD_TILE; v++)
+			rb[v] = bs[threadIdx.y + v * GEMM_TILE][l];
+		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
+			for (int v = 0; v < GEMM_THREAD_TILE; v++)
+			    acc[u][v] += ra[u] * rb[v];
+		}
 		__syncthreads();
 	    }
-	    if (i < m && j < n)
-		cp[i + j * C.ld] = alpha * sum + (beta == real_t(0) ? real_t(0) : beta * cp[i + j * C.ld]);
+	    for (int u = 0; u < GEMM_THREAD_TILE; u++) {
+		const long i = ib + threadIdx.x + u * GEMM_TILE;
+		for (int v = 0; v < GEMM_THREAD_TILE; v++) {
+		    const long j = jb + threadIdx.y + v * GEMM_TILE;
+		    if (i < m && j < n)
+			cp[i + j * C.ld] = alpha * acc[u][v] + (beta == real_t(0) ? real_t(0) : beta * cp[i + j * C.ld]);
+		}
+	    }
 	}
     }
 }
@@ -414,8 +437,8 @@ void gemm(const char* transa, const char* transb, real_t alpha, const Matrix& A,
     if (m <= 0 || n <= 0 || (alpha == real_t(0) && beta == real_t(1))) return;

     const dim3 block(GEMM_TILE, GEMM_TILE);
-    long gx = (m + block.x - 1) / block.x;
-    long gy = (n + block.y - 1) / block.y;
+    long gx = (m + GEMM_BLOCK_TILE - 1) / GEMM_BLOCK_TILE;
+    long gy = (n + GEMM_BLOCK_TILE - 1) / GEMM_BLOCK_TILE;
     //temporary cap on grid size
     if (gx > 65535) gx = 65535;
     if (gy > 65535) gy = 65535;
```

</details>

<div class="cuda-change">\(21.33 \rightarrow 6.20\,\mathrm{ms}\), approximately \(3.44\times\) faster.</div>

{% include cuda-evidence.liquid path="Gemm/RegisterBlocking/ncu_speed_of_light_vs_tiled.png" alt="The 4 × 4 register tile cuts time to 6.20 ms while theoretical occupancy falls from 100% to about 33%. Useful reuse more than pays for the additional registers." caption="The 4 × 4 register tile cuts time to 6.20 ms while theoretical occupancy falls from 100% to about 33%. Useful reuse more than pays for the additional registers." %}

<details class="cuda-support"><summary>Check the traffic reduction produced by register blocking</summary>

{% include cuda-evidence.liquid path="Gemm/RegisterBlocking/ncu_memory_chart_vs_tiled.png" alt="Shared requests fall by about 75%, consistent with the fourfold reduction in scalar shared operands per FMA. The larger block footprint also reduces repeated global loads." caption="Shared requests fall by about 75%, consistent with the fourfold reduction in scalar shared operands per FMA. The larger block footprint also reduces repeated global loads." %}

</details>

This was the biggest GEMM improvement in the sequence. Each warp performs more arithmetic with the values it already has, and independent accumulators give the compiler more work to schedule. Occupancy decreased, but useful throughput increased.

### GEMM 3. 8 × 8 register tile

The next change doubles both register-tile dimensions. Each thread owns 64 outputs, and the block covers $$128\times128$$. Sixteen shared operands now feed 64 FMAs, giving a scalar operand/FMA ratio of $$0.25$$.

Changing one constant expands the thread tile to 8 × 8 and the block tile to 128 × 128. The indexing, shared arrays, and launch geometry all follow that constant.

```diff
@@ -7,7 +7,7 @@
 #define GEMV_ROWS 32
 #define GEMV_SPLITS 16
 #define GEMM_TILE 16
-#define GEMM_THREAD_TILE 4
+#define GEMM_THREAD_TILE 8
 #define GEMM_BLOCK_TILE (GEMM_TILE * GEMM_THREAD_TILE)

 static long span_of(int n, int inc) {
```

<div class="cuda-change">\(6.20 \rightarrow 5.47\,\mathrm{ms}\), approximately \(1.13\times\) faster.</div>

{% include cuda-evidence.liquid path="Gemm/RegisterTile8x8/ncu_speed_of_light_vs_4x4.png" alt="The larger register tile improves time, but by much less than the previous change. Read 5.47 ms against the 6.20 ms baseline." caption="The larger register tile improves time, but by much less than the previous change. Read 5.47 ms against the 6.20 ms baseline." %}

<details class="cuda-support"><summary>Compare the instruction and traffic effects of the larger tile</summary>

{% include cuda-evidence.liquid path="Gemm/RegisterTile8x8/ncu_memory_chart_vs_4x4.png" alt="The 8 × 8 version reduces repeated global traffic further. The observed shared-request reduction is smaller than a simple scalar-operand count alone would suggest." caption="The 8 × 8 version reduces repeated global traffic further. The observed shared-request reduction is smaller than a simple scalar-operand count alone would suggest." %}

</details>

The compiled kernel uses about 170 registers per thread and supports only one of these blocks per multiprocessor in the recorded configuration. Theoretical occupancy falls to about 16.7%. The scheduler statistics show no eligible warp in roughly 45.65% of cycles.

The larger tile saves work, but all resident warps now belong to one block. When that block waits at a barrier or on dependencies, there is no second resident block to draw from. This is a plausible explanation for the limited gain, supported by the resource and scheduler measurements; the scalar reuse equation alone does not predict the result.

### GEMM 4. Double buffering

I allocated two shared-memory buffers for each input tile. The kernel preloads the first tile, then loads the next tile into registers before computing on the current shared tile. After the current work, it writes those prefetched values to the alternate buffer, swaps buffers, and synchronizes. This reduces the loop from two block barriers per reduction stage to one.

{% include cuda-diagram.liquid name="double-buffer" alt="The loop alternates between two shared buffers: while computing on one, each thread prefetches the next tile into registers, then stores it into the other buffer and swaps. A schematic timeline compares two barriers per stage for a single buffer with one barrier per stage for double buffering." caption="While computing on one shared buffer, each thread prefetches the next tile into registers, then stores it into the other buffer and swaps, with a single barrier per stage. The timeline is a schematic of the ordering, not a measurement." %}

The double-buffered shared-memory footprint is

$$
Q_{\mathrm{shared}}=2sB_K(B_M+B_N)
=2\cdot4\cdot16\cdot(128+128)=32\,\mathrm{KiB}.
$$

This implementation uses ordinary register prefetching, not asynchronous copy instructions. The compiler and hardware determine how much load latency overlaps with independent arithmetic.

Two shared buffers alternate between tiles. The kernel primes buffer zero, prefetches the next tile into pa/pb registers, and stages it into the alternate buffer using ordinary loads.

```cpp
		if (tn < k) {
		    for (int q = 0; q < GEMM_THREAD_TILE; q++) {
			const int e = tid + q * GEMM_TILE * GEMM_TILE;
			as[buf ^ 1][e / GEMM_BLOCK_TILE][e % GEMM_BLOCK_TILE] = pa[q];
			bs[buf ^ 1][e / GEMM_TILE][e % GEMM_TILE] = pb[q];
		    }
		    buf ^= 1;
		}
		__syncthreads();
```

<details class="cuda-support" markdown="1"><summary>Read the complete kernel diff</summary>

```diff
@@ -376,35 +376,58 @@ void symv(const char* uplo, real_t alpha, const Matrix& A, const Vector& x, real

 template <typename AccessA, typename AccessB>
 __global__ void gemm_kernel(real_t alpha, const Matrix A, const Matrix B, real_t beta, Matrix C, long m, long n, long k, AccessA at_a, AccessB at_b) {
-    __shared__ real_t as[GEMM_TILE][GEMM_BLOCK_TILE];
-    __shared__ real_t bs[GEMM_BLOCK_TILE][GEMM_TILE];
+    __shared__ real_t as[2][GEMM_TILE][GEMM_BLOCK_TILE];
+    __shared__ real_t bs[2][GEMM_BLOCK_TILE][GEMM_TILE];
     real_t* __restrict__ cp = C.data;
     const int tid = threadIdx.y * GEMM_TILE + threadIdx.x;
     for (long ib = blockIdx.x * (long)GEMM_BLOCK_TILE; ib < m; ib += (long)gridDim.x * GEMM_BLOCK_TILE) {
 	for (long jb = blockIdx.y * (long)GEMM_BLOCK_TILE; jb < n; jb += (long)gridDim.y * GEMM_BLOCK_TILE) {
 	    real_t acc[GEMM_THREAD_TILE][GEMM_THREAD_TILE] = {};
+	    for (int q = 0; q < GEMM_THREAD_TILE; q++) {
+		const int e = tid + q * GEMM_TILE * GEMM_TILE;
+		const int ar = e % GEMM_BLOCK_TILE;
+		const int ak = e / GEMM_BLOCK_TILE;
+		as[0][ak][ar] = (ib + ar < m && ak < k) ? at_a(A, ib + ar, ak) : real_t(0);
+		const int bk = e % GEMM_TILE;
+		const int bc = e / GEMM_TILE;
+		bs[0][bc][bk] = (bk < k && jb + bc < n) ? at_b(B, bk, jb + bc) : real_t(0);
+	    }
+	    __syncthreads();
+	    int buf = 0;
 	    for (long t = 0; t < k; t += GEMM_TILE) {
-		for (int q = 0; q < GEMM_THREAD_TILE; q++) {
-		    const int e = tid + q * GEMM_TILE * GEMM_TILE;
-		    const int ar = e % GEMM_BLOCK_TILE;
-		    const int ak = e / GEMM_BLOCK_TILE;
-		    as[ak][ar] = (ib + ar < m && t + ak < k) ? at_a(A, ib + ar, t + ak) : real_t(0);
-		    const int bk = e % GEMM_TILE;
-		    const int bc = e / GEMM_TILE;
-		    bs[bc][bk] = (t + bk < k && jb + bc < n) ? at_b(B, t + bk, jb + bc) : real_t(0);
+		const long tn = t + GEMM_TILE;
+		real_t pa[GEMM_THREAD_TILE];
+		real_t pb[GEMM_THREAD_TILE];
+		if (tn < k) {
+		    for (int q = 0; q < GEMM_THREAD_TILE; q++) {
+			const int e = tid + q * GEMM_TILE * GEMM_TILE;
+			const int ar = e % GEMM_BLOCK_TILE;
+			const int ak = e / GEMM_BLOCK_TILE;
+			pa[q] = (ib + ar < m && tn + ak < k) ? at_a(A, ib + ar, tn + ak) : real_t(0);
+			const int bk = e % GEMM_TILE;
+			const int bc = e / GEMM_TILE;
+			pb[q] = (tn + bk < k && jb + bc < n) ? at_b(B, tn + bk, jb + bc) : real_t(0);
+		    }
 		}
-		__syncthreads();
 		for (int l = 0; l < GEMM_TILE; l++) {
 		    real_t ra[GEMM_THREAD_TILE];
 		    real_t rb[GEMM_THREAD_TILE];
 		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
-			ra[u] = as[l][threadIdx.x + u * GEMM_TILE];
+			ra[u] = as[buf][l][threadIdx.x + u * GEMM_TILE];
 		    for (int v = 0; v < GEMM_THREAD_TILE; v++)
-			rb[v] = bs[threadIdx.y + v * GEMM_TILE][l];
+			rb[v] = bs[buf][threadIdx.y + v * GEMM_TILE][l];
 		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
 			for (int v = 0; v < GEMM_THREAD_TILE; v++)
 			    acc[u][v] += ra[u] * rb[v];
 		}
+		if (tn < k) {
+		    for (int q = 0; q < GEMM_THREAD_TILE; q++) {
+			const int e = tid + q * GEMM_TILE * GEMM_TILE;
+			as[buf ^ 1][e / GEMM_BLOCK_TILE][e % GEMM_BLOCK_TILE] = pa[q];
+			bs[buf ^ 1][e / GEMM_TILE][e % GEMM_TILE] = pb[q];
+		    }
+		    buf ^= 1;
+		}
 		__syncthreads();
 	    }
 	    for (int u = 0; u < GEMM_THREAD_TILE; u++) {
```

</details>

<div class="cuda-change">\(5.47 \rightarrow 4.91\,\mathrm{ms}\), approximately \(1.11\times\) faster.</div>

{% include cuda-evidence.liquid path="Gemm/DoubleBuffering/ncu_speed_of_light_vs_singlebuf.png" alt="Double buffering reduces duration from 5.47 to 4.91 ms. Higher utilization here accompanies a measured improvement in useful arithmetic throughput." caption="Double buffering reduces duration from 5.47 to 4.91 ms. Higher utilization here accompanies a measured improvement in useful arithmetic throughput." %}

<details class="cuda-support"><summary>Check whether double buffering reduced the amount of work</summary>

{% include cuda-evidence.liquid path="Gemm/DoubleBuffering/ncu_memory_chart_vs_singlebuf.png" alt="The saved comparison shows essentially unchanged global and shared request counts. The gain comes from scheduling the same work more effectively, rather than from another large traffic reduction." caption="The saved comparison shows essentially unchanged global and shared request counts. The gain comes from scheduling the same work more effectively, rather than from another large traffic reduction." %}

</details>

The scheduler measurements make the difference clearer: issue-slot utilization rises from about 52.7% to 60.4%, and cycles with no eligible warp fall from 45.65% to 37.67%. Registers rise from 170 to 176 per thread, with no recorded spills. The remaining idle cycles explain why prefetching improves performance without closing the entire cuBLAS gap.

{% include cuda-chart.liquid name="gemm-steps" title="GEMM kernel time at each step, 2048³ FP32" alt="Horizontal bar chart of GEMM kernel time for the five implementations in Table 4, with a cuBLAS reference line at 2.89 milliseconds." caption="The values of Table 4. Register blocking produces the largest single drop; the remaining gap to cuBLAS is about 1.7 times." %}

<div class="cuda-table-wrap"><table class="cuda-table"><caption>Table 4. GEMM progression for 2048³ FP32 work. Throughput uses 2MNK FLOPs; speedup is relative to the first pass.</caption><thead><tr><th scope="col">Implementation</th><th scope="col" class="num">Time <span class="unit">\(\mathrm{ms}\)</span></th><th scope="col" class="num">Throughput <span class="unit">\(\mathrm{TFLOP/s}\)</span></th><th scope="col" class="num">Speedup</th></tr></thead><tbody>

<tr><td>One output per thread</td><td class="num">\(27.94\)</td><td class="num">\(0.615\)</td><td class="num">\(1.00\times\)</td></tr>

<tr><td>Shared-memory tiles</td><td class="num">\(21.33\)</td><td class="num">\(0.805\)</td><td class="num">\(1.31\times\)</td></tr>

<tr><td>4 × 4 register tiles</td><td class="num">\(6.20\)</td><td class="num">\(2.771\)</td><td class="num">\(4.51\times\)</td></tr>

<tr><td>8 × 8 register tiles</td><td class="num">\(5.47\)</td><td class="num">\(3.141\)</td><td class="num">\(5.11\times\)</td></tr>

<tr class="best"><td>Double buffering</td><td class="num">\(4.91\)</td><td class="num">\(3.499\)</td><td class="num">\(5.69\times\)</td></tr>

</tbody></table></div>

### Complete GEMM implementation

This includes the complete double-buffered kernel, transpose dispatch, and host entry point. This listing is the current working version, not a byte-for-byte copy of `c11b4fd`: the later `GEMM_K_TILE` and `GEMM_LOADS` refactor separates reduction depth from launch geometry and permits the smaller FP64 shared-memory footprint. The historical diffs above retain the original constants; the screenshots are not measurements of that later refactor. With the FP32 definitions below, each block has 256 threads and computes a 128 × 128 output tile. The shared types, constants, and memory helpers are listed [at the end](#shared-code).

```cpp
template <typename AccessA, typename AccessB>
__global__ void gemm_kernel(real_t alpha, const Matrix A, const Matrix B, real_t beta, Matrix C, long m, long n, long k, AccessA at_a, AccessB at_b) {
    __shared__ real_t as[2][GEMM_K_TILE][GEMM_BLOCK_TILE];
    __shared__ real_t bs[2][GEMM_BLOCK_TILE][GEMM_K_TILE];
    real_t* __restrict__ cp = C.data;
    const int tid = threadIdx.y * GEMM_TILE + threadIdx.x;
    for (long ib = blockIdx.x * (long)GEMM_BLOCK_TILE; ib < m; ib += (long)gridDim.x * GEMM_BLOCK_TILE) {
	for (long jb = blockIdx.y * (long)GEMM_BLOCK_TILE; jb < n; jb += (long)gridDim.y * GEMM_BLOCK_TILE) {
	    real_t acc[GEMM_THREAD_TILE][GEMM_THREAD_TILE] = {};
	    for (int q = 0; q < GEMM_LOADS; q++) {
		const int e = tid + q * GEMM_TILE * GEMM_TILE;
		const int ar = e % GEMM_BLOCK_TILE;
		const int ak = e / GEMM_BLOCK_TILE;
		as[0][ak][ar] = (ib + ar < m && ak < k) ? at_a(A, ib + ar, ak) : real_t(0);
		const int bk = e % GEMM_K_TILE;
		const int bc = e / GEMM_K_TILE;
		bs[0][bc][bk] = (bk < k && jb + bc < n) ? at_b(B, bk, jb + bc) : real_t(0);
	    }
	    __syncthreads();
	    int buf = 0;
	    for (long t = 0; t < k; t += GEMM_K_TILE) {
		const long tn = t + GEMM_K_TILE;
		real_t pa[GEMM_LOADS];
		real_t pb[GEMM_LOADS];
		if (tn < k) {
		    for (int q = 0; q < GEMM_LOADS; q++) {
			const int e = tid + q * GEMM_TILE * GEMM_TILE;
			const int ar = e % GEMM_BLOCK_TILE;
			const int ak = e / GEMM_BLOCK_TILE;
			pa[q] = (ib + ar < m && tn + ak < k) ? at_a(A, ib + ar, tn + ak) : real_t(0);
			const int bk = e % GEMM_K_TILE;
			const int bc = e / GEMM_K_TILE;
			pb[q] = (tn + bk < k && jb + bc < n) ? at_b(B, tn + bk, jb + bc) : real_t(0);
		    }
		}
		for (int l = 0; l < GEMM_K_TILE; l++) {
		    real_t ra[GEMM_THREAD_TILE];
		    real_t rb[GEMM_THREAD_TILE];
		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
			ra[u] = as[buf][l][threadIdx.x + u * GEMM_TILE];
		    for (int v = 0; v < GEMM_THREAD_TILE; v++)
			rb[v] = bs[buf][threadIdx.y + v * GEMM_TILE][l];
		    for (int u = 0; u < GEMM_THREAD_TILE; u++)
			for (int v = 0; v < GEMM_THREAD_TILE; v++)
			    acc[u][v] += ra[u] * rb[v];
		}
		if (tn < k) {
		    for (int q = 0; q < GEMM_LOADS; q++) {
			const int e = tid + q * GEMM_TILE * GEMM_TILE;
			as[buf ^ 1][e / GEMM_BLOCK_TILE][e % GEMM_BLOCK_TILE] = pa[q];
			bs[buf ^ 1][e / GEMM_K_TILE][e % GEMM_K_TILE] = pb[q];
		    }
		    buf ^= 1;
		}
		__syncthreads();
	    }
	    for (int u = 0; u < GEMM_THREAD_TILE; u++) {
		const long i = ib + threadIdx.x + u * GEMM_TILE;
		for (int v = 0; v < GEMM_THREAD_TILE; v++) {
		    const long j = jb + threadIdx.y + v * GEMM_TILE;
		    if (i < m && j < n)
			cp[i + j * C.ld] = alpha * acc[u][v] + (beta == real_t(0) ? real_t(0) : beta * cp[i + j * C.ld]);
		}
	    }
	}
    }
}

template <typename AccessA>
static void gemm_launch(const char* transb, real_t alpha, const Matrix& A, const Matrix& B, real_t beta, Matrix& C, long m, long n, long k, dim3 grid, dim3 block, AccessA at_a) {
    if (transb[0] == 'N' || transb[0] == 'n') {
	gemm_kernel<<<grid, block>>>(alpha, A, B, beta, C, m, n, k, at_a, NoTransAt());
    } else {
	gemm_kernel<<<grid, block>>>(alpha, A, B, beta, C, m, n, k, at_a, TransAt());
    }
}

void gemm(const char* transa, const char* transb, real_t alpha, const Matrix& A, const Matrix& B, real_t beta, Matrix& C) {
    const bool na = (transa[0] == 'N' || transa[0] == 'n');
    const long m = na ? A.rows : A.cols;
    const long k = na ? A.cols : A.rows;
    const long n = (transb[0] == 'N' || transb[0] == 'n') ? B.cols : B.rows;

    if (m <= 0 || n <= 0 || (alpha == real_t(0) && beta == real_t(1))) return;

    const dim3 block(GEMM_TILE, GEMM_TILE);
    long gx = (m + GEMM_BLOCK_TILE - 1) / GEMM_BLOCK_TILE;
    long gy = (n + GEMM_BLOCK_TILE - 1) / GEMM_BLOCK_TILE;
    //temporary cap on grid size
    if (gx > 65535) gx = 65535;
    if (gy > 65535) gy = 65535;
    const dim3 grid((unsigned)gx, (unsigned)gy);

    real_t* sa = nullptr;
    real_t* sb = nullptr;
    real_t* sc = nullptr;
    const Matrix dA = stage_matrix(A, sa);
    const Matrix dB = stage_matrix(B, sb);
    Matrix dC = stage_matrix(C, sc);

    if (na) {
	gemm_launch(transb, alpha, dA, dB, beta, dC, m, n, k, grid, block, NoTransAt());
    } else {
	gemm_launch(transb, alpha, dA, dB, beta, dC, m, n, k, grid, block, TransAt());
    }
    CUDA_ERROR_CHECK(cudaGetLastError());
    unstage_matrix(C, sc);
    release(sb);
    release(sa);
}
```

## Scaling with input size {#scaling}

The captures above measure one size per routine. To see whether the conclusions hold elsewhere, I rebuilt the saved kernel implementations and timed them across a range of sizes on the same RTX4060 alongside cuBLAS. Each implementation uses its original grid and block configuration. Timing uses CUDA events around launches on device-resident data, with the L2 cache flushed before every repetition. At each size all implementations run round-robin, so clock changes affect them alike, and each point is the median of three passes of at least 20 repetitions. Every result was checked against cuBLAS.

These numbers are not interchangeable with the Nsight Compute captures. Nsight Compute locks the GPU to its base clocks, while these runs let it boost, so the compute-bound GEMM kernels run faster here: 4.46 ms instead of 4.91 ms for the final version at 2048. Under sustained load the GPU also reached its 40 W power limit and sometimes lowered the memory clock, which pushes the medians of the bandwidth-bound DOT and GEMV kernels 12 to 15% above the captures, although their fastest repetitions agree with the captures to within about 1%. Compare curves within a chart rather than reading single points against the earlier tables. The raw measurements are available as [a CSV file]({{ '/assets/data/cuda-size-sweep.csv' | relative_url }}).

{% include cuda-chart.liquid name="dot-sizes" sweep=true title="DOT useful bandwidth by vector length" alt="Line chart of useful bandwidth against vector length from 4K to 64M elements for five DOT versions and cuBLAS. The two-per-thread and warp-shuffle kernels track cuBLAS to about 218 GB/s; the one-element-per-thread trees peak near 170 GB/s and fall to about 130 GB/s; the atomic baseline stays below 5 GB/s." caption="Once each thread handles two elements, the DOT kernel tracks cuBLAS up to about 218 GB/s. The two versions with one element per thread pay for a full reduction tree every 256 products and level off between 130 and 170 GB/s. The atomic baseline stays below 5 GB/s at every length: about 1.64 ns per element on large inputs, the cost of one serialized update." %}

For DOT, the final kernel matches cuBLAS at every length, from 7.2 versus 10.2 µs at 2¹⁶ elements to 2,456 versus 2,464 µs at 2²⁶. Below about a million elements both are limited by launch and reduction overhead rather than by bandwidth, which is why every curve starts low. The chart also shows that step DOT 5 was not specific to 2²⁴ elements: at every length above a million, the two versions that give each thread one element stay 20 to 40% below the ones that give it two. The atomic baseline does not improve with size at all: its time grows in proportion to n, so its bandwidth stays flat. Its FP32 result also drifts as n grows, because millions of single additions into one accumulator lose low-order bits; at 2²⁶ elements its relative error reached 22%, while the reduction trees stay within 4 × 10⁻⁶ of cuBLAS.

{% include cuda-chart.liquid name="gemv-sizes" sweep=true title="GEMV useful bandwidth by matrix order" alt="Line chart of useful bandwidth against matrix order from 256 to 8192 for the eight-block baseline, the row and column split, and cuBLAS. The split kernel and cuBLAS overlap at every size, reaching about 217 GB/s; the baseline is far below at small sizes and approaches them at 8192." caption="The row and column split tracks cuBLAS at every size. The eight-block baseline is 4 to 10 times slower on small matrices but only about 1.3 times slower at 8192, where each of its threads has more rows to keep the memory system busy." %}

For GEMV, the row and column split and cuBLAS are indistinguishable across the whole range. The baseline's gap depends strongly on size. Its eight-block launch was written for the 4096 problem; on smaller matrices it has even less independent work per SM, and on larger ones each thread's longer row loop partly compensates.

{% include cuda-chart.liquid name="gemm-sizes" sweep=true title="GEMM throughput by matrix order" alt="Line chart of FP32 throughput against matrix order from 128 to 4096 for five GEMM versions and cuBLAS. cuBLAS is highest throughout. The register-tiled kernels reach roughly half to 60% of it at large sizes, the double-buffered kernel leading among them, while the naive and shared-tile kernels stay below 1 TFLOP/s." caption="Register blocking separates the GEMM versions from order 512 upward. On small matrices the 128 × 128 block tiles of the 8 × 8 and double-buffered kernels leave only one to four blocks for 24 SMs, so the 4 × 4 version, and at 128 even the shared-tile version, is faster there." %}

GEMM shows the clearest size dependence. From order 1024 upward the final kernel stays about 1.6 to 1.7 times behind cuBLAS, a stable gap that matches the single capture. The ordering of the versions changes at the small end. At order 256 the double-buffered kernel launches only four 128 × 128 blocks and takes 55.3 µs, while the 4 × 4 version, with sixteen 64 × 64 blocks, takes 27.6 µs and cuBLAS takes 15.4 µs. The tile size that maximizes reuse on a large matrix starves the GPU of blocks on a small one, which is why libraries such as cuBLAS choose among several kernels by problem size.

## What I learned about acceleration {#what-i-learned}

The useful question changed at each stage. For DOT, it was how to combine results without serializing every thread. For GEMV, it was how to expose enough independent work while respecting column-major memory layout. For GEMM, it was how many times a value could contribute to arithmetic after each load. The same GPU needed three different strategies because the operations place different demands on it.

DOT made the cost of coordination especially clear. Millions of independent multiplications still ran slowly when every thread updated the same scalar. Reducing within a block removed most of that contention; giving each thread more work then reduced how often the kernel had to combine partial sums. Changing the reduction tree also changed floating-point rounding, so checking the answer remained part of evaluating each improvement.

GEMV showed that reducing memory accesses is only part of the problem. Caching the input vector helped, but an eight-block launch still left too little independent work for the GPU. Splitting columns exposed more parallelism while keeping neighboring rows contiguous in memory. The lesson was to consider data layout and work distribution together: a kernel can access the right data efficiently and still leave much of the machine idle.

GEMM made reuse tangible. Shared tiles let threads cooperate on input loads, and register tiles let each thread use those values to accumulate several outputs. But larger tiles also reduce the number of blocks. The size sweep showed the consequence: a configuration that performed well on a large matrix could lose on a small one because it no longer supplied enough parallel work. Tile size is a tradeoff between reuse, resource use, and the amount of work available.

The roofline model helped distinguish operations with little reuse from operations with considerable reuse potential. The profiles explained why a particular implementation fell short. A traffic equation could predict the effect of tiling on requested bytes, but it could not by itself account for atomic contention, shared-memory instruction pressure, or a block waiting at a barrier. A useful optimization process starts with a prediction about the bottleneck, tests a code change, and checks both runtime and the profile against that prediction.

Acceleration comes from coordinating the mathematical structure with the machine: combining locally, mapping contiguous data to neighboring lanes, accumulating many outputs in registers, and arranging the remaining loads around independent work. Once one bottleneck is removed, another can become the limiting factor, so each improvement changes what is worth investigating next.

These improvements are kernel-level results. The current host-pointer API also allocates memory, transfers inputs, and copies outputs back. Those costs must be measured separately when deciding whether an application benefits. A useful next step is to keep data on the GPU across several operations, so transfers and allocations can be spread over more computation. A faster kernel matters most when the surrounding application can make use of it.

## Shared code and a complete source file {#shared-code}

The functions above use the following shared definitions and staging helpers. These are included once to keep each kernel listing focused. The code is a snapshot of the working implementation, including its host-memory API, rather than a claim of complete BLAS conformance.

[Download the complete CUDA source]({{ '/assets/code/cuda-blas-kernels.cu' | relative_url }}). It combines this prelude with all three implementations and can be compiled as a translation unit:

```sh
nvcc -O3 -arch=sm_89 -c cuda-blas-kernels.cu
```

<details class="cuda-support" markdown="1">
<summary>Complete types, configuration, error checking, and memory helpers</summary>

```cpp
#include <cuda_runtime.h>
#include <iostream>
#include <cstdlib>

#ifdef DOUBLE_PRECISION
    typedef double real_t;
#else
    typedef float real_t;
#endif

//Vector: a strided view of n elements at data[0], data[inc], data[2*inc], ...
//A matrix column is {data + j*ld, rows, 1}; a row is {data + i, cols, ld}.
struct Vector {
    real_t* data;
    int n;
    int inc;  // stride between elements, in units of real_t (1 = contiguous)
};

//Matrix
struct Matrix {
    real_t* data;
    int rows, cols, ld;
};


struct NoTransAt {
    __device__ real_t operator()(const Matrix& A, long i, long j) const {
        return A.data[i + j * A.ld];
    }
};

struct TransAt {
    __device__ real_t operator()(const Matrix& A, long i, long j) const {
        return A.data[j + i * A.ld];
    }
};

#define CUDA_ERROR_CHECK(call)                                                             \
    do {                                                                                  \
        cudaError_t status = call;                                                        \
        if (status != cudaSuccess) {                                                      \
            std::cerr << "CUDA error: " << cudaGetErrorString(status) << std::endl;       \
            std::exit(1);                                                                 \
        }                                                                                 \
    } while (0)

#define BLOCK_SIZE 256
#define GEMV_BLOCK_SIZE BLOCK_SIZE
#define GEMV_ROWS 32
#define GEMV_SPLITS 16
#ifndef GEMM_TILE
#define GEMM_TILE 16
#endif
#ifndef GEMM_K_TILE
// Keep static shared storage below the per-block 48 KiB limit in FP64.
#ifdef DOUBLE_PRECISION
#define GEMM_K_TILE 8
#else
#define GEMM_K_TILE 16
#endif
#endif
#define GEMM_LOADS (GEMM_K_TILE * GEMM_BLOCK_TILE / (GEMM_TILE * GEMM_TILE))
#define GEMM_THREAD_TILE 8
#define GEMM_BLOCK_TILE (GEMM_TILE * GEMM_THREAD_TILE)
static_assert(GEMM_K_TILE * GEMM_BLOCK_TILE % (GEMM_TILE * GEMM_TILE) == 0,
              "GEMM tile loads must divide evenly across the block");

static long span_of(int n, int inc) {
    return n > 0 ? 1 + (long)(n - 1) * (inc < 0 ? -inc : inc) : 0;
}

static long offset_of(int n, int inc) {
    return (inc < 0 && n > 0) ? (long)(n - 1) * -inc : 0;
}

static real_t* device_copy_in(const real_t* host, long count) {
    real_t* dev = nullptr;
    CUDA_ERROR_CHECK(cudaMalloc(&dev, (count > 0 ? count : 1) * sizeof(real_t)));
    if (count > 0)
	CUDA_ERROR_CHECK(cudaMemcpy(dev, host, count * sizeof(real_t), cudaMemcpyHostToDevice));
    return dev;
}

static Vector stage_vector(const Vector& v, real_t*& slab) {
    const long off = offset_of(v.n, v.inc);
    slab = device_copy_in(v.data - off, span_of(v.n, v.inc));
    return Vector{slab + off, v.n, v.inc};
}

static void unstage_vector(const Vector& v, real_t* slab) {
    const long count = span_of(v.n, v.inc);
    if (count > 0)
	CUDA_ERROR_CHECK(cudaMemcpy(v.data - offset_of(v.n, v.inc), slab, count * sizeof(real_t), cudaMemcpyDeviceToHost));
    CUDA_ERROR_CHECK(cudaFree(slab));
}

static Matrix stage_matrix(const Matrix& A, real_t*& slab) {
    slab = device_copy_in(A.data, (long)A.ld * A.cols);
    return Matrix{slab, A.rows, A.cols, A.ld};
}

static void unstage_matrix(const Matrix& A, real_t* slab) {
    const long count = (long)A.ld * A.cols;
    if (count > 0)
	CUDA_ERROR_CHECK(cudaMemcpy(A.data, slab, count * sizeof(real_t), cudaMemcpyDeviceToHost));
    CUDA_ERROR_CHECK(cudaFree(slab));
}

static void release(real_t* slab) {
    CUDA_ERROR_CHECK(cudaFree(slab));
}
```

</details>

</div>
