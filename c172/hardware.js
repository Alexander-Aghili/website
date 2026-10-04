// Hardware and wiring renderers for the Skyhawk explorer.
//
// Fasteners: every catalog line item (bolt, nut, washer, screw, stud, pin, clamp...) becomes instances of a
// small procedural mesh sized from its nomenclature (thread diameter, length), drawn with one InstancedMesh
// per (kind, size) so thousands stay cheap. Each instance remembers its catalog item, so a click can name
// the exact part number. Wires: one tube per wire, radius from AWG, bundled where runs share a path.

const IN = 0.0254;

// Thread designations to major diameter in inches ("1/2-20", "3/8-24", "10-32", "#8-32", "AN4" = 1/4).
export function threadDiameter(spec) {
  if (!spec) return null;
  const s = String(spec).trim();
  let m = s.match(/^(\d+)\/(\d+)/); if (m) return +m[1] / +m[2];
  m = s.match(/^#?(\d+)-\d+/); if (m) return 0.060 + 0.013 * +m[1];            // numbered machine-screw sizes
  m = s.match(/AN(\d)(\d*)/i); if (m) return +m[1] / 16;                        // AN bolt dash number = 16ths
  m = s.match(/(\d*\.\d+)\s*in/); if (m) return +m[1];
  return null;
}
export function kindOf(nomenclature = "") {
  const n = nomenclature.toUpperCase();
  if (/WASHER/.test(n)) return "washer";
  if (/NUT/.test(n)) return "nut";
  if (/STUD/.test(n)) return "stud";
  if (/BOLT/.test(n)) return "bolt";
  if (/SCREW/.test(n)) return "screw";
  if (/COTTER|PIN|DOWEL/.test(n)) return "pin";
  if (/CLAMP|CLIP/.test(n)) return "clamp";
  if (/GASKET|SEAL|O-RING|PACKING/.test(n)) return "gasket";
  if (/INSERT|HELI-COIL/.test(n)) return "insert";
  if (/PLUG/.test(n)) return "plug";
  return "part";
}

// Geometry for one fastener, axis along +Y, head (if any) at y = 0, shank toward −Y.
export function fastenerGeometry(THREE, kind, d = 0.25, len = 0.75) {
  const D = Math.max(0.06, d) * IN, L = Math.max(0.1, len) * IN;
  const merge = parts => { const g = mergeGeometries(THREE, parts); g.computeVertexNormals(); return g; };
  switch (kind) {
    case "bolt": { const head = new THREE.CylinderGeometry(D * 0.85, D * 0.85, D * 0.65, 6); head.translate(0, D * 0.32, 0);
      const shank = new THREE.CylinderGeometry(D / 2, D / 2, L, 12); shank.translate(0, -L / 2, 0); return merge([head, shank]); }
    case "screw": { const head = new THREE.CylinderGeometry(D * 0.95, D * 0.95, D * 0.4, 16); head.translate(0, D * 0.2, 0);
      const shank = new THREE.CylinderGeometry(D / 2, D / 2, L, 10); shank.translate(0, -L / 2, 0); return merge([head, shank]); }
    case "stud": { const g = new THREE.CylinderGeometry(D / 2, D / 2, L, 10); g.translate(0, -L / 2 + L * 0.35, 0); return g; }
    case "nut": { const g = new THREE.CylinderGeometry(D * 0.85, D * 0.85, D * 0.85, 6); g.translate(0, D * 0.42, 0); return g; }
    case "washer": { const g = new THREE.CylinderGeometry(D * 1.05, D * 1.05, Math.max(0.03 * IN, D * 0.12), 20); return g; }
    case "pin": { const g = new THREE.CylinderGeometry(D / 2, D / 2, L, 8); g.translate(0, -L / 2, 0); return g; }
    case "clamp": { const g = new THREE.TorusGeometry(Math.max(D, 0.25 * IN), D * 0.12, 6, 20); g.rotateX(Math.PI / 2); return g; }
    case "gasket": { const g = new THREE.TorusGeometry(Math.max(D * 1.2, 0.2 * IN), D * 0.08, 4, 24); g.rotateX(Math.PI / 2); return g; }
    default: { const g = new THREE.BoxGeometry(D * 1.4, D * 1.4, D * 1.4); return g; }
  }
}
function mergeGeometries(THREE, geos) {
  // Minimal merge of non-indexed copies (position + normal), enough for small fastener meshes.
  const parts = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); return out;
}

const MAT = {};
function fastenerMaterial(THREE, kind) {
  return (MAT[kind] ||= new THREE.MeshStandardMaterial({ color: kind === "gasket" ? 0x2a2622 : kind === "clamp" ? 0x8a8f96 : 0xb9bec4, metalness: kind === "gasket" ? 0.1 : 0.85, roughness: 0.32 }));
}

// placements: [{item: catalog item, position: [x,y,z], axis: [x,y,z] (head-to-tip direction reversed: points out of the surface), kind?, d?, len?}]
// Returns { group, lookup(mesh, instanceId) -> placement }.
export function buildFasteners(THREE, placements, name = "fasteners") {
  const group = new THREE.Group(); group.name = name;
  const buckets = new Map();
  for (const p of placements) {
    const kind = p.kind || kindOf(p.item?.nomenclature);
    const d = p.d ?? p.item?.diameter_in ?? threadDiameter(p.item?.thread) ?? 0.25;
    const len = p.len ?? p.item?.length_in ?? d * 3;
    const key = `${kind}|${d.toFixed(3)}|${len.toFixed(2)}`;
    (buckets.get(key) || buckets.set(key, { kind, d, len, list: [] }).get(key)).list.push(p);
  }
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const index = new Map();
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(fastenerGeometry(THREE, b.kind, b.d, b.len), fastenerMaterial(THREE, b.kind), b.list.length);
    mesh.name = `${name}:${b.kind}`;
    b.list.forEach((p, i) => {
      q.setFromUnitVectors(up, v.set(...(p.axis || [0, 1, 0])).normalize());
      m.compose(new THREE.Vector3(...p.position), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    index.set(mesh, b.list);
    group.add(mesh);
  }
  return { group, lookup: (mesh, id) => index.get(mesh)?.[id] || null, count: placements.length };
}

// Placement helpers for common hardware patterns.
export function boltCircle(center, axis, radius, count, startDeg = 0) {
  // Points on a circle around `axis` through `center` (all arrays in model meters).
  const [ax, ay, az] = normalize(axis);
  const ref = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross([ax, ay, az], ref)), w = cross([ax, ay, az], u);
  return Array.from({ length: count }, (_, k) => {
    const a = (startDeg * Math.PI) / 180 + (k / count) * 2 * Math.PI;
    return [0, 1, 2].map(i => center[i] + radius * (Math.cos(a) * u[i] + Math.sin(a) * w[i]));
  });
}
export function along(p0, p1, count, inset = 0) {
  return Array.from({ length: count }, (_, k) => { const t = count === 1 ? 0.5 : inset + (1 - 2 * inset) * (k / (count - 1)); return [0, 1, 2].map(i => p0[i] + (p1[i] - p0[i]) * t); });
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };

// ---- Wiring ----------------------------------------------------------------------------------------
const AWG_MM = { 0: 8.25, 2: 6.54, 4: 5.19, 6: 4.11, 8: 3.26, 10: 2.59, 12: 2.05, 14: 1.63, 16: 1.29, 18: 1.02, 20: 0.81, 22: 0.64, 24: 0.51 };
export function wireRadius(awg) { return ((AWG_MM[awg] ?? 1.0) * 1.6) / 2000; }    // conductor + insulation, meters

// wires: [{id, awg, color?, points: [[x,y,z]...], meta}] — points share bundle paths; parallel wires are
// offset around the bundle so a harness reads as a bundle. Returns { group, lookup(mesh) -> wire }.
export function buildWires(THREE, wires, opts = {}) {
  const group = new THREE.Group(); group.name = opts.name || "wiring";
  const byPath = new Map();
  for (const w of wires) { const k = w.bundle || w.points.map(p => p.map(x => x.toFixed(3)).join(",")).join(";"); (byPath.get(k) || byPath.set(k, []).get(k)).push(w); }
  const index = new Map();
  if (opts.exact) {   // pre-routed, pre-bundled polylines (the harness): one merged mesh, wire found by face index
    const geos = [], ranges = []; let tri = 0;
    const col = new THREE.Color();
    for (const w of wires) {
      const pts = w.points.map(p => new THREE.Vector3(...p));
      if (pts.length < 2) continue;
      const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.0) : new THREE.LineCurve3(pts[0], pts[1]);
      let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      const g = new THREE.TubeGeometry(curve, Math.min(1200, Math.max(12, Math.round(len / 0.02), pts.length * 4)), w.radius ?? wireRadius(w.awg), 6, false).toNonIndexed();   // full detail: every polyline point and bend kept
      g.deleteAttribute("uv");
      col.set(w.color || (w.awg <= 6 ? "#1d1d1d" : "#e8e2d4"));
      const n = g.attributes.position.count, c = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { c[k * 3] = col.r; c[k * 3 + 1] = col.g; c[k * 3 + 2] = col.b; }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      geos.push(g); ranges.push([tri, tri + n / 3, w]); tri += n / 3;
    }
    if (!geos.length) return { group, lookup: () => null };
    let off = 0; const total = geos.reduce((a, g) => a + g.attributes.position.count, 0);
    const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3);
    for (const g of geos) { P.set(g.attributes.position.array, off * 3); N.set(g.attributes.normal.array, off * 3); C.set(g.attributes.color.array, off * 3); off += g.attributes.position.count; g.dispose(); }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(P, 3)); merged.setAttribute("normal", new THREE.BufferAttribute(N, 3)); merged.setAttribute("color", new THREE.BufferAttribute(C, 3));
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }));
    mesh.name = opts.name || "wiring"; group.add(mesh);
    const find = fi => { let lo = 0, hi = ranges.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (fi < ranges[m][0]) hi = m - 1; else if (fi >= ranges[m][1]) lo = m + 1; else return ranges[m][2]; } return null; };
    return { group, lookup: (m, faceIndex) => (m === mesh && faceIndex != null ? find(faceIndex) : null) };
  }
  for (const list of byPath.values()) list.forEach((w, i) => {
    const off = list.length > 1 ? (i / list.length) * Math.PI * 2 : 0, rad = list.length > 1 ? 0.004 + 0.0007 * list.length : 0;
    const pts = w.points.map((p, j) => new THREE.Vector3(p[0] + rad * Math.cos(off) * (j % 2 ? 1 : 1), p[1] + rad * Math.sin(off), p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.2);
    const geo = new THREE.TubeGeometry(curve, Math.max(16, pts.length * 14), wireRadius(w.awg), 6, false);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(w.color || (w.awg <= 4 ? "#1d1d1d" : "#e8e2d4")), roughness: 0.6, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = `wire:${w.id}`;
    index.set(mesh, w); group.add(mesh);
  });
  return { group, lookup: mesh => index.get(mesh) || null };
}
