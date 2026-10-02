"""GEMM 1 (shared tiles), GEMM 2/3 (register outer product), GEMM 4 (double buffering)."""
from style import *

SCENES = [
    ("gemm-tiles", "GemmTiles"),
    ("register-outer-product", "RegisterOuterProduct"),
    ("double-buffer", "DoubleBuffer"),
]


def tiled(rows, cols, unit, fill, every=1, stroke=MUTED, line=LINE, sw=1.6, lw=1.1, opacity=1.0):
    """A rows x cols matrix outline (in elements of size unit) with a line every `every` elements."""
    box = Rectangle(width=cols * unit, height=rows * unit, fill_color=fill, fill_opacity=opacity,
                    stroke_color=stroke, stroke_width=sw)
    ul = box.get_corner(UL)
    lines = VGroup()
    for c in range(every, cols, every):
        lines.add(Line(ul + RIGHT * c * unit, ul + RIGHT * c * unit + DOWN * rows * unit, color=line, stroke_width=lw))
    for r in range(every, rows, every):
        lines.add(Line(ul + DOWN * r * unit, ul + DOWN * r * unit + RIGHT * cols * unit, color=line, stroke_width=lw))
    return VGroup(box, lines)


def patch(mat, r, c, nr, nc, unit, color, opacity=0.85, stroke=None, sw=0):
    """A filled rectangle covering element rows r..r+nr and cols c..c+nc of mat."""
    ul = mat[0].get_corner(UL)
    rect = Rectangle(width=nc * unit, height=nr * unit, fill_color=color, fill_opacity=opacity,
                     stroke_color=stroke or color, stroke_width=sw)
    return rect.move_to(ul + RIGHT * (c + nc / 2) * unit + DOWN * (r + nr / 2) * unit)


def at(mat, r, c, unit):
    """Centre of element (r, c) of mat."""
    return mat[0].get_corner(UL) + RIGHT * (c + 0.5) * unit + DOWN * (r + 0.5) * unit


def code_lines(lines, size=15):
    """(indent, text) pairs as separate monospace lines, so each can be highlighted."""
    g = VGroup(*[code(t, size) for _, t in lines]).arrange(DOWN, buff=0.16, aligned_edge=LEFT)
    for m, (ind, _) in zip(g, lines):
        m.shift(RIGHT * 0.34 * ind)
    return g


def barrier_flash(scene, mob, run_time=0.5):
    box = DashedVMobject(SurroundingRectangle(mob, color=GOLD, buff=0.12, stroke_width=3), num_dashes=60)
    scene.play(Create(box), run_time=run_time)
    scene.play(FadeOut(box), run_time=0.3)


class GemmTiles(CudaScene):
    title = "GEMM 1: shared-memory tiles"
    subtitle = "one 16 × 16 thread block per 16 × 16 tile of C, one output per thread"

    def construct(self):
        self.intro()
        ts = 0.5                 # one 16 x 16 tile
        u = ts / 16              # one element
        A = tiled(64, 64, u, BLUE_FILL, every=16, sw=1.6).move_to([-4.6, -1.1, 0])
        C = tiled(64, 64, u, CORAL_FILL, every=16).move_to([-2.2, -1.1, 0])
        B = tiled(64, 64, u, TEAL_FILL, every=16).move_to([-2.2, 1.35, 0])
        for m in (A, B, C):
            m[1].set_stroke(opacity=0)
        la = T("A   (M × K)", 18).next_to(A, DOWN, buff=0.15)
        lc = T("C   (M × N)", 18).next_to(C, DOWN, buff=0.15)
        lb = T("B   (K × N)", 18).next_to(B, RIGHT, buff=0.25)
        self.play(FadeIn(A), FadeIn(B), FadeIn(C), FadeIn(la), FadeIn(lb), FadeIn(lc), run_time=0.8)

        # Naive prelude: thread (i, j) streams a row of A and a column of B from global memory.
        i, j = 22, 41
        row = Line(at(A, i, 0, u) + LEFT * u / 2, at(A, i, 63, u) + RIGHT * u / 2, color=GOLD, stroke_width=5)
        col = Line(at(B, 0, j, u) + UP * u / 2, at(B, 63, j, u) + DOWN * u / 2, color=GOLD, stroke_width=5)
        cij = Dot(at(C, i, j, u), radius=0.065, color=CORAL)
        naive = code_lines([(0, "// GEMM 0: one thread per C(i, j)"),
                            (0, "for (l = 0; l < k; l++)"),
                            (1, "sum += A(i, l) * B(l, j);   // 2 global loads")], 15)
        naive.move_to([3.85, 1.2, 0])
        self.say("GEMM 0: thread (i, j) reads a row of A and a column of B from global memory.")
        self.play(FadeIn(cij, scale=2), Create(row), Create(col), FadeIn(naive), run_time=1.0)
        lt = ValueTracker(0)
        da = always_redraw(lambda: Dot(at(A, i, lt.get_value(), u), radius=0.07, color=INK))
        db = always_redraw(lambda: Dot(at(B, lt.get_value(), j, u), radius=0.07, color=INK))
        cnt = always_redraw(lambda: T(f"global loads so far: {2 * (int(lt.get_value()) + 1)}", 18, INK)
                            .move_to([3.85, -0.1, 0]))
        self.add(da, db, cnt)
        self.play(lt.animate.set_value(63), run_time=2.4, rate_func=linear)
        self.wait(0.3)
        j2 = 10
        col2 = Line(at(B, 0, j2, u) + UP * u / 2, at(B, 63, j2, u) + DOWN * u / 2, color=GOLD, stroke_width=5)
        c2 = Dot(at(C, i, j2, u), radius=0.065, color=CORAL)
        again = T("the same row of A, requested again", 16, RED).next_to(A, UP, buff=0.12)
        self.say("Its neighbour in the same row of C requests the same row of A again.")
        self.play(FadeIn(c2, scale=2), Create(col2), row.animate.set_color(RED), FadeIn(again), run_time=0.9)
        self.wait(1.2)
        self.play(*[FadeOut(m) for m in (row, col, col2, cij, c2, da, db, cnt, naive, again)], run_time=0.6)
        self.remove(da, db, cnt)

        # Tiled kernel.
        bi, bj = 1, 2
        self.say("GEMM 1 cuts the matrices into 16 × 16 tiles. One block owns one tile of C.")
        ctile = patch(C, 16 * bi, 16 * bj, 16, 16, u, CORAL, 0.9, INK, 2)
        self.play(*[m[1].animate.set_stroke(opacity=1) for m in (A, B, C)], run_time=0.6)
        self.play(FadeIn(ctile), run_time=0.5)

        pu = 0.1                                                     # panel element size
        As = tiled(16, 16, pu, PAPER, sw=1.6, lw=0.6).move_to([2.2, -0.15, 0])
        Ct = tiled(16, 16, pu, PAPER, sw=1.6, lw=0.6).move_to([4.15, -0.15, 0])
        Bs = tiled(16, 16, pu, PAPER, sw=1.6, lw=0.6).move_to([4.15, 1.75, 0])
        l_as = T("as: A tile", 17).next_to(As, UP, buff=0.12)
        l_bs = T("bs: B tile", 17).next_to(Bs, RIGHT, buff=0.2).align_to(Bs, UP)
        l_ct = T("sum: one register\nper thread", 16, MUTED).next_to(Ct, RIGHT, buff=0.18)
        l_sh = T("as, bs: shared\nmemory", 15, MUTED).next_to(l_bs, DOWN, buff=0.08, aligned_edge=LEFT)
        acc = Rectangle(width=1.6, height=1.6, fill_color=CORAL, fill_opacity=0.0, stroke_width=0).move_to(Ct)
        self.play(FadeIn(As), FadeIn(Bs), FadeIn(Ct), FadeIn(acc), FadeIn(l_as), FadeIn(l_bs), FadeIn(l_ct),
                  FadeIn(l_sh), run_time=0.7)
        prog = code_lines([(0, "as[ty][tx] = A(ib + tx, t + ty);"),
                           (0, "bs[ty][tx] = B(t + tx, jb + ty);"),
                           (0, "__syncthreads();"),
                           (0, "for (l = 0; l < 16; l++)"),
                           (1, "sum += as[l][tx] * bs[ty][l];"),
                           (0, "__syncthreads();")], 14)
        prog.move_to([3.35, -2.05, 0])
        self.add(prog)
        self.play(FadeIn(prog), run_time=0.4)

        stage_lab = None
        hl_a = hl_b = fa = fb = None
        for s in range(4):
            fast = s > 0
            na = patch(A, 16 * bi, 16 * s, 16, 16, u, BLUE, 0.9, INK, 2)
            nb = patch(B, 16 * s, 16 * bj, 16, 16, u, TEAL, 0.9, INK, 2)
            lab = T(f"stage t = {16 * s}", 18, INK).move_to([2.2, 1.75, 0])
            if s == 0:
                self.say("Stage t: every thread loads one element of the A tile and one of the B tile.")
                self.play(FadeIn(na), FadeIn(nb), FadeIn(lab), run_time=0.6)
            else:
                self.play(ReplacementTransform(hl_a, na), ReplacementTransform(hl_b, nb),
                          ReplacementTransform(stage_lab, lab), FadeOut(fa), FadeOut(fb), run_time=0.5)
            hl_a, hl_b, stage_lab = na, nb, lab
            fa = Rectangle(width=1.6, height=1.6, fill_color=BLUE, fill_opacity=0.35, stroke_width=0).move_to(As)
            fb = Rectangle(width=1.6, height=1.6, fill_color=TEAL, fill_opacity=0.35, stroke_width=0).move_to(Bs)
            self.play(TransformFromCopy(na, fa), TransformFromCopy(nb, fb), run_time=0.5 if fast else 0.9)
            self.bring_to_front(As[1], Bs[1])
            if s == 0:
                self.say("A barrier makes sure the whole tile is staged before anyone reads it.")
            barrier_flash(self, VGroup(As, Bs, Ct), 0.3 if fast else 0.5)

            if s == 0:
                # Reuse: one A value feeds a whole row of C, one B value a whole column.
                r, l, c = 5, 3, 9
                ea = patch(As, r, l, 1, 1, pu, GOLD, 1, INK, 1.5)
                row_c = patch(Ct, r, 0, 1, 16, pu, GOLD_FILL, 1, GOLD, 2)
                ar = arrow(ea.get_right(), row_c.get_left(), color=GOLD, sw=2.5, tip=0.1, buff=0.04)
                ra_l = T("one A value,\n16 threads", 15, INK).next_to(As, LEFT, buff=0.15)
                self.say("Each staged A value is read by the 16 threads in one row of the C tile.")
                self.play(FadeIn(ea), run_time=0.3)
                self.play(GrowArrow(ar), FadeIn(row_c), FadeIn(ra_l), run_time=0.7)
                self.wait(0.8)
                eb = patch(Bs, l, c, 1, 1, pu, GOLD, 1, INK, 1.5)
                col_c = patch(Ct, 0, c, 16, 1, pu, GOLD_FILL, 1, GOLD, 2)
                ab = arrow(eb.get_bottom(), col_c.get_top(), color=GOLD, sw=2.5, tip=0.1, buff=0.04)
                rb_l = T("one B value,\n16 threads", 15, INK).move_to(ra_l)
                self.say("Each staged B value is read by the 16 threads in one column of the C tile.")
                self.play(FadeOut(VGroup(ea, row_c, ar)), Transform(ra_l, rb_l), FadeIn(eb), run_time=0.4)
                self.play(GrowArrow(ab), FadeIn(col_c), run_time=0.6)
                self.wait(0.8)
                self.play(FadeOut(VGroup(eb, col_c, ab, ra_l)), run_time=0.4)
                self.say("Then 16 multiply-add steps run entirely from shared memory.")

            lt = ValueTracker(0)
            sa = always_redraw(lambda: patch(As, 0, min(int(lt.get_value()), 15), 16, 1, pu, BLUE, 0.9, INK, 1))
            sb = always_redraw(lambda: patch(Bs, min(int(lt.get_value()), 15), 0, 1, 16, pu, TEAL, 0.9, INK, 1))
            self.add(sa, sb)
            self.play(lt.animate.set_value(15.99), acc.animate.set_fill(opacity=0.12 + 0.17 * s),
                      run_time=0.9 if fast else 1.8, rate_func=linear)
            self.remove(sa, sb)
            if s == 0:
                self.say("A second barrier keeps the tile until every thread has finished with it.")
            barrier_flash(self, VGroup(As, Bs, Ct), 0.3 if fast else 0.5)
            if s == 1:
                self.say("The A tile slides right, the B tile slides down: 128 stages at N = 2048.")

        # What the tiling bought.
        self.play(FadeOut(prog), run_time=0.4)
        stats = VGroup(
            VGroup(T("global load requests per FMA", 15, MUTED),
                   M(r"2\ \rightarrow\ 2/16 = 0.125\quad(-93.75\%)", 26)),
            VGroup(T("stage input intensity, T = 16, s = 4 bytes", 15, MUTED),
                   M(r"T/s = 4\ \mathrm{FLOP/byte}", 26)),
            VGroup(T("kernel time", 15, MUTED),
                   M(r"27.94\,\mathrm{ms}\ \rightarrow\ 21.33\,\mathrm{ms}\quad (1.31\times)", 26)),
        )
        for g in stats:
            g.arrange(DOWN, buff=0.05, aligned_edge=LEFT)
        stats.arrange(DOWN, buff=0.16, aligned_edge=LEFT).move_to([0.9, -2.15, 0], aligned_edge=LEFT)
        res = stats[2]
        stats = VGroup(stats[0], stats[1])
        self.say("Load requests fell 16 times, time only 1.31 times: caches already reused data.")
        self.play(FadeIn(stats, shift=0.1 * UP), run_time=0.7)
        self.play(FadeIn(res, shift=0.1 * UP), run_time=0.6)
        self.wait(1.4)
        self.say("Each FMA still reads two shared operands, and every stage has two barriers.")
        self.finish(3.0)


class RegisterOuterProduct(CudaScene):
    title = "GEMM 2: each thread accumulates a 4 × 4 outer product"
    subtitle = "16 × 16 threads per block, 64 × 64 outputs per block"

    def construct(self):
        self.intro()
        u = 0.06
        tx, ty = 5, 9
        Cb = tiled(64, 64, u, CORAL_FILL, every=16, line=MUTED, lw=1.4).move_to([-2.0, -1.05, 0])
        Bt = tiled(16, 64, u, TEAL_FILL, every=16, line=MUTED, lw=1.4).next_to(Cb, UP, buff=0.13)
        At = tiled(64, 16, u, BLUE_FILL, every=16, line=MUTED, lw=1.4).next_to(Cb, LEFT, buff=0.13)
        fineA = VGroup(*[Line(At[0].get_corner(UL) + RIGHT * c * u, At[0].get_corner(DL) + RIGHT * c * u,
                              color=LINE, stroke_width=0.6) for c in range(1, 16)])
        fineB = VGroup(*[Line(Bt[0].get_corner(UL) + DOWN * r * u, Bt[0].get_corner(UR) + DOWN * r * u,
                              color=LINE, stroke_width=0.6) for r in range(1, 16)])
        lA = T("as: A tile, 64 × 16", 16).rotate(PI / 2).next_to(At, LEFT, buff=0.12)
        lB = T("bs: B tile, 16 × 64", 16).next_to(Bt, UP, buff=0.1)
        lC_bg = Rectangle(width=2.75, height=0.34, fill_color=PAPER, fill_opacity=0.9, stroke_width=0)
        lC = T("C block tile, 64 × 64", 16, MUTED)
        lC_bg.move_to(at(Cb, 28.5, 32, u))
        lC.move_to(lC_bg)
        self.say("The same 16 × 16 threads now cover a 64 × 64 tile of C.")
        self.play(FadeIn(Cb), FadeIn(Bt), FadeIn(At), FadeIn(fineA), FadeIn(fineB), FadeIn(lA), FadeIn(lB),
                  FadeIn(lC_bg), FadeIn(lC), run_time=0.9)

        # The 16 outputs owned by thread (5, 9), strided by 16.
        own = VGroup(*[patch(Cb, tx + 16 * a, ty + 16 * b, 1, 1, u, GOLD, 1, INK, 1.2).scale(1.5)
                       for a in range(4) for b in range(4)])
        who = VGroup(T("thread (tx, ty) = (5, 9) owns", 17),
                     code("rows ib + tx + 16u\ncols jb + ty + 16v", 15),
                     T("u, v = 0, 1, 2, 3", 17, MUTED)).arrange(DOWN, buff=0.12, aligned_edge=LEFT)
        who.move_to([3.6, 0.6, 0])
        self.say("Thread (5, 9) owns one spot in each of the 16 sub-tiles, 16 apart.")
        self.play(LaggedStart(*[FadeIn(o, scale=2.5) for o in own], lag_ratio=0.05), FadeIn(who), run_time=1.4)
        self.wait(1.4)
        self.play(FadeOut(who), run_time=0.4)

        # Register panel.
        rc = 0.56
        acc = grid(4, 4, rc, rc, PAPER).move_to([3.75, 0.55, 0])
        rb = VGroup(*[cell(rc, rc, TEAL_FILL) for _ in range(4)]).arrange(RIGHT, buff=0).next_to(acc, UP, buff=0.14)
        ra = VGroup(*[cell(rc, rc, BLUE_FILL) for _ in range(4)]).arrange(DOWN, buff=0).next_to(acc, LEFT, buff=0.14)
        l_rb = code("rb[v] = bs[ty + 16v][l]", 14).next_to(rb, UP, buff=0.12)
        l_ra = code("ra[u] = as[l][tx + 16u]", 14).next_to(acc, DOWN, buff=0.16).align_to(ra, LEFT)
        l_acc = code("acc[u][v] +=\n  ra[u] * rb[v]", 14).next_to(acc, RIGHT, buff=0.18)
        self.play(FadeIn(acc), FadeIn(rb), FadeIn(ra), FadeIn(l_rb), FadeIn(l_ra), FadeIn(l_acc), run_time=0.7)

        acc_txt = VGroup()
        for step, l in enumerate([3, 4, 5]):
            first = step == 0
            stripA = patch(At, 0, l, 64, 1, u, BLUE, 0.35)
            stripB = patch(Bt, l, 0, 1, 64, u, TEAL, 0.35)
            ea = VGroup(*[patch(At, tx + 16 * a, l, 1, 1, u, GOLD, 1, INK, 1.2).scale(1.6) for a in range(4)])
            eb = VGroup(*[patch(Bt, l, ty + 16 * b, 1, 1, u, GOLD, 1, INK, 1.2).scale(1.6) for b in range(4)])
            if first:
                self.say(f"Step l = {l}: load four A values from one column of as, 16 rows apart.")
            self.play(FadeIn(stripA), FadeIn(stripB), FadeIn(ea), FadeIn(eb), run_time=0.5 if not first else 0.8)
            va = VGroup(*[M(f"a_{a}", 24).move_to(ra[a]) for a in range(4)])
            vb = VGroup(*[M(f"b_{b}", 24).move_to(rb[b]) for b in range(4)])
            if first:
                self.play(*[TransformFromCopy(ea[a], va[a]) for a in range(4)], run_time=0.9)
                self.say("And four B values from one row of bs, 16 columns apart, into registers.")
                self.play(*[TransformFromCopy(eb[b], vb[b]) for b in range(4)], run_time=0.9)
                self.say("Their outer product is 16 independent FMAs into 16 accumulators.")
            else:
                self.play(*[TransformFromCopy(ea[a], va[a]) for a in range(4)],
                          *[TransformFromCopy(eb[b], vb[b]) for b in range(4)], run_time=0.6)
            prods = VGroup(*[M(f"a_{a} b_{b}", 20).move_to(acc[a][b]) for a in range(4) for b in range(4)])
            flashes = VGroup(*[cell(rc, rc, GOLD_FILL).move_to(acc[a][b]) for a in range(4) for b in range(4)])
            self.add(flashes)
            self.play(LaggedStart(*[FadeIn(f) for f in flashes], lag_ratio=0.04),
                      LaggedStart(*[FadeIn(p, scale=0.6) for p in prods], lag_ratio=0.04),
                      FadeOut(acc_txt), run_time=1.4 if first else 0.7)
            self.play(flashes.animate.set_fill(CORAL_FILL, opacity=0.25 + 0.2 * step), run_time=0.3)
            acc_txt = VGroup(flashes, prods)
            if first:
                # Map one accumulator back to its place in C.
                k = 2 * 4 + 1
                link = DashedLine(acc[2][1].get_left(), own[k].get_center(), color=CORAL, stroke_width=2.5,
                                  dash_length=0.08)
                ring = Circle(radius=0.11, color=CORAL, stroke_width=3).move_to(own[k])
                note = code("acc[2][1] -> C(ib + 37, jb + 25)", 14, CORAL).next_to(l_ra, DOWN, buff=0.14)
                note.align_to(l_ra, LEFT)
                self.say("acc[2][1] lives in a register for the whole K loop, then goes to C.")
                self.play(Create(link), Create(ring), FadeIn(note), run_time=0.8)
                self.wait(1.4)
                self.play(FadeOut(link), FadeOut(ring), FadeOut(note), run_time=0.4)
                self.say("Each step repeats this with the next column of as and row of bs.")
            self.play(FadeOut(stripA), FadeOut(stripB), FadeOut(ea), FadeOut(eb), FadeOut(va), FadeOut(vb),
                      run_time=0.3)

        # Operand counts.
        tab = VGroup(
            VGroup(T("register tile", 16, MUTED), T("shared operands per FMA", 16, MUTED)),
            VGroup(T("1 × 1  (GEMM 1)", 18), M(r"2", 26)),
            VGroup(T("4 × 4  (GEMM 2)", 18), M(r"8/16 = 0.5", 26)),
            VGroup(T("8 × 8  (GEMM 3)", 18), M(r"16/64 = 0.25", 26)),
        )
        for r in tab:
            r[1].move_to([4.8, 0, 0], aligned_edge=LEFT)
            r[0].move_to([1.0, 0, 0], aligned_edge=LEFT)
        tab.arrange(DOWN, buff=0.16, aligned_edge=LEFT)
        for r in tab:
            r[0].set_x(1.0, direction=LEFT)
            r[1].set_x(3.75, direction=LEFT)
        tab.move_to([3.6, -1.95, 0])
        self.say("Shared operands per FMA fall from 2 to 0.5: four times fewer shared loads.")
        self.play(FadeIn(tab[0]), FadeIn(tab[1]), FadeIn(tab[2]), run_time=0.8)
        self.wait(1.2)
        r4 = VGroup(T("4 × 4:", 17), M(r"21.33\,\mathrm{ms}\rightarrow 6.20\,\mathrm{ms}", 26),
                    T("occupancy 100% to about 33%", 16, MUTED)).arrange(RIGHT, buff=0.2)
        r4.move_to([3.4, 2.05, 0])
        self.play(FadeOut(VGroup(rb, l_rb)), run_time=0.3)
        self.play(FadeIn(r4, shift=0.1 * UP), run_time=0.6)
        self.say("Occupancy fell, yet time fell 3.44 times: the reuse pays for the registers.")
        self.wait(1.6)
        self.play(FadeIn(tab[3]), run_time=0.6)
        r8 = VGroup(T("8 × 8:", 17), M(r"5.47\,\mathrm{ms}", 26),
                    T("128 × 128 block tile, about 170 registers", 16, MUTED)).arrange(RIGHT, buff=0.2)
        r8.next_to(r4, DOWN, buff=0.12, aligned_edge=LEFT)
        self.play(FadeOut(acc_txt), FadeOut(acc), FadeOut(ra), FadeOut(l_ra), FadeOut(l_acc), run_time=0.4)
        r8.move_to([3.6, 1.45, 0])
        occ = T("theoretical occupancy 16.7%: one block per SM", 16, MUTED).next_to(r8, DOWN, buff=0.14)
        self.play(FadeIn(r8, shift=0.1 * UP), FadeIn(occ), run_time=0.6)
        self.say("8 × 8 halves shared traffic again, but leaves only one block per SM.")
        self.finish(3.2)


class DoubleBuffer(CudaScene):
    title = "GEMM 4: prefetch the next tile while computing"
    subtitle = "two shared buffers, register prefetch, one barrier per stage"

    def construct(self):
        self.intro()
        # Global K tiles.
        tiles = VGroup(*[chip(f"tile {t}", PAPER, w=1.05, h=0.55, size=17) for t in range(4)])
        tiles.arrange(RIGHT, buff=0.15).move_to([-4.0, 1.75, 0])
        g_lab = T("global memory: the K tiles of A and B", 15, MUTED).next_to(tiles, UP, buff=0.1)
        regs = chip("", GOLD_FILL, w=2.0, h=0.6).move_to([-4.0, 0.45, 0])
        r_lab = code("pa, pb", 15).next_to(regs, LEFT, buff=0.2)
        r_sub = T("registers", 14, MUTED).next_to(r_lab, DOWN, buff=0.04)
        bufs = VGroup(*[RoundedRectangle(width=1.85, height=0.95, corner_radius=0.08, fill_color=PAPER, fill_opacity=1,
                                         stroke_color=MUTED, stroke_width=1.6) for _ in range(2)])
        bufs[0].move_to([-5.2, -0.95, 0])
        bufs[1].move_to([-2.8, -0.95, 0])
        b_names = VGroup(*[code(f"as[{b}], bs[{b}]", 13, MUTED).next_to(bufs[b], UP, buff=0.07) for b in range(2)])
        footprint = T("shared: 2 × (16 × 128 + 128 × 16) × 4 B = 32 KiB", 14, MUTED)
        footprint.move_to([-3.6, -2.4, 0])
        comp = chip("acc += 16 outer\nproduct steps", BLUE_FILL, w=1.9, h=0.95, size=15).move_to([-0.75, -0.95, 0])
        self.play(FadeIn(tiles), FadeIn(g_lab), FadeIn(regs), FadeIn(r_lab), FadeIn(r_sub), FadeIn(bufs),
                  FadeIn(b_names), FadeIn(comp), FadeIn(footprint), run_time=0.9)

        prog = code_lines([(0, "as[0], bs[0] <- tile 0"),
                           (0, "__syncthreads();"),
                           (0, "for (t = 0; t < k; t += 16) {"),
                           (1, "tn = t + 16;"),
                           (1, "if (tn < k) pa, pb <- tile t+1"),
                           (1, "16 steps on as[buf], bs[buf]"),
                           (1, "if (tn < k) {"),
                           (2, "as[buf^1], bs[buf^1] <- pa, pb"),
                           (2, "buf ^= 1;"),
                           (1, "}"),
                           (1, "__syncthreads();  // only barrier"),
                           (0, "}")], 15)
        prog.move_to([3.75, 0.0, 0]).align_to(np.array([0.85, 0, 0]), LEFT)
        hl = Rectangle(width=5.9, height=0.3, fill_color=GOLD_FILL, fill_opacity=0.8, stroke_width=0)
        hl.move_to(prog[0]).align_to(prog, LEFT).shift(LEFT * 0.1)
        self.add(hl)
        self.play(FadeIn(prog), FadeIn(hl), run_time=0.5)
        self.bring_to_front(prog)

        def point(i, rt=0.3):
            self.play(hl.animate.move_to(prog[i]).align_to(prog, LEFT).shift(LEFT * 0.1), run_time=rt)

        contents = [None, None]
        tags = [None, None]

        def content(b, t, fill):
            txt = T(f"tile {t}", 18).move_to(bufs[b])
            bg = RoundedRectangle(width=1.85, height=0.95, corner_radius=0.08, fill_color=fill, fill_opacity=1,
                                  stroke_color=MUTED, stroke_width=1.6).move_to(bufs[b])
            return VGroup(bg, txt)

        def tag(b, text, color):
            return T(text, 15, color).next_to(bufs[b], DOWN, buff=0.1)

        # Prologue.
        self.say("Prologue: the block loads tile 0 into buffer 0 and synchronizes once.")
        c0 = content(0, 0, BLUE_FILL)
        self.play(TransformFromCopy(tiles[0], c0), run_time=0.9)
        contents[0] = c0
        point(1)
        barrier_flash(self, bufs, 0.5)
        tags[0] = tag(0, "being read", BLUE)
        tags[1] = tag(1, "free", MUTED)
        self.play(FadeIn(tags[0]), FadeIn(tags[1]), run_time=0.4)

        buf = 0
        reg_val = None
        for t in range(4):
            first, last = t == 0, t == 3
            rt = 1.0 if first else 0.55
            point(2 if first else 3, 0.3)
            # (1) prefetch the next tile into registers.
            point(4)
            if not last:
                if first:
                    self.say("Each thread issues global loads for tile 1 into registers pa and pb.")
                rv = T(f"tile {t + 1}", 18).move_to(regs)
                ghost = tiles[t + 1].copy()
                self.play(ghost.animate.move_to(regs).set_opacity(0), FadeIn(rv), run_time=rt)
                self.remove(ghost)
                reg_val = rv
            else:
                self.say("On the last tile tn < k fails: nothing to prefetch, so it only computes.")
                self.wait(0.6)
            # (2) compute on the current buffer.
            point(5)
            if first:
                self.say("Without waiting on those loads, it runs 16 outer-product steps on buffer 0.")
            link = arrow(bufs[buf].get_right() if buf == 1 else bufs[buf].get_bottom(),
                         comp.get_left() if buf == 1 else comp.get_bottom(), color=BLUE, sw=3, tip=0.12)
            if buf == 0:
                link = CurvedArrow(bufs[0].get_bottom() + DOWN * 0.35, comp.get_bottom() + DOWN * 0.02,
                                   angle=PI / 3, color=BLUE, stroke_width=3, tip_length=0.12)
            self.play(Create(link), run_time=0.4 if first else 0.25)
            self.play(Indicate(comp, color=BLUE, scale_factor=1.06), run_time=1.0 if first else 0.6)
            self.play(FadeOut(link), run_time=0.2)
            # (3) store prefetched values into the other buffer, (4) flip.
            if not last:
                point(7)
                other = buf ^ 1
                if first:
                    self.say("Then it stores the prefetched values into buffer 1, which nobody is reading.")
                elif t == 1:
                    self.say("Reusing buffer 0 is safe: the last barrier proved everyone finished with it.")
                nc = content(other, t + 1, TEAL_FILL)
                self.play(FadeIn(nc[0]), *([FadeOut(contents[other])] if contents[other] else []), run_time=0.3)
                self.bring_to_front(reg_val)
                self.play(ReplacementTransform(reg_val, nc[1]), run_time=rt)
                contents[other] = nc
                point(8)
                if first:
                    self.say("Flipping buf swaps the roles of the two buffers.")
                new_tags = [tag(other, "being read", BLUE), tag(buf, "free", MUTED)]
                self.play(contents[other][0].animate.set_fill(BLUE_FILL),
                          contents[buf][0].animate.set_fill(IDLE),
                          ReplacementTransform(tags[other], new_tags[0]),
                          ReplacementTransform(tags[buf], new_tags[1]),
                          # Animating a background re-adds it on top; re-add the labels after it.
                          contents[other][1].animate.set_opacity(1),
                          contents[buf][1].animate.set_opacity(1), run_time=0.5)
                tags[other], tags[buf] = new_tags
                buf = other
            # (5) one barrier.
            point(10)
            if first:
                self.say("One barrier ends the stage, so the new buffer is complete before it is read.")
            barrier_flash(self, bufs, 0.4 if first else 0.3)
        self.wait(0.6)

        # Act 2: schematic timeline.
        self.play(*[FadeOut(m) for m in self.mobjects if m is not self.header and m is not self._caption],
                  run_time=0.6)
        x0 = -4.05
        L, S, Cp, W = 1.05, 0.14, 1.5, 0.25

        def seg(x, w, y, fill, label="", h=0.42, size=14):
            r = Rectangle(width=w, height=h, fill_color=fill, fill_opacity=1, stroke_color=PAPER, stroke_width=1.5)
            r.move_to([x + w / 2, y, 0])
            return VGroup(r, T(label, size).move_to(r)) if label else VGroup(r)

        y1, y2, y3 = 1.55, 0.25, -0.33
        lab1 = T("single buffer\n(GEMM 3)", 17).move_to([-5.45, y1, 0])
        lab2 = T("double buffer\n(GEMM 4)", 17).move_to([-5.45, y2, 0])
        lab3 = T("global loads\nin flight", 14, MUTED).move_to([-5.45, y3 - 0.05, 0])
        single = VGroup()
        x = x0
        for st in range(3):
            single.add(seg(x, L, y1, TEAL_FILL, "load" if st == 0 else ""))
            x += L
            single.add(seg(x, S, y1, GOLD))
            x += S
            single.add(seg(x, Cp, y1, BLUE_FILL, "compute"))
            x += Cp
            single.add(seg(x, S, y1, GOLD))
            x += S
        n1 = T("2 barriers per stage", 15, MUTED).next_to(single, RIGHT, buff=0.2)
        double = VGroup()
        flight = VGroup()
        x = x0
        double.add(seg(x, L, y2, TEAL_FILL, "tile 0"))
        x += L
        double.add(seg(x, S, y2, GOLD))
        x += S
        for st in range(3):
            if st < 2:
                flight.add(seg(x + 0.05, 1.1, y3, GOLD_FILL, "tile t+1" if st == 0 else "", h=0.24, size=12))
            double.add(seg(x, Cp, y2, BLUE_FILL, "compute"))
            x += Cp
            if st < 2:
                double.add(seg(x, W, y2, TEAL_FILL))
                x += W
            double.add(seg(x, S, y2, GOLD))
            x += S
        n2 = T("1 barrier per stage", 15, MUTED).next_to(double, RIGHT, buff=0.2)
        legend = VGroup(
            VGroup(cell(0.25, 0.2, TEAL_FILL, stroke=PAPER), T("fill shared memory", 14, MUTED)).arrange(RIGHT, buff=0.1),
            VGroup(cell(0.25, 0.2, BLUE_FILL, stroke=PAPER), T("outer products", 14, MUTED)).arrange(RIGHT, buff=0.1),
            VGroup(cell(0.25, 0.2, GOLD, stroke=PAPER), T("barrier", 14, MUTED)).arrange(RIGHT, buff=0.1),
        ).arrange(RIGHT, buff=0.4).move_to([0.5, 2.3, 0])
        self.say("Single buffering waits on each tile's loads, with two barriers per stage.")
        self.play(FadeIn(lab1), FadeIn(legend), run_time=0.4)
        self.play(LaggedStart(*[FadeIn(s) for s in single], lag_ratio=0.12), run_time=1.6)
        self.play(FadeIn(n1), run_time=0.3)
        self.say("Double buffering issues the next loads first, so compute can hide them.")
        self.play(FadeIn(lab2), FadeIn(lab3), run_time=0.4)
        anims = []
        for s in double:
            anims.append(FadeIn(s))
        self.play(LaggedStart(*anims, lag_ratio=0.12), LaggedStart(*[FadeIn(f) for f in flight], lag_ratio=0.5),
                  run_time=1.8)
        self.play(FadeIn(n2), run_time=0.3)
        caveat = T("Schematic order, not a measured timeline. These are ordinary register loads, not cp.async;\n"
                   "the compiler and hardware decide how much latency actually overlaps.", 15, MUTED)
        caveat.move_to([0.2, -1.05, 0])
        self.play(FadeIn(caveat), run_time=0.5)
        self.wait(1.0)

        stats = VGroup(
            VGroup(T("kernel time", 15, MUTED), M(r"5.47 \rightarrow 4.91\,\mathrm{ms}", 28)),
            VGroup(T("cycles with no eligible warp", 15, MUTED), M(r"45.65\% \rightarrow 37.67\%", 28)),
            VGroup(T("issue-slot utilization", 15, MUTED), M(r"52.7\% \rightarrow 60.4\%", 28)),
        )
        for g in stats:
            g.arrange(DOWN, buff=0.08, aligned_edge=LEFT)
        stats.arrange(RIGHT, buff=0.7, aligned_edge=UP).move_to([0.2, -2.15, 0])
        self.say("Same loads and FMAs, better scheduled: 1.11 times faster, no register spills.")
        self.play(LaggedStart(*[FadeIn(s, shift=0.1 * UP) for s in stats], lag_ratio=0.3), run_time=1.2)
        self.finish(3.2)
