// Charts and animation playback for the CUDA BLAS article.
// Bar charts restate Tables 2 to 4; line charts read the size sweep CSV.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  // ---------- shared helpers ----------
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, s, cls, anchor) {
    const t = el("text", { x, y, class: cls || "", "text-anchor": anchor || "start" }, parent);
    t.textContent = s;
    return t;
  }
  function fmt(v, digits) {
    if (v >= 1000) return Math.round(v).toLocaleString("en-US");
    if (digits !== undefined) return v.toFixed(digits);
    if (v >= 100) return v.toFixed(1);
    if (v >= 10) return v.toFixed(2);
    return v.toFixed(2);
  }
  function niceTicks(max, count) {
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let v = 0; out.length < 2 || out[out.length - 1] < max; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function logTicks(lo, hi) {
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
      }
    return out;
  }

  function tooltip(fig) {
    let tip = fig.querySelector(".cuda-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "cuda-tip";
      tip.setAttribute("role", "status");
      fig.querySelector(".cuda-chart-plot").appendChild(tip);
    }
    return {
      show(rows, title, x, y) {
        tip.replaceChildren();
        if (title) {
          const h = document.createElement("div");
          h.className = "cuda-tip-title";
          h.textContent = title;
          tip.appendChild(h);
        }
        for (const r of rows) {
          const row = document.createElement("div");
          row.className = "cuda-tip-row";
          if (r.key) {
            const k = document.createElement("span");
            k.className = "cuda-tip-key";
            k.style.background = r.key;
            row.appendChild(k);
          }
          const v = document.createElement("strong");
          v.textContent = r.value;
          row.appendChild(v);
          const n = document.createElement("span");
          n.className = "cuda-tip-name";
          n.textContent = r.name;
          row.appendChild(n);
          tip.appendChild(row);
        }
        tip.style.display = "block";
        const host = tip.parentElement.getBoundingClientRect();
        const w = tip.offsetWidth;
        const left = x + 14 + w > host.width ? x - 14 - w : x + 14;
        tip.style.left = Math.max(0, left) + "px";
        tip.style.top = Math.max(0, y - tip.offsetHeight / 2) + "px";
      },
      hide() {
        tip.style.display = "none";
      },
    };
  }

  // ---------- step-by-step bar charts (Tables 2 to 4) ----------
  const STEPS = {
    "dot-steps": {
      unit: "µs",
      log: true,
      axis: "Kernel time, µs (log scale)",
      bars: [
        ["Per-element atomics", 33600],
        ["256-thread blocks", 33640],
        ["Block reduction", 1560],
        ["Contiguous active threads", 979.78],
        ["Sequential addressing", 933.98],
        ["Two elements per thread", 566.24],
        ["Warp shuffles", 543.55],
      ],
    },
    "gemv-steps": {
      unit: "µs",
      axis: "Kernel time, µs",
      ref: [280.0, "cuBLAS 280.0 µs"],
      bars: [
        ["Eight-block baseline", 770.75],
        ["Shared-memory x", 794.3],
        ["Launch 2 × 1024", 816.77],
        ["Launch 128 × 512", 497.82],
        ["Launch 512 × 256", 428.03],
        ["Row and column split", 277.5],
      ],
    },
    "gemm-steps": {
      unit: "ms",
      axis: "Kernel time, ms",
      ref: [2.89, "cuBLAS 2.89 ms"],
      flops: 2 * Math.pow(2048, 3),
      bars: [
        ["One output per thread", 27.94],
        ["Shared-memory tiles", 21.33],
        ["4 × 4 register tiles", 6.2],
        ["8 × 8 register tiles", 5.47],
        ["Double buffering", 4.91],
      ],
    },
  };

  function barChart(fig, spec) {
    const plot = fig.querySelector(".cuda-chart-plot");
    const W = plot.clientWidth || 640;
    const narrow = W < 520;
    const labelW = narrow ? 128 : 190;
    const rowH = 30,
      barH = 16,
      top = spec.ref ? 30 : 14,
      axisH = 40,
      right = 64;
    const H = top + spec.bars.length * rowH + axisH;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
    svg.setAttribute("aria-label", fig.getAttribute("aria-label") || "");
    plot.replaceChildren(svg);
    const x0 = labelW,
      x1 = W - right;
    const vals = spec.bars.map((b) => b[1]).concat(spec.ref ? [spec.ref[0]] : []);
    let sx, ticks;
    if (spec.log) {
      const lo = 200,
        hi = 50000;
      sx = (v) => x0 + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (x1 - x0);
      ticks = logTicks(lo, hi);
      if (narrow) ticks = ticks.filter((t) => String(t)[0] !== "2");
    } else {
      const max = Math.max(...vals) * 1.04;
      ticks = niceTicks(max, narrow ? 4 : 6);
      const hi = ticks[ticks.length - 1];
      sx = (v) => x0 + (v / hi) * (x1 - x0);
    }
    const gy = top + spec.bars.length * rowH;
    const g = el("g", {}, svg);
    for (const t of ticks) {
      el("line", { x1: sx(t), x2: sx(t), y1: top - 6, y2: gy, class: "cuda-grid" }, g);
      text(g, sx(t), gy + 18, fmt(t, t < 10 ? (t % 1 ? 1 : 0) : 0), "cuda-tick", "middle");
    }
    text(g, (x0 + x1) / 2, gy + 36, spec.axis, "cuda-axis-title", "middle");
    const base = spec.log ? x0 : sx(0);
    el("line", { x1: base, x2: base, y1: top - 6, y2: gy, class: "cuda-baseline" }, g);
    const tip = tooltip(fig);
    spec.bars.forEach(([name, v], i) => {
      const y = top + i * rowH + (rowH - barH) / 2;
      const w = Math.max(2, sx(v) - base);
      const grp = el("g", { class: "cuda-bar", tabindex: 0 }, svg);
      grp.setAttribute("aria-label", `${name}: ${exact(v)} ${spec.unit}`);
      el("rect", { x: 0, y: top + i * rowH, width: W, height: rowH, class: "cuda-hit" }, grp);
      el("path", { d: roundedBar(base, y, w, barH, 4), class: "cuda-bar-mark" }, grp);
      text(grp, x0 - 10, y + barH / 2 + 4.5, name, "cuda-label", "end");
      text(grp, base + w + 6, y + barH / 2 + 4.5, exact(v), "cuda-value");
      const rows = [{ value: `${exact(v)} ${spec.unit}`, name: "kernel time" }];
      if (i > 0) {
        const r = spec.bars[i - 1][1] / v;
        rows.push({ value: `${r.toFixed(2)}×`, name: r >= 1 ? "faster than the previous row" : "of the previous row's speed" });
      }
      if (spec.flops) rows.push({ value: `${(spec.flops / (v * 1e-3) / 1e12).toFixed(2)} TFLOP/s`, name: "throughput" });
      const show = () => tip.show(rows, name, base + w + 48, y + barH / 2);
      grp.addEventListener("pointerenter", show);
      grp.addEventListener("focus", show);
      grp.addEventListener("pointerleave", tip.hide);
      grp.addEventListener("blur", tip.hide);
    });
    if (spec.ref) {
      const rx = sx(spec.ref[0]);
      el("line", { x1: rx, x2: rx, y1: top - 6, y2: gy, class: "cuda-ref" }, svg);
      svg.appendChild(svg.querySelector(".cuda-ref"));
      text(svg, rx, top - 12, spec.ref[1], "cuda-ref-label", "middle");
    }
  }

  function exact(v) {
    return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
  }

  function roundedBar(x, y, w, h, r) {
    r = Math.min(r, w, h / 2);
    return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
  }

  // ---------- size sweep line charts ----------
  const SWEEP = {
    "dot-sizes": {
      routine: "dot",
      metric: "gbps_useful",
      axis: "Useful bandwidth, GB/s",
      unit: "GB/s",
      ref: [256, "256 GB/s DRAM peak"],
      sizeLabel: (n) => (n >= 1 << 20 ? n / (1 << 20) + "M" : n / 1024 + "K"),
      sizeName: (n) => `n = 2^${Math.log2(n)} (${n.toLocaleString("en-US")})`,
      series: [
        ["4da826e", "Per-element atomics"],
        ["3affd9b", "Block reduction"],
        ["47a65d8", "Sequential addressing"],
        ["7099f40", "Two elements per thread"],
        ["98cc847", "Warp shuffles"],
      ],
    },
    "gemv-sizes": {
      routine: "gemv",
      metric: "gbps_useful",
      axis: "Useful bandwidth, GB/s",
      unit: "GB/s",
      ref: [256, "256 GB/s DRAM peak"],
      sizeLabel: (n) => String(n),
      sizeName: (n) => `${n} × ${n}`,
      series: [
        ["051d7c3", "Eight-block baseline"],
        ["15e6bc6", "Row and column split"],
      ],
    },
    "gemm-sizes": {
      routine: "gemm",
      metric: "gflops",
      scale: 1e-3,
      axis: "Throughput, TFLOP/s",
      unit: "TFLOP/s",
      sizeLabel: (n) => String(n),
      sizeName: (n) => `${n} × ${n} × ${n}`,
      series: [
        ["15e6bc6", "One output per thread"],
        ["89b175b", "Shared-memory tiles"],
        ["a44068e", "4 × 4 register tiles"],
        ["6d1f43a", "8 × 8 register tiles"],
        ["c11b4fd", "Double buffering"],
      ],
    },
  };

  function parseCSV(src) {
    const lines = src.trim().split(/\r?\n/);
    const head = lines.shift().split(",");
    return lines.map((l) => {
      const c = l.split(",");
      const o = {};
      head.forEach((h, i) => (o[h] = isNaN(+c[i]) || c[i] === "" ? c[i] : +c[i]));
      return o;
    });
  }

  function sweepSeries(rows, spec) {
    const mine = rows.filter((r) => r.routine === spec.routine);
    const pick = (pred) =>
      mine
        .filter(pred)
        .map((r) => ({ size: r.size, v: r[spec.metric] * (spec.scale || 1), t: r.time_us_median }))
        .sort((a, b) => a.size - b.size);
    const n = spec.series.length;
    const out = spec.series
      .map(([rev, name], i) => ({
        name,
        cls: `cuda-s${n === 5 ? i + 1 : i === 0 ? 2 : 5}`,
        pts: pick((r) => String(r.rev) === rev && !/cublas/i.test(r.impl)),
      }))
      .filter((s) => s.pts.length);
    const cub = pick((r) => /cublas/i.test(r.impl));
    if (cub.length) out.push({ name: "cuBLAS", cls: "cuda-sref", pts: cub, square: true });
    return out;
  }

  function lineChart(fig, spec, rows) {
    const plot = fig.querySelector(".cuda-chart-plot");
    const series = sweepSeries(rows, spec);
    if (!series.length) return;
    const W = plot.clientWidth || 640;
    const narrow = W < 520;
    const H = narrow ? 300 : 340;
    const m = { l: 52, r: narrow ? 16 : 150, t: 14, b: 44 };
    const sizes = [...new Set(series.flatMap((s) => s.pts.map((p) => p.size)))].sort((a, b) => a - b);
    const lx0 = Math.log2(sizes[0]),
      lx1 = Math.log2(sizes[sizes.length - 1]);
    const sx = (n) => m.l + ((Math.log2(n) - lx0) / (lx1 - lx0)) * (W - m.l - m.r);
    const vmax = Math.max(...series.flatMap((s) => s.pts.map((p) => p.v)), spec.ref ? spec.ref[0] : 0) * 1.06;
    const ticks = niceTicks(vmax, 5);
    const ymax = ticks[ticks.length - 1];
    const sy = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: 0 });
    svg.setAttribute("aria-label", fig.getAttribute("aria-label") || "");
    plot.replaceChildren(svg);
    for (const t of ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: t === 0 ? "cuda-baseline" : "cuda-grid" }, svg);
      text(svg, m.l - 8, sy(t) + 4, t >= 1000 ? fmt(t) : String(t), "cuda-tick", "end");
    }
    const every = narrow && sizes.length > 8 ? 2 : 1;
    sizes.forEach((n, i) => {
      if (i % every === 0 && Number.isInteger(Math.log2(n))) text(svg, sx(n), H - m.b + 18, spec.sizeLabel(n), "cuda-tick", "middle");
    });
    text(
      svg,
      m.l + (W - m.l - m.r) / 2,
      H - 6,
      spec.routine === "dot" ? "Vector length n (log scale)" : "Matrix order N (log scale)",
      "cuda-axis-title",
      "middle"
    );
    const yt = text(svg, 0, 0, spec.axis, "cuda-axis-title", "middle");
    yt.setAttribute("transform", `translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`);
    if (spec.ref) {
      el("line", { x1: m.l, x2: W - m.r, y1: sy(spec.ref[0]), y2: sy(spec.ref[0]), class: "cuda-ref" }, svg);
      text(svg, m.l + 6, sy(spec.ref[0]) - 6, spec.ref[1], "cuda-ref-label");
    }
    for (const s of series) {
      const d = s.pts.map((p, i) => `${i ? "L" : "M"}${sx(p.size).toFixed(1)},${sy(p.v).toFixed(1)}`).join("");
      el("path", { d, class: `cuda-line ${s.cls}` }, svg);
      for (const p of s.pts) {
        if (s.square) el("rect", { x: sx(p.size) - 4, y: sy(p.v) - 4, width: 8, height: 8, class: `cuda-dot ${s.cls}` }, svg);
        else el("circle", { cx: sx(p.size), cy: sy(p.v), r: 4, class: `cuda-dot ${s.cls}` }, svg);
      }
    }
    // Direct labels for the final kernel and cuBLAS, unless their ends collide.
    if (!narrow) {
      const ends = series.slice(-2).map((s) => ({ s, y: sy(s.pts[s.pts.length - 1].v), x: sx(s.pts[s.pts.length - 1].size) }));
      if (ends.length < 2 || Math.abs(ends[0].y - ends[1].y) > 16) for (const e of ends) text(svg, e.x + 10, e.y + 4, e.s.name, "cuda-end-label");
    }
    // Legend (always present for two or more series).
    const legend = fig.querySelector(".cuda-legend");
    legend.replaceChildren();
    for (const s of series) {
      const item = document.createElement("span");
      const key = document.createElement("span");
      key.className = `cuda-key ${s.cls}${s.square ? " cuda-key-square" : ""}`;
      item.appendChild(key);
      item.appendChild(document.createTextNode(s.name));
      legend.appendChild(item);
    }
    // Crosshair and tooltip, by pointer or arrow keys.
    const cross = el("line", { y1: m.t, y2: H - m.b, class: "cuda-cross", visibility: "hidden" }, svg);
    const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "cuda-hit" }, svg);
    const tip = tooltip(fig);
    let idx = -1;
    function showAt(i) {
      idx = i;
      const n = sizes[i];
      cross.setAttribute("x1", sx(n));
      cross.setAttribute("x2", sx(n));
      cross.setAttribute("visibility", "visible");
      const rowsAt = series
        .map((s) => ({ s, p: s.pts.find((p) => p.size === n) }))
        .filter((o) => o.p)
        .sort((a, b) => b.p.v - a.p.v)
        .map((o) => ({
          key: getComputedStyle(svg.querySelector(`.cuda-line.${o.s.cls}`)).stroke,
          value: `${o.p.v >= 100 ? o.p.v.toFixed(0) : o.p.v.toFixed(2)} ${spec.unit}`,
          name: `${o.s.name}, ${o.p.t >= 1000 ? (o.p.t / 1000).toFixed(2) + " ms" : o.p.t.toFixed(1) + " µs"}`,
        }));
      tip.show(rowsAt, spec.sizeName(n), sx(n), m.t + 40);
    }
    function hide() {
      cross.setAttribute("visibility", "hidden");
      tip.hide();
    }
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      let best = 0;
      sizes.forEach((n, i) => {
        if (Math.abs(sx(n) - x) < Math.abs(sx(sizes[best]) - x)) best = i;
      });
      showAt(best);
    });
    hit.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        showAt(Math.min(sizes.length - 1, Math.max(0, idx + (e.key === "ArrowRight" ? 1 : -1))));
      } else if (e.key === "Escape") hide();
    });
    svg.addEventListener("focus", () => showAt(idx < 0 ? sizes.length - 1 : idx));
    // Table view, the accessible twin of the chart.
    const table = fig.querySelector(".cuda-chart-table");
    if (table && !table.dataset.built) {
      table.dataset.built = "1";
      const t = document.createElement("table");
      t.className = "cuda-table";
      const hr = t.createTHead().insertRow();
      for (const h of ["Size"].concat(series.map((s) => s.name))) {
        const th = document.createElement("th");
        th.textContent = h;
        th.className = h === "Size" ? "" : "num";
        hr.appendChild(th);
      }
      const body = t.createTBody();
      for (const n of sizes) {
        const r = body.insertRow();
        r.insertCell().textContent = spec.sizeLabel(n);
        for (const s of series) {
          const p = s.pts.find((q) => q.size === n);
          const c = r.insertCell();
          c.className = "num";
          c.textContent = p ? (p.v >= 100 ? p.v.toFixed(0) : p.v.toFixed(2)) : "";
        }
      }
      const cap = t.createCaption();
      cap.textContent = `${spec.axis} by size.`;
      table.appendChild(t);
    }
  }

  // ---------- wiring ----------
  let sweepRows = null;
  function renderAll() {
    document.querySelectorAll(".cuda-chart[data-chart]").forEach((fig) => {
      const id = fig.dataset.chart;
      if (STEPS[id]) barChart(fig, STEPS[id]);
      else if (SWEEP[id] && sweepRows) lineChart(fig, SWEEP[id], sweepRows);
    });
  }
  function init() {
    renderAll();
    const src = document.querySelector(".cuda-chart[data-src]");
    if (src)
      fetch(src.dataset.src)
        .then((r) => r.text())
        .then((t) => {
          sweepRows = parseCSV(t);
          renderAll();
        })
        .catch(() => {});
    let w = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - w) > 40) {
        w = window.innerWidth;
        renderAll();
      }
    });
    // Theme toggles restyle via CSS variables; tooltip keys read computed colors on demand.
    initAnimations();
  }

  // Play the manim clips only while they are on screen, and never for reduced motion.
  function initAnimations() {
    const vids = document.querySelectorAll("video[data-cuda-animation]");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target;
          if (e.isIntersecting && e.intersectionRatio >= 0.5) {
            if (v.dataset.userPaused) continue;
            if (v.preload === "none") v.preload = "auto";
            v.play().catch(() => {});
          } else if (!v.paused) {
            v.dataset.autoPaused = "1";
            v.pause();
          }
        }
      },
      { threshold: [0, 0.5] }
    );
    vids.forEach((v) => {
      v.addEventListener("pause", () => {
        if (v.dataset.autoPaused) delete v.dataset.autoPaused;
        else v.dataset.userPaused = "1";
      });
      v.addEventListener("play", () => delete v.dataset.userPaused);
      io.observe(v);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
