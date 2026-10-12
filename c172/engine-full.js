// Lycoming O-320-D2J, the whole engine as assembled, for the Skyhawk Systems Explorer.
//
// Same API as engine.js: buildEngine(THREE) -> { root, parts, update, setXray, specs, cylinders, rodLength, bore }
// plus `layout` (the inch dimensions below), `spin` (extra animated handles) and `stats`.
//
// Frame: engine-local, meters. x aft along the crankshaft (origin at the propeller-flange face), y up,
// z engine-left. Odd cylinders on the right (-z), #1 right front; the left bank sits 2.31 in aft of the
// right. The crank turns clockwise seen from the cockpit; firing order 1-3-2-4.
//
// Everything is modelled in inches (the catalog's unit) and scaled once per merged mesh. Every assembly
// of the Lycoming parts catalog PC-O-320-D2J is its own part with its figure, item and part number on its
// card. Positions come from the catalog's top view, the operator manual's installation drawings and its
// published dimensions; shapes are reconstructions from the catalog drawings, and each card's note says
// which parts are estimated. Motion is exact slider-crank kinematics from bore, stroke and rod length;
// valve events as engine.js. The four cylinders are one identical part (LW-12416) turned 180 degrees for
// the right bank, so intake valves sit aft on the right and forward on the left, and the 2.31 in bank
// stagger lets cylinders 1-2 and 3-4 share their intake cam lobes (six-lobe camshaft).
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const SPECS = {
  bore_in: 5.125, stroke_in: 3.875, rod_in: 6.375, cylinders: 4, firing: [1, 3, 2, 4],
  displacement_in3: 320, max_hp: 160, idle_rpm: 600, max_rpm: 2700, spark_btdc_deg: 25,
  // Typical Lycoming valve events (degrees from TDC/BDC); illustrative, not from a sourced cam card.
  io_btdc: 25, ic_abdc: 55, eo_bbdc: 60, ec_atdc: 20,
  valve_lift_in: 0.45,
};

// Engine layout in inches. Mirrored in tools/place_engine_hardware_full.py; change both together.
export const LAYOUT = {
  cylX: [9.03, 11.34, 15.75, 18.06], side: [-1, 1, -1, 1],   // IPC top view (PDF p.9)
  pad: 4.5, flange: 5.0,                    // cylinder pad face / outer face of the barrel flange (|z|)
  holdDown: { half: [1.155, 2.9], threeEighths: [2.75, 1.6] }, // stud pattern, canonical (x, y) +/- (estimated)
  barrelFin: [5.85, 8.45], head: [8.5, 12.3], box: [12.2, 14.6], cover: [14.6, 16.1],
  coverW: 5.6, coverH: 6.95, coverY: 0.12,
  vx: 1.155,                                // valve, push-rod and tappet offset fore/aft of the cylinder axis
  camY: 3.75, camBase: 0.55,
  tappet: [0.6, 2.6], pushTop: [3.88, 13.3], pivot: [2.7, 13.75], seatZ: 10.5, valveAxis: [0, 0.423, 0.906], stem: 3.3,
  intakePort: [-1.155, -4.05, 12.2], exhaustPort: [1.155, -3.95, 12.4],
  plugTop: { at: [0, 3.25, 12.05], dir: [0, 0.7, 0.71] }, plugBottom: { at: [0, -3.3, 10.4], dir: [0, -0.9, 0.44] },
  caseFront: 3.16, caseRear: 20.26, accRear: 23.47, caseTop: 4.75, caseBottom: -5.0,
  sump: { x: [12.4, 21.3], y: [-11.7, -6.7], halfW: 5.2, conn: [13.5, 19.3], connY: -8.2, connZ: 6.4 },
  carb: { x: 16.85, flangeY: -11.7, bottomY: -16.55 },
  ringGear: { x: 1.64, od: 12.7, teeth: 149 }, pulley: { x: 0.9, r: 3.45 },
  mag: { zL: 4.91, zR: -4.59, y: 0.3, capX: 28.44 },
  gears: { x: 20.4, w: 0.45, crankR: 1.233, idlerR: 1.35 },
  filter: { y: 0.4, end: 30.9 },
  alternator: { y: -6.2, z: -4.4, r: 2.35, x: [2.1, 6.9], pulleyR: 1.06 },
  starter: { pinion: [-5.6, 3.75], body: [-7.1, 3.95], r: 1.6, x: [2.6, 8.0] },
};

const IN = 0.0254;
const PDF = { 1: 14, 2: 16, 3: 18, 4: 20, 5: 22, 6: 24, 7: 26, 8: 28, 9: 30, 10: 32, 11: 34, 12: 36, 13: 38, 14: 40, 15: 42, 16: 44, 17: 46, 18: 48, 19: 50, 20: 52, 21: 54, 22: 56 };

export function buildEngine(THREE, specs = SPECS) {
  const S = { ...SPECS, ...specs }, Lo = LAYOUT;
  const r = (S.stroke_in / 2) * IN, l = S.rod_in * IN, bore = S.bore_in * IN;
  const rIn = S.stroke_in / 2, lIn = S.rod_in;
  const THROWS = Lo.cylX.map(v => v * IN);
  const SIDE = Lo.side;
  const PIN = [-1, 1, 1, -1];                         // crank-pin direction along z at theta = 0
  const firingAngle = {}; S.firing.forEach((c, k) => (firingAngle[c] = k * 180));
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- Materials ----------------------------------------------------------------------------------
  const M = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const mat = {
    case: M(0x828a91, 0.55, 0.5),        // Lycoming grey paint on cast aluminium
    cyl: M(0x4a5157, 0.55, 0.5),         // painted nitrided steel barrels
    head: M(0x8e959c, 0.7, 0.42),        // cast aluminium heads
    cover: M(0x6c747b, 0.5, 0.45),       // painted rocker covers
    shroud: M(0x8a9198, 0.75, 0.35),
    steel: M(0x9ca3aa, 0.9, 0.3),
    dark: M(0x4d545b, 0.85, 0.38),
    alu: M(0xb3b9bf, 0.85, 0.3),
    black: M(0x1d2024, 0.35, 0.55),
    rubber: M(0x18191b, 0.0, 0.85),
    exhaust: M(0x7a5a45, 0.6, 0.55),
    lead: M(0xcfc8b8, 0.05, 0.7),
    brass: M(0xb08d57, 0.8, 0.35),
    gold: M(0xb89a52, 0.85, 0.32),
    belt: M(0x232323, 0.0, 0.8),
    white: M(0xe4e1da, 0.1, 0.4),
  };
  mat.fin = mat.cyl.clone(); mat.headFin = mat.head.clone();     // fins fade almost away in x-ray
  const xray = { on: false, mats: [[mat.case, 0.22], [mat.cyl, 0.22], [mat.head, 0.22], [mat.cover, 0.2], [mat.shroud, 0.3], [mat.fin, 0.05], [mat.headFin, 0.05]] };
  for (const [m] of xray.mats) { m.transparent = true; m.opacity = 1; }

  // ---- Geometry helpers (inches) ------------------------------------------------------------------
  const prep = g => {
    const h = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(h.attributes)) if (k !== "position" && k !== "normal") h.deleteAttribute(k);
    if (!h.attributes.normal) h.computeVertexNormals();
    return h;
  };
  // An accumulator merges every static piece of an assembly into one mesh per material.
  function Acc() {
    const lists = new Map();
    let merged = null;
    return {
      add(m, g) { if (!lists.has(m)) lists.set(m, []); lists.get(m).push(prep(g)); return g; },
      merged() {
        if (!merged) merged = [...lists].map(([m, gs]) => { const g = mergeGeometries(gs); g.scale(IN, IN, IN); g.computeBoundingSphere(); return [m, g]; });
        return merged;
      },
      meshes(parent) { for (const [m, g] of this.merged()) parent.add(new THREE.Mesh(g, m)); return parent; },
    };
  }
  const q = new THREE.Quaternion(), mtx = new THREE.Matrix4(), Y = V3(0, 1, 0);
  // Cylinder or cone between two points (radius r0 at p0, r1 at p1).
  function seg(p0, p1, r0, r1 = r0, n = 16, open = false) {
    const a = V3(...p0), b = V3(...p1), d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, n, 1, open);
    q.setFromUnitVectors(Y, d.normalize());
    g.applyMatrix4(mtx.compose(a.add(b).multiplyScalar(0.5), q, V3(1, 1, 1)));
    return g;
  }
  const cx = (r0, x0, x1, y = 0, z = 0, n = 24, r1 = r0) => seg([x0, y, z], [x1, y, z], r0, r1, n);
  const cy = (r0, y0, y1, x = 0, z = 0, n = 24, r1 = r0) => seg([x, y0, z], [x, y1, z], r0, r1, n);
  const cz = (r0, z0, z1, x = 0, y = 0, n = 24, r1 = r0) => seg([x, y, z0], [x, y, z1], r0, r1, n);
  const rbox = (c, s, rad = 0.2, segs = 2) => {
    const g = new RoundedBoxGeometry(s[0], s[1], s[2], segs, Math.min(rad, Math.min(...s) / 2 - 1e-3));
    g.translate(...c); return g;
  };
  const box = (c, s) => { const g = new THREE.BoxGeometry(...s); g.translate(...c); return g; };
  const sphere = (c, rad, n = 12) => { const g = new THREE.SphereGeometry(rad, n, Math.max(6, n / 2)); g.translate(...c); return g; };
  function ringX(rIn0, rOut, x0, x1, y = 0, z = 0, n = 32) {        // annulus along x (lathe)
    const pr = [[rIn0, x0], [rOut, x0], [rOut, x1], [rIn0, x1], [rIn0, x0]].map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(pr, n); g.rotateZ(-Math.PI / 2); g.translate(0, y, z);
    return prepFlat(g);
  }
  function ringZ(rIn0, rOut, z0, z1, x = 0, y = 0, n = 32) {
    const pr = [[rIn0, z0], [rOut, z0], [rOut, z1], [rIn0, z1], [rIn0, z0]].map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(pr, n); g.rotateX(Math.PI / 2); g.translate(x, y, 0);
    return prepFlat(g);
  }
  // Lathe rings have hard corners: split them and recompute normals per face set (flat across the profile,
  // smooth around the circumference is lost but the rings are thin).
  function prepFlat(g) { const h = g.toNonIndexed(); h.deleteAttribute("normal"); h.deleteAttribute("uv"); h.computeVertexNormals(); return h; }
  const rrect = (w, h, rad, cxp = 0, cyp = 0, shape = new THREE.Shape()) => {
    const x0 = cxp - w / 2, y0 = cyp - h / 2, x1 = cxp + w / 2, y1 = cyp + h / 2, rr = Math.min(rad, w / 2, h / 2);
    shape.moveTo(x0 + rr, y0); shape.lineTo(x1 - rr, y0); shape.quadraticCurveTo(x1, y0, x1, y0 + rr);
    shape.lineTo(x1, y1 - rr); shape.quadraticCurveTo(x1, y1, x1 - rr, y1); shape.lineTo(x0 + rr, y1);
    shape.quadraticCurveTo(x0, y1, x0, y1 - rr); shape.lineTo(x0, y0 + rr); shape.quadraticCurveTo(x0, y0, x0 + rr, y0);
    return shape;
  };
  const rrectPath = (w, h, rad, cxp = 0, cyp = 0) => rrect(w, h, rad, cxp, cyp, new THREE.Path());
  // Extrude a shape in the x-y plane along +z from z0 (canonical cylinder plates).
  function extZ(shape, z0, depth, bevel = 0, curveSegments = 6) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments });
    g.translate(0, 0, z0); return g;
  }
  // Shapes drawn in the y-z plane: shape point (u, v) is (y = v, z = -u); extruded along +x from x0.
  const P = (y, z) => new THREE.Vector2(-z, y);
  const YZ = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  function extX(shape, x0, depth, bevel = 0, curveSegments = 6) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments });
    g.applyMatrix4(YZ); g.translate(x0, 0, 0); return g;
  }
  const polyShape = pts => { const s = new THREE.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p.x, p.y) : s.moveTo(p.x, p.y))); return s; };
  function hull(pts) {                         // 2D convex hull (monotone chain) of Vector2s
    const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y), cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const v of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
    for (const v of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], v) <= 0) up.pop(); up.push(v); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const circlePts = (cyp, czp, rad, n = 28, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n }, (_, k) => { const a = a0 + (a1 - a0) * k / (n - 1); return P(cyp + rad * Math.sin(a), czp + rad * Math.cos(a)); });
  // Spur gear in the y-z plane centred at (yc, zc), extruded along x.
  function gearX(rad, teeth, x0, w, yc = 0, zc = 0, hole = 0) {
    const s = new THREE.Shape(), m = (2 * rad) / (teeth + 2), rr = rad - 2.25 * m, rp = rad - m;
    for (let k = 0; k < teeth; k++) {
      const a = (k / teeth) * Math.PI * 2, da = (Math.PI * 2) / teeth;
      const pts = [[rr, a - da * 0.5], [rr, a - da * 0.25], [rad, a - da * 0.12], [rad, a + da * 0.12], [rr, a + da * 0.25]];
      for (const [rad2, ang] of pts) { const v = P(yc + rad2 * Math.sin(ang), zc + rad2 * Math.cos(ang)); if (!k && ang === a - da * 0.5) s.moveTo(v.x, v.y); else s.lineTo(v.x, v.y); }
    }
    if (hole) s.holes.push(new THREE.Path().absarc(-zc, yc, hole, 0, Math.PI * 2, true));
    return extX(s, x0, w, 0, hole ? 24 : 2);
  }
  function tube(pts, rad, n = 32, radial = 8, closed = false) {
    const c = new THREE.CatmullRomCurve3(pts.map(p => V3(...p)), closed, "centripetal");
    return new THREE.TubeGeometry(c, n, rad, radial, closed);
  }
  function helix(rad, wire, len, turns, segPerTurn = 18) {   // coil spring along +z from 0 to len
    const pts = []; const N = Math.round(turns * segPerTurn);
    for (let k = 0; k <= N; k++) { const t = k / N, a = t * turns * Math.PI * 2; pts.push(V3(rad * Math.cos(a), rad * Math.sin(a), wire + t * (len - 2 * wire))); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, wire, 5, false);
  }
  const xform = (g, pos, quat) => g.applyMatrix4(new THREE.Matrix4().compose(V3(...pos), quat || new THREE.Quaternion(), V3(1, 1, 1)));
  const quatZ = d => new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(...d).normalize());
  const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const norm = d => { const v = V3(...d).normalize(); return [v.x, v.y, v.z]; };

  // ---- Parts ----------------------------------------------------------------------------------------
  const root = new THREE.Group(); root.name = "engine";
  const parts = [];
  function part(name, label, facts = [], note, explode = [0, 0, 0]) {
    const g = new THREE.Group(); g.name = name; root.add(g);
    const p = { name, label, group: "engine", node: g, facts, note, explode: V3(...explode) };
    parts.push(p); return p;
  }
  const fact = (label, value, source) => ({ label, value, source });
  const SRC = { tcds: "Lycoming O-320 Operator's Manual 60297-30 p. 2-2; FAA TCDS E-274", lyc: "Lycoming O-320 Operator's Manual 60297-30",
    om73: "Operator's Manual 60297-30 Fig. 7-6 (left side installation drawing, PDF p.73)", om74: "Operator's Manual 60297-30 Fig. 7-7 (rear installation drawing, PDF p.74)",
    top: "Lycoming PC-O-320-D2J top view (PDF p.9)", poh: "Cessna 172P Pilot's Operating Handbook, Section 7" };
  const fig = n => `Lycoming PC-O-320-D2J fig ${n} (PDF p.${PDF[n]}-${PDF[n] + 1})`;
  const ipc = (f, item, pn, desc, qty) => fact(`Fig ${f} item ${item}`, `${pn} ${desc}${qty ? ` (×${qty})` : ""}`, fig(f));
  const EST = "Shape reconstructed from the catalog drawing; proportions estimated.";

  // Canonical cylinder frame: cylinder n's parts live in a group at (x_n, 0, 0), turned 180 deg about y on
  // the right bank, so canonical +z points out along that cylinder's axis.
  const frame = (pt, i) => { const f = new THREE.Group(); f.position.set(THROWS[i], 0, 0); if (SIDE[i] < 0) f.rotation.y = Math.PI; pt.node.add(f); return f; };
  const toEngine = (i, p) => [Lo.cylX[i] + SIDE[i] * p[0], p[1], SIDE[i] * p[2]];         // canonical -> engine (inches)
  const dirEngine = (i, d) => [SIDE[i] * d[0], d[1], SIDE[i] * d[2]];

  // ======== Crankcase (one matched assembly of two halves, fig 2 item 1) ===============================
  const caseP = part("engine.crankcase", "Crankcase (two halves)", [
    ipc(2, 1, "LW-18402-2", "CRANKCASE ASSEMBLY (matched halves)", 1),
    fact("Engine", "Lycoming O-320-D2J, 160 hp at 2700 rpm, 319.8 in³", SRC.tcds),
    fact("Split", "Vertical at the crankshaft axis; right half carries cylinders 1 and 3, left half 2 and 4; no gasket", "Operator's Manual p. 1-1"),
    fact("Length", "3.16 in to 20.26 in aft of the propeller flange", SRC.top),
    fact("Envelope", "32.24 wide × 23.00 high × 29.05 long (in)", "Operator's Manual Table 1, p. 1-3"),
    fact("Dry weight", "275 lb with starter, alternator, carburetor, magnetos and harness", "Operator's Manual p. 2-3"),
    fact("Mount", "Four mounting bosses at the rear of the case (dynafocal pattern)", "estimated position"),
  ], `${EST} Cylinder pads, tappet bosses, parting flange and bolt stations from the catalog figures; mount bosses and the starter/alternator pads estimated.`);
  {
    const A = Acc(), cs = mat.case;
    for (const s of [-1, 1]) {
      A.add(cs, rbox([11.78, -0.75, s * 2.05], [16.96, 8.5, 4.1], 0.7, 3));                 // main shell: x 3.3..20.26, y -5..3.5
      A.add(cs, rbox([16.33, -5.35, s * 2.6], [7.86, 2.7, 5.2], 0.4));                      // rear lower block to the sump flange
      A.add(cs, rbox([12.23, 3.55, s * 1.0], [16.06, 2.3, 2.0], 0.6));                      // camshaft gallery (spine)
      A.add(cs, box([11.93, 4.5, s * 0.225], [16.66, 0.5, 0.45]));                          // top parting-flange lip
      A.add(cs, box([7.95, -5.2, s * 0.225], [8.7, 0.5, 0.45]));                            // bottom lip, front
      for (const x of [4.2, 5.6, 8.4, 10.6, 14.6, 16.9]) A.add(cs, cz(0.42, 0, s * 0.8, x, 4.45, 12));   // top flange bolt bosses
      for (const x of [7.0, 9.0, 12.0]) A.add(cs, cz(0.4, 0, s * 0.75, x, -5.05, 12));                    // bottom flange bosses
      // nose: front main-bearing boss
      const nose = new THREE.CylinderGeometry(3.0, 3.0, 1.0, 28, 1, false, s > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI);
      nose.rotateZ(Math.PI / 2); nose.translate(3.66, 0, 0); A.add(cs, nose);
      // cylinder pads, bore bulges and lower ribs
      Lo.cylX.forEach((x, i) => { if (SIDE[i] !== s) return;
        A.add(cs, rbox([x, 0, s * 4.15], [6.8, 7.1, 0.7], 0.3));
        A.add(cs, cz(3.25, s * 3.2, s * 3.9, x, 0, 32));
      });
      for (const x of [6.1, 13.5, 19.9]) A.add(cs, rbox([x, -4.15, s * 4.15], [0.55, 1.9, 0.5], 0.15));
      // tappet bosses: the lumps on top of the case leading to the shroud tubes
      Lo.cylX.forEach((x, i) => { if (SIDE[i] !== s) return;
        for (const lx of [-Lo.vx, Lo.vx]) A.add(cs, cz(0.62, s * 0.9, s * 4.35, x + s * lx, Lo.camY, 16));
      });
      // rear mount bosses (estimated dynafocal pattern)
      for (const [pt, d] of [[[19.6, 4.1, s * 2.9], [0.85, 0.3, 0.45 * s]], [[19.8, -6.0, s * 4.4], [0.85, -0.3, 0.45 * s]]]) {
        A.add(cs, seg(add3(pt, d, -0.9), add3(pt, d, 0.9), 0.78, 0.78, 20));
        A.add(cs, seg(add3(pt, d, -1.2), pt, 0.55, 0.55, 12));
      }
    }
    A.add(cs, rbox([4.9, -5.3, 3.2], [3.4, 0.7, 2.8], 0.2));                                   // starter pad (left)
    A.add(cs, rbox([4.0, -5.3, -3.6], [2.4, 0.7, 1.6], 0.2));                                  // alternator bracket pad (right)
    A.add(cs, cz(0.42, -4.0, -4.7, 4.47, 1.8, 12));                                            // alternator link boss
    A.add(cs, seg([19.4, -4.4, -4.3], [20.5, -3.2, -5.9], 0.8, 0.7, 16));                     // oil filler boss (right rear, low)
    A.add(cs, rbox([6.2, 1.4, 4.2], [2.0, 2.0, 0.4], 0.15));                                   // boss with three 3/8 studs (left, forward of cyl 2)
    A.meshes(caseP.node);
  }

  // ======== Lifting strap (fig 6 item 3) =================================================================
  const strapP = part("engine.lifting_strap", "Lifting strap", [ipc(6, 3, "60803", "STRAP, Lifting", 1), fact("Position", "Top parting flange between the cylinder pairs", fig(6))], EST, [0, 0.12, 0]);
  {
    const A = Acc(), s = new THREE.Shape();
    s.moveTo(-1.0, 0); s.lineTo(1.0, 0); s.lineTo(0.75, 0.75); s.absarc(0, 0.75, 0.75, 0, Math.PI, false); s.lineTo(-1.0, 0);
    s.holes.push(new THREE.Path().absarc(0, 0.8, 0.38, 0, Math.PI * 2, true));
    for (const z of [-0.5, 0.25]) { const g = extZ(s, z, 0.25); g.translate(12.9, 4.75, 0); A.add(mat.steel, g); }
    A.meshes(strapP.node);
  }

  // ======== Crankshaft (fig 4) =============================================================================
  const crankP = part("engine.crankshaft", "Crankshaft and gear", [
    ipc(4, 1, "13B47020", "CRANKSHAFT ASSEMBLY", 1), ipc(4, 6, "13S19646", "GEAR, Crankshaft", 1), ipc(4, 3, "STD-1211", "PLUG, 2.00 diameter, expansion", 1),
    fact("Stroke", `${S.stroke_in} in (throw ${rIn} in)`, SRC.tcds), fact("Firing order", S.firing.join("-"), "Operator's Manual p. 2-2"),
    fact("Rotation", "Clockwise viewed from the rear", "Operator's Manual p. 1-1"),
    fact("Throws", "9.03, 11.34, 15.75, 18.06 in aft of the flange; 1-2 and 3-4 pairs 180° apart on shared webs", SRC.top),
  ], `${EST} Journal and pin diameters and the counterweights are estimated; throw positions and stroke are sourced.`, [-0.05, 0, 0]);
  const crank = new THREE.Group(); crankP.node.add(crank);
  {
    const A = Acc(), st = mat.steel;
    const pinZ = PIN.map(p => p * rIn);
    A.add(st, cx(1.35, 0.45, 3.5, 0, 0, 28));                     // nose
    A.add(mat.dark, cx(1.0, -0.62, 0.45, 0, 0, 24));              // pilot / expansion plug end
    A.add(st, cx(1.19, 3.5, 7.75, 0, 0, 28));                     // front main journal
    A.add(st, cx(1.19, 12.6, 14.5, 0, 0, 28));                    // centre main
    A.add(st, cx(1.19, 19.3, 20.1, 0, 0, 28));                    // rear main
    A.add(st, cx(1.5, 20.1, 20.4, 0, 0, 28));                     // gear seat
    const pins = [[8.45, 9.61], [10.76, 11.92], [15.17, 16.33], [17.48, 18.64]];
    pins.forEach(([a, b], i) => A.add(st, cx(1.125, a, b, 0, pinZ[i], 24)));
    const cheek = (x0, x1, pinIdx, cw) => {
      const pts = [...circlePts(0, pinZ[pinIdx], 1.5), ...circlePts(0, 0, 1.6)];
      if (cw) { const opp = pinZ[pinIdx] > 0 ? Math.PI : 0; pts.push(...circlePts(0, 0, 2.75, 16, opp - 0.95, opp + 0.95)); }
      A.add(st, extX(polyShape(hull(pts)), x0, x1 - x0));
    };
    const web = (x0, x1, a, b) => A.add(st, extX(polyShape(hull([...circlePts(0, pinZ[a], 1.5), ...circlePts(0, pinZ[b], 1.5)])), x0, x1 - x0));
    cheek(7.75, 8.45, 0, true); web(9.61, 10.76, 0, 1); cheek(11.92, 12.6, 1, true);
    cheek(14.5, 15.17, 2, true); web(16.33, 17.48, 2, 3); cheek(18.64, 19.3, 3, true);
    A.add(st, gearX(Lo.gears.crankR, 26, Lo.gears.x, Lo.gears.w, 0, 0));
    A.meshes(crank);
  }

  // ======== Main bearings and nose seal (fig 3 items 5-7) ================================================
  const brgP = part("engine.bearings", "Main bearings and crankshaft oil seal", [
    ipc(3, 5, "18D26098", "BEARING, Crankshaft", 4), ipc(3, 6, "18A26093", "BEARING, Crankshaft", 2), ipc(3, 7, "LW-13792", "SEAL, Crankshaft oil", 1),
    fact("Mains", "Three main journals: front, centre (between cylinders 2 and 3), rear", "IPC fig 3 quantities (6 half-shells)")], `${EST} Journal stations estimated.`);
  {
    const A = Acc();
    for (const [a, b] of [[3.7, 7.6], [12.65, 14.45], [19.35, 20.05]]) A.add(mat.brass, ringX(1.2, 1.34, a, b));
    A.add(mat.rubber, ringX(1.36, 1.95, 3.0, 3.25));
    A.meshes(brgP.node);
  }

  // ======== Propeller flange and starter ring gear support (rotate with the crank) =========================
  const flangeP = part("engine.propflange", "Propeller flange and bushings", [
    ipc(4, 4, "LW-18817-S", "BUSHING, Propeller flange, long", 1), ipc(4, 5, "LW-18815-S", "BUSHING, Propeller flange, short", 5),
    fact("Face", "Origin of the engine frame (x = 0)", SRC.top), fact("Propeller", "75 in fixed pitch, 2 blades", "Engines/prop_75in2f.xml"),
  ], `${EST} Flange diameter estimated; six bushings on a 4.75 in circle (estimated).`, [-0.35, 0, 0]);
  const flangeSpin = new THREE.Group(); flangeP.node.add(flangeSpin);
  {
    const A = Acc();
    A.add(mat.steel, cx(3.2, 0, 0.45, 0, 0, 40));
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; A.add(mat.brass, cx(0.36, -0.4, 0.02, 2.375 * Math.sin(a), 2.375 * Math.cos(a), 12)); }
    A.add(mat.steel, cx(1.6, -0.55, 0, 0, 0, 28));
    A.meshes(flangeSpin);
  }
  const ringP = part("engine.ringgear", "Starter ring gear and alternator pulley", [
    ipc(4, 9, "76628", "SUPPORT ASSEMBLY, Starter ring gear", 1), ipc(4, 10, "72566", "GEAR, Starter ring, 12/14 pitch", 1),
    fact("Ring gear", "Plane 1.64 in aft of the flange, 12.7 in outside diameter", SRC.top),
    fact("Alternator drive", "V-belt groove on the support; alternator turns 3.25 × crank speed", "Operator's Manual p. 2-3"),
  ], `${EST} Pulley groove radius chosen to give the published 3.25:1 ratio with the alternator pulley.`, [-0.28, 0, 0]);
  const ringSpin = new THREE.Group(); ringP.node.add(ringSpin);
  {
    const A = Acc(), al = mat.alu, R = Lo.ringGear;
    A.add(al, cx(3.75, 0.45, 0.55, 0, 0, 48));
    A.add(al, cx(3.75, 0.55, 0.9, 0, 0, 48, 3.4)); A.add(al, cx(3.4, 0.9, 1.25, 0, 0, 48, 3.75));     // V groove
    A.add(al, cx(3.75, 1.25, 1.35, 0, 0, 48));
    A.add(al, cx(3.7, 1.35, 1.5, 0, 0, 48, 5.95));                                                  // web out to the gear
    A.add(al, cx(2.5, 1.35, 2.6, 0, 0, 32, 2.35));                                                  // hub into the case nose
    A.add(mat.steel, gearX(R.od / 2, R.teeth, R.x - 0.22, 0.44, 0, 0, 5.85));
    A.meshes(ringSpin);
  }

  // ======== Camshaft (fig 5 item 8) ======================================================================
  // Six lobes: an exhaust lobe for each cylinder and two intake lobes each shared by an opposed pair (1-2, 3-4).
  const camP = part("engine.camshaft", "Camshaft and gear", [
    ipc(5, 8, "LW-18840", "CAMSHAFT ASSEMBLY", 1),
    fact("Position", "Above and parallel to the crankshaft; drives the tachometer shaft at half crank speed", "Operator's Manual p. 1-1, p. 2-3"),
    fact("Lobes", "6: one exhaust lobe per cylinder, intake lobes shared by cylinders 1-2 and 3-4 (2.31 in bank stagger = tappet spacing)", "derived from IPC top view"),
    fact("Drive", "Gear on the rear end, meshing with the crankshaft gear (2:1)", fig(5)),
  ], `${EST} Lobe profile follows the illustrative valve events; lobe lift and the cam height (3.75 in) are estimated.`, [0, 0.14, 0]);
  const cam = new THREE.Group(); cam.position.set(0, Lo.camY * IN, 0); camP.node.add(cam);
  const valveTiming = { intake: [360 - S.io_btdc, 540 + S.ic_abdc], exhaust: [180 - S.eo_bbdc, 360 + S.ec_atdc] };
  {
    const A = Acc(), st = mat.steel, base = Lo.camBase, liftCam = S.valve_lift_in / 1.06;
    A.add(st, cx(0.42, 5.3, 20.5, 0, 0, 16));
    for (const [a, b] of [[5.5, 6.6], [13.15, 13.95], [19.7, 20.35]]) A.add(st, cx(0.62, a, b, 0, 0, 20));
    const lobes = new Map();
    Lo.cylX.forEach((x, i) => {
      for (const kind of ["intake", "exhaust"]) {
        const lx = kind === "intake" ? -Lo.vx : Lo.vx, xe = +(x + SIDE[i] * lx).toFixed(3);
        const [o, c] = valveTiming[kind], peak = firingAngle[i + 1] + ((o + ((c - o + 720) % 720) / 2) % 720);
        const psi = (SIDE[i] < 0 ? Math.PI : 0) + THREE.MathUtils.degToRad(peak / 2);
        const hw = THREE.MathUtils.degToRad(((c - o + 720) % 720) / 4);
        if (!lobes.has(xe)) lobes.set(xe, { psi, hw, n: 0 });
        lobes.get(xe).n++;
      }
    });
    for (const [xe, lb] of lobes) {
      const pts = [];
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2 - Math.PI; let rr = base;
        if (Math.abs(a) < lb.hw) rr += liftCam * Math.sin(Math.PI * (a + lb.hw) / (2 * lb.hw));
        pts.push(P(rr * Math.sin(lb.psi + a), rr * Math.cos(lb.psi + a)));
      }
      const w = lb.n > 1 ? 0.8 : 0.55;
      A.add(st, extX(polyShape(pts), xe - w / 2, w));
    }
    A.add(st, gearX(Lo.camY - Lo.gears.crankR, 52, Lo.gears.x, Lo.gears.w, 0, 0, 0.5));
    A.add(st, cx(0.9, 20.0, Lo.gears.x, 0, 0, 20));
    A.meshes(cam);
  }

  // ======== Idler gears and tachometer shaft (fig 5 items 1, 2, 5) ==========================================
  const G = Lo.gears, idlerDist = G.crankR + G.idlerR;
  function idlerAt(zMag) {                     // idler centre meshing both the crank gear and a magneto gear
    const c1 = [Lo.mag.y, zMag], d = Math.hypot(...c1), a = d / 2, h = Math.sqrt(Math.max(0, idlerDist * idlerDist - a * a));
    const m = [c1[0] / 2, c1[1] / 2], perp = [c1[1] / d, -c1[0] / d];
    const s1 = [m[0] + h * perp[0], m[1] + h * perp[1]], s2 = [m[0] - h * perp[0], m[1] - h * perp[1]];
    return s1[0] < s2[0] ? s1 : s2;           // the lower solution, clear of the camshaft gear
  }
  const idlerP = part("engine.idler_gears", "Crankshaft idler gears and tachometer shaft", [
    ipc(5, 1, "74996", "GEAR ASSEMBLY, Crankshaft idler, plain", 2), ipc(5, 5, "LW-13796", "SHAFT, Crankshaft idler gear", 2), ipc(5, 2, "76121", "SHAFT ASSEMBLY, Tachometer", 1),
    fact("Drive", "Crankshaft gear → idler → magneto gear, magnetos at crank speed; tachometer from the camshaft at 0.5 ×", "Operator's Manual p. 2-3"),
  ], `${EST} Gear sizes chosen to give the published ratios; positions solved so the gears mesh.`, [0.12, 0, 0]);
  const idlers = [];
  {
    for (const zMag of [Lo.mag.zL, Lo.mag.zR]) {
      const [yy, zz] = idlerAt(zMag), A = Acc(), g = new THREE.Group();
      g.position.set(0, yy * IN, zz * IN); idlerP.node.add(g);
      A.add(mat.steel, gearX(G.idlerR, 28, G.x, G.w, 0, 0, 0.4)); A.add(mat.dark, cx(0.42, 19.9, G.x + G.w + 0.2, 0, 0, 12));
      A.meshes(g); idlers.push(g);
    }
    const A = Acc(), tach = new THREE.Group(); tach.position.set(0, Lo.camY * IN, 0); idlerP.node.add(tach);
    A.add(mat.steel, cx(0.3, G.x + G.w, Lo.accRear + 0.5, 0, 0, 12)); A.add(mat.steel, cx(0.5, Lo.accRear + 0.1, Lo.accRear + 0.4, 0, 0, 6));
    A.meshes(tach); idlers.tach = tach;
  }

  // ======== Per-cylinder assemblies ========================================================================
  // Canonical geometry, built once and shared by all four cylinders.
  const VX = Lo.vx, U = norm(Lo.valveAxis), seatPt = kind => [kind === "intake" ? -VX : VX, 0, Lo.seatZ];
  const pushBase = kind => [kind === "intake" ? -VX : VX, Lo.camY, Lo.tappet[1]];
  const pushEnd = kind => [kind === "intake" ? -VX : VX, Lo.pushTop[0], Lo.pushTop[1]];
  const pushDir = norm([0, Lo.pushTop[0] - Lo.camY, Lo.pushTop[1] - Lo.tappet[1]]);
  const pushLen = Math.hypot(Lo.pushTop[0] - Lo.camY, Lo.pushTop[1] - Lo.tappet[1]);
  const coverOutline = () => rrect(Lo.coverW, Lo.coverH, 1.4, 0, Lo.coverY);

  const cylGeo = Acc();                       // barrel + head (fig 8 item 1)
  {
    const A = cylGeo;
    const fl = rrect(6.6, 6.9, 1.6); fl.holes.push(new THREE.Path().absarc(0, 0, 2.62, 0, Math.PI * 2, true));
    A.add(mat.cyl, extZ(fl, Lo.pad, Lo.flange - Lo.pad, 0, 8));                        // hold-down flange
    A.add(mat.cyl, ringZ(2.56, 2.75, 3.4, Lo.pad, 0, 0, 40));                          // skirt into the case
    A.add(mat.cyl, ringZ(2.6, 2.86, Lo.flange, 8.7, 0, 0, 40));                        // barrel
    for (let z = Lo.barrelFin[0]; z <= Lo.barrelFin[1] + 1e-6; z += 0.2) A.add(mat.fin, ringZ(2.8, 3.1, z, z + 0.065, 0, 0, 36));
    // head casting
    A.add(mat.head, rbox([0, 0, 10.4], [5.3, 6.2, 3.8], 0.9, 3));
    const fin = rrect(6.7, 6.9, 1.7);
    for (let z = 8.62; z <= 12.2; z += 0.2) A.add(mat.headFin, extZ(fin, z, 0.06, 0, 4));
    // rocker box walls and flange, pushrod bosses, rocker shaft bosses
    const wall = coverOutline(); wall.holes.push(rrectPath(Lo.coverW - 0.5, Lo.coverH - 0.5, 1.15, 0, Lo.coverY));
    A.add(mat.head, extZ(wall, Lo.box[0], Lo.box[1] - Lo.box[0] - 0.15, 0, 6));
    const lip = rrect(Lo.coverW + 0.3, Lo.coverH + 0.3, 1.55, 0, Lo.coverY); lip.holes.push(rrectPath(Lo.coverW - 0.5, Lo.coverH - 0.5, 1.15, 0, Lo.coverY));
    A.add(mat.head, extZ(lip, Lo.box[1] - 0.15, 0.15, 0, 6));
    A.add(mat.head, rbox([0, Lo.coverY, Lo.box[0] + 0.1], [Lo.coverW - 0.2, Lo.coverH - 0.2, 0.2], 0.08));
    for (const kind of ["intake", "exhaust"]) {
      const b = pushBase(kind);
      A.add(mat.head, seg(add3(b, pushDir, 9.0), add3(b, pushDir, 10.4), 0.52, 0.5, 16));
    }
    for (const sx of [-1, 1]) A.add(mat.head, cx(0.42, sx * 2.35, sx * 2.85, Lo.pivot[0], Lo.pivot[1], 14));
    // ports: intake (fwd in canonical) and exhaust, both on the bottom, 2-bolt flanges
    const ip = Lo.intakePort, ep = Lo.exhaustPort;
    A.add(mat.head, cy(0.95, -2.3, ip[1] + 0.2, ip[0], ip[2], 20));
    A.add(mat.head, cy(0.82, -2.3, ep[1] + 0.2, ep[0], ep[2], 20));
    const pf = (w, h, at) => { const s = rrect(w, h, 0.45); const g = extZ(s, 0, 0.2, 0, 4); g.rotateX(Math.PI / 2); g.translate(at[0], at[1] + 0.2, at[2]); return g; };
    A.add(mat.head, pf(1.9, 3.1, ip)); A.add(mat.head, pf(1.7, 2.9, ep));
    // spark-plug bosses
    for (const pl of [Lo.plugTop, Lo.plugBottom]) A.add(mat.head, seg(add3(pl.at, pl.dir, -1.2), add3(pl.at, pl.dir, 0.05), 0.62, 0.55, 16));
    // valve guides showing in the rocker box
    for (const kind of ["intake", "exhaust"]) A.add(mat.head, seg(add3(seatPt(kind), U, 1.2), add3(seatPt(kind), U, 1.95), 0.32, 0.28, 12));
  }
  const coverGeo = Acc();                     // rocker box cover (fig 10 item 7)
  {
    coverGeo.add(mat.cover, extZ(coverOutline(), Lo.cover[0], 0.18, 0, 8));                 // screw flange
    const s = rrect(Lo.coverW - 2.2, Lo.coverH - 2.0, 0.7, 0, Lo.coverY);
    coverGeo.add(mat.cover, extZ(s, Lo.cover[0] + 0.18 + 0.45, 0.42, 0.45, 8));
    const rib = rrect(2.8, 0.35, 0.15, 0, Lo.coverY + 1.2); coverGeo.add(mat.cover, extZ(rib, Lo.cover[1] - 0.05, 0.08, 0, 2));
  }
  const pistonGeo = Acc();                    // piston, rings, pin (fig 7 items 6-10); origin at the pin, crown +z
  {
    const A = pistonGeo, R = S.bore_in / 2 - 0.006;
    A.add(mat.alu, cz(R, -1.25, 1.6, 0, 0, 40));
    for (const z of [1.38, 1.13, 0.82]) A.add(mat.dark, ringZ(R - 0.02, R + 0.004, z - 0.04, z + 0.04, 0, 0, 40));
    A.add(mat.steel, cx(0.55, -2.42, 2.42, 0, 0, 16));
  }
  const rodGeo = Acc();                       // connecting rod (fig 7 items 1-5); z along the rod, big end at -L/2
  {
    const A = rodGeo, h = lIn / 2;
    A.add(mat.steel, ringX(1.125, 1.52, -0.52, 0.52, 0, -h, 32));
    A.add(mat.brass, ringX(1.08, 1.125, -0.5, 0.5, 0, -h, 32));
    for (const sy of [-1, 1]) A.add(mat.steel, rbox([0, sy * 1.42, -h], [0.9, 0.62, 2.1], 0.12));
    A.add(mat.steel, box([0, 0, -h - 1.35], [0.95, 2.2, 0.35]));                       // cap bridge
    A.add(mat.steel, rbox([0, 0, 0.2], [0.42, 0.95, lIn - 2.6], 0.1));                 // web
    for (const sx of [-1, 1]) A.add(mat.steel, box([sx * 0.33, 0, 0.2], [0.18, 1.05, lIn - 2.6]));   // I-beam flanges
    A.add(mat.steel, ringX(0.55, 0.88, -0.5, 0.5, 0, h, 24));
    A.add(mat.brass, ringX(0.5, 0.55, -0.48, 0.48, 0, h, 24));
  }
  const valveGeo = { intake: Acc(), exhaust: Acc() };   // valve + upper seat + keys, local +z along the stem
  for (const kind of ["intake", "exhaust"]) {
    const A = valveGeo[kind], rv = kind === "intake" ? 1.0 : 0.85;
    A.add(kind === "intake" ? mat.steel : mat.exhaust, cz(rv, 0, 0.12, 0, 0, 28));
    A.add(kind === "intake" ? mat.steel : mat.exhaust, cz(rv * 0.93, 0.12, 0.45, 0, 0, 28, 0.22));
    A.add(mat.steel, cz(0.2, 0.45, Lo.stem, 0, 0, 10));
    A.add(mat.dark, cz(0.72, 2.95, 3.08, 0, 0, 20, 0.52));
    if (kind === "exhaust") A.add(mat.dark, cz(0.27, Lo.stem - 0.05, Lo.stem + 0.1, 0, 0, 12));
  }
  const springLen = 0.96, springAt = 1.99;
  const springGeo = Acc(); springGeo.add(mat.steel, helix(0.6, 0.085, springLen, 5.5)); springGeo.add(mat.steel, helix(0.43, 0.06, springLen, 6.5));
  const rockerGeo = Acc();                    // one valve rocker (fig 10 item 2), origin at the shaft
  {
    const A = rockerGeo, pe = [0, Lo.pushTop[0] - Lo.pivot[0], Lo.pushTop[1] - Lo.pivot[1]];
    const ve = add3(add3(seatPt("intake"), U, Lo.stem), [VX, -Lo.pivot[0], -Lo.pivot[1]]);
    A.add(mat.steel, cx(0.4, -0.3, 0.3, 0, 0, 16));
    A.add(mat.steel, seg([0, 0, 0], pe, 0.2, 0.17, 10)); A.add(mat.steel, sphere(pe, 0.24, 10));
    A.add(mat.steel, seg([0, 0, 0], ve, 0.21, 0.18, 10)); A.add(mat.steel, rbox(add3(ve, [0, 0, 0.05]), [0.42, 0.4, 0.22], 0.08));
  }
  const pushrodGeo = Acc();                   // push rod (fig 10 item 1), local +z along the rod
  pushrodGeo.add(mat.steel, cz(0.16, 0.1, pushLen - 0.1, 0, 0, 8)); pushrodGeo.add(mat.steel, sphere([0, 0, 0.12], 0.21, 10)); pushrodGeo.add(mat.steel, sphere([0, 0, pushLen - 0.12], 0.21, 10));
  const tappetGeo = Acc();                    // hydraulic tappet body + plunger + socket (fig 3 item 10, fig 9 items 12-13)
  tappetGeo.add(mat.steel, cz(0.36, Lo.tappet[0], Lo.tappet[1], 0, 0, 16)); tappetGeo.add(mat.dark, cz(0.3, Lo.tappet[1] - 0.25, Lo.tappet[1] + 0.03, 0, 0, 14));
  const shroudGeo = Acc();                    // push-rod shroud tubes + spring + seals (fig 9 items 14, 15)
  for (const kind of ["intake", "exhaust"]) {
    const b = pushBase(kind), a0 = add3(b, pushDir, 1.6), a1 = add3(b, pushDir, 9.15);
    shroudGeo.add(mat.shroud, seg(a0, a1, 0.375, 0.375, 18));
    shroudGeo.add(mat.rubber, seg(add3(a0, pushDir, -0.2), add3(a0, pushDir, 0.35), 0.45, 0.45, 18));
    shroudGeo.add(mat.rubber, seg(add3(a1, pushDir, -0.25), add3(a1, pushDir, 0.05), 0.44, 0.44, 18));
    shroudGeo.add(mat.steel, seg(add3(a0, pushDir, 0.35), add3(a0, pushDir, 0.9), 0.42, 0.42, 18));
  }
  const plugGeo = Acc();                      // two Champion REM38E plugs (fig 21 item 12)
  for (const pl of [Lo.plugTop, Lo.plugBottom]) {
    const qd = quatZ(pl.dir), g1 = cz(0.48, 0.05, 0.45, 0, 0, 6), g2 = cz(0.33, 0.45, 2.3, 0, 0, 14), g3 = cz(0.38, 2.3, 2.55, 0, 0, 6);
    for (const [g, m] of [[g1, mat.gold], [g2, mat.steel], [g3, mat.steel]]) plugGeo.add(m, xform(g, pl.at, qd));
  }
  const rockShaftGeo = Acc();                 // rocker shaft + thrust buttons (fig 10 items 4, 5)
  rockShaftGeo.add(mat.steel, cx(0.3, -2.35, 2.35, Lo.pivot[0], Lo.pivot[1], 14));
  for (const sx of [-1, 1]) rockShaftGeo.add(mat.brass, cx(0.33, sx * 2.35, sx * 2.6, Lo.pivot[0], Lo.pivot[1], 14));
  const springSeatGeo = Acc();
  for (const kind of ["intake", "exhaust"]) springSeatGeo.add(mat.dark, xform(cz(0.72, -0.08, 0, 0, 0, 20), add3(seatPt(kind), U, springAt), quatZ(U)));

  const VLIFT = S.valve_lift_in, ROCK_ARM_V = Math.hypot(...add3(add3(seatPt("intake"), U, Lo.stem), [VX, -Lo.pivot[0], -Lo.pivot[1]]));
  const ROCK_ARM_P = Math.hypot(Lo.pushTop[0] - Lo.pivot[0], Lo.pushTop[1] - Lo.pivot[1]);
  const PLIFT = VLIFT * ROCK_ARM_P / ROCK_ARM_V;

  const cyl = [];
  for (let i = 0; i < 4; i++) {
    const n = i + 1, s = SIDE[i], x = THROWS[i], side = s < 0 ? "Right" : "Left", pos = `${side} ${i < 2 ? "front" : "rear"}`;
    const ex = (z, y = 0) => [0, y, s * z];
    // cylinder
    const cp = part(`engine.cyl${n}`, `Cylinder ${n}`, [
      ipc(8, 1, "LW-12416", "CYLINDER ASSEMBLY, Nitrided (with valve seats 72057/72058, guides 76943/16R22126, rocker shaft bushings 66610)", 4),
      fact("Bore", `${S.bore_in} in`, SRC.tcds), fact("Compression ratio", "8.5:1", SRC.tcds),
      fact("Position", `${pos}, axis ${Lo.cylX[i]} in aft of the flange; odd cylinders right`, SRC.top),
      fact("Length", "Pad face 4.5 in to rocker cover 16.12 in from the crank axis", SRC.top),
      fact("Ports", "Intake and exhaust on the bottom of the head; intake valve on the side nearer the sump connection", fig(8)),
    ], `${EST} Fin counts and head outline from IPC fig 8; hold-down stud pattern estimated (bolt circle not printed).`, ex(0.32));
    const cf = frame(cp, i);
    cylGeo.meshes(cf);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(bore / 2 - 0.004, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffa03a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(0, 0, 10.15 * IN); glow.scale.set(1, 1, 0.45); cf.add(glow);
    // rocker cover
    const cvP = part(`engine.cover${n}`, `Rocker box cover ${n}`, [ipc(10, 7, "61247", "COVER, Rocker box", 4), fact("Fastening", "6 screws 1/4-20 × 5/8 and a gasket", fig(10))], EST, ex(0.37));
    coverGeo.meshes(frame(cvP, i));
    // valves and springs
    const vP = part(`engine.valves${n}`, `Valves and springs ${n}`, [
      ipc(9, 1, "17A23938", "VALVE, Intake", 4), ipc(9, 2, "17B23936", "VALVE, Exhaust", 4), ipc(9, 3, "LW-11795", "SPRING, Valve, inner", 8), ipc(9, 4, "LW-11800", "SPRING, Valve, outer", 8),
      ipc(9, 7, "LW-10077", "SEAT, Valve spring, upper intake", 4), ipc(9, 8, "LW-16475", "SEAT, Valve spring, upper exhaust (rotator)", 4), ipc(9, 11, "17C19386", "CAP, Valve stem exhaust", 4),
      fact("Lift", `${VLIFT} in (illustrative)`, "estimated"), fact("Events", `IO ${S.io_btdc}° BTDC, IC ${S.ic_abdc}° ABDC, EO ${S.eo_bbdc}° BBDC, EC ${S.ec_atdc}° ATDC (illustrative)`, "estimated"),
    ], `${EST} Valve inclination and diameters estimated.`, ex(0.5, 0.02));
    const vf = frame(vP, i);
    springSeatGeo.meshes(vf);
    const valves = [], springs = [];
    for (const kind of ["intake", "exhaust"]) {
      const v = new THREE.Group(), base = V3(...seatPt(kind)).multiplyScalar(IN), axis = V3(...U);
      v.position.copy(base); v.quaternion.copy(quatZ(U)); vf.add(v); valveGeo[kind].meshes(v);
      const sp = new THREE.Group(); sp.position.copy(V3(...add3(seatPt(kind), U, springAt)).multiplyScalar(IN)); sp.quaternion.copy(quatZ(U)); vf.add(sp); springGeo.meshes(sp);
      valves.push({ kind, obj: v, base, axis, spring: sp });
    }
    // rockers and shaft
    const rP = part(`engine.rockers${n}`, `Valve rockers and shaft ${n}`, [
      ipc(10, 2, "17F19357", "ROCKER ASSEMBLY, Valve (bushing 74637)", 8), ipc(10, 4, "LW-13790", "SHAFT, Valve rocker", 4), ipc(10, 5, "LW-12892", "THRUST BUTTON, Rocker shaft", 8),
      fact("Arrangement", "Both rockers on one shaft running fore and aft in the rocker box", fig(10)),
    ], `${EST} Rocker arm ratio about ${(ROCK_ARM_V / ROCK_ARM_P).toFixed(2)} (estimated).`, ex(0.44, 0.04));
    const rf = frame(rP, i); rockShaftGeo.meshes(rf);
    const rockers = ["intake", "exhaust"].map(kind => { const g = new THREE.Group(); g.position.set((kind === "intake" ? -VX : VX) * IN, Lo.pivot[0] * IN, Lo.pivot[1] * IN); rf.add(g); rockerGeo.meshes(g); return g; });
    // push rods
    const prP = part(`engine.pushrods${n}`, `Push rods ${n}`, [
      ipc(10, 1, "15F19957-08…-15", "ROD ASSEMBLY, Push (selective length, as required)", 8),
      fact("Path", "From the hydraulic tappets above the crankshaft out along the top of the barrel to the rockers", SRC.top)], EST, ex(0.2, 0.1));
    const pf = frame(prP, i);
    const pushrods = ["intake", "exhaust"].map(kind => { const g = new THREE.Group(), b = V3(...pushBase(kind)).multiplyScalar(IN); g.position.copy(b); g.quaternion.copy(quatZ(pushDir)); pf.add(g); pushrodGeo.meshes(g); return { obj: g, base: b, dir: V3(...pushDir) }; });
    // shroud tubes
    const shP = part(`engine.shrouds${n}`, `Push-rod shroud tubes ${n}`, [ipc(9, 14, "68987", "SHROUD TUBE ASSEMBLY, Push rod", 8), ipc(9, 15, "LW-14995", "SPRING, Shroud tube", 4),
      fact("Position", "Two per cylinder above the barrel, 2.31 in apart, case to rocker box", SRC.top)], EST, ex(0.24, 0.16));
    shroudGeo.meshes(frame(shP, i));
    // tappets
    const tP = part(`engine.tappets${n}`, `Hydraulic tappets ${n}`, [ipc(3, 10, "15B26262", "BODY, Hydraulic tappet (flat tappet build)", 8), ipc(9, 12, "15B26066", "PLUNGER ASSEMBLY, Hydraulic lifter", 8), ipc(9, 13, "15B21319", "SOCKET, Hydraulic tappet", 8)],
      `${EST} Tappet bores horizontal at the camshaft height.`, ex(0.1, 0.08));
    const tf = frame(tP, i);
    const tappets = ["intake", "exhaust"].map(kind => { const g = new THREE.Group(), b = V3(kind === "intake" ? -VX : VX, Lo.camY, 0).multiplyScalar(IN); g.position.copy(b); tf.add(g); tappetGeo.meshes(g); return { obj: g, base: b }; });
    // spark plugs
    const plP = part(`engine.plugs${n}`, `Spark plugs ${n}`, [ipc(21, 12, "1182-E7", "SPARK PLUG, Champion REM38E", 8), fact("Gap / timing", `Fired ${S.spark_btdc_deg}° BTDC, one plug by each magneto`, SRC.tcds)], EST, ex(0.42, 0.04));
    plugGeo.meshes(frame(plP, i));
    const plugs = [Lo.plugTop, Lo.plugBottom].map(pl => V3(...toEngine(i, add3(pl.at, pl.dir, 2.55))).multiplyScalar(IN));
    // piston and rod (engine frame, moved by update)
    const pp = part(`engine.piston${n}`, `Piston ${n}`, [ipc(7, 6, "14D23912", "PISTON, 8.50:1 compression ratio", 4), ipc(7, 7, "LW-14078", "PIN, Piston", 4), ipc(7, 9, "74241", "RING, Piston compression", 8), ipc(7, 10, "14H21950", "RING, Piston, oil", 4),
      fact("Diameter", `${S.bore_in} in`, SRC.tcds)], `${EST} Pin-to-crown height 1.6 in estimated.`, ex(0.2));
    const piston = new THREE.Group(); if (s < 0) piston.rotation.y = Math.PI; pp.node.add(piston); pistonGeo.meshes(piston);
    const rp = part(`engine.rod${n}`, `Connecting rod ${n}`, [ipc(7, 1, "78030-S", "CONNECTING ROD ASSEMBLY (bushing LW-13923)", 4), ipc(7, 5, "18M26104", "BEARING, Connecting rod", 8),
      fact("Length (centres)", `${S.rod_in} in`, "illustrative")], `${EST} Centre distance as engine.js.`, ex(0.1));
    const rod = new THREE.Group(); rp.node.add(rod); rodGeo.meshes(rod);
    cyl.push({ n, i, s, x, piston, rod, glow, valves, plugs, cp, rockers, pushrods, tappets });
  }

  // ======== Intake pipes (fig 12) and the sump (fig 14) ===================================================
  const SU = Lo.sump;
  const sumpP = part("engine.sump", "Oil sump and induction riser", [
    ipc(14, 2, "LW-10828", "SUMP ASSEMBLY, Oil", 1), ipc(14, 3, "78914", "CONNECTION, Intake pipe", 4), ipc(14, 13, "70484", "SCREEN, Oil suction screen", 1),
    fact("Induction", "Carburetor on the bottom; the mixture rises through the riser inside the oil and leaves by four side connections, one per cylinder", "Operator's Manual p. 1-1"),
    fact("Size", "About 15.0 wide (with connections) × 8.9 long; flange 6.7 in, bottom 11.7 in below the crank axis", `${SRC.om73}; ${SRC.om74}`),
  ], `${EST} Body taper and connection heights estimated.`, [0, -0.3, 0]);
  {
    const A = Acc(), cs = mat.case, len = SU.x[1] - SU.x[0];
    const tr = new THREE.Shape(); [[SU.y[1], -SU.halfW], [SU.y[1], SU.halfW], [SU.y[0] + 0.6, SU.halfW - 0.6], [SU.y[0], SU.halfW - 1.0], [SU.y[0], -SU.halfW + 1.0], [SU.y[0] + 0.6, -SU.halfW + 0.6]]
      .forEach(([yy, zz], k) => { const v = P(yy, zz); k ? tr.lineTo(v.x, v.y) : tr.moveTo(v.x, v.y); });
    A.add(cs, extX(tr, SU.x[0] + 0.25, len - 0.5, 0.25, 2));
    A.add(cs, rbox([(SU.x[0] + SU.x[1]) / 2, SU.y[1] - 0.15, 0], [len + 0.3, 0.3, 2 * SU.halfW + 0.6], 0.12));     // flange
    for (const xc of SU.conn) for (const sz of [-1, 1]) A.add(cs, cz(0.98, sz * (SU.halfW - 0.4), sz * SU.connZ, xc, SU.connY, 24));
    A.add(cs, rbox([Lo.carb.x, SU.y[0] - 0.15, 0], [3.5, 0.3, 3.5], 0.1));                                            // carburetor pad
    A.add(cs, cx(0.62, SU.x[1] - 0.2, SU.x[1] + 0.25, -10.2, 1.6, 16));                                               // suction screen boss
    A.add(cs, cy(0.5, SU.y[0] - 0.2, SU.y[0], 13.0, 0, 8)); A.add(cs, cy(0.5, SU.y[0] - 0.2, SU.y[0], 19.6, 0, 8));
    // internal riser and runners (seen in x-ray)
    A.add(mat.alu, cy(1.35, SU.y[0], -7.6, Lo.carb.x, 0, 24));
    for (const xc of SU.conn) for (const sz of [-1, 1]) A.add(mat.alu, tube([[Lo.carb.x, -7.9, 0], [(Lo.carb.x + xc) / 2, -8.1, sz * 1.8], [xc, SU.connY, sz * 3.6], [xc, SU.connY, sz * (SU.halfW - 0.3)]], 0.7, 20, 10));
    A.add(mat.dark, cx(0.45, 15.0, SU.x[1], -10.2, 1.6, 12));                                                         // suction screen
    A.meshes(sumpP.node);
  }
  const intakeP = part("engine.intake", "Intake pipes", [
    ipc(12, 1, "74084", "PIPE, Intake", 4), ipc(12, 2, "69603", "HOSE, 1-3/4 I.D. × 2-3/16 O.D. × 1-3/4 long", 4), ipc(12, 5, "73346", "FLANGE, Intake pipe, upper", 4),
    fact("Path", "Sump connection (hose, 2 clamps) up and out to the 2-bolt flange under each head", `${fig(12)}; ${SRC.om73}`),
  ], `${EST} Bend radii estimated; end points fixed by the sump connections and the head ports.`, [0, -0.18, 0]);
  const pipeRoutes = [];
  {
    const A = Acc();
    for (let i = 0; i < 4; i++) {
      const s = SIDE[i], port = toEngine(i, Lo.intakePort), xc = SU.conn[i < 2 ? 0 : 1], xp = port[0];
      const pts = [[xp, port[1] + 0.1, port[2]], [xp, -5.3, s * 12.0], [xp + (xc - xp) * 0.35, -7.0, s * 10.9], [xc - (xc - xp) * 0.1, SU.connY, s * 8.9], [xc, SU.connY, s * 7.7]];
      pipeRoutes.push(pts);
      A.add(mat.alu, tube(pts, 0.88, 40, 14));
      A.add(mat.rubber, cz(1.08, s * (SU.connZ - 0.2), s * 8.0, xc, SU.connY, 24));
      A.add(mat.alu, (() => { const g = extZ(rrect(1.9, 3.1, 0.45), 0, 0.22, 0, 4); g.rotateX(Math.PI / 2); g.translate(xp, port[1] + 0.02, port[2]); return g; })());
    }
    A.meshes(intakeP.node);
  }

  // ======== Carburetor (fig 20) ===========================================================================
  const CB = Lo.carb;
  const carbP = part("engine.carburetor", "Carburetor (Marvel-Schebler MA-4SPA)", [
    ipc(20, 2, "61B26214", "CARBURETOR, LVC-5-4PA (vendor AV 10-5217, MA-4SPA family)", 1),
    fact("Type", "Updraft float carburetor on the bottom of the sump; air enters from the air box below", "Operator's Manual p. 1-1"),
    fact("Feeds from", "Fuel strainer by gravity; float chamber meters fuel into the venturi", "Systems/fuel.xml"),
    fact("Mount", "4 studs 5/16-18 on a square flange, gasket 66224", fig(20)),
  ], `${EST} Body and levers after the catalog drawing; bottom height estimated from the 23.0 in envelope.`, [0, -0.42, 0]);
  {
    const A = Acc(), y0 = CB.flangeY - 0.3;                                          // top of the carburetor flange, under the sump pad
    A.add(mat.alu, rbox([CB.x, y0 - 0.15, 0], [3.6, 0.3, 3.6], 0.15));
    A.add(mat.alu, rbox([CB.x, y0 - 1.3, 0], [2.3, 2.0, 2.3], 0.3));                    // throttle body
    A.add(mat.alu, rbox([CB.x - 0.3, y0 - 3.4, 0.2], [4.5, 2.6, 3.9], 0.6));             // float bowl / venturi body
    A.add(mat.alu, rbox([CB.x, CB.bottomY + 0.25, 0], [3.4, 0.5, 3.0], 0.12));           // air inlet flange
    A.add(mat.alu, cy(1.25, CB.bottomY + 0.5, y0 - 4.6, CB.x, 0, 24));
    A.add(mat.steel, cz(0.18, -2.4, 2.4, CB.x + 0.4, y0 - 1.1, 10));                    // throttle shaft
    A.add(mat.steel, box([CB.x + 0.9, y0 - 1.5, -2.5], [1.6, 0.9, 0.15]));               // throttle arm
    A.add(mat.steel, box([CB.x - 1.4, y0 - 2.3, 2.25], [1.2, 0.5, 0.12]));               // mixture arm
    A.add(mat.brass, cx(0.3, CB.x - 3.2, CB.x - 2.4, y0 - 3.0, 0.8, 8));                 // fuel inlet
    A.add(mat.brass, cx(0.28, CB.x + 1.9, CB.x + 2.4, y0 - 4.3, -0.4, 6));               // bowl drain
    A.meshes(carbP.node);
  }

  // ======== Accessory housing (fig 15) and what mounts on it ===============================================
  const accP = part("engine.accessory_housing", "Accessory housing", [
    ipc(15, 2, "21A21533-05", "HOUSING ASSEMBLY, Accessory", 1), ipc(15, 9, "76119", "SHIELD, Accessory breather oil", 1),
    fact("Faces", "Front face on the crankcase rear (20.26 in) and the top rear of the sump; rear face 23.47 in", SRC.top),
    fact("Rear face", "Magnetos upper left and right; tachometer top centre; vacuum pad upper right; oil filter centre; governor pad lower right; fuel pump pad lower left", SRC.om74),
  ], `${EST} Outline after IPC fig 15 and the rear installation drawing.`, [0.25, 0.05, 0]);
  {
    const A = Acc(), cs = mat.case, x0 = Lo.caseRear, x1 = Lo.accRear;
    const out = new THREE.Shape(), pt = (yy, zz, k) => { const v = P(yy, zz); k ? out.lineTo(v.x, v.y) : out.moveTo(v.x, v.y); };
    pt(-6.7, -4.3, 0); pt(-6.7, 4.3, 1); pt(-1.8, 4.6, 1); pt(1.6, 4.6, 1); pt(3.4, 3.3, 1);
    for (let k = 0; k <= 16; k++) { const a = Math.PI / 2 - Math.PI / 2 + (k / 16) * Math.PI; pt(Lo.camY + 2.6 * Math.sin(a), 2.6 * Math.cos(a), 1); }
    pt(3.4, -3.3, 1); pt(1.6, -4.6, 1); pt(-1.8, -4.6, 1); pt(-6.7, -4.3, 1);
    A.add(cs, extX(out, x0 + 0.1, 0.5, 0.1, 4));                                               // flange on the crankcase, over the gear train
    const body = extX(out, x0 + 0.85, x1 - x0 - 1.0, 0.15, 4); body.translate(0, 0.5, 0); body.scale(1, 0.92, 0.88); body.translate(0, -0.5, 0);
    A.add(cs, body);
    for (const zm of [Lo.mag.zL, Lo.mag.zR]) A.add(cs, cx(1.85, 21.6, x1, Lo.mag.y, zm, 28));
    A.add(cs, cx(0.75, x1 - 0.1, x1 + 0.45, Lo.camY, 0, 16));                                   // tachometer drive
    A.add(cs, rbox([x1 + 0.1, 2.9, -2.3], [0.3, 2.7, 2.7], 0.15));                              // vacuum pump pad
    A.add(cs, rbox([x1 + 0.1, -3.0, -2.6], [0.3, 2.6, 2.6], 0.15));                             // governor pad
    A.add(cs, rbox([x1 + 0.1, -3.3, 2.6], [0.3, 2.0, 3.0], 0.15));                              // fuel pump pad
    A.add(cs, cx(1.6, x1 - 0.1, x1 + 0.15, Lo.filter.y, 0, 28));                                // filter pad
    A.add(cs, cx(0.55, x1 - 0.1, x1 + 0.25, 3.4, 2.6, 12));                                     // breather boss
    A.meshes(accP.node);
  }
  const pumpP = part("engine.oil_pump", "Oil pump", [ipc(16, 1, "78531", "BODY ASSEMBLY, Oil pump", 1), ipc(16, 2, "61174", "SHAFT, Oil pump drive", 1), ipc(16, 3, "05K19423-S", "IMPELLER KIT (LW-18110 driven, LW-18109 driving)", 1),
    fact("Location", "Inside the accessory housing, lower centre, driven from the crankshaft gear", fig(16))], `${EST} Visible in x-ray.`, [0.2, -0.05, 0]);
  { const A = Acc(); A.add(mat.alu, rbox([21.8, -2.75, 0], [1.6, 2.3, 2.6], 0.25)); A.add(mat.steel, cx(0.25, 20.5, 21.0, -2.0, 0, 10)); A.meshes(pumpP.node); }
  const fpP = part("engine.fuelpump_cover", "Fuel pump pad cover", [ipc(17, 2, "03D23350", "COVER, Fuel pump", 1),
    fact("Why a cover", "The 172P feeds fuel by gravity; the AN20003 fuel pump pad is blanked off", `${fig(17)}; ${SRC.poh}`)], EST, [0.33, -0.02, 0.03]);
  { const A = Acc(); A.add(mat.case, extX(rrect(3.0, 1.9, 0.8, -2.6, -3.3), Lo.accRear + 0.25, 0.16, 0, 6)); A.meshes(fpP.node); }
  const govP = part("engine.governor_cover", "Propeller governor pad cover", [ipc(18, 2, "69106", "COVER, Governor drive adapter pad", 1),
    fact("Why a cover", "Fixed-pitch propeller: no governor", fig(18))], EST, [0.33, -0.02, -0.03]);
  { const A = Acc(); A.add(mat.case, extX(rrect(2.5, 2.5, 0.4, 2.6, -3.0), Lo.accRear + 0.25, 0.18, 0, 4)); A.add(mat.case, cx(0.7, Lo.accRear + 0.4, Lo.accRear + 0.6, -3.0, -2.6, 16)); A.meshes(govP.node); }
  const vacP = part("engine.vacuum_pump", "Vacuum pump drive and pump", [
    ipc(18, 8, "61098", "ADAPTER ASSEMBLY, Vacuum pump", 1), ipc(18, 11, "72970", "GEAR ASSEMBLY, Vacuum pump driven", 1), ipc(18, 14, "60430", "COVER, Vacuum pump (as shipped)", 1),
    fact("Installed", "Engine-driven dry vacuum pump for the attitude and heading gyros mounts on this pad in the 172P", SRC.poh),
    fact("Drive", "1.300:1 counter-clockwise", "Operator's Manual p. 2-3"),
  ], "The adapter is from IPC fig 18; the pump is an airframe part and its shape is estimated.", [0.4, 0.08, -0.05]);
  {
    const A = Acc(), x1 = Lo.accRear + 0.25;
    A.add(mat.case, rbox([x1 + 0.5, 2.9, -2.3], [1.0, 2.6, 2.6], 0.25));
    A.add(mat.black, cx(1.75, x1 + 1.0, x1 + 1.3, 2.9, -2.3, 24));
    A.add(mat.black, cx(1.5, x1 + 1.3, x1 + 4.2, 2.9, -2.3, 24));
    A.add(mat.black, cx(1.2, x1 + 4.2, x1 + 4.5, 2.9, -2.3, 24));
    A.add(mat.brass, seg([x1 + 3.0, 4.2, -2.3], [x1 + 3.0, 5.0, -2.1], 0.25, 0.25, 8));
    A.meshes(vacP.node);
  }
  const filtP = part("engine.oil_filter", "Oil filter and base", [ipc(19, 6, "77852", "OIL FILTER BASE ASSEMBLY", 1), ipc(19, 7, "LW-13216", "OIL FILTER, Long CH48111-1", 1),
    fact("Length", "Filter end about 30.9 in aft of the propeller flange", SRC.top)], EST, [0.45, 0, 0]);
  {
    const A = Acc(), x1 = Lo.accRear + 0.15, F = Lo.filter;
    A.add(mat.case, rbox([x1 + 0.6, F.y, 0], [1.2, 2.6, 3.0], 0.3));
    A.add(mat.case, cx(1.4, x1 + 1.2, x1 + 1.55, F.y, 0, 28));
    A.add(mat.white, cx(1.85, x1 + 1.55, F.end - 0.45, F.y, 0, 36));
    A.add(mat.white, cx(1.85, F.end - 0.45, F.end - 0.25, F.y, 0, 36, 1.55));
    A.add(mat.steel, cx(0.5, F.end - 0.25, F.end, F.y, 0, 6));
    A.meshes(filtP.node);
  }
  const fitP = part("engine.oil_fittings", "Oil cooler bypass valve and breather fittings", [
    ipc(19, 13, "53E22144", "VALVE ASSEMBLY, Temperature control, oil cooler bypass", 1), ipc(19, 2, "62417", "PLUG, Oil cooler bypass", 1), ipc(19, 3, "71140", "FITTING, Breather", 1),
    fact("Oil cooler", "The cooler itself is an airframe part on the baffles (not modelled)", "IPC structure notes")], EST, [0.3, 0.05, 0.02]);
  {
    const A = Acc(), x1 = Lo.accRear + 0.1;
    A.add(mat.steel, tube([[x1, 3.4, 2.6], [x1 + 0.8, 3.45, 2.6], [x1 + 1.3, 4.3, 2.75]], 0.33, 12, 10));
    A.add(mat.steel, cx(0.5, x1, x1 + 0.6, 3.4, 2.6, 6));
    A.add(mat.case, cx(0.62, x1, x1 + 1.0, -1.6, 3.0, 20)); A.add(mat.steel, cx(0.45, x1 + 1.0, x1 + 1.3, -1.6, 3.0, 6));
    A.add(mat.steel, cx(0.42, x1, x1 + 0.35, 1.8, 3.4, 6));
    A.meshes(fitP.node);
  }
  const gageP = part("engine.oil_gage", "Oil filler tube and level gage", [ipc(13, 1, "56C23075", "TUBE, Oil level gage, 10-9/16 long", 1), ipc(13, 4, "LW-14798", "GAGE ASSEMBLY, Oil level", 1),
    fact("Position", "Right rear of the crankcase, angled up, out and aft", `${fig(13)}; ${SRC.top}`), fact("Capacity", "8 US quarts (172P)", SRC.poh)], `${EST} Tube angle estimated from the top view and photos.`, [0.12, 0.12, -0.12]);
  {
    const A = Acc(), a = [20.4, -3.6, -5.6], d = norm([4.6, 6.6, -7.0]), b = add3(a, d, 10.56);
    A.add(mat.case, seg(a, b, 0.55, 0.5, 16)); A.add(mat.case, seg(add3(a, d, 3.0), add3(a, d, 3.6), 0.65, 0.65, 16));
    A.add(mat.black, seg(b, add3(b, d, 0.55), 0.62, 0.62, 16)); A.add(mat.black, seg(add3(b, d, 0.55), add3(b, d, 0.95), 0.25, 0.25, 8));
    A.meshes(gageP.node);
  }
  const reliefP = part("engine.relief_valve", "Oil pressure relief valve", [ipc(3, 4, "77808", "VALVE ASSEMBLY, Oil pressure relief", 1), ipc(3, 1, "1028-B", "BALL, 11/16 diameter", 1), ipc(3, 2, "61084", "SPRING, Oil pressure relief valve", 1),
    fact("Position", "Upper right side of the crankcase in front of the accessory housing", "Operator's Manual p. 1-2")], `${EST} Exact position estimated.`, [0, 0.1, -0.05]);
  { const A = Acc(); A.add(mat.case, cy(0.6, 3.6, 4.7, 19.6, -2.6, 16)); A.add(mat.steel, cy(0.5, 4.7, 5.1, 19.6, -2.6, 6)); A.meshes(reliefP.node); }

  // ======== Magnetos and harness (fig 21) ==================================================================
  const magFacts = side => [ipc(21, 6, "66GC20SFNN", "MAGNETO, Impulse, Slick 4371", 2), ipc(21, 4, "LW-12706", "ADAPTER, Magneto, impulse coupling", 2), ipc(21, 1, "61665", "GEAR, Magneto, impulse coupling", 2),
    fact("Position", `${side}, axis about crankshaft height, cap end 28.44 in aft`, `${SRC.top}; ${SRC.om74}`),
    fact("Timing", `${S.spark_btdc_deg}° before TDC; drive 1:1 with the crankshaft`, `${SRC.tcds}; Operator's Manual p. 2-3`),
    fact("Fires", side === "Left" ? "Bottom plugs of cylinders 2 and 4, top plugs of 1 and 3" : "Bottom plugs of cylinders 1 and 3, top plugs of 2 and 4", "estimated (harness routing in the bag drawing)"),
    fact("Manual", "Operator's Manual Table 1 lists Slick 4251; the 2016 catalog lists 4371", "IPC structure notes")];
  const magGears = [], magOutlet = {};
  const magParts = { left: part("engine.magneto_left", "Left magneto", magFacts("Left"), `${EST} Slick 4300-series body.`, [0.4, 0.06, 0.06]), right: part("engine.magneto_right", "Right magneto", magFacts("Right"), `${EST} Slick 4300-series body.`, [0.4, 0.06, -0.06]) };
  for (const [key, zm] of [["left", Lo.mag.zL], ["right", Lo.mag.zR]]) {
    const A = Acc(), y = Lo.mag.y, x1 = Lo.accRear, cap = Lo.mag.capX;
    A.add(mat.case, cx(1.75, x1, x1 + 0.28, y, zm, 28));
    A.add(mat.black, cx(1.9, x1 + 0.28, x1 + 0.55, y, zm, 28));
    for (const sy of [-1, 1]) A.add(mat.black, rbox([x1 + 0.42, y + sy * 2.0, zm], [0.27, 0.8, 1.1], 0.1));
    A.add(mat.black, rbox([x1 + 1.95, y, zm], [2.8, 3.0, 3.15], 0.7, 3));
    A.add(mat.black, cx(1.58, x1 + 0.55, x1 + 3.35, y, zm, 28));
    A.add(mat.dark, rbox([(x1 + 3.35 + cap) / 2, y, zm], [cap - x1 - 3.35, 2.9, 3.05], 0.55, 3));
    A.add(mat.dark, cx(0.95, cap - 0.6, cap, y + 0.9, zm, 16));                                  // harness outlet plate
    A.add(mat.brass, seg([x1 + 2.0, y - 1.5, zm], [x1 + 2.0, y - 2.0, zm + Math.sign(zm) * 0.2], 0.2, 0.2, 8));   // P-lead terminal
    A.meshes(magParts[key].node);
    magOutlet[key] = [cap, y + 0.9, zm];
    const g = new THREE.Group(); g.position.set(0, y * IN, zm * IN); magParts[key].node.add(g);
    const B = Acc(); B.add(mat.steel, gearX(G.crankR, 26, G.x, G.w, 0, 0)); B.add(mat.steel, cx(0.35, G.x + G.w, x1 + 0.3, 0, 0, 12)); B.meshes(g); magGears.push(g);
  }
  const harness = { left: part("engine.harness_left", "Ignition harness, left magneto", [ipc(21, 8, "67P20409", "HARNESS ASSEMBLY, Left, Slick M2513", 1), fact("Leads", "4: bottom plugs 2 and 4, top plugs 1 and 3", "estimated")], "Lead routes estimated; clip positions are on the drawing in harness bag 01P19762-1-43.", [0.15, 0.12, 0.04]),
    right: part("engine.harness_right", "Ignition harness, right magneto", [ipc(21, 7, "67P20408", "HARNESS ASSEMBLY, Right, Slick M2512", 1), fact("Leads", "4: bottom plugs 1 and 3, top plugs 2 and 4", "estimated")], "Lead routes estimated; clip positions are on the drawing in harness bag 01P19762-1-43.", [0.15, 0.12, -0.04]) };
  {
    const acc = { left: Acc(), right: Acc() };
    for (const c of cyl) {
      const i = c.i, s = c.s;
      for (const [k, pl] of [[0, Lo.plugTop], [1, Lo.plugBottom]]) {
        // each magneto fires its own side's bottom plugs and the opposite side's top plugs
        const key = k === 0 ? (s < 0 ? "left" : "right") : (s < 0 ? "right" : "left"), O = magOutlet[key], zm = O[2];
        const E = toEngine(i, add3(pl.at, pl.dir, 2.55)), D = dirEngine(i, pl.dir), up = add3(E, D, 0.62);
        const xc = Lo.cylX[i];
        const pts = k === 0
          ? [O, [27.0, 3.4, zm * 0.92], [23.6, 5.4, zm * 0.5], [21.2, 5.3, s * 2.1], [xc + 1.2, 5.15, s * 2.2], [xc, 5.05, s * 4.0], [xc, 4.95, s * 7.5], [xc, 5.35, s * 11.0], up]
          : [O, [27.4, -1.4, zm * 1.2], [23.2, -5.0, zm * 1.32], [20.0, -5.8, s * 6.3], [xc + 0.8, -6.0, s * 6.5], [xc, -6.4, s * 8.4], [xc, -6.55, s * 10.4], up];
        acc[key].add(mat.lead, tube(pts, 0.16, 64, 6));                                          // lead ends in the elbow on the plug terminal
        acc[key].add(mat.steel, seg(add3(E, D, 0.0), add3(E, D, 0.55), 0.36, 0.36, 10));
      }
    }
    acc.left.meshes(harness.left.node); acc.right.meshes(harness.right.node);
  }

  // ======== Starter (fig 22) ===============================================================================
  const ST = Lo.starter;
  const starterP = part("engine.starter", "Starter motor (Sky-Tec 149NL)", [
    ipc(22, 1, "31B23592", "STARTER, 12-24V, 12/14 pitch (Sky-Tec 149NL)", 1),
    fact("Mount", "3 studs + 1 bolt on the pad at the bottom front of the left crankcase half; pinion forward to the ring gear", fig(22)),
    fact("Ratio", "13.556:1 / 16.556:1", "Operator's Manual p. 2-3"), fact("Power", "From the battery via the starter contactor", "Nasal/electrical.nas")],
    `${EST} Motor body after the catalog drawing; pinion placed on the ring gear pitch circle.`, [-0.15, -0.12, 0]);
  {
    const A = Acc(), [by, bz] = ST.body, [py, pz] = ST.pinion;
    A.add(mat.black, cx(ST.r, ST.x[0] + 0.5, ST.x[1], by, bz, 28));
    A.add(mat.alu, cx(ST.r * 0.85, ST.x[1], ST.x[1] + 0.5, by, bz, 24));
    A.add(mat.alu, rbox([ST.x[0] - 0.2, (by + py) / 2, (bz + pz) / 2], [1.8, Math.abs(by - py) + 2.6, 2.6], 0.5));   // nose housing
    A.add(mat.steel, gearX(0.55, 12, 1.42, 0.5, py, pz));
    A.add(mat.black, cx(0.65, ST.x[0] + 1.0, ST.x[1] - 0.8, by - 0.2, bz + 1.95, 16));                              // solenoid
    A.add(mat.alu, rbox([4.9, -5.85, 3.2], [3.2, 0.3, 2.6], 0.1));                                                  // mounting foot on the pad
    A.add(mat.alu, rbox([4.9, (-5.85 + by) / 2, 3.45], [2.6, Math.abs(by + 5.85), 1.6], 0.2));
    A.meshes(starterP.node);
  }

  // ======== Alternator, bracket and belt (fig 1; alternator itself is an airframe part) ==================
  const AL = Lo.alternator;
  const altP = part("engine.alternator", "Alternator", [fact("Output", "28 V, 60 A", "Nasal/electrical.nas"), fact("Drive", "V-belt from the ring-gear support, 3.250:1 clockwise", "Operator's Manual p. 2-3"),
    fact("Location", "Front, lower right", "Operator's Manual p. vi (3/4 right front photo); IPC fig 1")], "Airframe part: not in the Lycoming catalog; shape and size estimated.", [-0.15, -0.12, 0]);
  const altPulley = new THREE.Group(); altPulley.position.set(0, AL.y * IN, AL.z * IN); altP.node.add(altPulley);
  {
    const A = Acc();
    A.add(mat.alu, cx(AL.r, AL.x[0] + 0.4, AL.x[1] - 0.4, AL.y, AL.z, 32));
    A.add(mat.alu, cx(AL.r - 0.2, AL.x[0], AL.x[0] + 0.4, AL.y, AL.z, 32)); A.add(mat.alu, cx(AL.r - 0.2, AL.x[1] - 0.4, AL.x[1], AL.y, AL.z, 32));
    for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; A.add(mat.dark, box([(AL.x[0] + AL.x[1]) / 2, AL.y + (AL.r + 0.02) * Math.sin(a), AL.z + (AL.r + 0.02) * Math.cos(a)], [AL.x[1] - AL.x[0] - 1.2, 0.12, 0.12])); }
    for (const [yy, zz] of [[AL.y + AL.r + 0.25, AL.z], [AL.y - AL.r * 0.6, AL.z + AL.r * 0.85]]) A.add(mat.alu, rbox([AL.x[0] + 1.6, yy, zz], [0.9, 0.7, 0.7], 0.15));   // ears
    A.add(mat.steel, cx(0.3, Lo.pulley.x, AL.x[0], AL.y, AL.z, 12));
    A.meshes(altP.node);
    const B = Acc(); B.add(mat.steel, cx(AL.pulleyR + 0.3, Lo.pulley.x - 0.35, Lo.pulley.x - 0.2, 0, 0, 24)); B.add(mat.steel, cx(AL.pulleyR, Lo.pulley.x - 0.2, Lo.pulley.x + 0.2, 0, 0, 24, AL.pulleyR - 0.3));
    B.add(mat.steel, cx(AL.pulleyR - 0.3, Lo.pulley.x + 0.2, Lo.pulley.x + 0.35, 0, 0, 24, AL.pulleyR + 0.3)); B.add(mat.dark, cx(0.5, Lo.pulley.x + 0.35, Lo.pulley.x + 0.8, 0, 0, 16));
    B.meshes(altPulley);
  }
  const altBrP = part("engine.alt_bracket", "Alternator bracket, brace, link and strut", [ipc(1, 1, "07A21443", "BRACKET, Alternator", 1), ipc(1, 2, "LW-13365", "BRACE, Alternator", 1), ipc(1, 6, "LW-10729", "LINK, Alternator adjusting", 1), ipc(1, 9, "76908", "STRUT, Alternator support", 1),
    fact("Link", "Bolts to the case at 4.47 in, reaching out to z = -6.78 in", SRC.top)], EST, [-0.15, -0.12, 0]);
  {
    const A = Acc(), st = mat.case, ear = [AL.x[0] + 1.6, AL.y + AL.r + 0.25, AL.z];
    A.add(st, rbox([3.9, -5.85, -3.6], [2.6, 0.3, 1.8], 0.08));
    A.add(st, rbox([3.9, -6.45, -4.0], [2.2, 1.2, 0.3], 0.08));
    A.add(st, seg([4.47, 1.8, -4.75], [4.47, -1.2, -6.78], 0.22, 0.22, 8)); A.add(st, seg([4.47, -1.2, -6.78], ear, 0.22, 0.22, 8));
    A.add(st, seg([5.2, -5.6, -3.2], [AL.x[0] + 1.6, AL.y - AL.r * 0.6, AL.z + AL.r * 0.85], 0.2, 0.2, 8));
    A.add(st, seg([4.2, -1.0, -4.3], [AL.x[0] + 2.4, AL.y + AL.r * 0.5, AL.z - AL.r * 0.75], 0.18, 0.18, 8));
    A.meshes(altBrP.node);
  }
  const beltP = part("engine.alt_belt", "Alternator drive belt", [fact("Path", "Ring-gear support groove to the alternator pulley", "Operator's Manual p. vi photo"), fact("Ratio", "3.25:1", "Operator's Manual p. 2-3")], "Airframe/vendor part; belt section estimated.", [-0.2, -0.08, 0]);
  {
    const R1 = Lo.pulley.r + 0.05, R2 = AL.pulleyR + 0.05, c2 = [AL.y, AL.z], d = Math.hypot(...c2), phi = Math.atan2(c2[0], c2[1]), beta = Math.acos((R1 - R2) / d);
    const pts = [];
    for (let k = 0; k <= 48; k++) { const a = phi + beta + (2 * Math.PI - 2 * beta) * k / 48; pts.push([Lo.pulley.x, R1 * Math.sin(a), R1 * Math.cos(a)]); }
    for (let k = 0; k <= 16; k++) { const a = phi - beta + 2 * beta * k / 16; pts.push([Lo.pulley.x, c2[0] + R2 * Math.sin(a), c2[1] + R2 * Math.cos(a)]); }
    const A = Acc(); A.add(mat.belt, tube(pts, 0.2, 160, 6, true)); A.meshes(beltP.node);
  }

  // ======== Drain tubes and intercylinder baffles (fig 11) ===================================================
  const drainP = part("engine.drain_tubes", "Cylinder head oil drain tubes", [ipc(11, 4, "68759", "TUBE ASSEMBLY, Oil drain, cylinder no. 1", 1), ipc(11, 5, "68760", "TUBE ASSEMBLY, Oil drain, cylinder no. 2", 1), ipc(11, 6, "68761", "TUBE ASSEMBLY, Oil drain, cylinders 3 & 4", 2), ipc(11, 2, "STD-2180", "HOSE, 3/8 I.D. × 1-7/8", 4),
    fact("Path", "From the bottom of each rocker box back to the crankcase", fig(11))], `${EST} Routes estimated.`, [0, -0.1, 0]);
  {
    const A = Acc();
    for (let i = 0; i < 4; i++) {
      const pts = [[2.2, -3.3, 13.4], [2.65, -4.2, 12.6], [2.7, -4.05, 7.5], [2.5, -4.0, 5.6], [2.2, -4.1, 4.3]].map(p => toEngine(i, p));
      A.add(mat.steel, tube(pts, 0.19, 28, 8));
      A.add(mat.rubber, seg(toEngine(i, [2.45, -4.02, 6.2]), toEngine(i, [2.3, -4.05, 4.6]), 0.3, 0.3, 10));
    }
    A.meshes(drainP.node);
  }
  const baffleP = part("engine.baffles", "Intercylinder baffles", [ipc(11, 7, "72569", "BAFFLE ASSEMBLY, Intercylinder", 2), fact("Position", "Under the barrels between cylinders 1-3 and 2-4, forcing cooling air round the fins", fig(11))], EST, [0, -0.12, 0]);
  {
    const A = Acc();
    for (const [xm, s] of [[(Lo.cylX[0] + Lo.cylX[2]) / 2, -1], [(Lo.cylX[1] + Lo.cylX[3]) / 2, 1]]) {
      const sh = polyShape([new THREE.Vector2(-1.9, -2.6), new THREE.Vector2(0, -3.55), new THREE.Vector2(1.9, -2.6), new THREE.Vector2(1.9, -2.67), new THREE.Vector2(0, -3.62), new THREE.Vector2(-1.9, -2.67)]);
      const g = extZ(sh, 0, 7.6, 0, 1); if (s < 0) g.rotateY(Math.PI); g.translate(xm, 0, s * 5.6); A.add(mat.steel, g);
      A.add(mat.steel, cy(0.06, -2.6, 2.9, xm, s * 9.0, 6));
    }
    A.meshes(baffleP.node);
  }

  // ======== Exhaust (airframe) ===============================================================================
  const exhP = part("engine.exhaust", "Exhaust risers and muffler", [fact("Ports", "One per cylinder, bottom of the head, 2 studs 5/16-18", fig(8)), fact("System", "Risers collect into the muffler under the front of the engine; the muffler shroud supplies cabin and carburetor heat", SRC.poh)],
    "Airframe part: not in the Lycoming catalog; routing and muffler shape estimated.", [0, -0.34, 0]);
  {
    const A = Acc(), MX = 6.4, MY = -11.0;
    A.add(mat.exhaust, cz(1.8, -6.2, 6.2, MX, MY, 28)); A.add(mat.exhaust, cz(1.3, 6.2, 6.7, MX, MY, 20)); A.add(mat.exhaust, cz(1.3, -6.7, -6.2, MX, MY, 20));
    A.add(mat.steel, cz(1.95, -4.2, 4.2, MX, MY, 28));                                              // heat shroud
    for (let i = 0; i < 4; i++) {
      const s = SIDE[i], p = toEngine(i, Lo.exhaustPort), front = i < 2 ? (s < 0 ? true : false) : false;
      const pts = [[p[0], p[1] + 0.1, p[2]], [p[0], -6.8, s * 12.5], [p[0] - 0.4, -9.4, s * 11.6], [(p[0] + MX) / 2 + 0.8, -11.0, s * 9.0], [MX + 0.3, MY, s * 7.0], [MX, MY, s * 6.5]];
      A.add(mat.exhaust, tube(pts, 0.72, 40, 12));
      A.add(mat.exhaust, (() => { const g = extZ(rrect(1.7, 2.9, 0.45), 0, 0.2, 0, 4); g.rotateX(Math.PI / 2); g.translate(p[0], p[1] + 0.02, p[2]); return g; })());
      void front;
    }
    A.add(mat.exhaust, tube([[MX, MY - 1.0, -3.0], [MX + 2.2, -14.4, -3.6], [MX + 7.0, -15.0, -4.4]], 0.75, 20, 12));
    A.meshes(exhP.node);
  }

  // ======== Engine mount isolators (airframe) ================================================================
  const mountP = part("engine.mounts", "Engine mount isolators", [fact("Bosses", "Four on the rear of the crankcase", fig(2)), fact("Mount", "Steel tube mount to the firewall (Cessna)", "Cessna D2065-3-13 Section 11")],
    "Airframe parts on estimated boss positions (dynafocal pattern).", [0.08, 0, 0]);
  {
    const A = Acc();
    for (const s of [-1, 1]) for (const [pt, d] of [[[19.6, 4.1, s * 2.9], [0.85, 0.3, 0.45 * s]], [[19.8, -6.0, s * 4.4], [0.85, -0.3, 0.45 * s]]]) {
      const dd = norm(d);
      A.add(mat.rubber, seg(add3(pt, dd, 0.9), add3(pt, dd, 1.9), 0.95, 0.95, 20));
      A.add(mat.steel, seg(add3(pt, dd, 1.9), add3(pt, dd, 2.05), 1.05, 1.05, 20));
    }
    A.meshes(mountP.node);
  }

  // ---- Animation -------------------------------------------------------------------------------------------
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), pinV = new THREE.Vector3(), wristV = new THREE.Vector3();
  const STROKES = ["Power", "Exhaust", "Intake", "Compression"];
  function lift(p, open, close) {        // smooth valve lift over [open, close] (cycle degrees, wraps)
    let a = p - open; if (a < 0) a += 720; const span = (close - open + 720) % 720;
    return a > span ? 0 : Math.sin(Math.PI * a / span);
  }
  const idlerRatio = G.crankR / G.idlerR;
  function update(thetaDeg, { firing = true } = {}) {
    const th = THREE.MathUtils.degToRad(thetaDeg);
    crank.rotation.x = -th; flangeSpin.rotation.x = -th; ringSpin.rotation.x = -th;
    cam.rotation.x = th / 2; idlers.tach.rotation.x = th / 2;
    for (const g of idlers) g.rotation.x = th * idlerRatio;
    for (const g of magGears) g.rotation.x = -th;
    altPulley.rotation.x = -th * 3.25;
    const out = [];
    for (const c of cyl) {
      const pz = PIN[c.i] * r;
      const pinY = pz * Math.sin(th), pinZ = pz * Math.cos(th);
      const along = pinZ * c.s, perp = pinY;
      const dist = along + Math.sqrt(l * l - perp * perp);   // crank axis to piston pin
      c.piston.position.set(c.x, 0, c.s * dist);
      pinV.set(c.x, pinY, pinZ); wristV.set(c.x, 0, c.s * dist);
      c.rod.position.copy(pinV).add(wristV).multiplyScalar(0.5);
      c.rod.quaternion.setFromUnitVectors(up, tmp.copy(wristV).sub(pinV).normalize());
      const phase = ((thetaDeg - firingAngle[c.n]) % 720 + 720) % 720;       // 0 = firing TDC
      const stroke = STROKES[Math.floor(phase / 180)];
      const ex = lift(phase, ...valveTiming.exhaust), inl = lift(phase, ...valveTiming.intake);
      c.valves.forEach((v, k) => {
        const kk = v.kind === "intake" ? inl : ex, d = kk * VLIFT * IN;
        v.obj.position.copy(v.base).addScaledVector(v.axis, -d);
        v.spring.scale.z = (springLen - kk * VLIFT) / springLen;
        c.rockers[k].rotation.x = kk * VLIFT / ROCK_ARM_V;
        const pd = kk * PLIFT * IN;
        c.pushrods[k].obj.position.copy(c.pushrods[k].base).addScaledVector(c.pushrods[k].dir, pd);
        c.tappets[k].obj.position.set(c.tappets[k].base.x, c.tappets[k].base.y, pd);
      });
      const sparkAt = 720 - S.spark_btdc_deg;
      const burn = !firing ? 0 : phase >= sparkAt ? (phase - sparkAt) / S.spark_btdc_deg : phase < 50 ? 1 - phase / 50 : 0;
      c.glow.material.opacity = Math.max(0, Math.min(1, burn)) * 0.9;
      out.push({ n: c.n, stroke, phase, spark: firing && phase >= sparkAt - 2 && phase < sparkAt + 12, head: new THREE.Vector3(c.x, 0.12, c.s * 0.37) });
    }
    return out;
  }
  function setXray(on) { xray.on = on; for (const [m, op] of xray.mats) { m.opacity = on ? op : 1; m.depthWrite = !on; } }
  update(0);
  let triangles = 0; root.traverse(o => { if (o.isMesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { root, parts, update, setXray, specs: S, cylinders: cyl, rodLength: l, bore, layout: Lo,
    spin: { crank, flange: flangeSpin, ringGear: ringSpin, cam, tach: idlers.tach, idlers: [...idlers], magnetoGears: magGears, alternatorPulley: altPulley },
    stats: { parts: parts.length, triangles: Math.round(triangles) } };
}
