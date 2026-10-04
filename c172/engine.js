// Lycoming O-320 flat-four, built from its published dimensions for the Skyhawk Systems Explorer.
//
// Frame: engine-local, meters. x aft along the crankshaft (origin at the propeller flange), y up,
// z left, matching the AC3D aircraft frame. Cylinders: odd numbers on the right (-z), even on the
// left (+z), #1 right front; the left bank sits one throw aft of the right. The crank turns
// clockwise seen from the cockpit, firing order 1-3-2-4, two crank throws 180 degrees apart per pair.
//
// Motion is exact slider-crank kinematics from bore, stroke and rod length. The shapes (fins, heads,
// covers, accessories) are simplified reconstructions, not manufacturer CAD.
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const SPECS = {
  bore_in: 5.125, stroke_in: 3.875, rod_in: 6.375, cylinders: 4, firing: [1, 3, 2, 4],
  displacement_in3: 320, max_hp: 160, idle_rpm: 600, max_rpm: 2700, spark_btdc_deg: 25,
  // Typical Lycoming valve events (degrees from TDC/BDC); illustrative, not from a sourced cam card.
  io_btdc: 25, ic_abdc: 55, eo_bbdc: 60, ec_atdc: 20,
};

const IN = 0.0254;

export function buildEngine(THREE, specs = SPECS) {
  const S = { ...SPECS, ...specs };
  const r = (S.stroke_in / 2) * IN, l = S.rod_in * IN, bore = S.bore_in * IN;
  // Cylinder axes aft of the propeller flange, measured from the O-320-D2J parts catalog top view
  // (9.03, 11.34, 15.75, 18.06 in; data/o320d2j-structure.json).
  const THROWS = [9.03, 11.34, 15.75, 18.06].map(v => v * IN);
  const SIDE = [-1, 1, -1, 1];                        // cylinder axis sign along z (right = -z)
  const PIN = [-1, 1, 1, -1];                         // crank-pin direction along z at theta = 0
  const firingAngle = {}; S.firing.forEach((c, k) => (firingAngle[c] = k * 180));
  const CASE_HALF = 0.15, CROWN = 0.028, BARREL_TOP = l + r + CROWN + 0.012, HEAD_LEN = 0.115;

  const mat = {
    cyl: new THREE.MeshStandardMaterial({ color: 0x33383e, metalness: 0.55, roughness: 0.5 }),     // painted steel barrels
    head: new THREE.MeshStandardMaterial({ color: 0x8b9197, metalness: 0.8, roughness: 0.38 }),    // cast aluminium heads
    case: new THREE.MeshStandardMaterial({ color: 0x6d737a, metalness: 0.65, roughness: 0.48 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5b6168, metalness: 0.9, roughness: 0.32 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x9ea4aa, metalness: 0.85, roughness: 0.3 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1c1f23, metalness: 0.3, roughness: 0.6 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x7a5a45, metalness: 0.6, roughness: 0.55 }),
    lead: new THREE.MeshStandardMaterial({ color: 0x3a2f2a, metalness: 0.1, roughness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.8, roughness: 0.35 }),
  };
  const xray = { on: false, mats: [mat.cyl, mat.head, mat.case] };
  for (const m of xray.mats) { m.transparent = true; m.opacity = 1; }

  const root = new THREE.Group(); root.name = "engine";
  const parts = [];
  function part(name, label, facts = [], note) {
    const g = new THREE.Group(); g.name = name; root.add(g);
    const p = { name, label, group: "engine", node: g, facts, note, explode: new THREE.Vector3() };
    parts.push(p); return p;
  }
  const along = (geo, axis) => { if (axis === "x") geo.rotateZ(Math.PI / 2); if (axis === "z") geo.rotateX(Math.PI / 2); return geo; };
  const mesh = (geo, m, parent, pos) => { const o = new THREE.Mesh(geo, m); if (pos) o.position.set(...pos); parent.add(o); return o; };
  const tube = (pts, radius, m, parent) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 24, radius, 8, false), m, parent);
  const fact = (label, value, source) => ({ label, value, source });
  const SRC = { tcds: "Lycoming O-320 Operator's Manual 60297-30 p. 2-2; FAA TCDS E-274 p. 2", fdm: "Engines/eng_io320.xml", lyc: "Lycoming O-320 Operator's Manual 60297-30", mags: "FAA TCDS E-274 Notes 5, 9", illus: "illustrative" };

  // ---- Crankcase, accessory case, sump, propeller flange --------------------------------------
  const caseP = part("engine.crankcase", "Crankcase", [fact("Engine", "Lycoming O-320-D2J, 160 hp at 2700 rpm", SRC.tcds), fact("Displacement", "319.8 in³", SRC.tcds),
    fact("Dry weight", "255 lb (TCDS); 275 lb with starter and alternator", "FAA TCDS E-274 Note 9; Operator's Manual p. 2-3"), fact("Envelope", "32.24 wide × 23.00 high × 29.05 long (in)", "Operator's Manual p. 1-3")]);
  // Crankcase 3.2–20.3 in aft of the flange, top 4.7 in above the crank axis (catalog/manual drawings).
  mesh(new RoundedBoxGeometry(0.435, 0.235, 0.27, 4, 0.05), mat.case, caseP.node, [0.2985, 0.0, 0]);
  mesh(new RoundedBoxGeometry(0.09, 0.2, 0.2, 4, 0.04), mat.case, caseP.node, [0.085, 0.0, 0]);              // nose section
  mesh(along(new THREE.CylinderGeometry(0.12, 0.13, 0.081, 24), "x"), mat.case, caseP.node, [0.556, 0.01, 0]);  // accessory housing, back face 23.5 in
  mesh(new THREE.BoxGeometry(0.435, 0.012, 0.3), mat.steel, caseP.node, [0.2985, 0.0, 0]);                    // parting flange
  const flangeP = part("engine.propflange", "Propeller flange and shaft", [fact("Propeller", "75 in fixed pitch, 2 blades", "Engines/prop_75in2f.xml")]);
  mesh(along(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 24), "x"), mat.steel, flangeP.node, [0.06, 0, 0]);
  mesh(along(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 32), "x"), mat.steel, flangeP.node, [0.01, 0, 0]);
  flangeP.explode.set(-0.35, 0, 0);
  const sumpP = part("engine.sump", "Oil sump and intake plenum", [fact("Note", "On the O-320 the intake runs through the sump, warming the mixture", SRC.lyc)]);
  // Sump: flange 6.7 in and bottom 11.7 in below the crank axis, about 15.0 wide x 8.9 long (drawings).
  const sump = new THREE.BoxGeometry(0.226, 0.127, 0.381); mesh(sump, mat.case, sumpP.node, [0.417, -0.234, 0]);
  sumpP.explode.set(0, -0.22, 0);
  const carbP = part("engine.carburetor", "Carburetor (float type)", [fact("Feeds from", "Fuel strainer; float chamber meters fuel into intake air", "Systems/fuel.xml")]);
  mesh(new THREE.BoxGeometry(0.1, 0.1, 0.11), mat.alu, carbP.node, [0.417, -0.36, 0]);
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 20), mat.black, carbP.node, [0.417, -0.44, 0]);          // air box throat
  carbP.explode.set(0, -0.4, 0);

  // ---- Crankshaft (rotates as a unit) ---------------------------------------------------------
  const crankP = part("engine.crankshaft", "Crankshaft", [fact("Stroke", `${S.stroke_in} in`, SRC.tcds), fact("Firing order", S.firing.join("-"), "Operator's Manual p. 2-2"), fact("Rotation", "Clockwise from the rear (cockpit)", SRC.lyc)]);
  const crank = new THREE.Group(); crankP.node.add(crank);
  mesh(along(new THREE.CylinderGeometry(0.028, 0.028, 0.5, 20), "x"), mat.steel, crank, [0.34, 0, 0]);
  THROWS.forEach((x, i) => {
    const pz = PIN[i] * r;
    mesh(along(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 16), "x"), mat.steel, crank, [x, 0, pz]);
    for (const dx of [-0.03, 0.03]) mesh(new THREE.BoxGeometry(0.014, 0.06, r + 0.06), mat.steel, crank, [x + dx, 0, pz / 2]);
  });
  crankP.explode.set(-0.05, 0, 0);

  // ---- Per-cylinder: barrel + head (one part), piston, rod, valves, plugs ---------------------
  const cyl = [];
  for (let i = 0; i < 4; i++) {
    const n = i + 1, s = SIDE[i], x = THROWS[i];
    const cp = part(`engine.cyl${n}`, `Cylinder ${n}`, [
      fact("Bore", `${S.bore_in} in`, SRC.tcds), fact("Compression ratio", "8.5:1", SRC.tcds), fact("Position", `${s < 0 ? "Right" : "Left"} ${i < 2 ? "front" : "rear"} (odd right, even left, from the rear)`, "Operator's Manual p. 1-1")]);
    const barrelLen = BARREL_TOP - CASE_HALF;
    const barrel = along(new THREE.CylinderGeometry(bore / 2 + 0.008, bore / 2 + 0.008, barrelLen, 28, 1, true), "z");
    mesh(barrel, mat.cyl, cp.node, [x, 0, s * (CASE_HALF + barrelLen / 2)]);
    mesh(along(new THREE.CylinderGeometry(bore / 2 + 0.03, bore / 2 + 0.03, 0.012, 28), "z"), mat.cyl, cp.node, [x, 0, s * (CASE_HALF + 0.006)]);   // base flange
    const nf = 14;
    for (let f = 0; f < nf; f++) {
      const fz = CASE_HALF + 0.02 + f * (barrelLen - 0.024) / (nf - 1);
      mesh(along(new THREE.CylinderGeometry(bore / 2 + 0.034, bore / 2 + 0.034, 0.0025, 32), "z"), mat.cyl, cp.node, [x, 0, s * fz]);
    }
    const hz = BARREL_TOP + HEAD_LEN / 2;
    mesh(new RoundedBoxGeometry(0.15, 0.15, HEAD_LEN, 3, 0.02), mat.head, cp.node, [x, 0, s * hz]);                                  // cast head block
    for (let f = 0; f < 11; f++) mesh(new THREE.BoxGeometry(0.19, 0.0035, HEAD_LEN * 0.9), mat.head, cp.node, [x, -0.075 + f * 0.015, s * hz]);   // head fins
    for (const ry of [0.095, -0.095]) mesh(new RoundedBoxGeometry(0.12, 0.04, HEAD_LEN * 0.85, 3, 0.012), mat.alu, cp.node, [x, ry, s * hz]);   // rocker covers
    const plugs = [0.075, -0.075].map(py => mesh(along(new THREE.CylinderGeometry(0.009, 0.009, 0.04, 10), "x"), mat.brass, cp.node, [x + 0.09, py * 0.6, s * (BARREL_TOP + 0.03)]));
    // pushrod tubes from the case to the rocker boxes
    for (const py of [0.05, -0.05]) mesh(along(new THREE.CylinderGeometry(0.007, 0.007, BARREL_TOP - CASE_HALF + 0.06, 8), "z"), mat.steel, cp.node, [x - 0.045, py * 1.4, s * (CASE_HALF + (BARREL_TOP - CASE_HALF) / 2 + 0.03)]);
    // combustion glow in the chamber
    const glow = mesh(new THREE.SphereGeometry(bore / 2 - 0.004, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffa03a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), cp.node, [x, 0, s * (BARREL_TOP - 0.004)]);
    glow.scale.set(1, 1, 0.45);
    // valves: stem + head, open toward the piston
    const valves = [["intake", 0.028], ["exhaust", -0.028]].map(([kind, dx]) => {
      const v = new THREE.Group(); v.position.set(x + dx, 0, s * (BARREL_TOP + 0.002)); cp.node.add(v);
      mesh(along(new THREE.CylinderGeometry(0.022, 0.016, 0.006, 16), "z"), kind === "intake" ? mat.alu : mat.exhaust, v, [0, 0, 0]);
      mesh(along(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 8), "z"), mat.steel, v, [0, 0, s * 0.035]);
      return { kind, obj: v, base: v.position.clone() };
    });
    cp.explode.set(0, 0, s * 0.32);

    const pp = part(`engine.piston${n}`, `Piston ${n}`, [fact("Diameter", `${S.bore_in} in`, SRC.tcds)]);
    const piston = new THREE.Group(); pp.node.add(piston);
    mesh(along(new THREE.CylinderGeometry(bore / 2 - 0.002, bore / 2 - 0.002, 0.06, 28), "z"), mat.alu, piston, [0, 0, s * (CROWN - 0.03)]);
    for (const rz of [0.02, 0.012]) mesh(along(new THREE.CylinderGeometry(bore / 2 - 0.001, bore / 2 - 0.001, 0.003, 28), "z"), mat.steel, piston, [0, 0, s * rz]);
    pp.explode.set(0, 0, s * 0.2);
    const rp = part(`engine.rod${n}`, `Connecting rod ${n}`, [fact("Length (centres)", `${S.rod_in} in`, SRC.illus)]);
    const rod = mesh(new THREE.BoxGeometry(0.018, 0.03, l), mat.steel, rp.node);
    rp.explode.set(0, 0, s * 0.1);
    cyl.push({ n, i, s, x, piston, rod, glow, valves, plugs, cp });
  }

  // ---- Ignition: two magnetos at the rear, leads to every plug ---------------------------------
  const magFacts = [fact("Type", "Slick 4251, impulse coupling", SRC.mags), fact("Timing", `${S.spark_btdc_deg}° before TDC`, SRC.tcds), fact("Plugs", "Each magneto fires one of the two plugs in every cylinder", "FAA-H-8083-25C Fig. 7-16")];
  const magL = part("engine.magneto_left", "Left magneto", magFacts), magR = part("engine.magneto_right", "Right magneto", magFacts);
  for (const [p, z] of [[magL, 0.085], [magR, -0.085]]) {
    mesh(along(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 20), "x"), mat.black, p.node, [0.67, 0.061, z * 1.47]);   // caps at 28.4 in, ±4.91 in
    p.explode.set(0.22, 0.08, Math.sign(z) * 0.05);
  }
  const leadsP = part("engine.ignition_leads", "Ignition leads", [fact("Count", "8 (two plugs per cylinder)", SRC.lyc)]);
  for (const c of cyl) for (const [k, py] of [[0, 0.075], [1, -0.075]]) {
    const mz = k === 0 ? (c.s < 0 ? -0.085 : 0.085) : (c.s < 0 ? 0.085 : -0.085);   // top plugs from one magneto, bottom from the other
    tube([[0.72, 0.061, mz * 1.47], [0.66, 0.16, mz * 1.6], [c.x + 0.06, py * 1.6, c.s * (BARREL_TOP - 0.02)], [c.x + 0.035, py, c.s * (BARREL_TOP + 0.03)]], 0.0035, mat.lead, leadsP.node);
  }
  leadsP.explode.set(0.15, 0.1, 0);

  // ---- Intake and exhaust ----------------------------------------------------------------------
  const intakeP = part("engine.intake", "Intake pipes", [fact("Path", "Carburetor → sump plenum → each cylinder", SRC.lyc)]);
  for (const c of cyl) tube([[c.x, -0.193, c.s * 0.17], [c.x + 0.02, -0.15, c.s * 0.24], [c.x + 0.03, -0.09, c.s * (BARREL_TOP + 0.02)]], 0.016, mat.alu, intakeP.node);
  intakeP.explode.set(0, -0.28, 0);
  const exhP = part("engine.exhaust", "Exhaust stacks", [fact("Note", "Stacks collect into the muffler below the engine", SRC.illus)]);
  for (const c of cyl) tube([[c.x - 0.03, -0.08, c.s * (BARREL_TOP + 0.03)], [c.x - 0.04, -0.2, c.s * (BARREL_TOP - 0.02)], [0.25, -0.32, c.s * 0.16]], 0.018, mat.exhaust, exhP.node);
  exhP.explode.set(0, -0.34, 0);

  // ---- Accessories -------------------------------------------------------------------------------
  const starterP = part("engine.starter", "Starter motor", [fact("Power", "From the battery via the starter contactor", "Nasal/electrical.nas"), fact("Mount", "3 studs + 1 bolt, bottom front of the left crankcase half", "Lycoming PC-O-320-D2J fig 22")]);
  mesh(along(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 18), "x"), mat.black, starterP.node, [0.06, -0.15, 0.09]);   // bottom front left (catalog fig 22)
  starterP.explode.set(0.15, -0.1, 0.15);
  const altP = part("engine.alternator", "Alternator", [fact("Output", "28 V, 60 A", "Nasal/electrical.nas")], "illustrative position");
  mesh(along(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 20), "x"), mat.alu, altP.node, [0.12, -0.14, -0.14]);
  altP.explode.set(-0.2, -0.12, -0.12);

  // ---- Animation -------------------------------------------------------------------------------
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  const STROKES = ["Power", "Exhaust", "Intake", "Compression"];
  function lift(p, open, close) {        // smooth valve lift over [open, close] (cycle degrees, wraps)
    let a = p - open; if (a < 0) a += 720; const span = (close - open + 720) % 720;
    return a > span ? 0 : Math.sin(Math.PI * a / span);
  }
  function update(thetaDeg, { firing = true } = {}) {
    const th = THREE.MathUtils.degToRad(thetaDeg);
    crank.rotation.x = -th;
    const out = [];
    for (const c of cyl) {
      // pin position after rotation about x by -theta
      const pz = PIN[c.i] * r;
      const pinY = pz * Math.sin(th), pinZ = pz * Math.cos(th);
      const along = pinZ * c.s, perp = pinY;                 // components along and across the bore
      const dist = along + Math.sqrt(l * l - perp * perp);   // crank axis to piston pin
      c.piston.position.set(c.x, 0, c.s * dist);
      const pin = new THREE.Vector3(c.x, pinY, pinZ), wrist = new THREE.Vector3(c.x, 0, c.s * dist);
      c.rod.position.copy(pin).add(wrist).multiplyScalar(0.5);
      c.rod.quaternion.setFromUnitVectors(up, tmp.copy(wrist).sub(pin).normalize());
      const phase = ((thetaDeg - firingAngle[c.n]) % 720 + 720) % 720;       // 0 = firing TDC
      const stroke = STROKES[Math.floor(phase / 180)];
      const ex = lift(phase, 180 - S.eo_bbdc, 360 + S.ec_atdc), inl = lift(phase, 360 - S.io_btdc, 540 + S.ic_abdc);
      for (const v of c.valves) { const k = v.kind === "intake" ? inl : ex; v.obj.position.set(v.base.x, v.base.y, v.base.z - c.s * k * 0.02); }
      const sparkAt = 720 - S.spark_btdc_deg;
      const burn = !firing ? 0 : phase >= sparkAt ? (phase - sparkAt) / S.spark_btdc_deg : phase < 50 ? 1 - phase / 50 : 0;
      c.glow.material.opacity = Math.max(0, Math.min(1, burn)) * 0.9;
      out.push({ n: c.n, stroke, phase, spark: firing && phase >= sparkAt - 2 && phase < sparkAt + 12, head: new THREE.Vector3(c.x, 0.12, c.s * (BARREL_TOP + HEAD_LEN)) });
    }
    return out;
  }
  function setXray(on) { xray.on = on; for (const m of xray.mats) { m.opacity = on ? 0.22 : 1; m.depthWrite = !on; } }
  update(0);
  return { root, parts, update, setXray, specs: S, cylinders: cyl, rodLength: l, bore };
}
