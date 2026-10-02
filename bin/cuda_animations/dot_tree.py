"""DOT 3 (contiguous active threads), DOT 4 (sequential addressing) and DOT 6 (warp shuffles).

Every count shown on screen is computed here from the kernels' own indexing.
"""
from style import *

SCENES = [
    ("dot-divergence", "Divergence"),
    ("dot-bank-conflicts", "BankConflicts"),
    ("dot-warp-shuffle", "WarpShuffle"),
]

BLOCK = 256
WARP = 32
BANKS = 32
STRIDES_UP = [1 << k for k in range(8)]  # 1, 2, 4, ..., 128


def interleaved_active(s):
    """Earlier tree: thread tid adds when tid is a multiple of 2s."""
    return {t for t in range(BLOCK) if t % (2 * s) == 0}


def reindexed_active(s):
    """Committed tree: index = 2*s*tid, add when index < blockDim."""
    return {t for t in range(BLOCK) if 2 * s * t < BLOCK}


def warps_of(active):
    return sorted({t // WARP for t in active})


def conflict_degree(addresses):
    """Distinct words per bank; the busiest bank sets the replay count."""
    per_bank = {}
    for a in addresses:
        per_bank.setdefault(a % BANKS, set()).add(a)
    return max(len(v) for v in per_bank.values()), {b: len(v) for b, v in per_bank.items()}


class Divergence(CudaScene):
    title = "DOT 3: keep the active threads together"
    subtitle = "one 256-thread block, 8 warps of 32 lanes"

    def construct(self):
        self.intro()
        w, h = 0.165, 0.2
        lefts = [-5.95, 0.8]
        names = ["interleaved: tid % (2s) == 0", "reindexed: 2*s*tid < blockDim"]
        rules = [interleaved_active, reindexed_active]
        codes = ["if (tid % (2*s) == 0)\n  sdata[tid] += sdata[tid + s];",
                 "index = 2*s*tid;\nif (index < blockDim.x)\n  sdata[index] += sdata[index + s];"]
        top = 1.75

        panels = []
        for p in range(2):
            g = VGroup()
            for wp in range(8):
                row = VGroup(*[cell(w, h, IDLE, sw=0.6) for _ in range(WARP)]).arrange(RIGHT, buff=0)
                row.move_to([lefts[p] + w * WARP / 2, top - (wp + 0.5) * (h + 0.04), 0])
                g.add(row)
            wl = VGroup(*[T(f"warp {wp}", 12, MUTED).next_to(g[wp], LEFT, buff=0.1) for wp in range(8)])
            head = code(names[p], 15, INK).next_to(g, UP, buff=0.22)
            cd = code(codes[p], 13, MUTED).next_to(g, DOWN, buff=0.2)
            panels.append(dict(grid=g, wl=wl, head=head, code=cd))
        self.say("Both trees do the same additions. Only the threads doing them differ.")
        self.play(*[FadeIn(VGroup(pn["grid"], pn["wl"], pn["head"], pn["code"])) for pn in panels], run_time=0.9)

        stage = T("s = 1", 26, INK).move_to([0.42, -1.25, 0])
        counter_y = -1.95
        stats = []
        for p in range(2):
            lab = T("warps issuing the add", 15, MUTED)
            lab.move_to([lefts[p], counter_y + 0.25, 0], aligned_edge=LEFT)
            stats.append(dict(lab=lab, seq=VGroup(), total=None, per=None))
        self.play(FadeIn(stage), *[FadeIn(st["lab"]) for st in stats], run_time=0.5)
        self.say("Each square is a thread. Teal threads add at this stride.")

        totals = [0, 0]
        for k, s in enumerate(STRIDES_UP):
            anims = [Transform(stage, T(f"s = {s}", 26, INK).move_to(stage))]
            for p in range(2):
                act = rules[p](s)
                live_w = warps_of(act)
                g = panels[p]["grid"]
                for t in range(BLOCK):
                    c = g[t // WARP][t % WARP]
                    anims.append(c.animate.set_fill(TEAL if t in act else (IDLE if (t // WARP) not in live_w else CORAL_FILL)))
                for wp in range(8):
                    anims.append(panels[p]["wl"][wp].animate.set_color(INK if wp in live_w else LINE))
                totals[p] += len(live_w)
                n = T(str(len(live_w)), 20, CORAL if p == 0 else TEAL)
                st = stats[p]
                n.move_to([lefts[p] + 0.18 + 0.5 * k, counter_y - 0.1, 0])
                st["seq"].add(n)
                anims.append(FadeIn(n, shift=0.1 * UP))
                tot = T(f"= {totals[p]}", 20, INK).move_to([lefts[p] + 0.45 + 0.5 * 8, counter_y - 0.1, 0], aligned_edge=LEFT)
                if st["total"] is None:
                    st["total"] = tot
                    anims.append(FadeIn(tot))
                else:
                    anims.append(Transform(st["total"], tot))
            self.play(*anims, run_time=0.55)
            if k == 0:
                self.say("Interleaved: every warp still issues, half its lanes idle (coral).")
                self.wait(1.4)
            elif k == 1:
                self.say("Reindexed: active threads pack into low warps; whole warps drop out.")
                self.wait(1.2)
            else:
                self.wait(0.55)

        self.say("Late stages still idle some lanes, but far fewer warps issue the add.")
        self.wait(1.4)
        res = VGroup(T("kernel time", 16, MUTED),
                     M(r"1{,}560\,\mu\mathrm{s}\ \rightarrow\ 979.78\,\mu\mathrm{s}", 30)).arrange(RIGHT, buff=0.3)
        res.move_to([0.42, -2.65, 0])
        self.say(f"Warp-steps over 8 stages: {totals[0]} interleaved versus {totals[1]} reindexed.")
        self.play(FadeIn(res, shift=0.1 * UP), run_time=0.7)
        self.finish(3.0)


class BankConflicts(CudaScene):
    title = "DOT 4: sequential addressing avoids bank conflicts"
    subtitle = "warp 0 reading shared memory: 32 banks, bank = word index % 32"

    def construct(self):
        self.intro()
        w = 0.355
        rh = 0.25
        x0 = -5.68
        colx = [x0 + w * (b + 0.5) for b in range(BANKS)]

        lanes = VGroup(*[cell(w, 0.3, BLUE_FILL, sw=0.8).move_to([colx[t], 2.2, 0]) for t in range(WARP)])
        lane_n = VGroup(*[T(str(t), 10, INK).move_to(lanes[t]) for t in range(WARP)])
        lane_l = T("lane", 14, MUTED).next_to(lanes, LEFT, buff=0.12)

        bank_n = VGroup(*[T(str(b), 10, MUTED).move_to([colx[b], 1.62, 0]) for b in range(BANKS)])
        bank_l = T("bank", 14, MUTED).next_to(bank_n, LEFT, buff=0.12).align_to(lane_l, RIGHT)
        words = VGroup()
        for r in range(BLOCK // BANKS):
            for b in range(BANKS):
                words.add(cell(w, rh, PAPER, sw=0.6).move_to([colx[b], 1.36 - r * rh, 0]))
        row_l = VGroup(*[T(f"sdata[{r * BANKS}]", 11, MUTED).next_to(words[r * BANKS], LEFT, buff=0.1)
                         for r in range(BLOCK // BANKS)])
        hits_y = 1.36 - 8 * rh - 0.22
        hits = VGroup(*[cell(w, 0.3, PAPER, sw=0.8).move_to([colx[b], hits_y, 0]) for b in range(BANKS)])
        hits_l = T("hits", 14, MUTED).next_to(hits, LEFT, buff=0.12).align_to(lane_l, RIGHT)

        self.play(FadeIn(VGroup(lanes, lane_l, bank_n, bank_l, words, row_l, hits, hits_l)), run_time=0.8)
        self.play(FadeIn(lane_n), run_time=0.3)
        self.say("Lanes reading different words in the same bank must take turns.")
        self.wait(1.2)

        status = None
        code_line = None
        hit_vals = VGroup()
        links = VGroup()

        def show(addr_of_lane, label, codetext, color):
            nonlocal hit_vals, links, status, code_line
            active = [t for t in range(WARP) if addr_of_lane(t) is not None]
            addrs = [addr_of_lane(t) for t in active]
            degree, per_bank = conflict_degree(addrs)
            anims = [FadeOut(hit_vals), FadeOut(links)]
            anims += [w_.animate.set_fill(PAPER) for w_ in words]
            anims += [lanes[t].animate.set_fill(BLUE_FILL if t in active else IDLE) for t in range(WARP)]
            self.play(*anims, run_time=0.35)
            new_links = VGroup(*[Line(lanes[t].get_bottom(), words[a].get_center(), color=color,
                                      stroke_width=1.1, stroke_opacity=0.7) for t, a in zip(active, addrs)])
            new_hits = VGroup()
            hit_anims = []
            for b in range(BANKS):
                n = per_bank.get(b, 0)
                fill = PAPER if n == 0 else (TEAL_FILL if n == 1 else RED_FILL)
                hit_anims.append(hits[b].animate.set_fill(fill))
                if n:
                    new_hits.add(T(str(n), 12, RED if n > 1 else TEAL).move_to(hits[b]))
            way = "conflict-free: one access per bank" if degree == 1 else f"{degree}-way conflict: {degree} serialized accesses"
            new_status = T(f"{label}:  {way}", 20, RED if degree > 1 else TEAL).move_to([0, -1.45, 0])
            new_code = code(codetext, 14, MUTED).move_to([0, -1.95, 0])
            swap = [FadeIn(new_status), FadeIn(new_code)]
            if status is not None:
                swap += [FadeOut(status), FadeOut(code_line)]
            self.play(Create(new_links), *[words[a].animate.set_fill(GOLD_FILL) for a in addrs], *swap, run_time=0.9)
            status, code_line = new_status, new_code
            self.play(*hit_anims, FadeIn(new_hits), run_time=0.5)
            hit_vals, links = new_hits, new_links
            return degree

        self.say("Reindexed tree: lane t reads sdata[2*s*t]; the stride keeps doubling.")
        for s in [1, 2, 4, 8]:
            show(lambda t, s=s: 2 * s * t if 2 * s * t < BLOCK else None,
                 f"reindexed, s = {s}", f"index = 2*s*tid = {2 * s}*tid;  sdata[index] += sdata[index + s];", CORAL)
            self.wait(1.0 if s > 1 else 1.6)

        self.say("Sequential addressing: lane t reads sdata[t] and sdata[t + s].")
        for s in [128, 64, 16]:
            show(lambda t, s=s: t + s if t < s else None,
                 f"sequential, s = {s}", f"if (tid < {s})  sdata[tid] += sdata[tid + {s}];   (read shown: sdata[tid + {s}])", TEAL)
            self.wait(1.2)

        res = VGroup(T("kernel time", 16, MUTED),
                     M(r"979.78\,\mu\mathrm{s}\ \rightarrow\ 933.98\,\mu\mathrm{s}", 30)).arrange(RIGHT, buff=0.3)
        res.move_to([0, -2.6, 0])
        self.say("Same sums, conflict-free access: a real but modest 1.05 times gain.")
        self.play(FadeIn(res, shift=0.1 * UP), run_time=0.7)
        self.finish(3.0)


def lane_values(warp):
    """Small, deterministic register values for each lane of a warp."""
    return [(7 * (warp * WARP + i) + 3) % 9 + 1 for i in range(WARP)]


def shfl_down(vals, delta):
    """One __shfl_down_sync step: lanes past the end read their own value."""
    return [vals[i] + (vals[i + delta] if i + delta < WARP else vals[i]) for i in range(WARP)]


class WarpShuffle(CudaScene):
    title = "DOT 6: reduce each warp in registers"
    subtitle = "five register shuffles per warp, then a shared stage of 8 words"

    def lane_row(self, y, vals, keep, w, x0, size=13):
        cs = VGroup(*[cell(w, 0.36, TEAL_FILL if i < keep else IDLE, sw=0.7).move_to([x0 + w * (i + 0.5), y, 0])
                      for i in range(WARP)])
        vs = VGroup(*[T(str(vals[i]), size, INK if i < keep else LINE).move_to(cs[i]) for i in range(WARP)])
        return cs, vs

    def construct(self):
        self.intro()
        w, x0 = 0.37, -5.75
        v = lane_values(0)
        lane_n = VGroup(*[T(str(i), 10, MUTED).move_to([x0 + w * (i + 0.5), 2.42, 0]) for i in range(WARP)])
        lane_l = T("lane", 13, MUTED).next_to(lane_n, LEFT, buff=0.15)
        ys = [2.08 - 0.6 * r for r in range(6)]
        c0, v0 = self.lane_row(ys[0], v, WARP, w, x0)
        r0l = code("sum", 13, MUTED).next_to(c0, LEFT, buff=0.15)
        self.play(FadeIn(lane_n), FadeIn(lane_l), FadeIn(c0), FadeIn(r0l), run_time=0.6)
        self.play(FadeIn(v0), run_time=0.4)
        self.say(f"After its loop, each lane of warp 0 holds a sum; together {sum(v)}.")
        self.wait(1.0)

        self.say("Shuffles read other lanes' registers: no shared memory, no barrier.")
        prev_c, prev_v, vals = c0, v0, v
        keep_prev = WARP
        for r, delta in enumerate([16, 8, 4, 2, 1]):
            nv = shfl_down(vals, delta)
            cs, vs = self.lane_row(ys[r + 1], nv, delta, w, x0)
            lab = code(f"+{delta}", 13, MUTED).next_to(cs, LEFT, buff=0.15)
            arrows = VGroup()
            for i in range(delta):
                arrows.add(Line(prev_c[i + delta].get_bottom(), cs[i].get_top(), color=BLUE, stroke_width=1.3))
                arrows.add(Line(prev_c[i].get_bottom(), cs[i].get_top(), color=TEAL, stroke_width=1.3))
            self.play(FadeIn(cs), FadeIn(lab), Create(arrows), run_time=0.7 if r < 2 else 0.5)
            self.play(FadeIn(vs), run_time=0.4)
            if r == 0:
                self.say("Upper lanes execute too, but their sums never reach lane 0 (gray).")
                self.wait(1.8)
            else:
                self.wait(0.35)
            prev_c, prev_v, vals = cs, vs, nv
        warp0 = vals[0]
        assert warp0 == sum(v)
        ring = SurroundingRectangle(prev_c[0], color=CORAL, buff=0.03, stroke_width=3)
        self.play(Create(ring), run_time=0.4)
        self.say(f"After five shuffles lane 0 holds the warp total, {warp0}.")
        self.wait(1.2)

        keep = VGroup(prev_c[0].copy(), prev_v[0].copy())
        self.play(*[FadeOut(m) for m in self.mobjects if m not in (self.header, self._caption, ring)],
                  FadeIn(keep), run_time=0.6)
        self.remove(ring)

        # Block stage: 8 warps, one shared slot per warp.
        sums = [sum(lane_values(wp)) for wp in range(8)]
        block_total = sum(sums)
        wbox = VGroup()
        for wp in range(8):
            b = RoundedRectangle(width=1.25, height=0.62, corner_radius=0.08, fill_color=PAPER, fill_opacity=1,
                                 stroke_color=BLUE, stroke_width=1.6).move_to([-5.0 + 1.43 * wp, 2.0, 0])
            l = T(f"warp {wp}, lane 0", 11, MUTED).next_to(b, UP, buff=0.05)
            val = T(str(sums[wp]), 18).move_to(b)
            wbox.add(VGroup(b, l, val))
        self.play(ReplacementTransform(keep, wbox[0][2]), FadeIn(VGroup(*[wb[:2] for wb in wbox]), VGroup(*[wb[2] for wb in wbox[1:]])),
                  run_time=0.8)
        self.add(wbox)

        old = VGroup(*[Rectangle(width=11.44 / 256, height=0.3, fill_color=IDLE, fill_opacity=1, stroke_width=0.3,
                                 stroke_color=LINE) for _ in range(256)]).arrange(RIGHT, buff=0).move_to([0.72, 0.85, 0])
        old_l = T("before: sdata[256], one word per thread", 14, MUTED).next_to(old, DOWN, buff=0.08)
        sh = VGroup(*[cell(1.25, 0.5, TEAL_FILL).move_to([-5.0 + 1.43 * wp, 0.85, 0]) for wp in range(8)])
        sh_l = code("sdata[warp]", 14).next_to(sh, LEFT, buff=0.15)
        self.say("Lane 0 of each warp writes one word: 8 shared words instead of 256.")
        self.play(FadeIn(old), FadeIn(old_l), run_time=0.5)
        self.wait(0.6)
        self.play(ReplacementTransform(old, sh), FadeOut(old_l), FadeIn(sh_l), run_time=0.9)
        sh_v = VGroup(*[T(str(sums[wp]), 17).move_to(sh[wp]) for wp in range(8)])
        self.play(*[TransformFromCopy(wbox[wp][2], sh_v[wp]) for wp in range(8)], run_time=0.8)
        bar = DashedLine([-6.0, 0.4, 0], [6.4, 0.4, 0], color=GOLD, dash_length=0.08, stroke_width=2.5)
        bar_l = code("__syncthreads();", 13, GOLD).next_to(bar, DOWN, buff=0.06).align_to(bar, RIGHT)
        self.play(Create(bar), FadeIn(bar_l), run_time=0.5)

        # Warp 0 reloads: lanes 0..7 get sdata, the rest 0.
        w2 = 0.37
        lv = [sums[i] if i < 8 else 0 for i in range(WARP)]
        lc = VGroup(*[cell(w2, 0.36, TEAL_FILL if i < 8 else IDLE, sw=0.7).move_to([x0 + w2 * (i + 0.5), -0.3, 0])
                      for i in range(WARP)])
        lvt = VGroup(*[T(str(lv[i]), 9 if lv[i] > 999 else (11 if lv[i] > 99 else 13), INK if i < 8 else MUTED).move_to(lc[i]) for i in range(WARP)])
        ll = code("warp 0", 13, MUTED).next_to(lc, LEFT, buff=0.15)
        lcode = code("sum = lane < 8 ? sdata[lane] : 0;", 13, MUTED).next_to(lc, DOWN, buff=0.12).align_to(lc, LEFT)
        self.say("After the barrier, warp 0 loads the 8 partials and shuffles again.")
        self.play(FadeIn(lc), FadeIn(ll), FadeIn(lcode), run_time=0.5)
        self.play(*[TransformFromCopy(sh_v[i], lvt[i]) for i in range(8)], FadeIn(lvt[8:]), run_time=0.8)

        vals = lv
        for delta in [16, 8, 4, 2, 1]:
            vals = shfl_down(vals, delta)
            anims = []
            for i in range(WARP):
                if i < delta:
                    anims.append(Transform(lvt[i], T(str(vals[i]), 9 if vals[i] > 999 else (11 if vals[i] > 99 else 13), INK).move_to(lc[i])))
                else:
                    anims.append(lc[i].animate.set_fill(IDLE))
                    anims.append(lvt[i].animate.set_color(LINE))
            dl = code(f"shfl_down {delta}", 13, BLUE).next_to(lc, RIGHT, buff=0.1).shift(0.0 * UP)
            self.play(*anims, FadeIn(dl), run_time=0.45)
            self.play(FadeOut(dl), run_time=0.15)
        assert vals[0] == block_total

        res = cell(1.4, 0.5, CORAL_FILL).move_to([x0 + 0.7, -1.75, 0])
        res_v = T(f"+{block_total}", 18).move_to(res)
        res_l = code("if (lane == 0) atomicAdd(result, sum);", 14, MUTED).next_to(res, RIGHT, buff=0.3)
        at = arrow(lc[0].get_bottom() + 0.35 * DOWN, res.get_top(), color=CORAL, sw=2.5, tip=0.12, buff=0.02)
        self.say(f"Lane 0 adds the block total, {block_total}, with one atomic.")
        self.play(GrowArrow(at), FadeIn(res), FadeIn(res_l), run_time=0.6)
        self.play(TransformFromCopy(lvt[0], res_v), run_time=0.6)

        stat = VGroup(T("kernel time", 16, MUTED),
                      M(r"566.24\,\mu\mathrm{s}\ \rightarrow\ 543.55\,\mu\mathrm{s}", 28),
                      T("memory throughput 97.38% of peak", 16, MUTED)).arrange(RIGHT, buff=0.3)
        stat.move_to([0.4, -2.55, 0])
        self.say("Input bandwidth was already near its ceiling, so the gain is small.")
        self.play(FadeIn(stat, shift=0.1 * UP), run_time=0.6)
        self.finish(3.0)
