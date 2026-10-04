// Official figures with live hotspots and traced flow paths.
//
// Figure data (per key): { file, width, height, figure, caption, url, hotspots: [{node, shape_bbox,
// shape_polys?, printed_label?, confidence}], paths: [{from, to, points, kind?}] }.
// The machine supplies state(key, id) -> [on: true|false|null, value: string] for hotspots, and
// pathState(key, path) -> [on, dir] for paths; decorate(key, fig, svg, svgEl) may add live elements and
// return an update function (e.g. a selector needle).

const SVGNS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e); return e;
}

export class FigureView {
  constructor({ frame, img, svg, badges, src, onHotspot }) {
    Object.assign(this, { frame, img, svg, badges, srcEl: src, onHotspot });
    this.fig = null;
  }
  build(key, f, color, hooks) {
    const { svg } = this;
    svg.replaceChildren(); this.badges.replaceChildren();
    this.fig = null;
    if (!f) return;
    this.frame.style.setProperty("--c", color);
    this.frame.style.aspectRatio = `${f.width} / ${f.height}`;
    this.img.src = f.file; this.img.alt = `${f.figure}. ${f.caption}`;
    svg.setAttribute("viewBox", `0 0 ${f.width} ${f.height}`);
    const paths = (f.paths || []).map(p => ({ p, el: svgEl("polyline", { class: "fp", points: p.points.map(q => q.join(",")).join(" ") }, svg) }));
    const hs = f.hotspots.map(h => {
      const shapes = h.shape_polys?.length
        ? h.shape_polys.map(poly => svgEl("polygon", { class: "hs", points: poly.map(q => q.join(",")).join(" ") }, svg))
        : [svgEl("rect", { class: "hs", x: h.shape_bbox[0], y: h.shape_bbox[1], width: h.shape_bbox[2] - h.shape_bbox[0], height: h.shape_bbox[3] - h.shape_bbox[1], rx: 6 }, svg)];
      for (const el of shapes) {
        svgEl("title", {}, el).textContent = h.printed_label || h.node;
        el.addEventListener("click", () => {
          this.onHotspot?.(key, h, f);
          hs.forEach(x => x.shapes.forEach(e => e.classList.toggle("sel", x.h === h)));
        });
      }
      const badge = document.createElement("div"); badge.className = "badge"; badge.hidden = true;
      const bb = h.shape_bbox, wide = (bb[2] - bb[0]) > 2.5 * (bb[3] - bb[1]);
      // Wide label-style hotspots take the badge at their right end so the printed label stays readable.
      badge.dataset.x = wide ? bb[2] / f.width : (bb[0] + bb[2]) / 2 / f.width;
      badge.dataset.y = wide ? (bb[1] + bb[3]) / 2 / f.height : bb[1] / f.height;
      badge.dataset.wide = wide ? 1 : "";
      this.badges.append(badge);
      return { h, shapes, badge };
    });
    const extra = hooks.decorate?.(key, f, svg, svgEl) || null;
    this.srcEl.replaceChildren();
    const { text, link } = hooks.source(f);
    const span = document.createElement("span"); span.textContent = text + " ";
    this.srcEl.append(span);
    if (f.url) { const a = document.createElement("a"); a.href = f.url; a.textContent = link || "Source"; a.target = "_blank"; a.rel = "noopener"; a.style.color = "inherit"; this.srcEl.append(a); }
    this.fig = { key, f, hs, paths, extra, hooks };
  }
  update() {
    const F = this.fig; if (!F) return;
    for (const { h, shapes, badge } of F.hs) {
      const [on, value] = F.hooks.state(F.key, h.node);
      shapes.forEach(e => { e.classList.toggle("on", on === true); e.classList.toggle("off", on === false); });
      badge.hidden = !value; if (value) badge.textContent = value;
    }
    for (const { p, el } of F.paths) { const [on, dir] = F.hooks.pathState(F.key, p); el.classList.toggle("on", !!on); el.classList.toggle("rev", dir < 0); }
    this.placeBadges();
    F.extra?.();
  }
  // Anchor badges, keep them inside the frame, then push down any badge that overlaps one above it.
  placeBadges() {
    const fr = this.frame.getBoundingClientRect(); if (!fr.width) return;
    const placed = [];
    const items = this.fig.hs.map(x => x.badge).filter(b => !b.hidden).sort((a, b) => a.dataset.y - b.dataset.y);
    for (const b of items) {
      const w = b.offsetWidth, h = b.offsetHeight;
      let x = +b.dataset.x * fr.width, y = +b.dataset.y * fr.height;
      if (b.dataset.wide) { x += 4; y -= h / 2; } else { x -= w / 2; y -= h + 2; }
      x = Math.max(2, Math.min(fr.width - w - 2, x)); y = Math.max(2, Math.min(fr.height - h - 2, y));
      for (let k = 0; k < 12; k++) {
        const hit = placed.find(o => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
        if (!hit) break; y = hit.y + hit.h + 2;
      }
      placed.push({ x, y, w, h });
      b.style.left = `${x}px`; b.style.top = `${y}px`;
    }
  }
}
