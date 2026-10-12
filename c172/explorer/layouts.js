// Automatic 2D layouts for a system's live topology diagram.
// Each returns { pos: Map(id -> [x, y]), H, route(edge) -> [[x, y], ...], above?: Set, bus?: [[x, y], [x, y]] }.

// Plan view: nodes where they really are, projected by the machine's plan(pos) -> [x, y].
export function layoutPlan(s, W, plan) {
  const pts = [...s.nodes.values()].map(n => plan(n.def.pos));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 40, sc = Math.min((W - 2 * pad) / Math.max(1e-3, x1 - x0), 300 / Math.max(1e-3, y1 - y0));
  const P = v => { const [x, y] = plan(v); return [W / 2 + (x - (x0 + x1) / 2) * sc, pad + (y - y0) * sc]; };
  const pos = new Map([...s.nodes.values()].map(n => [n.def.id, P(n.def.pos)]));
  return { pos, H: (y1 - y0) * sc + 2 * pad, route: e => [e.def.from, ...(e.def.via || []), e.def.to].map(v => (typeof v === "string" ? pos.get(v) : P(v))) };
}

// Flow: layered top to bottom from sources (inputs, sensors) to what they drive.
export function layoutFlow(s, W) {
  const ids = [...s.nodes.keys()], preds = new Map(ids.map(i => [i, []]));
  for (const e of s.def.edges) if (preds.has(e.to) && s.nodes.has(e.from)) preds.get(e.to).push(e.from);
  const layer = new Map(ids.map(i => [i, 0]));
  for (let k = 0; k < ids.length - 1; k++) for (const e of s.def.edges)
    if (layer.has(e.from) && layer.has(e.to) && layer.get(e.to) < layer.get(e.from) + 1) layer.set(e.to, Math.min(layer.get(e.from) + 1, 12));
  const L = Math.max(0, ...layer.values()) + 1, rows = Array.from({ length: L }, () => []);
  for (const i of ids) rows[layer.get(i)].push(i);
  const x = new Map();
  rows.forEach((r, li) => {
    if (li > 0) r.sort((a, b) => { const m = id => { const p = preds.get(id).filter(q => x.has(q)); return p.length ? p.reduce((t, q) => t + x.get(q), 0) / p.length : 0.5; }; return m(a) - m(b); });
    r.forEach((id, k) => x.set(id, (k + 1) / (r.length + 1)));
  });
  const pad = 30, rowH = 62, pos = new Map(ids.map(i => [i, [pad + x.get(i) * (W - 2 * pad), pad + 8 + layer.get(i) * rowH]]));
  const above = new Set(); rows.forEach(r => { if (r.length > 3) r.forEach((id, k) => { if (k % 2) above.add(id); }); });
  return { pos, H: pad * 2 + (L - 1) * rowH + 30, route: e => [pos.get(e.def.from), pos.get(e.def.to)], above };
}

// Bus: sources on the left feed a vertical bus bar; loads hang off it in a column; an optional sub-bus
// (e.g. avionics) branches with its own loads. spec = { sources: [ids], main: id, sub?: id }.
export function layoutBus(s, W, spec) {
  const pos = new Map(), N = id => s.nodes.get(id);
  const main = [], sub = [];
  for (const e of s.def.edges) { const t = N(e.to); if (t?.def.kind === "load") (e.from === spec.sub ? sub : main).push(e.to); }
  const rowH = 22, top = 26, busX = W * 0.4, subX = busX + 40, loadX = busX + 62;
  const all = [...main, ...(spec.sub ? [spec.sub, ...sub] : [])];
  all.forEach((id, i) => pos.set(id, [id === spec.sub ? subX : loadX, top + i * rowH]));
  pos.set(spec.main, [busX, top + Math.max(0, main.length - 1) * rowH / 2]);
  spec.sources.forEach((id, i) => pos.set(id, [22, top + rowH * (1 + i * 2.5)]));
  for (const id of s.nodes.keys()) if (!pos.has(id)) pos.set(id, [22, top + rowH * (1 + spec.sources.length * 2.5)]);
  const busTop = top, busBot = top + Math.max(1, main.length) * rowH;
  const clampY = y => Math.min(Math.max(y, busTop), busBot);
  const route = e => {
    const a = pos.get(e.def.from), b = pos.get(e.def.to);
    if (e.def.from === spec.main) return [[busX, b[1]], b];
    if (e.def.from === spec.sub) return [[subX, a[1]], [subX, b[1]], b];
    return [a, [busX - 16, a[1]], [busX - 16, clampY(a[1])], [busX, clampY(a[1])]];
  };
  return { pos, H: top + all.length * rowH + 10, route, bus: [[busX, busTop - 6], [busX, busBot]] };
}
