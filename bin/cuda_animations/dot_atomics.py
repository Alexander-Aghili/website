"""DOT 0 (per-element atomics) and DOT 2 (block reduction, one atomic per block)."""
from style import *

SCENES = [
    ("dot-atomic-contention", "AtomicContention"),
    ("reduction-tree", "ReductionTree"),
]

X = [3, 1, 4, 1, 5, 9, 2, 6]
Y = [2, 7, 1, 8, 2, 8, 1, 8]
P = [a * b for a, b in zip(X, Y)]  # 6 7 4 8 10 72 2 48, sum 157
LANE_COLORS = [BLUE, TEAL, CORAL, GOLD, BLUE, TEAL, CORAL, GOLD]


def vector_row(label, values, fill, w=0.62):
    cells = VGroup(*[cell(w, 0.5, fill) for _ in values]).arrange(RIGHT, buff=0)
    nums = VGroup(*[valued(c, v, 20) for c, v in zip(cells, values)])
    name = T(label, 24, INK, slant=ITALIC).next_to(cells, LEFT, buff=0.25)
    return VGroup(cells, nums, name)


class AtomicContention(CudaScene):
    title = "DOT 0: every product updates one address"
    subtitle = "atomicAdd(result, x[i] * y[i]) for all i"

    def construct(self):
        self.intro()
        x = vector_row("x", X, BLUE_FILL).move_to([-3.4, 2.05, 0])
        y = vector_row("y", Y, TEAL_FILL).next_to(x, DOWN, buff=0.12, aligned_edge=RIGHT)
        self.play(FadeIn(x), FadeIn(y), run_time=0.8)
        self.say("Eight threads each multiply one pair. The multiplications are independent.")

        threads = VGroup()
        for i, c in enumerate(y[0]):
            box = RoundedRectangle(width=0.58, height=0.78, corner_radius=0.08, fill_color=PAPER,
                                   fill_opacity=1, stroke_color=LANE_COLORS[i], stroke_width=2.2)
            box.next_to(c, DOWN, buff=0.55)
            lab = T(f"t{i}", 15, MUTED).next_to(box, UP, buff=0.04)
            threads.add(VGroup(box, lab))
        products = VGroup(*[valued(t[0], p, 20) for t, p in zip(threads, P)])
        self.play(LaggedStart(*[FadeIn(t, shift=0.1 * DOWN) for t in threads], lag_ratio=0.05), run_time=0.7)
        self.play(*[TransformFromCopy(VGroup(x[1][i], y[1][i]), products[i]) for i in range(8)], run_time=1.1)
        self.wait(0.4)

        res_box = cell(1.3, 0.6, CORAL_FILL)
        res_box.move_to([x[0].get_center()[0], -1.2, 0])
        res_lab = code("result", 17).next_to(res_box, LEFT, buff=0.25)
        mem_lab = T("one float in global memory", 16, MUTED).next_to(res_box, RIGHT, buff=0.25)
        res_val = valued(res_box, 0, 24)
        self.play(FadeIn(VGroup(res_box, res_lab, mem_lab, res_val)), run_time=0.6)

        rays = VGroup(*[arrow(t[0].get_bottom(), res_box.get_top() + (i - 3.5) * 0.12 * RIGHT,
                              color=LANE_COLORS[i], sw=1.8, tip=0.1, buff=0.05) for i, t in enumerate(threads)])
        self.say("Every thread targets the same address, so the hardware applies the updates one at a time.")
        self.play(LaggedStart(*[GrowArrow(r) for r in rays], lag_ratio=0.06), run_time=0.9)

        # Timeline: one parallel step of arithmetic, then eight serialized updates.
        axis_y = -2.35
        t0 = -5.6
        step = 1.05
        lbl_mul = T("multiply", 17, MUTED).move_to([t0 - 0.05, axis_y + 0.42, 0], aligned_edge=LEFT)
        lbl_upd = T("atomic updates to result", 17, MUTED).move_to([t0 + step + 0.1, axis_y + 0.42, 0], aligned_edge=LEFT)
        mul_bar = VGroup(*[Rectangle(width=step - 0.08, height=0.1, fill_color=LANE_COLORS[i], fill_opacity=1,
                                     stroke_width=0).move_to([t0 + step / 2, axis_y - 0.06 + 0.12 * (i % 4) - 0.18, 0])
                           for i in range(8)])
        base = Line([t0, axis_y - 0.45, 0], [t0 + 9 * step + 0.2, axis_y - 0.45, 0], color=LINE, stroke_width=2)
        tlab = T("time", 15, MUTED).next_to(base, RIGHT, buff=0.1)
        self.play(Create(base), FadeIn(tlab), FadeIn(lbl_mul), FadeIn(mul_bar), FadeIn(lbl_upd), run_time=0.7)

        total = 0
        for i in range(8):
            total += P[i]
            seg = Rectangle(width=step - 0.08, height=0.3, fill_color=LANE_COLORS[i], fill_opacity=0.85, stroke_width=0)
            seg.move_to([t0 + step * (i + 1.5), axis_y - 0.06, 0])
            seg_l = T(f"t{i}", 13, PAPER).move_to(seg)
            new_val = valued(res_box, total, 24)
            mover = products[i].copy()
            self.play(mover.animate.move_to(res_box).set_opacity(0), rays[i].animate.set_stroke(opacity=0.15),
                      FadeIn(seg), FadeIn(seg_l), Transform(res_val, new_val),
                      run_time=0.5 if i < 2 else 0.32)
            self.remove(mover)
        self.wait(0.4)

        self.say("At n = 2²⁴ the kernel requests 16,777,216 updates to one float: 33.60 ms.")
        stat = VGroup(
            T("16,777,216", 34, CORAL),
            T("updates, one destination", 18, MUTED),
            T("33.60 ms", 34, INK),
            T("kernel time, about 4 GB/s useful input", 18, MUTED),
        ).arrange(DOWN, buff=0.12, aligned_edge=LEFT).move_to([4.5, 1.2, 0])
        stat[2].shift(0.18 * DOWN)
        stat[3].shift(0.18 * DOWN)
        self.play(FadeIn(stat, shift=0.1 * UP), run_time=0.8)
        self.finish(3.0)


class ReductionTree(CudaScene):
    title = "DOT 2: reduce inside the block, then one atomic"
    subtitle = "shown with 8 threads; the kernel uses 256 per block"

    def construct(self):
        self.intro()
        w, h = 0.66, 0.46
        left = -5.25
        xs = [left + w * (i + 0.5) for i in range(8)]
        rows_y = [2.05, 1.05, 0.05, -0.85, -1.75]

        def row(y, values, fill, labels=None):
            cs = VGroup(*[cell(w, h, fill).move_to([xs[i], y, 0]) for i in range(8)])
            vs = VGroup(*[valued(cs[i], v, 19) for i, v in enumerate(values)])
            return cs, vs

        # Registers: each thread's private sum.
        reg_c, reg_v = row(rows_y[0], P, BLUE_FILL)
        tids = VGroup(*[T(str(i), 14, MUTED).next_to(reg_c[i], UP, buff=0.06) for i in range(8)])
        tid_l = T("tid", 14, MUTED).next_to(tids, LEFT, buff=0.2)
        reg_l = code("sum", 16).next_to(reg_c, LEFT, buff=0.25)
        c_reg = code("sum += x[i] * y[i];", 15, MUTED).move_to([2.6, rows_y[0], 0], aligned_edge=LEFT)
        self.say("Each thread accumulates its own product in a register. No other thread touches it.")
        self.play(FadeIn(reg_c), FadeIn(tids), FadeIn(tid_l), FadeIn(reg_l), FadeIn(c_reg), run_time=0.7)
        self.play(LaggedStart(*[FadeIn(v, scale=0.7) for v in reg_v], lag_ratio=0.06), run_time=0.8)

        # Stage into shared memory, then barrier.
        sh_c, sh_v = row(rows_y[1], P, TEAL_FILL)
        sh_l = code("sdata", 16).next_to(sh_c, LEFT, buff=0.25)
        c_sh = code("sdata[tid] = sum;\n__syncthreads();", 15, MUTED).move_to([2.6, rows_y[1], 0], aligned_edge=LEFT)
        self.say("The block writes its partial sums to shared memory and waits at a barrier.")
        self.play(FadeIn(sh_c), FadeIn(sh_l), FadeIn(c_sh), run_time=0.4)
        self.play(*[TransformFromCopy(reg_v[i], sh_v[i]) for i in range(8)], run_time=0.8)
        bar = DashedLine([left - 0.1, rows_y[1] - 0.42, 0], [left + 8 * w + 0.1, rows_y[1] - 0.42, 0],
                         color=GOLD, dash_length=0.08, stroke_width=2.5)
        self.play(Create(bar), run_time=0.5)
        self.play(bar.animate.set_opacity(0.35), run_time=0.3)

        # Tree: sdata[index] += sdata[index + s] for index = 2*s*tid < 8.
        cur = list(P)
        prev_c, prev_v = sh_c, sh_v
        live = set(range(8))
        stage_code = code("for s = 1, 2, 4:\n  index = 2*s*tid\n  if (index < blockDim.x)\n"
                          "    sdata[index] += sdata[index+s]\n  __syncthreads()", 15, MUTED)
        stage_code.move_to([2.6, (rows_y[2] + rows_y[4]) / 2, 0], aligned_edge=LEFT)
        self.say("Each stage adds pairs in place, halving the live entries. Every stage ends at a barrier.")
        self.play(FadeIn(stage_code), run_time=0.5)
        for k, s in enumerate([1, 2, 4]):
            y = rows_y[2 + k]
            nxt = list(cur)
            pairs = [(i, i + s) for i in range(0, 8, 2 * s)]
            for a, b in pairs:
                nxt[a] = cur[a] + cur[b]
            live = {a for a, _ in pairs}
            cs = VGroup(*[cell(w, h, TEAL_FILL if i in live else IDLE).move_to([xs[i], y, 0]) for i in range(8)])
            vs = VGroup(*[valued(cs[i], nxt[i] if i in live else "", 19) for i in range(8)])
            slab = T(f"s = {s}", 16, MUTED).next_to(cs, LEFT, buff=0.25)
            arrows = VGroup()
            for a, b in pairs:
                arrows.add(arrow(prev_c[a].get_bottom(), cs[a].get_top(), color=TEAL, sw=2, tip=0.1, buff=0.04))
                arrows.add(arrow(prev_c[b].get_bottom(), cs[a].get_top(), color=TEAL, sw=2, tip=0.1, buff=0.04))
            self.play(FadeIn(cs), FadeIn(slab), LaggedStart(*[GrowArrow(a) for a in arrows], lag_ratio=0.04),
                      run_time=0.7)
            self.play(LaggedStart(*[FadeIn(vs[a], scale=0.7) for a, _ in pairs], lag_ratio=0.1), run_time=0.5)
            self.wait(0.25)
            cur, prev_c, prev_v = nxt, cs, vs

        # One atomic per block.
        res = cell(1.0, 0.5, CORAL_FILL).move_to([xs[0] + 0.17, -2.75, 0])
        res_l = code("result", 16).next_to(res, LEFT, buff=0.25)
        res_v = valued(res, "+157", 19)
        at = arrow(prev_c[0].get_bottom(), res.get_top(), color=CORAL, sw=2.5, tip=0.12, buff=0.04)
        c_at = code("if (tid == 0)\n  atomicAdd(result, sdata[0]);", 15, MUTED)
        c_at.move_to([-1.55, -2.75, 0], aligned_edge=LEFT)
        self.say("Only thread 0 touches global memory: one atomic update for the whole block.")
        self.play(GrowArrow(at), FadeIn(res), FadeIn(res_l), FadeIn(c_at), run_time=0.7)
        self.play(TransformFromCopy(prev_v[0], res_v), run_time=0.6)
        self.wait(0.5)

        # The count that changed.
        self.play(FadeOut(stage_code), FadeOut(c_sh), FadeOut(c_reg), run_time=0.4)
        cmp = VGroup(
            VGroup(T("atomics per element", 18, MUTED), T("16,777,216", 30, MUTED)).arrange(DOWN, buff=0.06, aligned_edge=LEFT),
            VGroup(T("atomics per block (256 threads)", 18, INK), T("65,536", 30, CORAL)).arrange(DOWN, buff=0.06, aligned_edge=LEFT),
            VGroup(T("kernel time", 18, INK), M(r"33.64\,\mathrm{ms}\ \rightarrow\ 1.56\,\mathrm{ms}", 34)).arrange(DOWN, buff=0.08, aligned_edge=LEFT),
        ).arrange(DOWN, buff=0.38, aligned_edge=LEFT).move_to([3.9, 0.6, 0])
        strike = Line(cmp[0][1].get_left(), cmp[0][1].get_right(), color=MUTED, stroke_width=2)
        self.say("2²⁴ products, 65,536 blocks: 256 times fewer updates to the shared answer.")
        self.play(FadeIn(cmp[0]), run_time=0.5)
        self.play(Create(strike), FadeIn(cmp[1], shift=0.1 * UP), run_time=0.7)
        self.play(FadeIn(cmp[2], shift=0.1 * UP), run_time=0.7)
        self.finish(3.2)
