// Skyhawk Systems Explorer: the open FlightGear Cessna 172P on the explorer core.
import { createExplorer, THREE } from "./explorer/explorer.js";
import { buildEngine } from "./engine-full.js";
import { buildFasteners, buildWires } from "./hardware.js";
import { makeFlight, makeLights, makeWidgets, chapters } from "./story.js";

const engineRuns = s => s.fuel.engine && s.fuel.selector !== "OFF" && s.engine.mags !== "OFF";
const interp = (tbl, x) => { if (x <= tbl[0][0]) return tbl[0][1]; for (let i = 1; i < tbl.length; i++) if (x <= tbl[i][0]) { const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return tbl[tbl.length - 1][1]; };
const controlValue = (s, c) => c === "pitch" ? s.controls.pitch : c === "roll" ? s.controls.roll : c === "yaw" ? s.controls.yaw : c === "flaps" ? s.controls.flaps / 30 : 0;
const opAmount = (s, op) => { const v = controlValue(s, op.control) * op.scale; return op.table ? interp(op.table, v) : v * op.factor; };
const FAA_LOAD = { beacon: "beacon", pitot_heat: "pitot_heat", strobe: "strobe", landing_light: "landing_light", nav_lights: "nav_lights", turn_coordinator: "turn_coordinator", navcom1: "navcom1", xpdr: "transponder" };
let CONTROLS = null, FUEL = null, INSTR = null;
let FLIGHT = null, LIGHTS = null, PROP = null, FAA = null;
let HINGES = [], ENG = null, HW_LOOKUPS = [], ENGINE_HW = null, WIRE_LOOKUP = null;

const machine = {
  id: "c172p", name: "Cessna 172P", eyebrow: "Cessna 172P Skyhawk",
  title: "Skyhawk, <em>taken apart</em>",
  lede: "One flight in a Cessna 172P, preflight to tie-down, with the airplane opening up as it goes: controls, fuel, every wire from the service manual, the whole Lycoming engine, and the airframe's bolts.",
  accent: "#ffb547", focus: "#5fd4ff",
  looks: { solid: "Livery", ghost: "Cutaway" },
  colors: { controls: "#5fd4ff", electrical: "#a58bff", fuel: "#ffb547", pitot: "#6be3a4", engine: "#ff7a45" },
  groups: { "airframe-hardware": "Airframe hardware (Cessna service manual)", wiring: "Wiring (Cessna service manual, Section 20)", "engine-hardware": "Engine hardware (Lycoming parts catalog)", "cockpit-panel": "Cockpit: panel", "cockpit-instruments": "Cockpit: instruments", "cockpit-radios": "Cockpit: radios", "cockpit-breakers": "Cockpit: circuit breakers",
    structure: "Airframe structure (spars, ribs, bulkheads, longerons)", "cockpit-switches": "Cockpit: switches and levers", "cockpit-controls": "Cockpit: yokes and pedals", "cockpit-cabin": "Cockpit: cabin", engine: "Engine (Lycoming O-320)", airframe: "Airframe", wing: "Wings", controls: "Control surfaces", empennage: "Tail", propulsion: "Engine & propeller",
    gear: "Landing gear", cabin: "Cabin", fuel: "Fuel", electrical: "Electrical", "pitot-static": "Pitot-static", lights: "Lights", antennas: "Antennas" },
  overlayScale: 0.016,
  exportFrame: "FlightGear AC3D model frame: x aft, y up, z toward the left wing (metres before unit scaling)",
  exportSources: "Airframe and cockpit geometry: FlightGear Cessna 172P (c172p-team), GPL-2.0. Engine: reconstructed from the Lycoming O-320-D2J parts catalog and operator's manual (facts only). Wiring, fasteners, controls, fuel and instrument systems: placed from Cessna Service Manual D2065-3-13 (facts only; positions marked sourced or estimated on each part). Gyro internals: generic construction per FAA-H-8083-25C.",
  home: { pos: [-6.4, 2.9, 7.0], target: [1.85, -0.4, 0] },

  async load({ loadModel, fetchJSON }) {
    const [overlay, gltf, cockpit, cockpitParts] = await Promise.all([fetchJSON("data/overlay.json"), loadModel("assets/web/c172p.gltf.json"),
      loadModel("assets/web/cockpit.gltf.json"), fetchJSON("data/cockpit-parts.json")]);
    // The FlightGear cockpit (panel, instruments, radios, breakers, switches, controls, cabin) shares the
    // exterior's raw AC3D frame, so it drops in as-is.
    // FlightGear's rain/frost effect planes (glas_interior*, *_interior glass) are not parts of the airplane:
    // FlightGear folds them against the glass with its glass-angle animation. Drop them.
    const effectPlanes = [];
    for (const root of [gltf.scene, cockpit.scene]) root.traverse(o => { if (/^glas_interior|^glas_.*_interior_|window_interior$/.test(o.name)) effectPlanes.push(o); });
    for (const o of effectPlanes) o.parent?.remove(o);
    // The windshield and windows as glass you can see: a light tint with reflections, not fully clear.
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x24323d, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.55 });
    gltf.scene.traverse(o => { if (o.isMesh && /^(glas|leftwindow|rightwindow)$/.test(o.name || o.parent?.name)) { o.material = glass; o.renderOrder = 2; } });
    // Window frames carry a face across the opening that FlightGear draws one-sided (invisible from outside);
    // the converter made every material two-sided, which closed the windows. Restore one-sided.
    // The converter triangulated each window frame's outline as a fan, which filled the opening. Drop the
    // triangles that lie over the window's glass (the frame border sits outside the pane).
    const paneOf = { windowframeleftext: "leftwindow", windowframeleftint: "leftwindow", windowframerightext: "rightwindow", windowframerightint: "rightwindow" };
    const findObj = n => gltf.scene.getObjectByName(n) || cockpit.scene.getObjectByName(n);
    for (const [fname, pname] of Object.entries(paneOf)) {
      const frame = findObj(fname), pane = findObj(pname); if (!frame || !pane) continue;
      gltf.scene.updateMatrixWorld(true); cockpit.scene.updateMatrixWorld(true);
      const pb = new THREE.Box3().setFromObject(pane); pb.min.x += 0.012; pb.max.x -= 0.012; pb.min.y += 0.012; pb.max.y -= 0.012; pb.min.z -= 0.08; pb.max.z += 0.08;
      frame.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(), pos = g.attributes.position, keep = [];
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();
        for (let t = 0; t < pos.count; t += 3) {
          a.fromBufferAttribute(pos, t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, t + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, t + 2).applyMatrix4(o.matrixWorld);
          m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
          if (!pb.containsPoint(m)) keep.push(t);
        }
        if (keep.length * 3 === pos.count) return;
        const out = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) {
          const arr = new attr.array.constructor(keep.length * 3 * attr.itemSize);
          keep.forEach((t, k) => { for (let v = 0; v < 3; v++) for (let i = 0; i < attr.itemSize; i++) arr[(k * 3 + v) * attr.itemSize + i] = attr.array[(t + v) * attr.itemSize + i]; });
          out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize, attr.normalized));
        }
        o.geometry = out;
      });
    }
    const cp = cockpit.scene; cp.name = "cockpit";
    gltf.scene.add(cp);
    for (const [name, m] of Object.entries(cockpitParts.parts)) {
      const facts = [];
      if (m.rating) facts.push({ label: "Rating (cap)", value: String(m.rating), source: "FlightGear panel texture" });
      if (m.circuit) facts.push({ label: "Circuit", value: Array.isArray(m.circuit) ? m.circuit.join(", ") : String(m.circuit), source: "Nasal/electrical.nas" });
      if (m.bus) facts.push({ label: "Bus", value: m.bus });
      overlay.parts[name] = { group: "cockpit-" + m.group, label: m.label, facts, source: (m.source || []).map(x => `${x.ac} · ${x.object}`).join("; ") };
    }
    machine._cockpitParts = cockpitParts;
    // Objects that sat on FlightGear's thinner wing, moved onto the true-scale wing (tools/build_structure_wing.py).
    const refit = await fetchJSON("data/c172p-wing-objects-refit.json").catch(() => null);
    if (refit) {
      for (const [name, r] of Object.entries(refit.objects || {})) {
        const o = gltf.scene.getObjectByName(name) || cockpit.scene.getObjectByName(name); if (!o) continue;
        if (r.rotate) { const p = new THREE.Vector3(...(r.rotate.pivot || [0, 0, 0])), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...r.rotate.axis).normalize(), THREE.MathUtils.degToRad(r.rotate.deg));
          o.position.sub(p).applyQuaternion(q).add(p); o.quaternion.premultiply(q); }
        if (r.translate) o.position.add(new THREE.Vector3(...r.translate));
      }
      // Objects the new skin covers, and FlightGear's landing/taxi light cones (shown only with the lights on).
      for (const name of refit.meta?.hide || []) { const o = gltf.scene.getObjectByName(name) || cockpit.scene.getObjectByName(name); o?.parent?.remove(o); }
      for (const e of cockpitParts.electrical_endpoints || []) { const np = refit.endpoints?.[e.id]; if (np) { if (e.fg_light) e.fg_light.position_ac = np; e.center_ac = np; } }
    }
    ENGINE_HW = await fetchJSON("data/o320d2j-placements-full.json").catch(() => null);
    machine._cables = await fetchJSON("data/c172p-cable-routing.json").catch(() => null);
    [machine._wireRuns, machine._wiring] = await Promise.all([fetchJSON("data/c172p-wire-runs.json").catch(() => null), fetchJSON("data/c172p-wiring.json").catch(() => null)]);
    FLIGHT = makeFlight(await fetchJSON("data/c172p-flight.json"));
    [machine._controls3d, machine._fuel3d, machine._instr3d, machine._structWing, machine._structFus] = await Promise.all(["controls-3d", "fuel-3d", "instruments-3d", "structure-wing-3d", "structure-fuselage-3d"].map(f => fetchJSON(`data/c172p-${f}.json`).catch(() => null)));
    [machine._harness, machine._afPlacements] = await Promise.all([fetchJSON("data/c172p-harness.json").catch(() => null), fetchJSON("data/c172p-airframe-placements.json").catch(() => null)]);
    const figuresPromise = fetchJSON("data/faa-figures.json").then(j => (FAA = j));
    return { model: gltf.scene, overlay, figuresPromise };
  },
  // Exterior parts are the top-level objects; cockpit parts are the children of its seven groups.
  partNodes: model => [...model.children.filter(o => o.name !== "cockpit"), ...(model.children.find(o => o.name === "cockpit")?.children || []).flatMap(g => [...g.children])],
  groupOf(name) {
    const n = name.toLowerCase();
    if (/aileron|flap|elevator|rudder/.test(n)) return "controls";
    if (/wing/.test(n)) return "wing";
    if (/stab|tail/.test(n)) return "empennage";
    if (/prop|spinner|cowl|exhaust|oil|radi/.test(n)) return "propulsion";
    if (/wheel|strut|axle|link|fairing|brake/.test(n)) return "gear";
    if (/fuel|sump/.test(n)) return "fuel";
    if (/pitot/.test(n)) return "pitot-static";
    if (/light|beacon/.test(n)) return "lights";
    if (/antenna/.test(n)) return "antennas";
    if (/door|window|glas|seat|panel|carpet|glove|handle|vent/.test(n)) return "cabin";
    return "airframe";
  },
  // Explode direction per part (model meters at full travel): wings outboard, tail aft, engine forward, gear down.
  explodeVector(p, THREE) {
    const c = p.center, n = p.name.toLowerCase(), side = Math.sign(c.z) || 0, v = new THREE.Vector3();
    if (p.group.startsWith("cockpit-")) {
      // Lift the cockpit out through the roof, spread by group so the panel, breakers and cabin separate.
      const lift = { "cockpit-panel": 1.0, "cockpit-instruments": 1.25, "cockpit-radios": 1.25, "cockpit-breakers": 1.15, "cockpit-switches": 1.1, "cockpit-controls": 0.85, "cockpit-cabin": 0.7 }[p.group] || 1;
      return v.set(p.group === "cockpit-cabin" ? 0.5 : -0.25, 1.4 * lift, side * (p.group === "cockpit-cabin" ? 0.3 : 0.05));
    }
    switch (p.group) {
      case "wing": v.set(0.1, 0.55, side * 1.5); break;
      case "controls":
        if (/aileron/.test(n)) v.set(0.75, 0.45, side * 1.75);
        else if (/flap/.test(n)) v.set(0.8, 0.2, 0);
        else if (/rudder/.test(n)) v.set(2.3, 0.45, 0);
        else v.set(2.2, 0.0, side * 0.6);
        break;
      case "empennage": v.set(1.5, /vstab/.test(n) ? 0.3 : 0, 0); break;
      case "propulsion": v.set(/prop|spinner/.test(n) ? -1.9 : -1.0, /top/.test(n) ? 0.6 : 0.1, 0); break;
      case "gear": v.set(0, -0.8, side * 0.35); break;
      case "cabin": v.set(0, /door|window/.test(n) ? 0.1 : 0, /door|window/.test(n) ? side * 1.0 : 0); break;
      case "antennas": v.set(0, 0.9, 0); break;
      case "fuel": case "pitot-static": case "lights":
        if (Math.abs(c.z) > 0.7 && c.y > 0) v.set(0.1, 0.55, side * (Math.abs(c.z) > 2.4 ? 1.5 : 0.9));
        else if (c.x > 4) v.set(1.5, 0.3, 0);
        break;
    }
    return v;
  },
  // Dismantle like a mechanic would: outer layers first.
  dismantle: [
    { label: "cowling and propeller", groups: ["propulsion"] },
    { label: "doors and windows", test: p => p.group === "cabin" && /door|window|glas/i.test(p.name) },
    { label: "cockpit: panel, instruments, breakers, seats", test: p => p.group.startsWith("cockpit-") },
    { label: "control surfaces", groups: ["controls"] },
    { label: "wings", groups: ["wing"], test: p => ["fuel", "pitot-static", "lights"].includes(p.group) && Math.abs(p.center.z) > 0.7 },
    { label: "tail", groups: ["empennage", "antennas"], test: p => p.group === "lights" && p.center.x > 4 },
    { label: "landing gear", groups: ["gear"] },
    { label: "engine internals and hardware", groups: ["engine", "engine-hardware"] },
  ],
  dimInGhost: p => p.group === "cabin" || p.group === "cockpit-cabin",
  // Keep drawing only while something moves (the core idles otherwise).
  animating(ctx) {
    const s = ctx.state, el = s.electrical, moved = s.flightT !== ctx._lastFT; ctx._lastFT = s.flightT;
    const blink = (el.bat || (el.alt && s.fuel.engine)) && (el.loads.beacon || el.loads.strobe) && !s.isolate;
    return s.engine.turning > 0.01 || moved || blink || (INSTR?.spinning || []).some(c => c.speed > 0.01);
  },
  // No drawn overlay: a system is shown by its real parts (lines, cables, wires, components), the rest fades.
  overlay3D: false,
  systemParts: {
    fuel: p => ["fuel-3d", "fuel"].includes(p.group) || ["engine.carburetor", "engine.intake"].includes(p.name) || /^af\.(fuel_|primer)/.test(p.name),
    controls: p => ["controls-3d", "controls", "cockpit-controls"].includes(p.group) || /^af\.(aileron|elevator|rudder|trim|flap|control_u|stab_attach)/.test(p.name),
    electrical: p => ["wiring", "cockpit-breakers", "lights", "antennas", "cockpit-radios"].includes(p.group) || /Master|Switch|Avionics/.test(p.name) || ["engine.alternator", "engine.starter", "engine.magneto_left", "engine.magneto_right"].includes(p.name),
    pitot: p => ["pitot-static", "cockpit-instruments", "instruments-3d"].includes(p.group) || /^af\.pitot/.test(p.name) || p.name === "engine.vacuum_pump",
    engine: p => ["engine", "engine-hardware"].includes(p.group),
  },

  setup(ctx) {
    const { THREE, overlay, byName, model, addPart } = ctx;
    // Surface motion uses FlightGear's own animations: hinge axes, deflection tables and, for the flaps,
    // two translations then a rotation, in the order FlightGear applies them.
    HINGES = [];
    for (const a of overlay.animations || []) for (const obj of a.objects) {
      const p = byName.get(obj); if (!p) continue;
      let h = HINGES.find(x => x.part === p);
      if (!h) { h = { part: p, ops: [] }; HINGES.push(h); p.pivot.matrixAutoUpdate = false; }
      const op = { ...a };
      if (a.type === "rotate") { op.p1v = new THREE.Vector3(...a.p1); op.axisv = new THREE.Vector3(...a.p2).sub(op.p1v).normalize(); }
      else op.axisv = new THREE.Vector3(...a.axis).normalize();
      h.ops.push(op);
    }
    // The engine: the open model has only the cowling.
    ENG = buildEngine(THREE);
    ENG.root.position.set(-1.72, -0.068, 0);
    ENG.root.rotation.z = THREE.MathUtils.degToRad(-3);
    model.add(ENG.root); model.updateMatrixWorld(true);
    for (const e of ENG.parts) addPart(e.node, { name: e.name, group: "engine", label: e.label, facts: e.facts, note: e.note, explode: e.explode, explodeLocal: true, inPlace: true, keepMaterial: true });
    // Every hardware unit of the Lycoming O-320-D2J parts catalog, placed by its catalog group.
    if (ENGINE_HW) buildEngineHardware(ctx, ENGINE_HW);
    // Every 172P wire from the service manual, run through the airframe between its real endpoints.
    if (machine._harness) buildHarness(ctx, machine._harness, machine._wiring);
    else if (machine._wireRuns) buildWiring(ctx, machine._wireRuns, machine._wiring, machine._cockpitParts);
    if (machine._afPlacements) buildAirframePlacements(ctx, machine._afPlacements); else buildAirframeHardware(ctx);
    if (machine._controls3d) CONTROLS = buildComponents(ctx, machine._controls3d, "controls-3d", "Flight controls");
    if (machine._fuel3d) FUEL = buildComponents(ctx, machine._fuel3d, "fuel-3d", "Fuel system");
    if (machine._instr3d) INSTR = buildComponents(ctx, machine._instr3d, "instruments-3d", "Instrument systems");
    // Airframe structure: one part per member, coming off with the skin part it sits in.
    for (const d of [machine._structWing, machine._structFus]) if (d) {
      // A true-scale skin replaces FlightGear's thinner wing: the old parts go, the new skin takes their place
      // (and their hinge motion, since it is attached to their pivots).
      const replaced = (d.meta?.replaces || []).map(n => byName.get(n)).filter(Boolean);
      for (const p of replaced) { p.meshes.forEach(m => (m.visible = false)); p.replacedBy = true; }
      buildComponents(ctx, d, "structure", "Airframe structure", { follow: true });
    }
    // Manual cable data on the control-system surfaces: run order and rigging tension (D2065-3-13 Sections 6-10).
    for (const cab of machine._cables?.control_cables || []) {
      const node = overlay.systems.controls?.nodes.find(n => n.id === { aileron: "aileron_left", elevator: "elevator", rudder: "rudder", flap: "flaps", "elevator trim": "trim_tab" }[cab.system]);
      if (!node) continue;
      node.facts = [...(node.facts || []), { label: `${cab.system} cable (${cab.cable})`, value: `tension ${cab.tension}; ${cab.routing.map(r => r.component).join(" → ")}`, source: `Cessna D2065-3-13 fig ${cab.routing[0]?.figure || "?"}` }];
    }
    overlay.systems.engine = {
      label: "Engine", edges: [],
      nodes: ENG.cylinders.map(c => ({ id: `cyl${c.n}`, label: `Cylinder ${c.n}`, short: `#${c.n}`, kind: "cylinder", small: true, primary: true, host: `engine.cyl${c.n}`,
        pos: ENG.root.localToWorld(new THREE.Vector3(c.x, 0.12, c.s * 0.37)).toArray(), source: "Lycoming O-320 Operator's Manual p. 1-1" })),
      note: "Lycoming O-320-D2J: 319.8 in³, 160 hp. Motion is exact slider-crank from bore and stroke; firing order 1-3-2-4; two magnetos each fire one plug per cylinder. Shapes are simplified; valve timing is typical, not from a sourced cam card.",
    };
    const sys = overlay.systems;
    for (const n of sys.controls?.nodes || []) if (n.surface || ["trim_wheel", "flap_switch"].includes(n.id)) n.named = true;
    for (const n of sys.pitot?.nodes || []) if (n.instrument || ["static_selector", "alt_static"].includes(n.id)) n.named = true;
    for (const e of sys.electrical?.edges || []) if (e.kind === "wire") e.thin = true;
    if (sys.electrical) sys.electrical.bus = { sources: ["battery", "alternator"], main: "bus1", sub: "avionics_bus" };
    // Story: the flight replay, light glows, and the propeller turning with the crankshaft.
    LIGHTS = makeLights(ctx, machine._cockpitParts);
    const prop = ["Propeller", "Spinner"].map(n => byName.get(n)).filter(Boolean);
    if (prop.length) {
      const c = new THREE.Box3().setFromObject(byName.get("Spinner")?.root || prop[0].root).getCenter(new THREE.Vector3());
      PROP = { parts: prop, c, axis: new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-3)) };
    }
    machine.widgets = makeWidgets({ flight: FLIGHT, machine, faa: () => FAA });
    for (const n of sys.electrical?.nodes || []) if (n.kind === "load") ctx.state.electrical.loads[n.id] ??= n.default_on ?? true;
  },

  state: {
    fuel: { selector: "BOTH", engine: true },
    electrical: { bat: true, alt: true, engine: true, loads: {} },
    controls: { pitch: 0, roll: 0, yaw: 0, flaps: 0 },
    pitot: { pitotBlocked: false, staticBlocked: false, ias: 110 },
    engine: { rpm: 2300, slow: 100, mags: "BOTH", xray: true, theta: 0, turning: 1, cranking: false },
    cowlplugs: false,
    attitude: { pitch: 0, bank: 0, heading: 0, turnRate: 0 },
  },

  evaluate: {
    fuel(s, { state }) {
      const sel = state.fuel.selector, run = engineRuns(state);
      const feedsLeft = run && (sel === "BOTH" || sel === "LEFT"), feedsRight = run && (sel === "BOTH" || sel === "RIGHT");
      for (const e of s.edges) { const side = e.def.side; e.on = side === "left" ? +feedsLeft : side === "right" ? +feedsRight : e.def.kind === "vent" ? 0.3 : e.def.kind === "service" ? 0 : +run; e.speed = 1; }
      for (const n of s.nodes.values()) {
        if (n.def.kind === "tank") n.value = (n.def.side === "left" ? feedsLeft : feedsRight) ? "feeding" : "shut off";
        else if (n.def.kind === "valve") n.value = sel;
        else if (n.def.kind === "engine") n.value = run ? "running" : state.fuel.engine ? "starving" : "stopped";
        else n.value = "";
      }
    },
    electrical(s, { state, $ }) {
      const el = state.electrical; el.engine = engineRuns(state);
      const V = s.def.bus_voltage ?? 28, busOn = el.bat || (el.alt && el.engine);
      let load = 0;
      for (const [id, n] of s.nodes) if (n.def.kind === "load" && el.loads[id] && busOn) load += n.def.amps ?? 0;
      const altOut = el.alt && el.engine ? (s.def.alternator_amps ?? 60) : 0, charging = altOut > 0;
      const batAmps = charging ? (el.bat ? -Math.min(s.def.charge_amps ?? 7, Math.max(0, altOut - load)) : 0) : (el.bat ? load : 0);
      for (const e of s.edges) {
        const to = s.nodes.get(e.def.to), from = s.nodes.get(e.def.from);
        let on = 0, dir = 1;
        if (from?.def.kind === "battery" || to?.def.kind === "battery") { on = el.bat && (load > 0 || charging) ? 1 : 0; dir = charging ? -1 : 1; if (from?.def.kind !== "battery") dir *= -1; }
        else if (from?.def.kind === "alternator" || to?.def.kind === "alternator") on = altOut > 0 ? 1 : 0;
        else if (to?.def.kind === "load") on = busOn && el.loads[e.def.to] ? 1 : 0;
        else on = busOn ? 1 : 0;
        e.on = on; e.dir = dir; e.speed = 0.6 + Math.min(2, load / 20);
      }
      for (const [id, n] of s.nodes) {
        if (n.def.kind === "battery") n.value = !el.bat ? "off" : batAmps > 0 ? `−${batAmps.toFixed(1)} A · ${(s.def.battery_ah / batAmps * 60).toFixed(0)} min left` : batAmps < 0 ? `charging ${(-batAmps).toFixed(1)} A` : "idle";
        else if (n.def.kind === "alternator") n.value = altOut ? `up to ${altOut} A` : "off";
        else if (n.def.kind === "bus") n.value = busOn ? `${charging ? V : (s.def.battery_voltage ?? 24)} V · ${load.toFixed(1)} A` : "dead";
        else if (n.def.kind === "load") n.value = busOn && el.loads[id] ? `${(n.def.amps ?? 0).toFixed(1)} A` : "off";
        else n.value = "";
      }
      s.load = load;
      const m = $("amp-meter"); if (m) m.textContent = `Bus load ${load.toFixed(1)} A`;
    },
    controls(s, { state }) {
      for (const e of s.edges) { let v = 0; for (const k of e.def.input || []) { const x = controlValue(state, k); if (Math.abs(x) > Math.abs(v)) v = x; } e.on = Math.min(1, Math.abs(v) * 1.6); e.speed = 0.8; e.dir = 1; }
      for (const n of s.nodes.values()) {
        n.value = "";
        const h = n.def.surface && HINGES.find(x => x.part.name === n.def.surface), rot = h && h.ops.find(o => o.type === "rotate");
        if (rot) n.value = `${opAmount(state, rot).toFixed(0)}°`;
      }
    },
    engine(s, { state }) {
      for (const o of s.cyl || []) { const n = s.nodes.get(`cyl${o.n}`); if (n) n.value = engineRuns(state) || state.engine.turning > 0.02 ? (o.spark ? "spark" : o.stroke.toLowerCase()) : "stopped"; }
    },
    pitot(s, { state }) {
      const p = state.pitot;
      for (const e of s.edges) { const blocked = e.def.kind === "pitot-line" ? p.pitotBlocked : e.def.kind === "static-line" ? p.staticBlocked : true; e.on = blocked ? 0 : 1; e.speed = 0.5; }
      for (const n of s.nodes.values()) {
        const k = n.def.instrument;
        n.value = k === "asi" ? (p.pitotBlocked ? "0 kt (pitot blocked)" : p.staticBlocked ? `${p.ias} kt, errs with altitude` : `${p.ias} kt`)
          : k === "altimeter" ? (p.staticBlocked ? "frozen" : "live") : k === "vsi" ? (p.staticBlocked ? "0 fpm (frozen)" : "live") : "";
      }
    },
  },

  switches: {
    fuel(ui, add, { state }) {
      add(ui.row("Fuel selector", ui.seg(["BOTH", "LEFT", "RIGHT", "OFF"], state.fuel.selector, v => (state.fuel.selector = v), "Fuel selector")));
      add(ui.row("Engine", ui.toggle(state.fuel.engine, v => (state.fuel.engine = v), ["Running", "Stopped"])));
    },
    electrical(ui, add, { state, SYS }) {
      add(ui.row("Master BAT", ui.toggle(state.electrical.bat, v => (state.electrical.bat = v))));
      add(ui.row("Master ALT", ui.toggle(state.electrical.alt, v => (state.electrical.alt = v))));
      add(ui.row("Engine", ui.toggle(state.fuel.engine, v => (state.fuel.engine = v), ["Running", "Stopped"])));
      for (const n of SYS.electrical.def.nodes.filter(n => n.kind === "load")) add(ui.row(n.label, ui.toggle(state.electrical.loads[n.id], v => (state.electrical.loads[n.id] = v))));
      add(ui.meter("amp-meter"));
    },
    controls(ui, add, { state, SYS }) {
      const pct = v => `${Math.round(v * 100)}%`, c = state.controls;
      add(ui.slider("Yoke fore/aft", -1, 1, 0.01, c.pitch, pct, v => (c.pitch = v)), ui.slider("Yoke roll", -1, 1, 0.01, c.roll, pct, v => (c.roll = v)), ui.slider("Rudder pedals", -1, 1, 0.01, c.yaw, pct, v => (c.yaw = v)));
      add(ui.row("Flaps", ui.seg((SYS.controls.def.flap_detents || [0, 10, 20, 30]).map(String), String(c.flaps), v => (c.flaps = +v), "Flaps")));
    },
    engine(ui, add, { state }) {
      const e = state.engine;
      add(ui.slider("Throttle", 600, 2700, 10, e.rpm, v => `${v} rpm`, v => (e.rpm = v)), ui.slider("Slow motion", 20, 400, 5, e.slow, v => `${v}×`, v => (e.slow = v)));
      add(ui.row("Magnetos", ui.seg(["OFF", "R", "L", "BOTH"], e.mags, v => (e.mags = v), "Magnetos")));
      add(ui.row("Fuel", ui.seg(["BOTH", "LEFT", "RIGHT", "OFF"], state.fuel.selector, v => (state.fuel.selector = v), "Fuel selector")));
      add(ui.row("See inside", ui.toggle(e.xray, v => { e.xray = v; ENG.setXray(v && state.system === "engine"); })));
    },
    pitot(ui, add, { state }) {
      const p = state.pitot;
      add(ui.row("Pitot tube", ui.toggle(!p.pitotBlocked, v => (p.pitotBlocked = !v), ["Clear", "Blocked"])));
      add(ui.row("Static port", ui.toggle(!p.staticBlocked, v => (p.staticBlocked = !v), ["Clear", "Blocked"])));
      add(ui.slider("Airspeed", 40, 160, 1, p.ias, v => `${v} kt`, v => (p.ias = v)));
    },
  },
  onSystem(id, { state }) { ENG.setXray(id === "engine" && state.engine.xray); },
  onIsolate() { ENG.setXray(false); },

  update(time, ctx) {
    const { state, THREE, SYS } = ctx;
    // Control surfaces from the FlightGear tables.
    const m = new THREE.Matrix4(), t = new THREE.Matrix4();
    for (const h of HINGES) {
      const M = h.part.pivot.matrix.identity();
      for (const op of h.ops) {
        const amt = opAmount(state, op);
        if (op.type === "rotate") { m.makeTranslation(-op.p1v.x, -op.p1v.y, -op.p1v.z); t.makeRotationAxis(op.axisv, THREE.MathUtils.degToRad(amt)).multiply(m); m.makeTranslation(op.p1v.x, op.p1v.y, op.p1v.z).multiply(t); }
        else m.makeTranslation(op.axisv.x * amt, op.axisv.y * amt, op.axisv.z * amt);
        M.premultiply(m);
      }
      h.part.pivot.matrixWorldNeedsUpdate = true;
    }
    // The engine turns when it has fuel and spark, spins up quickly and runs down slowly.
    const e = state.engine, dt = ctx._lastT == null ? 0 : Math.max(0, Math.min(0.1, time - ctx._lastT)); ctx._lastT = time;
    const target = engineRuns(state) ? 1 : e.cranking ? 0.12 : 0;
    e.turning += (target - e.turning) * Math.min(1, dt * (target ? 1.5 : 0.6));
    e.theta = (e.theta + e.turning * (e.rpm / 60) * 360 * dt / e.slow) % 1440;
    const out = ENG.update(e.theta, { firing: engineRuns(state) });
    if (SYS.engine) SYS.engine.cyl = out;
    // The propeller is bolted to the crankshaft flange: same angle.
    if (PROP) {
      const q = new THREE.Quaternion().setFromAxisAngle(PROP.axis, -THREE.MathUtils.degToRad(e.theta));
      for (const p of PROP.parts) { p.pivot.quaternion.copy(q); p.pivot.position.copy(PROP.c).sub(PROP.c.clone().applyQuaternion(q)); }
    }
    LIGHTS?.(state, time);
    // Wire lines follow the view: everywhere when no system is chosen, only with the electrical system otherwise.
    const showLines = !state.system || state.system === "electrical";
    if (ctx._lines !== showLines) { ctx._lines = showLines; for (const p of ctx.PARTS) if (p.lines) p.lines.visible = showLines; }
    // The control linkages move with the inputs (pulleys, bellcranks, rods, wheel, column, pedals).
    for (const c of [...(CONTROLS?.moving || []), ...(INSTR?.moving || [])]) {
      const v = { pitch: state.controls.pitch, roll: state.controls.roll, yaw: state.controls.yaw, flaps: state.controls.flaps / 30, trim: state.controls.trim || 0 }[c.motion.input] ?? 0;
      const pu = c.motion.per_unit, amt = Array.isArray(pu) ? interp(pu, v) : (pu || 0) * v;
      if (c.motion.type === "rotate" && c.motion.axis) {
        const q = new THREE.Quaternion().setFromAxisAngle(c.axis, THREE.MathUtils.degToRad(amt));
        c.part.pivot.quaternion.copy(q); c.part.pivot.position.copy(c.pivot).sub(c.pivot.clone().applyQuaternion(q));
      } else if (c.motion.type === "translate" && c.motion.axis) c.part.pivot.position.copy(c.axis).multiplyScalar(amt);
    }
    if (CONTROLS) {
      const inputs = { pitch: state.controls.pitch, roll: state.controls.roll, yaw: state.controls.yaw, flaps: state.controls.flaps / 30, trim: state.controls.trim || 0 };
      const D = new THREE.Matrix4(), M = new THREE.Matrix4(), off = new THREE.Vector3(), piv = new THREE.Vector3(), inv = new THREE.Matrix4();
      for (const c of CONTROLS.cockpit) {
        D.identity(); off.set(0, 0, 0);
        for (const m of c.motions) {
          const v = inputs[m.input] ?? 0, amt = Array.isArray(m.per_unit) ? interp(m.per_unit, v) : (m.per_unit || 0) * v, ax = new THREE.Vector3(...(m.axis || [1, 0, 0])).normalize();
          if (m.type === "translate") { M.makeTranslation(ax.x * amt, ax.y * amt, ax.z * amt); D.premultiply(M); off.addScaledVector(ax, amt); }
          else if (m.type === "rotate") { piv.set(...(m.pivot || [0, 0, 0])).add(off); M.makeTranslation(-piv.x, -piv.y, -piv.z).premultiply(new THREE.Matrix4().makeRotationAxis(ax, THREE.MathUtils.degToRad(amt))).premultiply(new THREE.Matrix4().makeTranslation(piv.x, piv.y, piv.z)); D.premultiply(M); }
        }
        D.premultiply(new THREE.Matrix4().makeTranslation(c.part.offsetWorld.x, c.part.offsetWorld.y, c.part.offsetWorld.z));   // explode offset
        c.obj.parent.updateMatrixWorld(true);
        c.obj.matrix.copy(inv.copy(c.obj.parent.matrixWorld).invert().multiply(D.multiply(c.rest)));
        c.obj.matrixWorldNeedsUpdate = true;
      }
    }
    // Gyro rotors spin while they have vacuum (engine-driven pump) or power (turn coordinator); others follow inputs.
    if (INSTR) for (const c of INSTR.spinning) {
      const powered = c.electric ? (state.electrical.bat || state.electrical.alt) : engineRuns(state) && !state.pitot?.vacuumFailed;
      c.speed += ((powered ? 1 : 0) - c.speed) * Math.min(1, dt * (powered ? 0.6 : 0.15));
      c.angle = (c.angle + c.speed * dt * 2 * Math.PI * Math.min(4, (c.motion.rpm || 20000) / 60 / e.slow * 0.05)) % (2 * Math.PI);
      const q = new THREE.Quaternion().setFromAxisAngle(c.axis, c.angle);
      c.part.pivot.quaternion.copy(q); c.part.pivot.position.copy(c.pivot).sub(c.pivot.clone().applyQuaternion(q));
    }
    // Gyro gimbals and indications from the airplane's attitude (degrees; turn rate in deg/s).
    if (INSTR) {
      const a = state.attitude || {}, val = { pitch: a.pitch || 0, roll: a.bank || 0, yaw: a.heading || 0 };
      for (const c of INSTR.attitude) {
        const u = c.motion.per_unit_units || "";
        let amt = /rate/.test(u) ? (c.motion.per_unit || 0) * (a.turnRate || 0) : (c.motion.per_unit || 0) * (val[c.motion.input] || 0);
        if (c.motion.limit_deg) amt = Math.max(-c.motion.limit_deg, Math.min(c.motion.limit_deg, amt));
        if (/rate/.test(u)) amt = Math.max(-30, Math.min(30, amt));
        const q = new THREE.Quaternion().setFromAxisAngle(c.axis, THREE.MathUtils.degToRad(amt));
        c.part.pivot.quaternion.copy(q); c.part.pivot.position.copy(c.pivot).sub(c.pivot.clone().applyQuaternion(q));
      }
    }
    // Fuel in the real lines: the segments carrying fuel for this selector position show the blue of 100LL.
    if (FUEL && FUEL.flow) {
      const run = engineRuns(state) || state.engine.cranking, sel = state.fuel.selector;
      const live = new Set(run ? FUEL.flow.by_selector?.[sel] || [] : []);
      const sig = [...live].join(",") + state.system;
      if (sig !== ctx._fuelSig) {
        ctx._fuelSig = sig;
        const comps = new Set(); for (const sg of FUEL.flow.segments || []) if (live.has(sg.id)) for (const id of sg.component_ids || []) comps.add(id);
        for (const [id, part] of FUEL.byId) if (part.fuelLine) for (const m of part.meshes) m.userData.orig = comps.has(id) ? FUEL.fuelMat : m.userData.base;
        ctx.applyLook();
      }
    }
    // FlightGear's model has two propellers: the working one and a parked copy shown only while the
    // cowl plugs are in (c172p.xml select animations). Show exactly one.
    const plugs = !!state.cowlplugs, run = ctx.byName.get("Propeller"), parked = ctx.byName.get("PropellerCowlPlugs");
    if ((run && run.hidden !== plugs) || (parked && parked.hidden !== !plugs)) {   // also undoes "Show all"
      if (run) run.hidden = plugs; if (parked) parked.hidden = !plugs;
      ctx.applyLook();
    }
    // In the air (story flight): open sky instead of the studio, ground grid faded out.
    const air = !!state.flight?.airborne && !state.isolate;
    ctx._sky ??= ctx.scene.background.clone();
    const want = air ? new THREE.Color(0x6f9fd6) : ctx._sky;
    ctx.scene.background.lerp(want, Math.min(1, dt * 2)); ctx.scene.fog.color.copy(ctx.scene.background);
    ctx.grid.visible = !air;
  },
  beforeExport(ctx) { Object.assign(ctx.state.engine, { theta: 0, turning: 1 }); ctx._lastT = null; },
  onPick(hit, ctx) {
    ctx._fastener = null; ctx._wire = WIRE_LOOKUP?.(hit.object, hit.faceIndex) || null;
    if (hit.object.isInstancedMesh) for (const lk of HW_LOOKUPS) { const pl = lk(hit.object, hit.instanceId); if (pl) { ctx._fastener = pl; break; } }
    return false;
  },
  cardExtra(p, ctx) {
    const f = ctx._fastener; ctx._fastener = null;
    const w = ctx._wire; ctx._wire = null;
    if (w?.harness) return { facts: [["Wire", w.cable ? `${w.wire_number} · ${w.cable}` : `${w.wire_number || "uncoded"} · ${w.awg} AWG`], ["From", `${w.from.component}${w.from.terminal ? " (" + w.from.terminal + ")" : ""}`], ["To", `${w.to.component}${w.to.terminal ? " (" + w.to.terminal + ")" : ""}`],
      ["Circuit", w.circuit_name || w.circuit], ["Ends", `${w.from.basis || "?"} → ${w.to.basis || "?"}`, /estimated/.test(`${w.from.basis}${w.to.basis}`)], ["Route", typeof w.basis === "object" ? w.basis.route : w.basis || "harness network", /conventional|estimated/i.test(JSON.stringify(w.basis || ""))],
      ["Length", w.length_m ? `${w.length_m.toFixed(2)} m` : "—"], ...(w.serials ? [["Effectivity", String(w.serials)]] : []), ...(w.note ? [["Note", w.note, true]] : [])],
      sourceLine: `Cessna D2065-3-13 Service Manual, Section 20${w.page ? `, page ${w.page.manual || w.page} (pdf ${w.page.pdf || "?"})` : ""} · route: tools/build_harness.py` };
    if (w) return { facts: [["Wire", `${w.wire_number || "uncoded"} · ${w.awg} AWG`], ["From", `${w.from.component}${w.from.terminal ? " (" + w.from.terminal + ")" : ""}`], ["To", `${w.to.component}${w.to.terminal ? " (" + w.to.terminal + ")" : ""}`],
      ["Effectivity", w.serials || "172P"], ["Route", "reconstructed: the manual gives the circuit, not the 3D path", true], ...(!w.from.placed || !w.to.placed ? [["Endpoint", "one end placed approximately (connector or panel item)", true]] : [])],
      sourceLine: `Cessna D2065-3-13 Service Manual, page ${w.page?.manual || "?"} (pdf ${w.page?.pdf || "?"})` };
    if (p.wires) return { facts: [["Wires", String(p.wires.length)], ["Wire numbers", p.wires.map(x => x.wire_number).filter(Boolean).join(", ")], ["Gauges (AWG)", [...new Set(p.wires.map(x => x.awg))].join(", ")], ...(p.breakerFact ? [p.breakerFact] : []), ["Route", p.wires[0]?.harness ? "harness network along the structure (click a wire for its basis)" : "reconstructed through the airframe", true]],
      sourceLine: `Cessna D2065-3-13 Service Manual, Section 20, pages ${[...new Set(p.wires.map(x => x.page?.manual).filter(Boolean))].join(", ")}` };
    if (p.group === "cockpit-breakers" && machine._wiring) {
      const key = p.label.replace(/[^A-Z]/gi, "").toUpperCase().slice(0, 4);
      const b = (machine._wiring.breakers || []).find(x => String(x.designation || x.label || "").replace(/[^A-Z]/gi, "").toUpperCase().startsWith(key));
      if (b) return { facts: [["Rating (manual)", `${b.rating_A ?? b.rating ?? "?"} A`], ...(b.part_number ? [["Part number", b.part_number]] : []), ...(b.effectivity ? [["Effectivity", String(b.effectivity)]] : [])], sourceLine: "Cessna D2065-3-13 Section 16/20 · FlightGear cockpit model" };
    }
    if (f && /Cessna/.test(f.figure)) return { facts: [["This item", f.item], ...(f.part_numbers?.length ? [["Part number", f.part_numbers.join(", ")]] : []), ...(f.torque ? [["Torque", String(f.torque)]] : []), ...(f.d_in ? [["Size", `${f.d_in} in${f.len_in ? " × " + f.len_in + " in" : ""}`]] : []), ["Placement", f.basis || "", /estimated/.test(f.basis || "")]], sourceLine: f.figure };
    if (f) return { facts: [["This item", f.item], ["Catalog figure", `${f.figure} (Lycoming PC-O-320-D2J)`], ["Part numbers in group", f.part_numbers.join(", ")], ["Placement", f.basis, /estimated/.test(f.basis)]],
      sourceLine: "Lycoming O-320-D2J Illustrated Parts Catalog, Oct 2016 (lycoming.com)" };
    if (p.hw) return { facts: [["Units", String(p.hw.length)], ["Items", [...new Set(p.hw.map(x => x.item))].join("; ")], ["Part numbers", [...new Set(p.hw.flatMap(x => x.part_numbers))].join(", ")], ["Placement", p.hw[0].basis, /estimated/.test(p.hw[0].basis)]],
      sourceLine: `Lycoming O-320-D2J Illustrated Parts Catalog fig ${p.hw[0].figure}` };
    const h = HINGES.find(x => x.part === p);
    if (p.group === "engine") return { sourceLine: `Reconstructed from published specs · ${[...new Set((p.facts || []).map(f => f.source).filter(Boolean))].join(" · ")}` };
    if (h) return { facts: [["Hinge", `from FlightGear animation (${h.ops.length} step${h.ops.length > 1 ? "s" : ""})`]], sourceLine: [p.source, ...h.ops.map(o => o.source)].filter(Boolean).join(" · ") };
    return {};
  },

  // The engine's "current path" is its firing order: which cylinder is on which stroke right now.
  trace: {
    engine: (s, { state }) => [1, 3, 2, 4].map(n => { const o = (s.cyl || []).find(c => c.n === n); return { id: `cyl${n}`, label: `Cylinder ${n}`, value: state.engine.turning > 0.02 && o ? (o.spark ? "spark" : o.stroke.toLowerCase()) : "stopped" }; }),
  },
  layouts: { fuel: "plan", electrical: "bus", controls: "flow", pitot: "flow", engine: "flow" },
  plan: v => [-v[2], v[0]],                    // AC3D frame -> plan view, nose up

  figures: {
    bySystem: { fuel: ["fuel"], electrical: ["electrical"], pitot: ["pitot"], controls: ["controls", "controls-cables"], engine: ["engine-cycle", "engine-ignition"] },
    tabLabel: { fuel: "FAA 7-30", electrical: "FAA 7-34", pitot: "FAA 8-1", controls: "FAA 6-4", "controls-cables": "FAA 6-1", "engine-cycle": "FAA 7-5", "engine-ignition": "FAA 7-16" },
    kindLabel: "official FAA figure · live",
    alias: FAA_LOAD,
    source(f) {
      const cap = f.caption.replace(/^Figure [\d-]+\.\s*/, "").replace(/\.+$/, "");
      return { text: `${f.figure}, FAA-H-8083-25C Pilot's Handbook of Aeronautical Knowledge: ${cap}${f.subfigure ? " (" + f.subfigure.replace(/\.+$/, "") + ")" : ""}. Public domain.`, link: "Chapter PDF" };
    },
    state(key, id, { state, SYS, selected }) {
      const sel = state.fuel.selector, run = engineRuns(state), feeds = side => run && (sel === "BOTH" || sel === side);
      const v = (sys, nid = id) => SYS[sys]?.nodes.get(nid)?.value || "";
      if (key === "fuel") {
        if (id === "tank_left") return [feeds("LEFT"), v("fuel")];
        if (id === "tank_right") return [feeds("RIGHT"), v("fuel")];
        if (id === "selector") return [sel !== "OFF", sel];
        if (id === "strainer" || id === "engine") return [run, id === "engine" ? v("fuel") : ""];
        return [null, ""];
      }
      if (key === "electrical") {
        const el = state.electrical, busOn = el.bat || (el.alt && run), charging = el.alt && run;
        if (["battery", "battery_contactor", "sw_bat"].includes(id)) return [el.bat, id === "battery" ? v("electrical", "battery") : ""];
        if (id === "sw_alt") return [el.alt, ""];
        if (id === "master_switch") return [el.bat || el.alt, ""];
        if (["alternator", "alt_control_unit", "alt_breaker", "alt_field_cb"].includes(id)) return [charging, id === "alternator" ? v("electrical", "alternator") : ""];
        if (id === "bus1") return [busOn, v("electrical", "bus1")];
        if (["bus2", "ammeter", "breakers"].includes(id)) return [busOn, ""];
        if (FAA_LOAD[id]) { const on = busOn && el.loads[FAA_LOAD[id]]; return [on, on ? v("electrical", FAA_LOAD[id]) : "off"]; }
        return [null, ""];
      }
      if (key === "pitot") {
        const p = state.pitot;
        if (["pitot_tube", "pressure_chamber", "ram_air"].includes(id)) return [!p.pitotBlocked, ""];
        if (id === "asi") return [!p.pitotBlocked, v("pitot", "asi")];
        if (["static_port", "static_hole", "static_chamber"].includes(id)) return [!p.staticBlocked, ""];
        if (id === "altimeter" || id === "vsi") return [!p.staticBlocked, v("pitot")];
        if (id === "alt_static") return [false, "closed"];
        if (id === "pitot_heat_switch" || id.startsWith("pitot_heater")) return [!!state.electrical.loads.pitot_heat && (state.electrical.bat || state.electrical.alt), ""];
        return [null, ""];
      }
      if (key === "controls" || key === "controls-cables") {
        const c = state.controls;
        const map = { elevator: [Math.abs(c.pitch), "elevator"], aileron_left: [Math.abs(c.roll), "aileron_left"], aileron_right: [Math.abs(c.roll), "aileron_right"], rudder: [Math.abs(c.yaw), "rudder"], flaps: [c.flaps, "flaps"], flap_left: [c.flaps, "flaps"], flap_right: [c.flaps, "flaps"] };
        if (key === "controls-cables" && ["yoke_left", "pulleys", "cables", "push_rod", "control_horn", "elevator"].includes(id)) return [Math.abs(c.pitch) > 0.04, id === "elevator" ? v("controls", "elevator") : ""];
        if (map[id]) return [map[id][0] > 0.04, v("controls", map[id][1])];
        return [null, ""];
      }
      if (key === "engine-cycle") {
        const m = selected?.name.match(/^engine\.(?:cyl|piston|rod)(\d)$/), n = m ? +m[1] : 1;
        const o = (SYS.engine?.cyl || []).find(c => c.n === n), turning = state.engine.turning > 0.02;
        if (["intake", "compression", "power", "exhaust"].includes(id)) { const on = turning && o && o.stroke.toLowerCase() === id; return [on, on ? `cylinder ${n}` : ""]; }
        if (id === "spark_plug") return [!!(o && o.spark), ""];
        return [null, ""];
      }
      if (key === "engine-ignition") {
        const m = state.engine.mags, turning = state.engine.turning > 0.02;
        if (id === "magneto_left") return [m === "L" || m === "BOTH", ""];
        if (id === "magneto_right") return [m === "R" || m === "BOTH", ""];
        if (id === "ignition_switch") return [m !== "OFF", m];
        const cm = id.match(/^cyl(\d)$/);
        if (cm) { const o = (SYS.engine?.cyl || []).find(c => c.n === +cm[1]); return [turning && o?.stroke === "Power", turning && o ? o.stroke.toLowerCase() : ""]; }
        if (id.startsWith("spark_plugs")) return [m !== "OFF" && turning, ""];
        return [null, ""];
      }
      return [null, ""];
    },
    pathState(key, p, ctx) {
      const { state } = ctx;
      if (key === "electrical") {
        const el = state.electrical, run = engineRuns(state), busOn = el.bat || (el.alt && run), charging = el.alt && run;
        if (p.kind === "control") return [(p.from === "sw_bat" && el.bat) || (["bus1", "sw_alt", "alt_control_unit"].includes(p.from) && el.alt && busOn), 1];
        if (p.from === "battery" || p.from === "ammeter" || p.to === "ammeter") return [el.bat && busOn, charging ? -1 : 1];
        if (p.from === "alternator") return [charging, 1];
        if (p.from.includes("starter") || p.to.includes("starter") || p.from === "ext_power") return [false, 1];
        if (FAA_LOAD[p.to]) return [busOn && !!el.loads[FAA_LOAD[p.to]], 1];
        return [busOn, 1];
      }
      const a = machine.figures.state(key, p.from, ctx)[0], b = machine.figures.state(key, p.to, ctx)[0];
      if (key === "fuel") { if ((p.from === "strainer" && p.to === "primer") || p.from === "primer") return [false, 1]; return [a !== false && b !== false && (a || b), 1]; }
      if (key === "pitot") { if (p.kind === "electrical") return [a, 1]; if (p.from === "alt_static") return [false, 1]; return [a !== false && b !== false, 1]; }
      return [!!(a || b), 1];
    },
    decorate(key, f, svg, svgEl, { state }) {
      if (key !== "fuel") return null;
      const sh = f.hotspots.find(h => h.node === "selector"); if (!sh) return null;
      // A live needle over the printed selector dial.
      const [x0, y0, x1, y1] = sh.shape_bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 4, r = Math.min(x1 - x0, y1 - y0) * 0.3;
      svgEl("circle", { cx, cy, r: r * 1.02, fill: "#ffffff", opacity: 0.92 }, svg);
      const needle = svgEl("polygon", { class: "needle", points: `${cx - r * 0.13},${cy} ${cx},${cy - r} ${cx + r * 0.13},${cy} ${cx},${cy + r * 0.35}` }, svg);
      needle.style.transformOrigin = `${cx}px ${cy}px`;
      return () => { needle.style.transform = `rotate(${{ BOTH: 0, RIGHT: 90, OFF: 180, LEFT: 270 }[state.fuel.selector]}deg)`; };
    },
  },

  tourReset: { controls: { pitch: 0, roll: 0, yaw: 0, flaps: 0 } },
  tour: [
    { title: "The whole aircraft", dur: 7, look: "solid", system: null, explode: 0, cam: [[-50, 16, 11.8], [-22, 12, 11]], target: [2.0, -0.2, 0] },
    { title: "Flight controls: yoke to surfaces", dur: 9, look: "ghost", system: "controls", cam: [[-140, 30, 10], [-115, 22, 9.5]], target: [2.4, 0, 0],
      script: t => ({ controls: { pitch: Math.sin(t * 1.3) * 0.8, roll: Math.sin(t * 0.9 + 1) * 0.7, yaw: Math.sin(t * 0.7) * 0.5, flaps: t > 6 ? 20 : 0 } }) },
    { title: "Fuel: two wing tanks to one engine", dur: 10, look: "ghost", system: "fuel", cam: [[-35, 48, 8.5], [-10, 40, 8]], target: [0.2, 0.1, 0],
      script: t => ({ fuel: { selector: t < 4.5 ? "BOTH" : t < 8 ? "LEFT" : "OFF", engine: true } }) },
    { title: "Engine: four strokes, four cylinders", dur: 11, look: "ghost", system: "engine", cam: [[-135, 38, 3.0], [-185, 34, 2.8]], target: [-1.35, -0.1, 0],
      script: () => ({ engine: { rpm: 2300, slow: 110, mags: "BOTH", xray: true }, fuel: { selector: "BOTH", engine: true } }) },
    { title: "Electrical: battery, alternator, bus", dur: 10, look: "ghost", system: "electrical", cam: [[-60, 25, 6.5], [-80, 20, 6]], target: [-0.6, 0, 0],
      script: t => ({ electrical: { bat: true, alt: t < 5 } }) },
    { title: "Pitot-static: how the airspeed is sensed", dur: 8, look: "ghost", system: "pitot", cam: [[-20, 20, 6.5], [-45, 16, 6]], target: [0, 0.2, 0.6],
      script: t => ({ pitot: { pitotBlocked: t > 5, staticBlocked: false, ias: Math.round(95 + 15 * Math.sin(t)) } }) },
    { title: "Taken apart", dur: 8, look: "solid", system: null, explode: [0, 1], cam: [[-35, 28, 13], [10, 24, 14.5]], target: [2.0, -0.3, 0] },
  ],

  lessons: [
    { title: "A high wing, braced by struts",
      text: "The 172's wing sits on top of the cabin and is held up by a single strut on each side, so the spar can be light. The wing carries the fuel tanks, the ailerons and the flaps; the fuselage carries the engine, the cabin and the tail.\n\nPull the slider to take the aircraft apart the way a mechanic would: cowling, doors, control surfaces, wings, tail, gear.",
      show: { look: "solid", system: null, explode: 0.56, cam: [-40, 26, 13], target: [2, -0.2, 0] } },
    { title: "Cables, not hydraulics",
      text: "Every control surface is moved by steel cables and push rods running from the yoke and pedals. Push the yoke forward and the elevator trailing edge goes down by up to 23°; pull it back and it rises up to 28°. These limits come from the simulator's flight-control model.\n\nOnly the cables for the input you move light up.",
      show: { look: "ghost", system: "controls", explode: 0, state: { controls: { pitch: 0.8, roll: 0, yaw: 0, flaps: 0 } }, cam: [-140, 28, 9.5], target: [2.4, 0, 0] } },
    { title: "Gravity feeds the engine",
      text: "There is no fuel pump: fuel falls from the two wing tanks through the selector valve and a strainer to the carburetor. The selector picks which tanks may feed. Turn it to LEFT and the right tank stops feeding; turn it OFF and the engine runs briefly on the float chamber, then starves.",
      show: { look: "ghost", system: "fuel", explode: 0, state: { fuel: { selector: "LEFT", engine: true } }, cam: [-25, 46, 8.2], target: [0.2, 0.1, 0] } },
    { title: "Four strokes, two turns",
      text: "Each cylinder needs two crankshaft turns for one cycle: intake, compression, power, exhaust. With four cylinders firing 1-3-2-4, one is always on its power stroke. The pistons and rods here move with exact slider-crank geometry from the O-320's 5.125 in bore and 3.875 in stroke.",
      show: { look: "ghost", system: "engine", explode: 0, select: "engine.cyl1", state: { engine: { slow: 220, mags: "BOTH", xray: true }, fuel: { selector: "BOTH", engine: true } }, cam: [-140, 36, 2.8], target: [-1.35, -0.1, 0] } },
    { title: "Two magnetos, two plugs per cylinder",
      text: "The engine makes its own spark. Two magnetos, driven by the crankshaft, each fire one of the two plugs in every cylinder, so the engine keeps running if one fails. That is the magneto check before take-off: switch to L, then R, and watch for a small RPM drop. Switch both off and the engine stops.",
      show: { look: "ghost", system: "engine", explode: 0, state: { engine: { mags: "L", xray: true, slow: 160 }, fuel: { selector: "BOTH", engine: true } }, cam: [-200, 30, 2.6], target: [-1.25, -0.05, 0] } },
    { title: "When the alternator quits",
      text: "The split master switch has two halves. BAT connects the battery to the bus; ALT lets the alternator power the bus and recharge the battery. Turn ALT off and everything runs from a 24 V, 13.36 Ah battery: watch the minutes left as you switch loads on and off.",
      show: { look: "ghost", system: "electrical", explode: 0, state: { electrical: { bat: true, alt: false } }, cam: [-60, 25, 6.5], target: [-0.6, 0, 0] } },
    { title: "Two pressures make an airspeed",
      text: "The airspeed indicator compares ram air from the pitot tube with still air from the static port. Block the pitot (ice, an insect) and the airspeed falls away; block the static port and the altimeter and vertical speed indicator freeze.",
      show: { look: "ghost", system: "pitot", explode: 0, state: { pitot: { pitotBlocked: true, staticBlocked: false } }, cam: [-20, 20, 6.5], target: [0, 0.2, 0.6] } },
  ],
};

// ---- Wiring -----------------------------------------------------------------------------------------
// Anchors: cockpit parts and FlightGear light objects (exact), engine parts, and firewall positions from the
// manual's Section 16 text ("battery on the forward left side of the firewall", contactors beside it, ACU on
// the left side of the firewall). Runs go through harness hubs: firewall pass-through, behind the panel, up
// the door posts to the wing roots, along the wing spar, and down the cabin floor into the tailcone.
function buildWiring(ctx, runsData, wiring, cockpitParts) {
  const { THREE, byName, overlay, model } = ctx;
  const center = name => { const p = byName.get(name); return p ? new THREE.Box3().setFromObject(p.root).getCenter(new THREE.Vector3()).toArray() : null; };
  const ep = Object.fromEntries((cockpitParts.electrical_endpoints || []).map(e => [e.id, e.fg_light?.position_ac || e.center_ac]));
  const tank = id => overlay.systems.fuel?.nodes.find(n => n.id === id)?.pos;
  const CB = { "INT LT": "CB-INT-LT", "INST LT": "CB-INT-LT", INST: "CB-INST", FLAP: "CB-FLAP", NAV: "CB-NAV-LT", LAND: "CB-LDG-LT", LANDING: "CB-LDG-LT", LDG: "CB-LDG-LT", BCN: "CB-BCN-LT", STROBE: "CB-STRB-LT", STRB: "CB-STRB-LT",
    PITOT: "CB-PITOT-HT", TURN: "CB-TURN-COORD", "ALT FIELD": "CB-ALT", ALT: "CB-ALT", AUTO: "CB-AUTOPILOT", RADIO: "CB-RADIO-1" };
  const FIXED = { battery: [-0.86, 0.02, 0.22], battery_contactor: [-0.82, -0.1, 0.24], starter_contactor: [-0.82, -0.17, 0.21], ground_service: [-0.86, -0.36, 0.3],
    acu: [-0.81, 0.08, 0.17], fuse_bracket: [-0.82, -0.03, 0.27], terminal_block: [-0.81, 0.13, 0.14], firewall: [-0.79, -0.12, 0.12],
    flap_motor: [1.0, 0.45, -0.62], elt: [3.2, 0.05, -0.22], aircon: [2.4, -0.2, 0.0], vacuum: [-1.17, 0.03, 0], stall_warning: [-0.05, 0.5, 1.6] };
  function resolve(a, other) {
    if (a.startsWith("part:")) return center(a.slice(5)) || center("BreakersBase");
    if (a === "wingroot_L") return [0.1, 0.43, 0.62]; if (a === "wingroot_R") return [0.1, 0.43, -0.62];
    if (a === "panel_tb") return [-0.41, -0.27, 0.2]; if (a === "taxi_light") return ep["taxi-light"];
    if (a.startsWith("cb:")) { const t = a.slice(3).toUpperCase(); const k = Object.keys(CB).sort((x, y) => y.length - x.length).find(k => t.startsWith(k)); return center(CB[k] || "BreakersBase") || center("BreakersBase"); }
    switch (a) {
      case "alternator": return center("engine.alternator"); case "starter": return center("engine.starter");
      case "magneto_left": return center("engine.magneto_left"); case "magneto_right": return center("engine.magneto_right");
      case "engine_sensor": { const m = center("engine.magneto_left"); return m && [m[0] - 0.05, m[1] - 0.12, m[2] - 0.08]; }
      case "master_switch": return center("MasterBAT"); case "ignition_switch": return center("IgnitionSwitch"); case "avionics_master": return center("AvionicsMaster");
      case "ammeter": return ep["instrument-Ammeter"]; case "turn_coordinator": return ep["instrument-TurnCoordinator"]; case "instruments": return ep["instrument-OilTempPress"];
      case "bus": return center("BreakersBase");
      case "nav_left": return ep["nav-light-left"]; case "nav_right": return ep["nav-light-right"]; case "nav_tail": return ep["nav-light-tail"];
      case "strobe_left": return ep["strobe-left"]; case "strobe_right": return ep["strobe-right"]; case "beacon": return ep.beacon;
      case "landing_light": return ep["landing-light"]; case "pitot_heat": return ep["pitot-heat"]; case "dome_light": return ep["dome-light-white"];
      case "courtesy_left": return [0.25, 0.28, 1.6]; case "fuel_left": return tank("tank_left"); case "fuel_right": return tank("tank_right");
      case "ground": return other ? [other[0] + 0.04, other[1] - 0.03, other[2] + 0.02] : FIXED.firewall;
    }
    return FIXED[a] || FIXED.firewall;
  }
  const PANEL = [-0.42, -0.3, 0.12], FW = [-0.79, -0.14, 0.12], FLOOR = [0.3, -0.58, 0.36], TAIL = [2.3, -0.32, 0.12], FIN = [5.0, 0.4, 0.0];
  const zone = p => (p[0] < -0.77 ? "engine" : p[2] > 0.58 && p[1] > 0.2 ? "wingL" : p[2] < -0.58 && p[1] > 0.2 ? "wingR" : p[0] > 1.6 ? "tail" : "cabin");
  const spar = z => [0.18, 0.46 + 0.016 * Math.abs(z), z];
  function hubPath(p) {           // from the panel trunk to point p
    switch (zone(p)) {
      case "engine": return [PANEL, FW, p];
      case "wingL": return [PANEL, [-0.1, 0.25, 0.48], [0.08, 0.42, 0.58], spar(0.75), spar(Math.max(0.8, p[2] - 0.12)), p];
      case "wingR": return [PANEL, [-0.1, 0.25, -0.48], [0.08, 0.42, -0.58], spar(-0.75), spar(Math.min(-0.8, p[2] + 0.12)), p];
      case "tail": return p[1] > 0.3 ? [PANEL, FLOOR, TAIL, FIN, p] : [PANEL, FLOOR, TAIL, p];
      default: return [PANEL, p];
    }
  }
  function route(a, b) {
    const za = zone(a), zb = zone(b);
    if (za === zb && (za === "wingL" || za === "wingR")) { const sg = za === "wingL" ? 1 : -1; return [a, spar(a[2]), spar(b[2] - sg * 0.12), b]; }
    if (za === zb && za !== "cabin") return [a, [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 0.02, (a[2] + b[2]) / 2], b];
    if (za === "cabin" && zb === "cabin") return [a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 0.05, (a[2] + b[2]) / 2], b];
    const pa = hubPath(a).reverse(), pb = hubPath(b);
    return [...pa.slice(0, -1), ...pb.slice(1)];
  }
  const byCircuit = new Map();
  runsData.runs.forEach((r, i) => {
    const a0 = resolve(r.from.anchor, null) || FIXED.firewall, b0 = resolve(r.to.anchor, a0) || FIXED.firewall;
    const a = r.from.anchor === "ground" ? resolve("ground", b0) : a0;
    // small per-wire offset so parallel wires in a bundle sit side by side
    const o = ((i * 37) % 11 - 5) * 0.0025, pts = route(a, b0).map((p, k, arr) => (k === 0 || k === arr.length - 1 ? p : [p[0], p[1] + o, p[2] + o]));
    const awg = parseInt(r.awg, 10) || 20;
    (byCircuit.get(r.circuit) || byCircuit.set(r.circuit, []).get(r.circuit)).push({ ...r, id: `${r.wire_number || "w" + i}`, awg, points: pts, bundle: `w${i}`, color: awg <= 6 ? "#26221f" : "#e6dfcf" });
  });
  const lookups = [];
  for (const [cid, wires] of byCircuit) {
    const built = buildWires(THREE, wires, { name: `wiring.${cid}` });
    model.add(built.group);
    lookups.push(built.lookup);
    const circ = wiring?.circuits?.find(c => c.id === cid), br = circ?.breaker;
    const part = ctx.addPart(built.group, { name: `wiring.${cid}`, group: "wiring", label: `Wiring: ${circ?.name || cid}`, inPlace: true, explode: new THREE.Vector3(), keepMaterial: true });
    if (part) { part.wires = wires; if (br) part.breakerFact = ["Breaker", `${br.designation || ""} ${br.rating_A != null ? br.rating_A + " A" : ""}`.trim()]; }
  }
  WIRE_LOOKUP = mesh => { for (const lk of lookups) { const w = lk(mesh); if (w) return w; } return null; };
}

// ---- Harness (tools/build_harness.py) ------------------------------------------------------------------
// Every wire pre-routed along the harness network and pre-bundled, ends at the device terminals.
// One airplane, not every variant: a 1983 172P, s/n 17275500 (the airframe hardware uses the same one).
// Circuits and wires whose service-manual effectivity excludes that serial are left out.
const REF_SERIAL = 17275500;
const SR = { SR9624: 17274010, SR9625: 17274011, SR9742: 17274183, SR10034: 17275035, SR10092: 17275800, SR10185: 17275675, SR10248: 17275361, SR10412: 17276260, SR10523: 17276300, SR11072: 17276517 };
const NOT_THIS_AIRPLANE = { air_cond: "17275800 and on", cigar_lighter: "1981 only (thru 17275034)", landing_taxi_1981: "1981 only (thru 17275034)", digital_clock: "alternative to the standard clock",
  standby_vacuum: "17276260 and on", vacuum_warning: "17275800 and on" };
function effective(serials) {
  const s = String(serials || ""), first = t => { const m = t.match(/SR\d+/); return m ? SR[m[0]] : null; };
  const [pre, post] = s.includes("THRU") ? s.split("THRU") : [s, null];
  const from = /& ?ON/.test(s) || post != null ? first(pre) : null, thru = post != null ? first(post) : null;
  return (from == null || REF_SERIAL >= from) && (thru == null || REF_SERIAL < thru);
}
function buildHarness(ctx, H, wiring) {
  const { THREE, model } = ctx;
  const byCircuit = new Map(); let skipped = 0;
  for (const w of H.wires || []) {
    if (!w.points || w.points.length < 2) continue;
    if (NOT_THIS_AIRPLANE[w.circuit] || !effective(w.serials)) { skipped++; continue; }
    const awg = parseInt(w.awg, 10) || 20;
    (byCircuit.get(w.circuit) || byCircuit.set(w.circuit, []).get(w.circuit)).push({ ...w, id: w.uid || w.id, wire_number: w.id, awg, radius: w.od_mm ? w.od_mm / 2000 : undefined,
      color: w.color_hint || (awg <= 6 ? "#26221f" : "#e6dfcf"), harness: true });
  }
  const lookups = [];
  for (const [cid, wires] of byCircuit) {
    const built = buildWires(THREE, wires, { name: `wiring.${cid}`, exact: true });
    // A one-pixel line along each wire's exact path, so the wiring stays visible at airplane distance
    // (the tubes are true size, 1-5 mm, and vanish from a few metres away).
    const lp = [], lc = [], c0 = new THREE.Color();
    for (const w of wires) {
      c0.set(w.color || "#e6dfcf"); if (c0.r * 0.3 + c0.g * 0.59 + c0.b * 0.11 > 0.6) c0.set("#6d5f45");   // light insulation drawn dark so it reads on paper
      for (let i = 1; i < w.points.length; i++) { lp.push(...w.points[i - 1], ...w.points[i]); lc.push(c0.r, c0.g, c0.b, c0.r, c0.g, c0.b); }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    lines.name = `wiring.${cid}:lines`; lines.raycast = () => {}; lines.renderOrder = 3; built.group.add(lines);
    model.add(built.group); lookups.push(built.lookup);
    const circ = wiring?.circuits?.find(c => c.id === cid), br = circ?.breaker;
    const part = ctx.addPart(built.group, { name: `wiring.${cid}`, group: "wiring", label: `Wiring: ${wires[0].circuit_name || circ?.name || cid}`, inPlace: true, explode: new THREE.Vector3(), keepMaterial: true });
    if (part) { part.lines = lines; part.wires = wires; if (br) part.breakerFact = ["Breaker", `${br.designation || ""} ${br.rating_A != null ? br.rating_A + " A" : ""}`.trim()]; }
  }
  WIRE_LOOKUP = (mesh, fi) => { for (const lk of lookups) { const w = lk(mesh, fi); if (w) return w; } return null; };
  // The tubes the engine-bay wires are clamped to (engine mount; positions estimated).
  const sup = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x3b4148, metalness: 0.6, roughness: 0.45 });
  for (const t of H.supports || []) {
    const a = new THREE.Vector3(...t.points[0]), b = new THREE.Vector3(...t.points[1]), len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t.radius, t.radius, len, 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); sup.add(m);
  }
  if (sup.children.length) {
    sup.name = "engine_mount_tubes"; model.add(sup);
    ctx.addPart(sup, { name: "engine_mount_tubes", group: "propulsion", label: "Engine mount (welded tube)", inPlace: true, explode: new THREE.Vector3(-0.6, 0, 0), keepMaterial: true,
      facts: [{ label: "Placement", value: "firewall bolts per the manual; tube layout estimated", source: "illustrative" }], source: H.supports[0].source });
  }
  machine._harnessSkipped = skipped;
}

// ---- Real components (flight-control linkages, fuel system) from tools/build_controls.py, tools/build_fuel.py ----
function buildComponents(ctx, data, group, title, opts = {}) {
  const { THREE, model } = ctx;
  const mats = {
    cable: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.9, roughness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb4bac1, metalness: 0.85, roughness: 0.3 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.7, roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2e3238, metalness: 0.4, roughness: 0.6 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x6d8fb8, metalness: 0.1, roughness: 0.5, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  };
  const fuelMat = new THREE.MeshStandardMaterial({ color: 0x3f7fd9, emissive: new THREE.Color(0x1d4fa0), emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.35 });
  const caseMat = new THREE.MeshPhysicalMaterial({ color: 0x1d2228, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const struct = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide });
  const matFor = c => c.display === "ghost" ? caseMat : c.kind === "skin" ? skinMat : group === "structure" ? struct : c.kind === "cable" ? mats.cable : c.kind === "tank" ? mats.tank : /line|fitting|vent|drain|primer/.test(c.kind) ? mats.alu : /pulley|bellcrank|bracket|wheel|pedal|actuator|strainer|valve/.test(c.kind) ? mats.dark : mats.steel;
  const V = a => new THREE.Vector3(...a);
  function geom(g) {
    if (g.type === "cable" || g.type === "tube") {
      const pts = g.points.map(V); if (pts.length < 2) return null;
      const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, "centripetal", 0) : new THREE.LineCurve3(pts[0], pts[1]);
      let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      return new THREE.TubeGeometry(curve, Math.min(1200, Math.max(8, Math.round(len / 0.015), pts.length * 4)), (g.d_in || 0.125) * 0.0254 / 2, 8, false);
    }
    if (g.type === "cylinder") { const a = V(g.a), b = V(g.b), L = a.distanceTo(b); const c = new THREE.CylinderGeometry(g.r, g.r, L, 16); c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())); c.translate(...a.clone().add(b).multiplyScalar(0.5).toArray()); return c; }
    if (g.type === "pulley") { const c = new THREE.CylinderGeometry(g.r, g.r, g.width || 0.012, 28); const grooveless = c; grooveless.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(g.axis).normalize())); grooveless.translate(...g.center); return grooveless; }
    if (g.type === "box" || g.type === "mesh_box") { const c = new THREE.BoxGeometry(...g.size); if (g.quat) c.applyQuaternion(new THREE.Quaternion(...g.quat)); c.translate(...g.center); return c; }
    if (g.type === "sphere") { const c = new THREE.SphereGeometry(g.r, 16, 12); c.translate(...g.center); return c; }
    if (g.type === "tank") { const c = new THREE.BufferGeometry(); c.setAttribute("position", new THREE.Float32BufferAttribute(g.vertices.flat(), 3)); if (g.uvs || g.uv) c.setAttribute("uv", new THREE.Float32BufferAttribute((g.uvs || g.uv).flat(), 2)); c.setIndex(g.faces.flat()); c.computeVertexNormals(); return c; }
    if (g.type === "plate") {
      const sh = new THREE.Shape(g.points.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of g.holes || []) sh.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
      const c = new THREE.ExtrudeGeometry(sh, { depth: g.thickness || 0.004, bevelEnabled: false });
      const [u, v] = g.axes, w = new THREE.Vector3(...u).cross(new THREE.Vector3(...v));
      c.applyMatrix4(new THREE.Matrix4().makeBasis(V(u), V(v), w).setPosition(V(g.origin))); return c;
    }
    return null;
  }
  const byId = new Map(), moving = [], spinning = [], attitude = [];
  for (const c of data.components || []) {
    const g = c.geometry && geom(c.geometry); if (!g) continue;
    let mat = matFor(c);
    // A replacement skin with UVs keeps FlightGear's livery texture from the part it replaces.
    if (c.kind === "skin" && g.attributes.uv && c.uv_atlas === "flightgear") { const hp = ctx.byName.get(c.host_part), om = hp?.meshes[0]?.userData.orig; if (om?.map) mat = om; }
    const mesh = new THREE.Mesh(g, mat); mesh.name = c.id; mesh.userData.base = mat;
    const holder = new THREE.Group(); holder.name = `${group}.${c.id}`; holder.add(mesh); model.add(holder);
    const facts = [{ label: "System", value: c.system || title }, ...(c.part_number ? [{ label: "Part number", value: c.part_number }] : []),
      ...(c.figure ? [{ label: "Figure", value: `${c.figure}${c.page ? ` (pdf p. ${c.page})` : ""}`, source: "Cessna D2065-3-13" }] : []),
      ...(c.geometry.d_in ? [{ label: "Diameter", value: `${c.geometry.d_in} in` }] : []), { label: "Placement", value: c.basis || "", source: /estimated/.test(c.basis || "") ? "illustrative" : undefined }];
    const host = opts.follow && c.host_part ? ctx.byName.get(c.host_part) : null;
    if (c.station) facts.splice(1, 0, { label: "Station", value: c.station });
    const ride = host && host.pivot !== host.root;      // ride on the host's pivot: follows its hinge motion and explode
    const part = ctx.addPart(holder, { name: `${group}.${c.id}`, group: c.kind === "skin" ? (host?.group || "wing") : group, label: c.label || c.id, facts, source: c.source || data.meta?.sources?.[0], explode: ride ? new THREE.Vector3() : host ? host.explodeWorld.clone() : new THREE.Vector3(), keepMaterial: true });
    if (!part) continue;
    if (host) { part.follow = host; if (ride) host.pivot.attach(part.root); }
    byId.set(c.id, part); part.comp = c;
    if (c.kind === "skin") part.keepMaterial = false;                 // skins ghost in the cutaway like the airframe
    if (c.kind === "line" || c.kind === "tube" || c.geometry.type === "tube") part.fuelLine = group === "fuel-3d";
    if (c.motion?.input === "gyro_spin") spinning.push({ electric: /^tc_/.test(c.id), part, motion: c.motion, axis: V(c.motion.axis || [0, 1, 0]).normalize(), pivot: V(c.motion.pivot || c.geometry.center || c.geometry.a || [0, 0, 0]), angle: 0, speed: 0 });
    else if (c.motion && group === "instruments-3d") attitude.push({ part, motion: c.motion, axis: V(c.motion.axis || [1, 0, 0]).normalize(), pivot: V(c.motion.pivot || [0, 0, 0]) });
    else if (c.motion && c.motion.type !== "cable") moving.push({ part, motion: c.motion, axis: c.motion.axis ? V(c.motion.axis).normalize() : null, pivot: c.motion.pivot ? V(c.motion.pivot) : new THREE.Vector3() });
  }
  // Parts that ride on another moving part (the control U carries its drum, sprockets and chains).
  for (const c of data.components || []) {
    const child = byId.get(c.id), carrier = (c.carried_by || c.attached_to) && byId.get(c.carried_by || c.attached_to);
    if (child && carrier) carrier.pivot.attach(child.root);
  }
  // The cockpit model's own yokes, pedals, trim wheel and flap pointer, moved to match the linkages.
  const cockpit = [];
  const byObj = new Map();
  for (const m of data.meta?.cockpit_model_motion || []) for (const o of m.objects) if (o.startsWith("cp:")) (byObj.get(o) || byObj.set(o, []).get(o)).push(m);
  for (const [o, motions] of byObj) {
    const [grp, name] = o.slice(3).split("__"), part = ctx.byName.get(grp);
    const obj = part && (part.node.name === name ? part.node : part.node.getObjectByName(name));
    if (!obj) continue;
    obj.updateMatrixWorld(true);
    cockpit.push({ obj, part, motions, rest: obj.matrixWorld.clone() });
    obj.matrixAutoUpdate = false;
  }
  return { byId, moving, spinning, attitude, cockpit, flow: data.flow || null, fuelMat };
}

// ---- Airframe hardware placements (tools/place_airframe_hardware.py) ---------------------------------------
// Every fastener the manual's figures call out for the 172P, grouped by assembly; each assembly comes off
// with the model part it holds when the airplane is taken apart.
function buildAirframePlacements(ctx, data) {
  const { THREE, model, byName } = ctx;
  const asm = Object.fromEntries((data.assemblies || []).map(a => [a.key, a]));
  const groups = new Map();
  for (const pl of data.placements || []) { const k = `${pl.assembly}|${pl.host_part || ""}`; (groups.get(k) || groups.set(k, []).get(k)).push(pl); }
  for (const [k, list] of groups) {
    const [key, hostName] = k.split("|"), a = asm[key] || { key, title: key };
    const recs = list.map(pl => ({ ...pl, kind: pl.render && pl.render !== "part" ? pl.render : "bolt", d: pl.d_in ?? 0.19, len: pl.len_in ?? undefined, axis: pl.axis || [0, 1, 0],
      item: `${pl.name || pl.item}${pl.item ? ` (item ${pl.item})` : ""}`, figure: `Cessna D2065-3-13 Fig ${pl.figure}${pl.sheet ? ` sheet ${pl.sheet}` : ""}, pdf p. ${pl.page}`, part_numbers: pl.part_number ? [pl.part_number] : [],
      basis: `${pl.basis}${pl.qty_basis && pl.qty_basis !== "printed" ? `; count: ${pl.qty_basis}` : ""}` }));
    const built = buildFasteners(THREE, recs, `af.${key}.${hostName}`);
    model.add(built.group);
    HW_LOOKUPS.push((mesh, id) => built.lookup(mesh, id));
    const host = hostName ? byName.get(hostName) : null;
    const hosts = [...groups.keys()].filter(k2 => k2.startsWith(`${key}|`)).length;
    const side = hosts > 1 ? ({ wing_left: " (left wing)", wing_right: " (right wing)", wing_center: " (wing centre)" }[hostName] || ` (on ${host?.label || hostName})`) : "";
    const part = ctx.addPart(built.group, { name: `af.${key}.${hostName}`, group: "airframe-hardware", label: `${a.title || key}${side}`, inPlace: true,
      explode: host ? host.explodeWorld.clone() : new THREE.Vector3(), keepMaterial: true,
      facts: [{ label: "Fasteners", value: String(list.length) }, { label: "Figure", value: `${a.figure || ""}${a.page ? ` (pdf p. ${a.page})` : ""}`, source: "Cessna D2065-3-13" }, { label: "Comes off with", value: host?.label || hostName || "airframe" }] });
    if (part) { part.follow = host || null; part.hwCount = list.length; }
  }
}

// ---- Airframe key hardware (Cessna D2065-3-13) ---------------------------------------------------------
// Counts, specs and torques are the manual's; positions come from the model's own parts, because the
// FlightGear airframe is not to scale side to side and the manual prints no hardware coordinates.
function buildAirframeHardware(ctx) {
  const { THREE, byName, model } = ctx, IN = 0.0254;
  const box = n => { const p = byName.get(n); return p ? new THREE.Box3().setFromObject(p.root) : null; };
  const groups = [];
  const wing = (side, n) => box(n);
  for (const [side, nm] of [[1, "wing_left"], [-1, "wing_right"]]) {
    const b = wing(side, nm); if (!b) continue;
    const zr = side > 0 ? b.min.z : b.max.z, y = (b.min.y + b.max.y) / 2;
    groups.push({ key: `wing_attach_${side > 0 ? "L" : "R"}`, title: `Wing attach, ${side > 0 ? "left" : "right"}`, source: "Cessna D2065-3-13 Section 4 (wing installation)",
      items: [{ item: "Front spar bolt AN8-23 (300–690 lb-in) + 3 washers + nut", kind: "bolt", d: 0.5, len: 2.9, at: [b.min.x + 0.25, y, zr], axis: [1, 0, 0] },
              { item: "Rear spar bolt AN7-24 (300–500 lb-in) + 2 eccentric bushings, 2 washers, nut", kind: "bolt", d: 0.4375, len: 3.0, at: [b.min.x + 0.95, y - 0.02, zr], axis: [1, 0, 0] }], basis: "spec and torque: manual; position: model wing root" });
  }
  for (const [side, nm] of [[1, "LeftWheelStrut"], [-1, "RightWheelStrut"]]) {
    const b = box(nm); if (!b) continue;
    groups.push({ key: `gear_${side > 0 ? "L" : "R"}`, title: `Main gear, ${side > 0 ? "left" : "right"}`, source: "Cessna D2065-3-13 Section 5 (main landing gear)",
      items: [{ item: "Gear-to-fuselage bolt (1100–1300 lb-in), between FS 56.70 and 65.33", kind: "bolt", d: 0.5, len: 4, at: [(b.min.x + b.max.x) / 2, b.max.y, (side > 0 ? b.min.z : b.max.z)], axis: [0, 1, 0] },
              ...[0, 1, 2, 3].map(k => ({ item: "Brake torque plate bolt (100–110 lb-in figure / 120–130 text)", kind: "bolt", d: 0.3125, len: 1.0, at: [(b.min.x + b.max.x) / 2 + 0.03 * Math.cos(k * Math.PI / 2), b.min.y + 0.18 + 0.03 * Math.sin(k * Math.PI / 2), side > 0 ? b.max.z + 0.05 : b.min.z - 0.05], axis: [0, 0, side] }))],
      basis: "torques: manual; position: model gear strut" });
  }
  const cowl = box("fuselage_cowling");
  if (cowl) {
    const x = cowl.max.x - 0.01;
    groups.push({ key: "engine_mount", title: "Engine mount to firewall", source: "Cessna D2065-3-13 Section 11 (engine mount)",
      items: [[0.18, 0.2], [0.18, -0.2], [-0.32, 0.2], [-0.32, -0.2]].map(([y, z]) => ({ item: "Engine mount bolt to firewall (160–190 lb-in)", kind: "bolt", d: 0.375, len: 2.0, at: [x, y, z], axis: [-1, 0, 0] })),
      basis: "count and torque: manual; positions: firewall corners, estimated" });
  }
  const flange = byName.get("engine.propflange");
  if (flange) {
    const c = new THREE.Box3().setFromObject(flange.root).getCenter(new THREE.Vector3());
    groups.push({ key: "propeller", title: "Propeller bolts", source: "Cessna D2065-3-13 Section 13 (propeller)",
      items: Array.from({ length: 6 }, (_, k) => ({ item: "Propeller bolt, safety-wired (540–560 lb-in)", kind: "bolt", d: 0.5, len: 3.0, at: [c.x - 0.06, c.y + 2.375 * IN * Math.cos(k * Math.PI / 3), c.z + 2.375 * IN * Math.sin(k * Math.PI / 3)], axis: [-1, 0, 0] })),
      basis: "count and torque: manual; bolt circle 4.75 in estimated" });
  }
  for (const g of groups) {
    const built = buildFasteners(THREE, g.items.map(it => ({ ...it, position: it.at, basis: g.basis, figure: g.source, part_numbers: [] })), `af.${g.key}`);
    model.add(built.group);
    HW_LOOKUPS.push((mesh, id) => { const pl = built.lookup(mesh, id); return pl ? { ...pl, figure: g.source, part_numbers: [], basis: g.basis } : null; });
    const part = ctx.addPart(built.group, { name: `af.${g.key}`, group: "airframe-hardware", label: g.title, inPlace: true, explode: new THREE.Vector3(), keepMaterial: true,
      facts: g.items.reduce((acc, it) => { const f = acc.find(x => x.value === it.item); if (f) f.n++; else acc.push({ label: "Item", value: it.item, n: 1 }); return acc; }, []).map(f => ({ label: `${f.n} ×`, value: f.value, source: g.source })) });
    if (part) part.note = g.basis;
  }
}

// ---- Engine hardware --------------------------------------------------------------------------------
function buildEngineHardware(ctx, data) {
  const { THREE, addPart } = ctx, IN = 0.0254;
  const toM = p => ({ ...p, position: p.pos_in.map(v => v * IN), d: p.d_in, len: p.len_in ?? undefined, axis: p.axis });
  const groups = new Map();
  for (const p of data.placements) {
    if (p.attach) continue;
    const key = p.group + (p.cylinder ? `.c${p.cylinder}` : "");
    (groups.get(key) || groups.set(key, []).get(key)).push(p);
  }
  for (const [key, list] of groups) {
    const built = buildFasteners(THREE, list.map(toM), `hw.${key}`);
    HW_LOOKUPS.push((mesh, id) => { const pl = built.lookup(mesh, id); return pl ? list[list.indexOf(pl.__src ?? pl)] || pl : null; });
    ENG.root.add(built.group);
    // Hardware comes off with the part it holds.
    const g = list[0].group, n = list[0].cylinder, B = ctx.byName;
    const hostName = n ? (/rocker_cover/.test(g) ? `engine.cover${n}` : /shroud/.test(g) ? `engine.shrouds${n}` : `engine.cyl${n}`)
      : /^sump/.test(g) ? "engine.sump" : /^carb/.test(g) ? "engine.carburetor" : /^intake/.test(g) ? "engine.intake" : /^starter/.test(g) ? "engine.starter"
      : /^alt/.test(g) ? "engine.alt_bracket" : /^oil\.gage/.test(g) ? "engine.oil_gage" : g === "ign.magneto_mount" ? (list[0].pos_in[2] >= 0 ? "engine.magneto_left" : "engine.magneto_right")
      : /^ign/.test(g) ? "engine.harness_left" : g === "acc.oil_filter" ? "engine.oil_filter" : g === "acc.vacuum_adapter" ? "engine.vacuum_pump" : g === "acc.governor_cover" ? "engine.governor_cover"
      : g === "acc.fuel_pump_cover" ? "engine.fuelpump_cover" : g === "acc.oil_pump" ? "engine.oil_pump" : /^acc/.test(g) ? "engine.accessory_housing" : "engine.crankcase";
    const host = B.get(hostName) || B.get("engine.crankcase");
    const cylPart = host;
    const explode = host ? host.explodeLocal.clone() : new THREE.Vector3();
    const part = addPart(built.group, { name: `hw.${key}`, group: "engine-hardware", label: `${list[0].title}${list[0].cylinder ? ` (cylinder ${list[0].cylinder})` : ""}`,
      inPlace: true, explode, explodeLocal: true, keepMaterial: true });
    if (part) { part.hw = list; part.follow = cylPart || null; }
  }
  // Rod bolts and piston-pin plugs ride on the moving rods and pistons.
  for (const c of ENG.cylinders) {
    const rodItems = data.placements.filter(p => p.attach === `rod${c.n}`), pinItems = data.placements.filter(p => p.attach === `piston${c.n}`);
    const L = ENG.rodLength, rodPart = ctx.byName.get(`engine.rod${c.n}`), pistonPart = ctx.byName.get(`engine.piston${c.n}`);
    const rb = buildFasteners(THREE, rodItems.map((p, i) => ({ ...p, d: p.d_in, len: 1.4, position: [0, (i % 2 ? 1 : -1) * 0.036, -L / 2 + (p.kind === "nut" ? -0.012 : 0.02)], axis: [0, 0, 1] })), `hw.conrod.${c.n}`);
    c.rod.add(rb.group); rb.group.traverse(o => { if (o.isMesh) { o.userData.part = rodPart; o.userData.orig = o.material; rodPart?.meshes.push(o); } });
    HW_LOOKUPS.push(rb.lookup);
    const pb = buildFasteners(THREE, pinItems.map((p, i) => ({ ...p, kind: "plug", d: 0.9, len: 0.2, position: [(i % 2 ? 1 : -1) * (ENG.bore / 2 - 0.004), 0, 0], axis: [i % 2 ? 1 : -1, 0, 0] })), `hw.pinplug.${c.n}`);
    c.piston.add(pb.group); pb.group.traverse(o => { if (o.isMesh) { o.userData.part = pistonPart; o.userData.orig = o.material; pistonPart?.meshes.push(o); } });
    HW_LOOKUPS.push(pb.lookup);
  }
}

machine.story = { get chapters() { return machine._chapters ||= chapters(FLIGHT.F, machine._afPlacements); } };
createExplorer(machine);
