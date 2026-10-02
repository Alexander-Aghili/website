// Complete DOT, GEMV, and GEMM implementation snapshot for the blog.
// Source: GPULinAlg/BLAS, September 26, 2026.
// Build: nvcc -O3 -arch=sm_89 -c cuda-blas-kernels.cu

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
