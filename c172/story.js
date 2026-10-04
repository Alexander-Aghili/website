// Story mode for the Skyhawk explorer: one flight, preflight to tie-down, told in chapters over the live
// model (Enigma-style). The flight is data/c172p-flight.json (FlightGear's C172P checklists, one slot per
// item, built by tools/build_flight.py); the clock replays it onto the model's switches, engine, flaps,
// controls and lights. Widgets here are mounted into the story panel by the explorer core.

import { FigureView } from "./explorer/figures.js";

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const RPM = { full: 2300, cruise: 2400, idle: 700 };   // internal animation speeds for throttle words; shown as the checklist's words

// ---------- Flight replay ----------------------------------------------------------------------------------
export function makeFlight(F) {
  const events = F.events;
  const eventAt = t => { let e = null; for (const x of events) { if (x.t <= t) e = x; else break; } return e; };
  const phaseAt = t => F.phases.find(p => t >= p.t0 && t < p.t1) || F.phases[F.phases.length - 1];
  const airborne = t => t >= F.airborne[0] && t < F.airborne[1];
  // The model state at time t: every patch up to t, plus what happens inside the current slot.
  function stateAt(t) {
    const s = { bat: false, alt: false, loads: { nav_lights: false, beacon: false, strobe: false, landing_light: false, taxi_light: false, pitot_heat: false, turn_coordinator: true, audio_panel: false, navcom1: false, transponder: false },
      mags: "OFF", selector: "BOTH", running: false, cowlplugs: true, cranking: false, rpm: 700, rpmWord: "", mixture: "rich", flaps: 0, pitch: 0, roll: 0, yaw: 0, note: "" };
    for (const e of events) {
      if (e.t > t) break;
      const p = e.patch, inSlot = t < e.t + e.dur, k = (t - e.t) / e.dur;
      for (const [key, v] of Object.entries(p)) {
        if (key === "electrical.bat") s.bat = v; else if (key === "electrical.alt") s.alt = v;
        else if (key.startsWith("loads.")) s.loads[key.slice(6)] = v;
        else if (key === "engine.mags") s.mags = v;
        else if (key === "fuel.selector") s.selector = v;
        else if (key === "engine.rpm") { s.rpm = typeof v === "number" ? v : RPM[v]; s.rpmWord = typeof v === "number" ? `${v} RPM` : e.value; }
        else if (key === "mixture") { s.mixture = v; if (v === "cutoff") s.running = false; }
        else if (key === "controls.flaps") s.flaps = v;
        else if (key === "cowlplugs") s.cowlplugs = v;
        else if (key === "controls.pitch") s.pitch = v;
        else if (key === "start") { if (inSlot && k < 0.3) { s.cranking = true; s.mags = "START"; s.note = "Starter cranking"; } else s.running = true; }
        else if (key === "magcheck" && inSlot) { s.mags = k < 0.33 ? "L" : k < 0.66 ? "R" : "BOTH"; s.note = k < 0.66 ? `Magneto check: ${s.mags} only` : ""; }
        else if (key === "sweep" && inSlot) { const w = Math.sin(k * Math.PI * 4); if (v === "all") { s.pitch = w * 0.9; s.yaw = Math.sin(k * Math.PI * 2) * 0.8; s.roll = Math.cos(k * Math.PI * 4) * 0.8; } else s.roll = w * 0.9; }
      }
    }
    if (s.running && s.mags === "OFF") s.running = false;
    return s;
  }
  function apply(state, t) {
    const s = stateAt(t);
    Object.assign(state.electrical, { bat: s.bat, alt: s.alt }); Object.assign(state.electrical.loads, s.loads);
    state.engine.mags = s.mags === "START" ? "BOTH" : s.mags; state.engine.rpm = s.rpm; state.engine.cranking = s.cranking;
    state.fuel.selector = s.selector; state.fuel.engine = s.running; state.cowlplugs = s.cowlplugs;
    Object.assign(state.controls, { flaps: s.flaps, pitch: s.pitch, roll: s.roll, yaw: s.yaw });
    state.flight = { t, airborne: airborne(t), mixture: s.mixture, rpmWord: s.rpmWord, note: s.note, magsShown: s.mags };
    return s;
  }
  return { F, events, eventAt, phaseAt, airborne, stateAt, apply };
}

// ---------- Lights: glows at FlightGear's light positions (nav red/green/white, beacon, strobes, landing, taxi) --
export function makeLights(ctx, cockpitParts) {
  const { THREE, model } = ctx;
  const ep = Object.fromEntries((cockpitParts.electrical_endpoints || []).map(e => [e.id, e.fg_light?.position_ac || e.center_ac]));
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const g2 = cv.getContext("2d"), grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.25, "rgba(255,255,255,0.6)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g2.fillStyle = grd; g2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  // Camera-facing quads (sprites size differently between three's WebGL and WebGPU renderers).
  const quad = new THREE.PlaneGeometry(1, 1), quads = [];
  const make = (pos, color, size) => { if (!pos) return null; const s = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide })); s.position.set(...pos); s.scale.setScalar(size * 0.5); s.visible = false; s.raycast = () => {}; model.add(s); quads.push(s); return s; };
  const L = {
    navL: make(ep["nav-light-left"], 0xff2a2a, 0.45), navR: make(ep["nav-light-right"], 0x2aff6a, 0.45), navT: make(ep["nav-light-tail"], 0xffffff, 0.35),
    beacon: make(ep.beacon, 0xff3020, 0.7), strobeL: make(ep["strobe-left"], 0xffffff, 0.9), strobeR: make(ep["strobe-right"], 0xffffff, 0.9),
    landing: make(ep["landing-light"], 0xfff3d6, 0.8), taxi: make(ep["taxi-light"], 0xfff3d6, 0.6),
  };
  return (state, time) => {
    for (const q of quads) if (q.visible) q.quaternion.copy(ctx.camera.quaternion);
    const el = state.electrical, bus = !state.isolate && (el.bat || (el.alt && state.fuel.engine)), ld = el.loads;
    const on = k => bus && !!ld[k];
    for (const k of ["navL", "navR", "navT"]) if (L[k]) L[k].visible = on("nav_lights");
    if (L.beacon) L.beacon.visible = on("beacon") && (time % 1.1) < 0.18;
    const st = (time % 1.3); for (const k of ["strobeL", "strobeR"]) if (L[k]) L[k].visible = on("strobe") && (st < 0.06 || (st > 0.14 && st < 0.2));
    if (L.landing) L.landing.visible = on("landing_light"); if (L.taxi) L.taxi.visible = on("taxi_light");
  };
}

// ---------- Widgets ----------------------------------------------------------------------------------------
export function makeWidgets({ flight, machine, faa }) {
  const W = {};

  W.clock = (el, ctx, st) => {
    const S = ctx.state, [a, b] = st.clock.range;
    if (S.flightT == null || S.flightT < a || S.flightT > b || st.clock.reset) S.flightT = a;
    let playing = st.clock.autoplay !== false, speed = st.clock.speed || 1, last = performance.now(), lastLook = null;
    const big = h("div", { class: "fx-clock" }), phase = h("div", { class: "fx-phase" });
    const now = h("div", { class: "fx-now" });
    const vals = h("div", { class: "fx-vals" });
    const play = h("button", { class: "primary", onclick: () => { if (S.flightT >= b - 0.05) S.flightT = a; playing = !playing; play.textContent = playing ? "Pause" : "Play"; } }, playing ? "Pause" : "Play");
    const speeds = h("div", { class: "seg", role: "group", "aria-label": "Speed" }, ...[1, 3, 10].map(v => h("button", { "aria-pressed": v === speed, onclick: e => { speed = v; [...speeds.children].forEach(x => x.setAttribute("aria-pressed", x === e.target)); } }, `${v}×`)));
    const slider = h("input", { type: "range", min: a, max: b, step: 0.1, value: S.flightT, "aria-label": "Flight time", oninput: e => { S.flightT = +e.target.value; playing = false; play.textContent = "Play"; } });
    const evs = flight.events.filter(e => e.t >= a && e.t < b);
    const list = h("ol", { class: "fx-list" }, ...evs.map(e => h("li", { "data-t": e.t, onclick: () => { S.flightT = e.t + 0.05; playing = false; play.textContent = "Play"; } },
      h("span", { class: "t", text: mmss(e.t) }), h("span", {}, h("b", { text: e.item }), e.value ? ` — ${e.value}` : ""))));
    el.append(h("div", { class: "fx-top" }, big, phase), now, vals, h("div", { class: "bar" }, play, speeds), slider, list,
      h("small", { class: "fx-src", text: "Procedure: FlightGear C172P checklists (c172-checklists.xml). Slot lengths are pacing, not real durations." }));
    let tick = 0, lastE = null;
    return {
      update() {
        const t1 = performance.now(), dt = Math.min(0.1, (t1 - last) / 1000); last = t1;
        if (playing) { S.flightT = Math.min(b, S.flightT + dt * speed); if (S.flightT >= b) { playing = false; play.textContent = "Play"; } }
        const t = S.flightT, s = flight.apply(S, t);
        if (document.activeElement !== slider) slider.value = t;
        const e = flight.eventAt(t);
        if (st.follow && e?.look && e.look !== lastLook) {
          lastLook = e.look; const p = ctx.byName.get(e.look);
          if (p) {   // stand back from the part, on its side of the airplane, as a person walking round would
            ctx.select(p);
            const c = new ctx.THREE.Box3().setFromObject(p.root).getCenter(new ctx.THREE.Vector3());
            const dir = c.clone().sub(new ctx.THREE.Vector3(1.4, -0.2, 0)); dir.y = 0; if (dir.lengthSq() < 0.01) dir.set(-1, 0, 0);
            dir.normalize().add(new ctx.THREE.Vector3(0, 0.45, 0)).normalize();
            ctx.tweenCamera(c.clone().addScaledVector(dir, Math.max(3.2, p.size.length() * 2.2)), c, 1.2);
          }
        }
        if (++tick % 5) return;
        big.textContent = mmss(t); phase.textContent = flight.phaseAt(t).title;
        if (e !== lastE) {
          lastE = e;
          now.replaceChildren(...(e ? [h("b", { text: e.item }), h("span", { text: e.value ? ` — ${e.value}` : "" })] : []));
          [...list.children].forEach(li => { li.classList.toggle("past", +li.dataset.t <= t); li.classList.toggle("now", e && +li.dataset.t === e.t); });
          list.querySelector(".now")?.scrollIntoView({ block: "nearest" });
        }
        const L = s.loads, lights = ["nav_lights", "beacon", "strobe", "landing_light", "taxi_light"].filter(k => L[k]).map(k => ({ nav_lights: "nav", beacon: "beacon", strobe: "strobes", landing_light: "landing", taxi_light: "taxi" }[k]));
        vals.replaceChildren(...[["Master", `BAT ${s.bat ? "on" : "off"} · ALT ${s.alt ? "on" : "off"}`], ["Magnetos", s.mags], ["Engine", s.cranking ? "cranking" : s.running ? `running${s.rpmWord ? " · " + s.rpmWord : ""}` : "stopped"],
          ["Mixture", s.mixture], ["Flaps", `${s.flaps}°`], ["Lights", lights.join(", ") || "off"], ...(s.note ? [["Now", s.note]] : [])].flatMap(([k, v]) => [h("span", { text: k }), h("b", { text: v })]));
      },
    };
  };

  // Cockpit switches the reader can flip (pauses nothing; the clock re-applies when it moves).
  W.panel = (el, ctx, st) => {
    const S = ctx.state, ui = ctx.ui;
    const rows = [];
    const want = st.panel || ["master", "mags", "fuel", "flaps", "lights"];
    if (want.includes("master")) rows.push(ui.row("Master BAT", ui.toggle(S.electrical.bat, v => (S.electrical.bat = v))), ui.row("Master ALT", ui.toggle(S.electrical.alt, v => (S.electrical.alt = v))));
    if (want.includes("engine")) rows.push(ui.row("Engine", ui.toggle(S.fuel.engine, v => (S.fuel.engine = v), ["Running", "Stopped"])), ui.slider("Throttle", 700, 2700, 10, S.engine.rpm, v => `${v} rpm`, v => (S.engine.rpm = v)));
    if (want.includes("mags")) rows.push(ui.row("Magnetos", ui.seg(["OFF", "R", "L", "BOTH"], S.engine.mags, v => (S.engine.mags = v), "Magnetos")));
    if (want.includes("fuel")) rows.push(ui.row("Fuel selector", ui.seg(["BOTH", "LEFT", "RIGHT", "OFF"], S.fuel.selector, v => (S.fuel.selector = v), "Fuel selector")));
    if (want.includes("flaps")) rows.push(ui.row("Flaps", ui.seg(["0", "10", "20", "30"], String(S.controls.flaps), v => (S.controls.flaps = +v), "Flaps")));
    if (want.includes("lights")) for (const [k, l] of [["nav_lights", "Nav lights"], ["beacon", "Beacon"], ["strobe", "Strobes"], ["landing_light", "Landing light"], ["taxi_light", "Taxi light"]]) rows.push(ui.row(l, ui.toggle(!!S.electrical.loads[k], v => (S.electrical.loads[k] = v))));
    if (want.includes("pitot")) rows.push(ui.row("Pitot tube", ui.toggle(!S.pitot.pitotBlocked, v => (S.pitot.pitotBlocked = !v), ["Clear", "Blocked"])), ui.row("Static port", ui.toggle(!S.pitot.staticBlocked, v => (S.pitot.staticBlocked = !v), ["Clear", "Blocked"])), ui.slider("Airspeed", 40, 160, 1, S.pitot.ias, v => `${v} kt`, v => (S.pitot.ias = v)));
    el.append(h("div", { class: "fx-panel" }, ...rows));
    return {};
  };

  // The airplane's attitude, which the gyro instruments sense; "Fly a turn" banks 20° at a standard rate.
  W.attitude = (el, ctx) => {
    const a = ctx.state.attitude; let turning = false, last = performance.now();
    const deg = v => `${Math.round(v)}°`;
    const rows = [ctx.ui.slider("Pitch", -20, 20, 1, a.pitch, deg, v => (a.pitch = v)), ctx.ui.slider("Bank", -45, 45, 1, a.bank, deg, v => (a.bank = v)), ctx.ui.slider("Heading", 0, 359, 1, a.heading, v => `${String(Math.round(v)).padStart(3, "0")}°`, v => (a.heading = v))];
    const fly = h("button", { class: "primary", onclick: () => { turning = !turning; fly.textContent = turning ? "Level off" : "Fly a standard-rate turn"; if (!turning) { a.bank = 0; a.turnRate = 0; } } }, "Fly a standard-rate turn");
    const pane = h("div", { class: "fx-panel" }, ...rows, h("div", { class: "bar" }, fly, h("button", { onclick: () => { Object.assign(a, { pitch: 0, bank: 0, heading: 0, turnRate: 0 }); turning = false; fly.textContent = "Fly a standard-rate turn"; } }, "Level")));
    el.append(pane, h("p", { class: "hint", text: "The rotors hold their direction in space; the cases, and the airplane, turn around them. The attitude indicator's gimbals take bank and pitch; the heading indicator's take heading; the turn coordinator's canted gimbal precesses with the rate of turn. A standard-rate turn is 3° per second." }));
    return { update() {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (turning) { a.bank += (20 - a.bank) * Math.min(1, dt * 1.5); a.turnRate = 3 * a.bank / 20; a.heading = (a.heading + a.turnRate * dt + 360) % 360; ctx.wake?.(); }
    } };
  };

  W.yoke = (el, ctx) => {
    const c = ctx.state.controls, pct = v => `${Math.round(v * 100)}%`;
    el.append(ctx.ui.slider("Yoke fore/aft", -1, 1, 0.01, c.pitch, pct, v => (c.pitch = v)), ctx.ui.slider("Yoke roll", -1, 1, 0.01, c.roll, pct, v => (c.roll = v)),
      ctx.ui.slider("Rudder pedals", -1, 1, 0.01, c.yaw, pct, v => (c.yaw = v)), ctx.ui.row("Flaps", ctx.ui.seg(["0", "10", "20", "30"], String(c.flaps), v => (c.flaps = +v), "Flaps")),
      h("p", { class: "hint", text: "Negative yoke = pulled back. Deflections follow FlightGear's tables: elevator 28° up / 23° down, ailerons 20° up / 15° down." }));
    return {};
  };

  // Pick a circuit: isolate its wires with the airframe ghosted, list every wire.
  W.circuit = (el, ctx, st) => {
    const parts = ctx.PARTS.filter(p => p.group === "wiring" && p.wires?.length).sort((x, y) => x.label.localeCompare(y.label));
    const hw = ctx.PARTS.filter(p => ["airframe-hardware", "engine-hardware", "engine", "structure", "controls-3d", "fuel-3d", "instruments-3d"].includes(p.group) || p.name === "engine_mount_tubes");

    const sel = h("select", { "aria-label": "Circuit" }, ...parts.map(p => h("option", { value: p.name, text: `${p.label.replace(/^Wiring: /, "")} (${p.wires.length})` })));
    const out = h("div", { class: "fx-wires" });
    const show = (name, frame = true) => {
      const p = ctx.byName.get(name); if (!p) return;
      // Airframe as a ghost, every other circuit hidden, this one glowing and framed.
      if (ctx.state.isolate) ctx.exitIsolate();
      for (const q of parts) q.hidden = q !== p;
      for (const q of hw) q.hidden = true;
      ctx.setLook("ghost"); ctx.select(p); document.getElementById("inspector").hidden = true;
      for (const q of parts) if (q.lines) { q.lines.material.vertexColors = q !== p; q.lines.material.color.set(q === p ? "#c0261e" : "#ffffff"); q.lines.material.needsUpdate = true; }   // the picked circuit in red
      if (frame) ctx.frameBox(new ctx.THREE.Box3().setFromObject(p.root));

      out.replaceChildren(h("p", { class: "hint", text: [p.breakerFact?.join(": "), `${p.wires.length} wires`].filter(Boolean).join(" · ") }),
        h("table", { class: "fx-table" }, h("tr", {}, h("th", { text: "Wire" }), h("th", { text: "AWG" }), h("th", { text: "From → to" })),
          ...p.wires.map(w => h("tr", {}, h("td", { text: w.wire_number || "—" }), h("td", { text: w.cable ? "coax" : String(w.awg) }), h("td", { text: `${w.from.component} → ${w.to.component}` })))));
    };
    sel.addEventListener("change", () => show(sel.value));
    el.append(sel, out);
    const first = parts.find(p => p.name === st.circuit) || parts[0];
    if (first) { sel.value = first.name; queueMicrotask(() => show(first.name, !st.show?.cam)); }   // the step's own camera wins
    return { destroy() { for (const q of [...parts, ...hw]) q.hidden = false; for (const q of parts) if (q.lines) { q.lines.material.vertexColors = true; q.lines.material.color.set("#ffffff"); q.lines.material.needsUpdate = true; } ctx.applyLook(); } };
  };

  // Show only some groups over the ghosted skin (e.g. the structure), restoring everything afterwards.
  W.focus = (el, ctx, st) => {
    const keep = new Set(st.focus || []), skin = new Set(["airframe", "wing", "controls", "empennage", "cabin", "propulsion", "gear", "lights", "antennas", "fuel", "pitot-static"]);
    const hidden = ctx.PARTS.filter(p => !keep.has(p.group) && !skin.has(p.group) && !p.hidden);
    hidden.forEach(p => (p.hidden = true)); ctx.applyLook();
    const n = ctx.PARTS.filter(p => keep.has(p.group)).length;
    el.append(h("p", { class: "hint", text: n ? `${n} structural members. Skin shown as a ghost; wiring, systems and hardware hidden for this step.` : "Structure data is not loaded in this build." }));
    return { destroy() { hidden.forEach(p => (p.hidden = false)); ctx.applyLook(); } };
  };

  // Where the loads go: structure coloured by how hard each member works in a pull-up, scaled by load factor.
  // An engineering sketch of the load paths (strut-braced wing as a beam pinned at the cabin top and propped by
  // the strut; landing loads into the gear bulkheads), not Cessna stress data.
  W.loads = (el, ctx) => {
    const T = ctx.THREE, parts = ctx.PARTS.filter(p => p.group === "structure" && p.comp && p.comp.kind !== "skin");
    const fit = id => ctx.byName.get(`structure.${id}`);
    const zs = fit("fitting_strut_fwd_L") ? Math.abs(fit("fitting_strut_fwd_L").center.z) : 2.2, zr = 0.55, tip = 5.4;
    const M = z => (z >= zs ? ((tip - z) / (tip - zs)) ** 2 : Math.max(0, (z - zr) / (zs - zr)));     // bending moment / moment at the strut
    function base(p) {
      const c = p.comp, id = c.id, z = Math.abs(p.center.z), sys = c.system || "";
      if (/strut/.test(id)) return 1.0;                                                     // strut fittings: the strut's whole load
      if (/wing_attach_fitting_front|fitting_front_spar_root/.test(id)) return 0.85;
      if (/wing_attach_fitting_rear|fitting_rear_spar_root/.test(id)) return 0.6;
      if (/carry_through/.test(id)) return 0.8;
      if (/gear_forging|gear_bulkhead/.test(id)) return 0.75;                               // landing
      if (/door_post/.test(id)) return 0.6;
      if (/fw_mount|fw_diagonal/.test(id)) return 0.55;                                     // engine weight and thrust
      if (/stab.*attach|fin.*(attach|fitting)|hstab_fitting|vstab_fitting/.test(id)) return 0.5;
      if (/longeron/.test(id)) return 0.4;
      if (sys === "wing_left" || sys === "wing_right") {
        const m = M(z);
        if (/front_spar|spar_cap.*front|front.*cap/.test(id)) return 0.15 + 0.85 * m;
        if (/rear_spar|spar_cap.*rear|rear.*cap/.test(id)) return 0.1 + 0.55 * m;
        if (c.kind === "stringer") return 0.08 + 0.4 * m;
        if (c.kind === "rib") return 0.1 + 0.25 * m;
        return 0.15;
      }
      if (/hstab|vstab|elevator|rudder/.test(sys)) return /spar/.test(id) ? 0.35 : 0.12;
      return 0.15;
    }
    const heat = new Map(parts.map(p => [p, base(p)]));
    const ramp = [[0, new T.Color(0x8ea0b4)], [0.35, new T.Color(0xd8c48a)], [0.65, new T.Color(0xe08a3a)], [1, new T.Color(0xc0261e)]];
    const colAt = v => { for (let i = 1; i < ramp.length; i++) if (v <= ramp[i][0]) { const [a0, c0] = ramp[i - 1], [a1, c1] = ramp[i]; return c0.clone().lerp(c1, (v - a0) / (a1 - a0)); } return ramp[ramp.length - 1][1].clone(); };
    const mats = new Map(), mat = v => { const k = Math.round(v * 20); if (!mats.has(k)) mats.set(k, new T.MeshStandardMaterial({ color: colAt(k / 20), roughness: 0.55, metalness: 0.2, side: T.DoubleSide })); return mats.get(k); };
    const saved = new Map(parts.flatMap(p => p.meshes.map(m => [m, m.userData.orig])));
    let n = 3.8;
    function paint() { for (const p of parts) { const m0 = mat(Math.min(1, heat.get(p) * Math.abs(n) / 3.8)); for (const m of p.meshes) m.userData.orig = m0; } ctx.applyLook(); ctx.wake?.(); }
    const legend = h("div", { class: "fx-legend" }, h("span", { class: "bar" }), h("span", { text: "lightly loaded" }), h("span", { text: "most loaded" }));
    el.append(ctx.ui.slider("Load factor", -1.52, 3.8, 0.02, n, v => `${v >= 0 ? "+" : ""}${v.toFixed(1)} g`, v => { n = v; paint(); }), legend,
      h("dl", { class: "fx-facts" }, ...[["Wing strut fittings", "The strut carries most of the wing's lift into the lower fuselage, so its wing and fuselage fittings are the hardest-working parts: forged or machined fittings with doublers spreading the load into the spar and skin."],
        ["Front spar at the strut", "Outboard of the strut the wing is a cantilever; its bending peaks at the strut station. The spar caps are heaviest there and inboard, lighter toward the tip."],
        ["Cabin-top carry-through", "Both wings' spars meet across the cabin top; the carry-through and door posts carry the root loads."],
        ["Gear bulkheads", "Landing loads go from the spring-steel main gear legs into forged attach fittings between two bulkheads under the floor."],
        ["Firewall and engine mount", "A welded steel-tube mount on four bolts spreads engine weight and thrust into the firewall's stiffeners; the firewall is stainless steel."]]
        .flatMap(([k, v]) => [h("dt", { text: k }), h("dd", {}, h("span", { class: "long", text: v }))])),
      h("p", { class: "hint", text: "Limits for the 172P in the normal category: +3.8 g and −1.52 g flaps up, +3.0 g flaps down (Cessna 172P Pilot's Operating Handbook, Section 2). The colours are an engineering sketch of the load paths, not Cessna's stress analysis." }));
    paint();
    return { destroy() { for (const [m, o] of saved) m.userData.orig = o; ctx.applyLook(); } };
  };

  W.parts = (el, ctx, st) => {
    el.append(h("div", { class: "fx-parts" }, ...(st.parts || []).map(n => ctx.byName.get(n)).filter(Boolean).map(p => h("button", { onclick: () => ctx.select(p, true) }, p.label.split(" (")[0]))),
      h("p", { class: "hint", text: "Click a name to frame it. On the model: click to select, shift-click to add, double-click to isolate, / to search." }));
    return {};
  };

  W.explode = (el, ctx) => {
    el.append(ctx.ui.slider("Take it apart", 0, 100, 1, Math.round(ctx.state.explode * 100), v => (v ? `${v}%` : "assembled"), v => { ctx.state.explode = v / 100; ctx.applyExplode(); }));
    return {};
  };

  W.figure = (el, ctx, st) => {
    const f = faa()?.figures?.[st.figure]; if (!f) return null;
    const frame = h("div", { class: "fig-frame" }), img = h("img", { alt: "" }), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), badges = h("div");
    frame.append(img, svg, badges);
    const src = h("p", { class: "src" });
    el.append(h("div", { class: "fig fx-fig" }, frame, src));
    const F = machine.figures, fv = new FigureView({ frame, img, svg, badges, src, onHotspot: () => {} });
    fv.build(st.figure, f, ctx.colors[st.show?.system] || "#ffb547", { state: (k, n) => F.state(k, n, ctx), pathState: (k, p) => F.pathState(k, p, ctx), decorate: F.decorate ? (k, fig, s2, mk) => F.decorate(k, fig, s2, mk, ctx) : null, source: x => F.source(x) });
    let tick = 0;
    return { update() { if (++tick % 9 === 0) fv.update(); } };
  };

  W.facts = (el, ctx, st) => {
    el.append(h("dl", { class: "fx-facts" }, ...(st.facts || []).flatMap(([k, v, s]) => [h("dt", { text: k }), h("dd", {}, h("span", { text: v }), s ? h("small", { text: s }) : null)])));
    return {};
  };

  W.export = (el, ctx) => {
    el.append(h("div", { class: "bar" }, h("button", { class: "primary", onclick: () => { const m = document.getElementById("export-menu"); if (m.hidden) document.getElementById("export-open").click(); document.querySelector('#ex-scope [data-v="all"]').click(); document.querySelector('#ex-format [data-v="glb"]').click(); document.getElementById("ex-go").click(); } }, "Save everything (glTF, zipped)"),
      h("button", { onclick: () => document.getElementById("export-open").click() }, "Other formats…"),
      h("button", { onclick: () => { ctx.exitIsolate(); ctx.select(null); } }, "Show everything")));
    return {};
  };

  W.step = (el, ctx, st) => {
    const live = [];
    for (const name of st.w || []) { const box = h("div", { class: `fx-w fx-${name}` }); el.append(box); const w = W[name]?.(box, ctx, st); if (w) live.push(w); else box.remove(); }
    if (st.figure && !(st.w || []).includes("figure")) { const box = h("div", { class: "fx-w" }); el.append(box); const w = W.figure(box, ctx, st); if (w) live.push(w); }
    if (st.facts) { const box = h("div", { class: "fx-w" }); el.append(box); W.facts(box, ctx, st); }
    return { update: t => live.forEach(w => w.update?.(t)), destroy: () => live.forEach(w => w.destroy?.()) };
  };
  return W;
}

// ---------- Chapters ---------------------------------------------------------------------------------------
const V = (az, el, d, target) => ({ cam: [az, el, d], target });
const BASE = { cowlplugs: false, controls: { pitch: 0, roll: 0, yaw: 0, flaps: 0 }, engine: { mags: "BOTH", rpm: 2300, slow: 100, xray: true, cranking: false }, fuel: { selector: "BOTH", engine: true } };
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? { ...a[k], ...v } : v; return o; };
const step = o => ({ ...o, widget: "step", show: { look: "solid", system: null, explode: 0, ...o.show, state: merge(BASE, o.show?.state) } });
const ph = (F, id) => { const p = F.phases.find(x => x.id === id); return [p.t0, p.t1]; };

export function chapters(F, HW = null) {
  const pl = HW?.placements || [], n = x => x.toLocaleString("en-US");
  const hwTotal = n(pl.length), hwAsm = new Set(pl.map(p => p.assembly)).size, hwFigs = new Set(pl.map(p => p.figure)).size, hwEst = n(pl.filter(p => /estimated/.test(p.basis || "")).length);
  return [
    { title: "Cessna 172P", icon: "intro", intro: true, steps: [
      step({ title: "This is the Cessna 172 Skyhawk", cta: "See how the Skyhawk works",
        text: "The most-built airplane in history, taken apart system by system: its structure, flight controls, fuel, electrical system with every wire in the service manual, radios, the Lycoming engine down to its bolts, and the instruments.\n\nEverything you see is placed from published sources, and every part tells you which.",
        show: { ...V(-36, 12, 10.5, [2.0, -0.2, 0]) } }),
      step({ title: "Where every piece comes from", anchor: "wing_left",
        facts: [["Airframe and cockpit", "FlightGear C172P 3D model", "c172p-team, GPL-2.0"], ["Systems behaviour", "FlightGear/JSBSim C172P", "file and line cited per value"], ["Wires, breakers, airframe hardware", "Cessna 172 Service Manual D2065-3-13", "page cited per item"], ["Engine and its hardware", "Lycoming O-320-D2J parts catalog and operator's manual", "figure and item cited"], ["Diagrams", "FAA Pilot's Handbook of Aeronautical Knowledge", "public domain"]],
        text: "Each part's card names its source. Where a source gives a fact but not a position (a bolt in a manual figure, a wire's route), the placement is marked: from a station, from the model's geometry, or estimated.\n\nThe FlightGear model is close to scale but not exact side to side, so hardware and wires are placed against the model's own surfaces.",
        show: { look: "ghost", ...V(-60, 22, 10, [1.5, 0, 0]) } }),
      step({ title: "How to use it", anchor: "engine.crankcase", w: ["parts"], parts: ["wing_left", "Propeller", "engine.crankcase", "NoseWheel", "elevatorleft"],
        text: "Click any part to see what it is. Shift-click to collect several, then Isolate shows just those. Double-click isolates one part, Esc goes back, and the arrow buttons step through its neighbours. Press / or use \"Find a part\" to search by name, and \"Show only\" to look at one group (the wiring, the engine hardware, the airframe bolts).\n\nExport, top right, saves what you see as glTF, OBJ or STL, or a parts list, for Blender, CAD or a slicer.",
        show: { ...V(-25, 18, 10.5, [1.8, -0.2, 0]) } }),
    ] },

    { title: "Structure", icon: "structure", group: "The airplane", steps: [
      step({ title: "The skeleton under the skin", anchor: "structure.front_spar_web_inboard_L", w: ["focus", "explode"], focus: ["structure"],
        text: "The 172 is a semi-monocoque aluminium airframe: thin skins riveted over a skeleton that carries the loads. Each wing hangs from two spars, front and rear, attached at the cabin top and braced by the strut; ribs at each wing station give the airfoil its shape. The fuselage is a set of bulkheads and frames joined by longerons and stringers, from the stainless firewall back through the cabin to the tailcone.\n\nThe wing here is built at true scale (NACA 2412 section, published span and washout) with every rib at the station the service manual gives it. Stations and arrangement come from the manual; most member sizes are estimated, and each part's card says which.",
        show: { look: "ghost", ...V(-38, 26, 11.5, [2.0, 0, 0]) } }),
      step({ title: "Wing: spars, ribs, tank bay", anchor: "structure.front_spar_web_outboard_L", w: ["focus", "parts"], focus: ["structure"], parts: ["structure.front_spar_web_inboard_L", "structure.front_spar_web_outboard_L", "structure.rear_spar_web_inboard_L", "structure.aux_spar_web_L", "structure.fitting_front_spar_root_L", "structure.fitting_rear_spar_root_L", "structure.fitting_strut_fwd_L", "structure.rib_23.62_center_L", "structure.rib_57.12_nose_L"],
        text: "The front spar takes most of the bending load and meets the cabin-top fitting and the strut; the rear spar carries the flap and aileron hinges. Between them, inboard, sit the fuel tanks. Ribs at each station have lightening holes, and the aileron and flap cables pass through them.",
        show: { look: "ghost", ...V(-120, 40, 5.5, [0.5, 0.45, 2.2]) } }),
      step({ title: "Where the loads go", anchor: "structure.fitting_strut_fwd_L", w: ["focus", "loads"], focus: ["structure"],
        text: "In a pull-up every member carries part of the load, but not equally. Drag the load factor: the colours show which parts work hardest and how that grows toward the airplane's +3.8 g limit, and the notes say what the design does about each hot spot.",
        show: { look: "ghost", ...V(-50, 30, 9.5, [1.0, 0.1, 0]) } }),
      step({ title: "Fuselage: firewall to tailcone", anchor: "structure.bulkhead_142", w: ["focus"], focus: ["structure"],
        text: "Forward, the firewall carries the engine mount. The door posts rise to the cabin-top carry-through where the wings attach; the floor beams carry the seat rails and the main-gear attach structure. Aft of the cabin, the tailcone narrows through its bulkheads to the stabilizer and fin attach fittings.",
        show: { look: "ghost", ...V(-150, 22, 8.5, [1.4, -0.1, 0]) } }),
    ] },

    { title: "Flight controls", icon: "controls", steps: [
      step({ title: "Cables, pulleys, bellcranks", anchor: "controls-3d.ctl_U", w: ["yoke"],
        text: "Every surface is moved by steel cable and push rod, with no hydraulics. Turn the wheel and the control U's drum and chains pull the aileron cables: down to pulleys under the floor, up the door posts, across the cabin top and out to a bellcrank in each wing, whose push-pull rod moves the aileron. Pull the wheel back and the elevator cables run aft under the floor to a bellcrank in the tailcone. The rudder bars pull cables aft to the rudder horn.\n\nMove the yoke and pedals: the wheel, column, pulleys, bellcranks and rods move with the surfaces. The manual gives the routing and rigging, not the stations, so positions are fitted to the airframe and each part's card says so.",
        show: { look: "ghost", system: "controls", ...V(-125, 30, 7.5, [1.8, 0.1, 0]) } }),
      step({ title: "Elevator and trim", anchor: "elevatorleft", w: ["yoke", "parts"], parts: ["controls-3d.el_rear_bellcrank", "controls-3d.el_fwd_bellcrank", "controls-3d.trim_act_housing", "controls-3d.trim_act_rodend", "controls-3d.trim_wheel_axle"],
        text: "Aft, the elevator cables end at a bellcrank that drives the elevators' torque tube. The trim wheel between the seats turns a cable loop back to a screw actuator in the stabilizer, whose push-pull rod moves the trim tab.",
        show: { look: "ghost", system: "controls", state: { controls: { pitch: -0.6, roll: 0, yaw: 0, flaps: 0 } }, ...V(-140, 26, 4.6, [4.4, -0.2, 0]) } }),
      step({ title: "Flaps: electric, in the right wing", anchor: "flaps", w: ["yoke"], parts: ["flaps", "af.flap_tracks.flaps", "af.flap_drive.wing_center", "wiring.wing_flaps", "CB-FLAP"],
        text: "The flaps are the one surface driven by a motor: a 28-volt actuator in the right wing on a 10-amp breaker turns drive pulleys; cables tie the left and right flaps together and push-pull rods move them along their tracks, to 10, 20 and 30 degrees.",
        show: { look: "ghost", system: "controls", state: { controls: { pitch: 0, roll: 0, yaw: 0, flaps: 30 } }, ...V(-60, 35, 7.5, [1.5, 0.3, 0]) } }),
    ] },

    { title: "Fuel", icon: "fuel", steps: [
      step({ title: "No pump: gravity does it", anchor: "fuel-3d.selector_valve", w: ["panel"], panel: ["fuel", "engine"], figure: "fuel",
        text: "The 172P has no fuel pump. Fuel falls from the two wing tanks, out of each tank's outlets and down lines inside both door posts, to the selector valve under the cabin floor (BOTH, LEFT, RIGHT, OFF). From there one line runs forward to the strainer on the firewall, and a hose takes it to the carburetor on the engine. The service manual lists an electric auxiliary pump only for the fuel-injected 172Q; the O-320's own pump pad is blanked off.\n\nThe lines carrying fuel show the blue of 100LL avgas. Switch the selector to see which tanks feed.",
        show: { look: "ghost", system: "fuel", ...V(-35, 34, 6.5, [-0.2, 0.1, 0]) } }),
      step({ title: "The carburetor", anchor: "engine.carburetor", w: ["parts"], parts: ["engine.carburetor", "fuel-3d.hose_strainer_carb", "fuel-3d.carb_inlet_fitting", "engine.intake", "engine.sump", "af.throttle_end.engine.crankcase", "Throttle", "Mixture"],
        text: "The fuel ends here: a Marvel-Schebler MA-4SPA updraft float carburetor bolted under the oil sump. Fuel from the strainer fills its float chamber; air drawn up from the air box through the venturi pulls fuel through the main jet, and the mixture rises through the sump's riser and the intake pipes to the four cylinders. The throttle cable opens its butterfly; the mixture cable leans it, and pulled fully out it cuts the fuel off to stop the engine. Carburetor heat can route warmed air past the exhaust when ice forms in the venturi.",
        show: { look: "ghost", system: "fuel", select: "engine.carburetor", ...V(118, 4, 0.95, [-1.32, -0.44, 0]) } }),
      step({ title: "The only pump: the primer", anchor: "fuel-3d.strainer_bowl", w: ["parts"], parts: ["fuel-3d.primer_barrel", "fuel-3d.primer_supply", "fuel-3d.primer_delivery_engine", "fuel-3d.primer_nozzle_4", "fuel-3d.strainer_bowl", "fuel-3d.selector_valve"],
        text: "The one pump in the system is the hand primer on the panel. Before a cold start the pilot pulls and pushes it two to six strokes: it draws fuel from the strainer and squirts it through thin lines into the engine's intake, so the first firings have fuel before the carburetor takes over.",
        show: { look: "ghost", system: "fuel", ...V(-140, 22, 2.8, [-0.75, -0.2, 0.15]) } }),
    ] },

    { title: "Electrical", icon: "power", steps: [
      step({ title: "A split master switch", anchor: "MasterBAT", w: ["panel"], panel: ["master", "engine", "lights"], figure: "electrical",
        text: "28-volt DC, negative ground. The master switch has two halves: BAT closes the battery contactor and puts the battery on the bus; ALT lets the 60-amp alternator power the bus and charge the battery. Every load hangs off a circuit breaker on the panel's breaker strip.\n\nTurn ALT off and watch the battery carry everything.",
        show: { look: "ghost", system: "electrical", ...V(-60, 25, 6.5, [-0.6, 0, 0]) } }),
      step({ title: "Breakers", anchor: "CB-NAV-LT", w: ["parts"], parts: ["CB-ALT", "CB-FLAP", "CB-NAV-LT", "CB-LDG-LT", "CB-BCN-LT", "CB-INST", "CB-PITOT-HT", "CB-TURN-COORD", "AvionicsMaster", "MasterBAT", "MasterALT"],
        text: "The breaker strip under the panel: ALT 60 A, ALT FIELD 5 A, FLAP 10 A, INST 5 A, NAV LT 5 A, BCN LT 10 A, LAND LT 20 A from 1982, TURN COORD 5 A, and the 40 A avionics power switch-breaker that feeds the avionics bus. Ratings and positions are from the service manual's Figure 16-1.",
        show: { look: "solid", ...V(1.8, 22.0, 0.669, [-0.37, -0.2, 0.3]) } }),
    ] },

    { title: "The wiring", icon: "wire", steps: [
      step({ title: "Every wire, from the service manual", anchor: "wing_left", w: ["circuit"], circuit: "wiring.nav_lights",
        text: "Section 20 of the service manual draws every circuit: each wire's number, gauge and the two terminals it joins. All of the 172P's wires are here, each run along the airframe through the harness: behind the panel, through the firewall, up the door posts to the wing disconnect plugs, out along the wing spar, and back through the tailcone.\n\nPick a circuit to see only its wires.",
        show: { look: "ghost", ...V(-60, 30, 9, [1.2, 0.2, 0]) } }),
      step({ title: "Behind the panel", anchor: "MasterALT", w: ["circuit"], circuit: "wiring.battery_master",
        text: "Behind the instrument panel the wires meet the breakers, switches and instruments at their rear terminals, then gather into bundles that pass through the firewall to the battery, contactors and alternator control unit on its engine side.",
        show: { look: "ghost", ...V(-150, 16, 2.6, [-0.6, -0.15, 0.1]) } }),
    ] },

    { title: "Radios and antennas", icon: "wire", steps: [
      step({ title: "Antennas to radios", anchor: "VHFAntenna", w: ["circuit"], circuit: "wiring.antenna_coax",
        text: "Two VHF whips on the cabin top feed the two NAV/COM radios; the V-shaped VOR antenna on the fin feeds both NAV receivers through a splitter; blade antennas under the belly serve the transponder, ADF and marker receiver; the ELT has its own whip on the tailcone. Each runs coax to the back of its radio.\n\nThe service manual has no avionics installation section, so this coax is routed along the airframe's harness by normal practice, not from a drawing, and each cable's card says so.",
        show: { look: "ghost", ...V(-60, 26, 9, [1.4, 0.0, 0]) } }),
      step({ title: "Power and audio", anchor: "KX165-1", w: ["circuit"], circuit: "wiring.avionics_power",
        text: "The avionics master puts the primary bus on the avionics bus; each radio takes power through its own RADIO breaker (the breakers and bus are in the manual) and grounds behind the panel. The KMA 20 audio panel joins the radios, the pilot's and copilot's headset and mic jacks, and the cabin speaker.\n\nThe manual stops at the breakers; the radio leads are drawn by normal practice.",
        show: { look: "ghost", ...V(160, 18, 0.8, [-0.5, -0.13, 0.05]) } }),
    ] },

    { title: "The engine", icon: "engine", group: "The engine", steps: [
      step({ title: "Lycoming O-320-D2J", w: ["parts", "explode"], parts: ["engine.crankcase", "engine.cyl1", "engine.crankshaft", "engine.sump", "engine.carburetor", "engine.camshaft", "engine.valves1", "engine.magneto_left", "engine.alternator", "engine.starter"],
        text: "Four cylinders, horizontally opposed, air-cooled: 5.125-inch bore, 3.875-inch stroke, 319.8 cubic inches, 160 horsepower at 2,700 rpm. Every assembly in the Lycoming parts catalog is a separate part here, with its catalog figure and part numbers on its card.",
        show: { look: "solid", select: "engine.crankcase", isolate: "group" } }),
      step({ title: "Its hardware", anchor: "engine.cyl1", w: ["parts"], parts: [],
        text: "All 673 hardware units the catalog lists for this engine are placed: cylinder hold-down nuts, rocker-cover screws, sump and accessory-housing bolts, intake and exhaust flange nuts, magneto nuts, rod bolts that ride on the moving rods. Use Show only → Engine hardware, or click any nut for its catalog figure and part number.",
        show: { look: "solid", select: "engine.crankcase", ...V(-150, 30, 2.6, [-1.35, -0.05, 0]) } }),
    ] },

    { title: "Inside the cylinders", icon: "cyl", steps: [
      step({ title: "Four strokes, firing 1-3-2-4", anchor: "engine.cyl1", w: ["panel"], panel: ["engine", "mags"], figure: "engine-cycle",
        text: "Each cylinder needs two crankshaft turns for its four strokes: intake, compression, power, exhaust. Firing 1-3-2-4, one cylinder is always on its power stroke. The pistons and rods move with exact slider-crank geometry from the bore and stroke; slowed down a hundred times here.",
        show: { look: "ghost", system: "engine", state: { engine: { slow: 160, xray: true } }, select: "engine.cyl1", ...V(-140, 36, 2.8, [-1.35, -0.1, 0]) } }),
    ] },

    { title: "Two magnetos", icon: "power", steps: [
      step({ title: "The engine makes its own spark", anchor: "engine.magneto_left", w: ["panel"], panel: ["engine", "mags"], figure: "engine-ignition",
        text: "Two magnetos, driven by the crankshaft, each fire one of the two spark plugs in every cylinder, so the engine keeps running if one fails. Switch to L or R and only that magneto's plugs fire; switch both off and the engine stops. The P-leads from the ignition switch ground a magneto to turn it off.",
        show: { look: "ghost", system: "engine", state: { engine: { slow: 140, xray: true } }, ...V(-200, 30, 2.6, [-1.25, -0.05, 0]) } }),
    ] },

    { title: "Instruments", icon: "gauge", group: "In the cockpit", steps: [
      step({ title: "Pitot and static", anchor: "instruments-3d.asi_case", w: ["panel"], panel: ["pitot"], figure: "pitot",
        text: "The pitot tube under the left wing takes ram air; a line runs inboard through the wing and down the door post to the back of the airspeed indicator. The static port on the fuselage side feeds still air through a sump and the alternate-static valve to the airspeed indicator, the altimeter and the vertical speed indicator. Block the pitot and the airspeed falls away; block the static port and the altimeter and vertical speed freeze.\n\nThe service manual draws the lines but prints no line sizes; those are estimated.",
        show: { look: "ghost", system: "pitot", ...V(-110, 20, 4.2, [0.0, 0.15, 0.7]) } }),
      step({ title: "Vacuum and the gyros", anchor: "instruments-3d.ai_case", w: ["attitude", "panel"], panel: ["engine"],
        text: "The attitude and heading indicators are air-driven gyros. An engine-driven dry vacuum pump draws cabin air through a filter, into each instrument where it spins the rotor against its buckets, out through a regulator to the pump. The suction gauge shows the vacuum. The turn coordinator's rotor is electric, so it keeps working if the vacuum pump fails.\n\nThe instrument cases are drawn see-through. Their internals follow the FAA handbook's generic construction, not Cessna drawings, and the rotor speeds are illustrative. Stop the engine and the vacuum rotors run down; the turn coordinator keeps spinning on the master switch.",
        show: { look: "ghost", system: "pitot", state: { engine: { slow: 100 } }, ...V(-155, 14, 1.25, [-0.47, 0.06, 0.12]) } }),
    ] },

    { title: "Every bolt", icon: "bolt", group: "Every part", steps: [
      step({ title: "What holds the wings on", w: ["parts"], parts: ["af.wing_attach.fuselage", "af.wing_strut.wing_center", "af.wing_strut.fuselage", "af.aileron_hinges.leftaileron", "af.aileron_bellcrank.wing_left", "af.flap_tracks.flaps", "af.fuel_tanks.wing_center"],
        text: `Every fastener the service manual's figures call out for the 172P is placed on the model: ${hwTotal} of them in ${hwAsm} assemblies from ${hwFigs} figures. Here, the wing attach bolts at the cabin top and the strut fittings, with the aileron hinges, bellcranks and flap tracks out along the wing.\n\nClick any bolt for its figure, part number, size and torque where the manual prints one, and how its position was found.`,
        show: { look: "ghost", select: "af.wing_attach.fuselage", ...V(-120, 32, 4.2, [0.3, 0.55, 0.4]) } }),
      step({ title: "The cowling", w: ["parts"], parts: ["af.cowling.fuselage_cowling", "af.cowling.fuselage_cowling_top", "af.cowling.oildoor", "af.engine_mount.fuselage"],
        text: "The cowling comes off in halves: quick-release fasteners along both side split lines join the upper and lower cowl, the nose caps are riveted and screwed together, the oil door hangs on a riveted hinge with two latches, and the whole cowl sits on shock-mounted quick-release studs at its aft edge. Counts the manual prints are used as printed; where a figure shows a row without a count, the pitch is estimated and the card says so.",
        show: { look: "solid", select: "af.cowling.fuselage_cowling", ...V(130, 10, 2.6, [-1.45, -0.05, 0.3]) } }),
      step({ title: "Landing gear and wheels", w: ["parts"], parts: ["af.main_gear.LeftWheelStrut", "af.main_wheels.LeftWheel", "af.nose_gear.NoseWheelStrut", "af.torque_links.NoseWheelStrut", "af.nose_strut.NoseWheelStrut", "af.shimmy_damper.NoseWheelStrut", "af.nose_wheel.NoseWheel"],
        text: "The spring-steel main gear legs bolt into the fuselage; the wheels are McCauley two-piece halves held by through-bolts, with the brake assemblies on torque plates. The nose gear carries its shock strut, torque links, steering and shimmy damper.",
        show: { look: "ghost", select: "af.main_gear.LeftWheelStrut", ...V(-150, 12, 3.6, [0.6, -0.9, 0.6]) } }),
      step({ title: "Tail, hinges and trim", w: ["parts"], parts: ["af.stab_attach.hstab", "af.elevator_install.hstab", "af.trim_actuator.hstab", "af.fin_attach.vstab.001", "af.rudder_hinges.rudder_1", "af.rudder_cables.rudder_1"],
        text: "The horizontal stabilizer and fin bolt to the tailcone; the elevators, rudder and trim tab hang on their hinge bolts, and the cables end at bellcranks and the trim actuator.",
        show: { look: "ghost", select: "af.stab_attach.hstab", ...V(-140, 26, 4.2, [4.8, -0.2, 0]) } }),
      step({ title: "All of it, taken apart", anchor: "wing_left", w: ["explode"],
        text: `Access-panel screws, the windshield, doors and latches, seats, the engine mount and cowling, the control system's pulleys and stops. Where the manual gives a count or a station, it is used; where it shows a pattern without a count (screws around a fairing, for example), the count is estimated and the card says so: ${hwEst} of the ${hwTotal} positions are estimated patterns. The manual gives no production pattern for skin rivets, so those are not invented.\n\nUse Show only → Airframe hardware to see the fasteners alone, or take the airplane apart: each group comes off with the part it holds.`,
        show: { look: "ghost", ...V(-40, 24, 12, [2, -0.2, 0]) } }),
    ] },

    { title: "Take it with you", icon: "export", steps: [
      step({ title: "Export", anchor: "fuselage", w: ["export"],
        text: "Export saves the model as you see it: glTF (.glb) keeps every part's name, group, facts and sources and opens in Blender, CAD viewers and game engines; OBJ and STL suit any 3D package or a slicer; the parts list is a spreadsheet. Isolate something first to export just that, or take it apart to export an exploded view. Units: metres, millimetres or inches.",
        show: { look: "solid", ...V(-38, 14, 11.5, [2.0, -0.2, 0]) } }),
    ] },
  ];
}
