"""GEMV 0 (eight blocks on a 24-SM GPU) and GEMV 3 (32 rows x 16 column chunks)."""
from style import *

SCENES = [
    ("gemv-launch", "LaunchGeometry"),
    ("gemv-mapping", "GemvMapping"),
]

N_SM = 24


def sm_grid(rows, cols, w, h, gap, label_size=14):
    """24 streaming multiprocessors as labelled boxes, row-major order."""
    boxes = VGroup()
    for r in range(rows):
        for c in range(cols):
            b = RoundedRectangle(width=w, height=h, corner_radius=0.06, fill_color=PAPER, fill_opacity=0,
                                 stroke_color=LINE, stroke_width=1.4)
            b.move_to([c * (w + gap), -r * (h + gap), 0])
            boxes.add(b)
    labels = VGroup(*[T(f"SM {i}", label_size, MUTED).move_to(b.get_top() + 0.14 * DOWN)
                      for i, b in enumerate(boxes)]) if label_size else VGroup()
    return boxes, labels


class LaunchGeometry(CudaScene):
    title = "GEMV 0: eight blocks for a 24-SM GPU"
    subtitle = "m = n = 4096, grid = (4096 + 511) / 512 = 8 blocks of 256 threads"

    def construct(self):
        self.intro()

        boxes, labels = sm_grid(4, 6, 0.95, 0.72, 0.12)
        VGroup(boxes, labels).move_to([-3.05, 0.35, 0])
        shell = SurroundingRectangle(boxes, buff=0.18, corner_radius=0.12, color=LINE, stroke_width=1.6)
        gpu_l = T("RTX4060: 24 streaming multiprocessors", 17, MUTED).next_to(shell, UP, buff=0.1)
        self.say("This GPU has 24 streaming multiprocessors (SMs) to run blocks on.")
        self.play(FadeIn(shell), FadeIn(gpu_l), LaggedStart(*[FadeIn(b) for b in boxes], lag_ratio=0.02),
                  FadeIn(labels), run_time=1.0)

        queue = VGroup(*[chip(f"block {b}", GOLD_FILL, w=1.15, h=0.42, size=15) for b in range(8)])
        queue.arrange_in_grid(2, 4, buff=(0.12, 0.14)).move_to([3.95, 1.55, 0])
        q_l = T("the whole grid: 8 blocks x 256 threads", 17, INK).next_to(queue, UP, buff=0.16)
        self.say("The baseline launch creates only eight blocks, 2,048 threads in total.")
        self.play(FadeIn(q_l), LaggedStart(*[FadeIn(q, shift=0.1 * DOWN) for q in queue], lag_ratio=0.06),
                  run_time=1.0)
        self.wait(0.4)

        self.say("Eight blocks can occupy at most eight SMs. Sixteen sit idle.")
        moves = []
        for b in range(8):
            moves.append(queue[b].animate.scale(0.62).move_to(boxes[b].get_center() + 0.1 * DOWN))
        self.play(LaggedStart(*moves, lag_ratio=0.08), boxes[:8].animate.set_stroke(GOLD, 2.2), run_time=1.4)
        idle = VGroup(*[T("idle", 15, MUTED).move_to(boxes[i].get_center() + 0.1 * DOWN) for i in range(8, N_SM)])
        self.play(*[boxes[i].animate.set_fill(IDLE, 1) for i in range(8, N_SM)], FadeIn(idle), FadeOut(q_l),
                  run_time=0.8)

        busy = VGroup(T("8 of 24", 34, GOLD), T("SMs have a block", 17, MUTED)).arrange(DOWN, buff=0.06,
                                                                                        aligned_edge=LEFT)
        busy.move_to([3.55, 1.5, 0], aligned_edge=LEFT)
        self.play(FadeIn(busy, shift=0.1 * UP), run_time=0.6)
        self.wait(0.8)

        # Zoom into one thread of block 0.
        self.play(FadeOut(busy), run_time=0.4)
        mat = Square(3.0, fill_color=BLUE_FILL, fill_opacity=0.35, stroke_color=LINE, stroke_width=1.4)
        mat.move_to([4.25, 0.45, 0])
        mat_l = T("A: 4096 x 4096", 17, MUTED).next_to(mat, UP, buff=0.1)
        r0 = Rectangle(width=3.0, height=0.07, fill_color=CORAL, fill_opacity=0.9, stroke_width=0)
        r0.move_to(mat.get_top() + 0.12 * DOWN)
        r1 = r0.copy().move_to(mat.get_center() + 0.03 * DOWN)
        r0_l = T("row 0", 14, CORAL).next_to(r0, LEFT, buff=0.12)
        r1_l = T("row 2048", 14, CORAL).next_to(r1, LEFT, buff=0.12)
        thr_l = T("thread 0 of block 0 (in SM 0)", 15, CORAL).next_to(mat_l, UP, buff=0.08)
        self.say("The row loop strides by 2,048, so each thread owns two full rows.")
        self.play(FadeIn(mat), FadeIn(mat_l), run_time=0.5)
        self.play(queue[0][0].animate.set_stroke(CORAL, 2.5), boxes[0].animate.set_stroke(CORAL, 3), FadeIn(thr_l),
                  run_time=0.6)
        self.play(FadeIn(r0), FadeIn(r1), FadeIn(r0_l), FadeIn(r1_l), run_time=0.6)

        loop = code("for (j = 0; j < 4096; j++)\n  sum += A[i + j*ld] * x[j];", 14, MUTED)
        loop.next_to(mat, DOWN, buff=0.2)
        count = VGroup(T("multiply-adds in sequence:", 16, MUTED), T("0", 22, INK)).arrange(RIGHT, buff=0.15)
        count.next_to(loop, DOWN, buff=0.12)
        self.play(FadeIn(loop), FadeIn(count), run_time=0.5)
        self.say("Each multiply-add waits on the previous sum: 8,192 steps in a row.")
        tracker = ValueTracker(0)
        num = always_redraw(lambda: T(f"{int(tracker.get_value()):,}", 22, INK).next_to(count[0], RIGHT, buff=0.15))
        self.remove(count[1])
        self.add(num)
        dot = Dot(r0.get_left(), radius=0.07, color=INK)
        self.add(dot)
        self.play(dot.animate.move_to(r0.get_right()), tracker.animate.set_value(4096), run_time=1.6,
                  rate_func=linear)
        dot.move_to(r1.get_left())
        self.play(dot.animate.move_to(r1.get_right()), tracker.animate.set_value(8192), run_time=1.6,
                  rate_func=linear)
        self.play(FadeOut(dot), run_time=0.3)

        stats = VGroup(
            VGroup(T("memory SOL", 16, MUTED), T("34.64%", 30, CORAL)).arrange(DOWN, buff=0.06, aligned_edge=LEFT),
            VGroup(T("this kernel", 16, MUTED), T("770.75 µs", 30, INK)).arrange(DOWN, buff=0.06, aligned_edge=LEFT),
            VGroup(T("cuBLAS, same report", 16, MUTED), T("279.62 µs", 30, TEAL)).arrange(DOWN, buff=0.06,
                                                                                       aligned_edge=LEFT),
        ).arrange(RIGHT, buff=0.8, aligned_edge=DOWN).move_to([-3.05, -2.2, 0])
        self.say("Too few blocks leave bandwidth unused. GEMV 2 adds more blocks.")
        self.play(LaggedStart(*[FadeIn(s, shift=0.1 * UP) for s in stats], lag_ratio=0.2), run_time=1.0)
        self.finish(3.0)


class GemvMapping(CudaScene):
    title = "GEMV 3: 32 rows x 16 column chunks per block"
    subtitle = "block = dim3(32, 16): threadIdx.x picks the row, threadIdx.y the column chunk"

    def construct(self):
        self.intro()
        ROWS, SPL, SHOWN = 32, 16, 4
        rh, cw, gap = 0.07, 0.1, 0.04
        chunk_w = SHOWN * cw
        left, top = -6.2, 2.0
        band_h = ROWS * rh

        def chunk_x(t):
            return left + t * (chunk_w + gap) + chunk_w / 2

        # The block's 32-row band of A, split into 16 column chunks.
        chunks = VGroup()
        for t in range(SPL):
            bg = Rectangle(width=chunk_w, height=band_h, fill_color=BLUE_FILL, fill_opacity=0.55,
                           stroke_color=LINE, stroke_width=1.2).move_to([chunk_x(t), top - band_h / 2, 0])
            lines = VGroup(*[Line(bg.get_left() + (bg.get_top()[1] - rh * r - bg.get_center()[1]) * UP,
                                  bg.get_right() + (bg.get_top()[1] - rh * r - bg.get_center()[1]) * UP,
                                  stroke_width=0.5, color=LINE) for r in range(1, ROWS)])
            cols = VGroup(*[Line(bg.get_bottom() + (k * cw - chunk_w / 2) * RIGHT,
                                 bg.get_top() + (k * cw - chunk_w / 2) * RIGHT,
                                 stroke_width=0.7, color=LINE) for k in range(1, SHOWN)])
            chunks.add(VGroup(bg, lines, cols))
        xs = VGroup(*[Rectangle(width=chunk_w, height=0.15, fill_color=TEAL_FILL, fill_opacity=1, stroke_color=LINE,
                                stroke_width=1).move_to([chunk_x(t), top + 0.2, 0]) for t in range(SPL)])
        x_l = T("x", 18, INK, slant=ITALIC).next_to(xs, LEFT, buff=0.12)
        ty_l = VGroup(*[T(str(t), 12, MUTED).move_to([chunk_x(t), top - band_h - 0.14, 0]) for t in range(SPL)])
        ty_cap = T("threadIdx.y: 16 chunks of 256 columns", 15, MUTED).next_to(ty_l, DOWN, buff=0.08)
        brace = Brace(chunks, LEFT, buff=0.06, color=MUTED)
        rows_l = T("32 rows", 13, MUTED).rotate(PI / 2).next_to(brace, LEFT, buff=0.04)

        self.say("One block owns 32 adjacent rows of A and splits the columns 16 ways.")
        self.play(LaggedStart(*[FadeIn(c) for c in chunks], lag_ratio=0.03), FadeIn(xs), FadeIn(x_l),
                  run_time=1.0)
        self.play(FadeIn(ty_l), FadeIn(ty_cap), GrowFromCenter(brace), FadeIn(rows_l), run_time=0.6)

        warp0 = SurroundingRectangle(chunks[0][0], buff=0.03, color=CORAL, stroke_width=2.5)
        warp_l = T("one warp", 14, CORAL).next_to(warp0, UP, buff=0.27)
        self.say("threadIdx.x varies fastest, so a warp is 32 adjacent rows of one chunk.")
        self.play(Create(warp0), FadeIn(warp_l), run_time=0.7)
        self.wait(0.6)

        # Current column j in every chunk.
        bars = VGroup(*[Rectangle(width=cw, height=band_h, fill_color=CORAL, fill_opacity=0.55,
                                  stroke_color=CORAL, stroke_width=1.5).move_to(
            [chunk_x(t) - chunk_w / 2 + cw / 2, top - band_h / 2, 0]) for t in range(SPL)])
        xbars = VGroup(*[Rectangle(width=cw, height=0.15, fill_color=CORAL, fill_opacity=0.7, stroke_width=0).move_to(
            [chunk_x(t) - chunk_w / 2 + cw / 2, top + 0.2, 0]) for t in range(SPL)])
        self.play(FadeIn(bars), FadeIn(xbars), FadeOut(warp_l), run_time=0.5)

        # Zoom: one warp's load at step j is 32 contiguous floats.
        lw = 0.165
        lanes = VGroup(*[cell(lw, 0.3, CORAL_FILL) for _ in range(ROWS)]).arrange(RIGHT, buff=0)
        lanes.move_to([-3.3, -1.75, 0])
        lane0 = T("lane 0", 13, MUTED).next_to(lanes[0], DOWN, buff=0.06)
        lane31 = T("lane 31", 13, MUTED).next_to(lanes[-1], DOWN, buff=0.06)
        seg = Brace(lanes, DOWN, buff=0.28, color=CORAL)
        seg_l = T("A[base + lane + j*ld]: 32 contiguous floats, one 128-byte segment", 14, INK).next_to(seg, DOWN,
                                                                                                       buff=0.04)
        zoom = VGroup(DashedLine(bars[0].get_bottom(), lanes.get_corner(UL), color=CORAL, stroke_width=1.2,
                                 dash_length=0.06),
                      DashedLine(bars[0].get_bottom(), lanes.get_corner(UR), color=CORAL, stroke_width=1.2,
                                 dash_length=0.06))
        self.say("Each step, a warp reads one column: contiguous in column-major storage.")
        self.play(Create(zoom), FadeIn(lanes), FadeIn(lane0), FadeIn(lane31), run_time=0.8)
        self.play(GrowFromCenter(seg), FadeIn(seg_l), run_time=0.6)

        xj = cell(0.55, 0.3, TEAL_FILL).move_to([-3.3, -0.95, 0])
        xj_t = code("x[j]", 13).move_to(xj)
        fan = VGroup(*[Line(xj.get_bottom(), lanes[i].get_top(), stroke_width=0.8, color=TEAL)
                       for i in range(0, ROWS, 3)] + [Line(xj.get_bottom(), lanes[-1].get_top(), stroke_width=0.8,
                                                           color=TEAL)])
        bc_l = T("same address for every lane: one broadcast", 14, TEAL).next_to(xj, RIGHT, buff=0.2)
        self.say("All 32 lanes need the same x[j], served as a single broadcast.")
        self.play(FadeIn(xj), FadeIn(xj_t), Create(fan), FadeIn(bc_l), run_time=0.8)
        self.wait(0.5)

        # Contrast: a warp walking along one row.
        alt_t = T("If a warp walked along a row instead:", 15, MUTED).move_to([3.95, -0.95, 0])
        scat = VGroup()
        for i in range(8):
            scat.add(cell(0.13, 0.3, RED_FILL).move_to([1.55 + i * 0.68, -1.75, 0]))
        dots = T("...", 16, MUTED).next_to(scat, RIGHT, buff=0.08)
        gaps = VGroup(*[T("ld", 11, MUTED).move_to((scat[i].get_center() + scat[i + 1].get_center()) / 2 + 0.25 * UP)
                        for i in range(7)])
        alt_l = T("addresses 4096 floats apart: 32 separate segments", 14, RED).move_to([3.95, -2.45, 0])
        self.say("Walking along a row instead would touch 32 separate memory segments.")
        self.play(FadeIn(alt_t), LaggedStart(*[FadeIn(s) for s in scat], lag_ratio=0.08), FadeIn(dots),
                  FadeIn(gaps), FadeIn(alt_l), run_time=1.0)
        self.wait(0.8)

        # All 16 warps sweep their chunks in parallel.
        steps = VGroup(T("step j = c0 +", 16, MUTED), T("0", 18, INK)).arrange(RIGHT, buff=0.12)
        steps.move_to([3.75, 2.2, 0])
        self.say("All 16 warps sweep their own 256-column chunks in parallel.")
        self.play(FadeIn(steps), run_time=0.3)
        for k in range(1, SHOWN):
            lab = T(str(k), 18, INK).move_to(steps[1], aligned_edge=LEFT)
            self.play(bars.animate.shift(cw * RIGHT), xbars.animate.shift(cw * RIGHT), Transform(steps[1], lab),
                      run_time=0.45)
        lab = T("255", 18, INK).move_to(steps[1], aligned_edge=LEFT)
        self.play(Transform(steps[1], lab), FadeOut(bars), FadeOut(xbars), run_time=0.45)

        self.play(FadeOut(VGroup(zoom, lanes, lane0, lane31, seg, seg_l, xj, xj_t, fan, bc_l, alt_t, scat, dots,
                                 gaps, alt_l, steps, warp0)), run_time=0.6)

        # Partials into shared memory.
        pw, ph = 0.165, 0.12
        part = grid(SPL, ROWS, pw, ph, PAPER, sw=0.8).move_to([3.95, top - SPL * ph / 2, 0])
        part_l = code("__shared__ partial[16][32]", 14).next_to(part, UP, buff=0.12)
        ty0 = T("ty 0", 12, MUTED).next_to(part[0], LEFT, buff=0.08)
        ty15 = T("ty 15", 12, MUTED).next_to(part[-1], LEFT, buff=0.08)
        tx_l = T("tx = row within the band", 13, MUTED).next_to(part, DOWN, buff=0.08)
        self.say("Each thread stores its partial sum, then the block synchronizes.")
        self.play(FadeIn(part), FadeIn(part_l), FadeIn(ty0), FadeIn(ty15), FadeIn(tx_l), run_time=0.6)
        fills = []
        for t in range(SPL):
            ghost = chunks[t][0].copy().set_fill(TEAL_FILL, 0.9)
            fills.append(ReplacementTransform(ghost, part[t].copy().set_fill(TEAL_FILL, 1).set_stroke(LINE, 0.8)))
        self.play(LaggedStart(*fills, lag_ratio=0.05), run_time=1.4)
        sync = DashedLine(part.get_corner(DL) + 0.25 * DOWN + 0.1 * LEFT, part.get_corner(DR) + 0.25 * DOWN + 0.1 * RIGHT,
                          color=GOLD, dash_length=0.08, stroke_width=2.5)
        sync_l = code("__syncthreads()", 13, GOLD).next_to(sync, RIGHT, buff=0.08)
        self.play(FadeOut(tx_l), Create(sync), run_time=0.5)
        sync_l.next_to(sync, DOWN, buff=0.05).align_to(sync, RIGHT)
        self.play(FadeIn(sync_l), run_time=0.3)

        # Warp 0 (threadIdx.y == 0) combines the partials and writes y.
        ys = VGroup(*[cell(pw, 0.24, PAPER, sw=0.8) for _ in range(ROWS)]).arrange(RIGHT, buff=0)
        ys.next_to(sync, DOWN, buff=0.45).align_to(part, LEFT)
        ys_l = T("y", 16, INK, slant=ITALIC).next_to(ys, LEFT, buff=0.12)
        rule = code("if (threadIdx.y == 0)\n  sum = partial[0][tx] + ... + partial[15][tx]\n"
                    "  y[i] = alpha*sum + (beta == 0 ? 0 : beta*y[i])", 13, MUTED)
        rule.next_to(ys, DOWN, buff=0.2).align_to(part, LEFT)
        self.say("Warp 0 adds each row's 16 partials and writes one y value per row.")
        self.play(FadeIn(ys), FadeIn(ys_l), FadeIn(rule), run_time=0.6)
        scan = Rectangle(width=part.width, height=ph, fill_color=GOLD, fill_opacity=0.45, stroke_width=0)
        scan.move_to(part[0])
        self.add(scan)
        self.play(scan.animate.move_to(part[-1]), run_time=1.2, rate_func=linear)
        self.play(FadeOut(scan), *[ys[i].animate.set_fill(CORAL_FILL) for i in range(ROWS)], run_time=0.5)

        # Launch geometry and result.
        mini, _ = sm_grid(3, 8, 0.36, 0.26, 0.07, label_size=0)
        mini.move_to([-4.95, -1.55, 0])
        for b in mini:
            b.set_fill(TEAL_FILL, 1).set_stroke(TEAL, 1.4)
        mini_l = T("grid = 4096 / 32 = 128 blocks\nof 512 threads over 24 SMs", 15, INK).next_to(mini, DOWN, buff=0.12)
        chain = VGroup(T("per-thread chain", 15, MUTED),
                       VGroup(T("256", 28, TEAL), T("multiply-adds, was 8,192", 15, MUTED)).arrange(RIGHT, buff=0.12,
                                                                                                 aligned_edge=DOWN)
                       ).arrange(DOWN, buff=0.05, aligned_edge=LEFT).move_to([-1.3, -1.35, 0])
        timing = VGroup(T("kernel time", 15, MUTED), M(r"428.03\,\mu\mathrm{s}\ \rightarrow\ 277.50\,\mu\mathrm{s}", 28),
                        T("cuBLAS, same session: 280.0 µs", 15, MUTED)).arrange(DOWN, buff=0.06, aligned_edge=LEFT)
        timing.next_to(chain, DOWN, buff=0.25, aligned_edge=LEFT)
        self.say("All 24 SMs get blocks, and each thread's chain is 32 times shorter.")
        self.play(FadeOut(ty_cap), LaggedStart(*[FadeIn(b) for b in mini], lag_ratio=0.02), FadeIn(mini_l),
                  run_time=0.9)
        self.play(FadeIn(chain, shift=0.1 * UP), run_time=0.6)
        self.play(FadeIn(timing, shift=0.1 * UP), run_time=0.6)
        self.say("The custom kernel now runs about as fast as cuBLAS on this problem.")
        self.finish(3.0)
