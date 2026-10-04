// Explorer core: an interactive, explodable, operable teardown of a machine with live system overlays,
// official figures, guided lessons, a tour and 1080p60 export. A machine is a config object (see
// MACHINE.md); this module supplies the stage, parts, systems, diagrams, lessons, tour and export.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { layoutPlan, layoutFlow, layoutBus } from "./layouts.js";
import { FigureView, svgEl } from "./figures.js";
import { exportMachine } from "./export.js";

export { THREE };
export const fetchJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });

// Artifact hosting serves JSON and images but not .glb, and blocks fetch() of data: URLs. Models ship as
// glTF JSON with the geometry buffer base64-embedded; decode it here and parse an in-memory GLB.
export async function loadModel(url) {
  if (!url.endsWith(".json")) return new GLTFLoader().loadAsync(url);
  const json = await fetchJSON(url);
  const bins = json.buffers.map(b => { const b64 = b.uri.slice(b.uri.indexOf(",") + 1); return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); });
  // Merge multiple buffers into one (GLB holds one binary chunk).
  let off = 0; const offsets = bins.map(b => { const o = off; off += Math.ceil(b.length / 4) * 4; return o; });
  const bin = new Uint8Array(off); bins.forEach((b, i) => bin.set(b, offsets[i]));
  for (const v of json.bufferViews) { v.byteOffset = (v.byteOffset || 0) + offsets[v.buffer || 0]; v.buffer = 0; }
  json.buffers = [{ byteLength: bin.length }];
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jLen = Math.ceil(enc.length / 4) * 4, bLen = bin.length;
  const glb = new Uint8Array(28 + jLen + bLen), dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jLen, true); dv.setUint32(16, 0x4e4f534a, true); glb.set(enc, 20); glb.fill(0x20, 20 + enc.length, 20 + jLen);
  dv.setUint32(20 + jLen, bLen, true); dv.setUint32(24 + jLen, 0x004e4942, true); glb.set(bin, 28 + jLen);
  return new GLTFLoader().parseAsync(glb.buffer, url.slice(0, url.lastIndexOf("/") + 1));
}

const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function template(M) {
  const looks = M.looks || { solid: "Solid", ghost: "Cutaway" };
  return `
<div class="wrap">
  <header><h1>${M.title}</h1><p class="lede">${esc(M.lede)}</p></header>
  <div class="main">
    <div style="display:grid; gap:10px; min-width:0">
      <div class="stage" id="stage">
        <canvas id="gl" aria-label="${esc(M.name)} in 3D with system overlays"></canvas>
        <div class="labels" id="labels"></div>
        <div class="stage-title"><span class="eyebrow">${esc(M.eyebrow || M.name)}</span><span class="beat" id="stage-beat"></span></div>
        <div class="stage-note">drag to orbit · middle-drag to move · scroll to zoom · click a part · double-click to isolate</div>
        <button class="iso-chip" id="iso-chip" hidden title="Show everything (Esc)"></button>
        <div class="stage-tools">
          <div class="find"><input id="find" type="search" placeholder="Find a part…" autocomplete="off" aria-label="Find a part" aria-controls="find-list"><ul class="find-list" id="find-list" role="listbox" hidden></ul></div>
          <select id="only" aria-label="Show only one group"><option value="">Show everything</option></select>
          <button id="export-open" aria-haspopup="dialog" aria-expanded="false">Export</button>
        </div>
        <div class="export-menu" id="export-menu" role="dialog" aria-label="Export" hidden>
          <div class="em-row"><span>What</span><div class="seg" id="ex-scope"><button data-v="all" aria-pressed="true">Everything</button><button data-v="visible" aria-pressed="false">What you see</button><button data-v="selected" aria-pressed="false">Selected</button></div></div>
          <div class="em-row"><span>Format</span><div class="seg" id="ex-format"><button data-v="glb" aria-pressed="true">glTF (.glb)</button><button data-v="obj" aria-pressed="false">OBJ</button><button data-v="stl" aria-pressed="false">STL</button><button data-v="csv" aria-pressed="false">Parts list (CSV)</button></div></div>
          <div class="em-row"><span>Units</span><div class="seg" id="ex-units"><button data-v="m" aria-pressed="true">m</button><button data-v="mm" aria-pressed="false">mm</button><button data-v="in" aria-pressed="false">in</button></div></div>
          <p class="hint" id="ex-hint">glTF keeps part names, groups, facts and sources as extras; it opens in Blender, most CAD viewers and game engines. Parts export where they are drawn, so an exploded view exports exploded.</p>
          <div class="bar"><button class="primary" id="ex-go">Save</button><button id="ex-close">Close</button><span class="readout" id="ex-status"></span></div>
        </div>
        <div class="inspector" id="inspector" hidden>
          <div class="ins-head"><div><span class="ins-group" id="ins-group"></span><h3 id="ins-title"></h3></div><button id="ins-close" aria-label="Clear selection">✕</button></div>
          <dl id="ins-facts"></dl>
          <div class="ins-actions">
            <button id="ins-iso" class="primary">Isolate</button><button id="ins-isogroup">Isolate group</button><button id="ins-hide">Hide</button>
            <div class="seg"><button id="ins-prev" aria-label="Previous part">◀</button><button id="ins-next" aria-label="Next part">▶</button></div>
          </div>
          <p class="ins-hint">Shift-click to add parts · double-click to isolate · <kbd>Esc</kbd> back</p>
        </div>
        <div class="hover-tip" id="hover-tip" hidden></div>
        <div class="loading" id="loading">loading ${esc(M.name)}…</div>
      </div>
      <div class="bar">
        <div class="seg" role="group" aria-label="Look">
          <button id="look-solid" aria-pressed="true">${esc(looks.solid)}</button>
          <button id="look-ghost" aria-pressed="false">${esc(looks.ghost)}</button>
        </div>
        <div class="field" style="flex:1 1 300px; grid-template-columns: 6em minmax(0,1fr) auto"><label for="explode">${M.dismantle ? "Dismantle" : "Explode"}</label><input type="range" id="explode" min="0" max="1000" step="1" value="0"><span class="stage-label" id="explode-v">assembled</span></div>
        <button id="reset-view">Reset view</button>
      </div>
      <div class="panel">
        <div class="bar" style="justify-content:space-between"><h2>Tour</h2><span class="readout" id="tour-time"></span></div>
        <div class="beats" id="beats"></div>
        <div class="bar">
          <button id="tour-play" class="primary">Play tour</button>
          <input type="range" id="tour-scrub" min="0" max="1000" value="0" aria-label="Tour time" style="flex:1 1 200px">
          <button id="export">Render 1080p60</button>
        </div>
        <progress id="export-progress" max="1" value="0" hidden></progress>
        <p class="hint" id="export-status">The tour is a timeline of camera moves, reveals and switch changes; export renders it frame by frame.</p>
        <video id="export-video" controls playsinline hidden></video>
        <button id="export-save" hidden>Save MP4</button>
      </div>
      <section class="panel" id="learn-panel" aria-labelledby="learn-title" hidden>
        <h2 id="learn-title">Learn</h2>
        <div class="lessons" id="lessons"></div>
        <div class="lesson-body" id="lesson-body" hidden><h3 id="lesson-title"></h3><div id="lesson-text"></div><div class="bar"><button id="lesson-show" class="primary">Show me on the machine</button><button id="lesson-next">Next lesson</button></div></div>
      </section>
    </div>
    <div class="deck">
      <section class="panel" aria-labelledby="sys-title">
        <h2 id="sys-title">Systems</h2>
        <div class="systems" id="systems"></div>
        <div class="switches" id="switches"></div>
        <div id="trace-wrap" hidden><div class="trace-head"><h2>Current path</h2><span class="readout" id="trace-count"></span></div><ol class="trace" id="trace"></ol></div>
      </section>
      <section class="panel" id="schematic-panel" aria-labelledby="schem-title" hidden>
        <div class="bar" style="justify-content:space-between"><h2 id="schem-title">System diagram</h2><span class="readout" id="schem-kind"></span></div>
        <div class="fig" id="fig">
          <div class="bar fig-tabs"><div class="seg" role="tablist" id="fig-tabs" aria-label="Diagram"></div><button id="fig-expand" aria-pressed="false">Expand</button></div>
          <div class="fig-frame" id="fig-frame"><img id="fig-img" alt=""><svg id="fig-svg"></svg><div id="fig-badges"></div></div>
          <svg id="schematic" role="img" aria-label="Live topology of the active system" hidden></svg>
          <p class="src" id="fig-src"></p>
        </div>
      </section>
      <section class="panel card" id="card" aria-live="polite">
        <h2>Selected</h2>
        <h3 id="card-title">Nothing selected</h3>
        <dl id="card-facts"></dl>
        <p class="src" id="card-src"></p>
        <div class="bar" id="iso-bar" hidden>
          <button id="iso-part">Isolate part</button>
          <button id="iso-group">Isolate group</button>
          <div class="seg" role="group" aria-label="Step through parts"><button id="iso-prev" aria-label="Previous part">◀</button><button id="iso-next" aria-label="Next part">▶</button></div>
          <button id="iso-exit" hidden>Show everything</button>
        </div>
        <p class="hint" id="iso-hint" hidden>Double-click a part to isolate it. <kbd>I</kbd> isolate, <kbd>G</kbd> group, <kbd>←</kbd> <kbd>→</kbd> step, <kbd>Esc</kbd> back.</p>
      </section>
      <section class="panel" aria-labelledby="parts-title">
        <div class="bar" style="justify-content:space-between"><h2 id="parts-title">Parts</h2><button id="show-all">Show all</button></div>
        <div class="tree" id="tree"></div>
        <p class="hint">Click to select and frame. <b>Hide</b> removes a part from view; Show all brings everything back.</p>
      </section>
    </div>
  </div>
</div>`;
}

// Story layout: chapter menu | persistent stage | step panel; the free-exploration panels move into a drawer.
// Story layout (Enigma-style): the machine fills the window on warm paper; a slim top bar (Back · chapter
// menu · Next), an intro screen, a note pinned to the part each step is about (with a dotted leader), and a
// chapters drawer. The free-exploration panels live in a drawer.
const ICONS = {   // 24×24 line icons for the chapters drawer
  intro: "M4 7h16v12H4zM4 7l2-3h12l2 3M8 11h8M8 15h5", plane: "M3 13l8-2 4-7h2l-2 7 5 1v2l-5 1 2 6h-2l-4-6-8-1z", walk: "M12 4a2 2 0 1 0 0 .1M10 8l-2 6 3 1 1 5M12 10l3 2M10 14l-2 6",
  structure: "M3 18h18M5 18V8l7-4 7 4v10M5 8h14M9 18V8M15 18V8M5 13h14", controls: "M4 12h4l2-5 4 10 2-5h4M6 6a2 2 0 1 0 .1 0M18 18a2 2 0 1 0 .1 0", fuel: "M12 3c3 5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6 6-11z",
  power: "M13 2L5 14h6l-1 8 8-12h-6z", wire: "M3 6c6 0 6 12 12 12h6M3 12h4M17 6h4M21 6v12", engine: "M5 9h3l2-2h4l2 2h3v7h-3l-2 2h-4l-2-2H5zM2 11v3M22 11v3", cyl: "M8 3h8v4H8zM7 7h10v6H7zM12 13v5M9 21h6M10 18h4",
  gauge: "M4 16a8 8 0 1 1 16 0M12 16l4-5M7 12l1 1M12 8v1M17 12l-1 1", flight: "M2 18l20-8M5 15l3-6M14 13l4 5", landing: "M2 20h20M5 16l12-6M17 10l3 2M8 20v-2M14 20v-2", bolt: "M9 3h6v4l-2 2v12h-2V9L9 7zM8 13h8",
  export: "M12 3v12M7 10l5 5 5-5M4 19h16", rocket: "M12 2c4 3 5 8 4 13H8C7 10 8 5 12 2zM8 15l-3 4h4M16 15l3 4h-4M10 19l2 3 2-3", orbit: "M12 12a3 3 0 1 0 .1 0M3 12c0-3 4-5 9-5s9 2 9 5-4 5-9 5-9-2-9-5z",
  book: "M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z", dot: "M12 12a3 3 0 1 0 .1 0",
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k] || ICONS.dot}"/></svg>`;

// Drag a floating panel by its handle (the panel itself if no handle). Interactive children keep working.
function makeDraggable(el, handle, onDrag) {
  let start = null;
  (handle || el).addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.target.closest("button,input,select,textarea,a,label,[role=listbox],.fig-frame,.fx-list,.sx-evlist,table")) return;
    const r = el.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.classList.add("dragging"); e.preventDefault();
  });
  el.addEventListener("pointermove", e => {
    if (!start) return;
    const x = Math.max(4, Math.min(innerWidth - 60, start.l + e.clientX - start.x)), y = Math.max(4, Math.min(innerHeight - 40, start.t + e.clientY - start.y));
    onDrag ? onDrag(x, y) : Object.assign(el.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto", transform: "none" });
  });
  const end = e => { if (!start) return; start = null; el.classList.remove("dragging"); try { el.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
}

function mountStoryLayout(M) {
  const $ = id => document.getElementById(id);
  const wrap = document.querySelector(".wrap"), main = document.querySelector(".main"), stage = $("stage");
  document.body.classList.add("story-mode", "paper");
  const root = document.createElement("div"); root.className = "story-root";
  root.innerHTML = `
    <a class="skip-link" href="#story-note">Skip to the lesson</a>
    <div class="story-stage-slot"></div>
    <svg class="story-leader" id="story-leader" aria-hidden="true"><line id="leader-line"/><circle id="leader-dot" r="3.5"/></svg>
    <nav class="tour-bar" aria-label="Lesson">
      <button class="tour-back" id="story-prev"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Back</button>
      <button class="tour-title" id="story-menu" aria-expanded="false" aria-controls="story-drawer"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span id="story-chapter-title"></span></button>
      <button class="tour-next" id="story-next">Next<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    </nav>
    <section class="story-intro" id="story-intro" hidden>
      <div class="intro-copy"><h1 id="intro-title"></h1><div id="intro-body"></div>
        <button class="intro-action" id="intro-go"><span id="intro-cta">Begin</span><kbd>Enter</kbd></button>
        <button class="intro-link" id="intro-explore">Explore the machine freely</button></div>
      <figure class="intro-gallery" id="intro-gallery" hidden><div class="intro-photos" id="intro-photos"></div><figcaption><span id="intro-caption"></span><small id="intro-credit"></small></figcaption></figure>
    </section>
    <article class="anchored-note" id="story-note" aria-live="polite" hidden>
      <div class="note-head" title="Drag to move · double-click to put it back"><span id="story-step-count"></span><span class="grip" aria-hidden="true">⠿</span></div>
      <h2 id="story-title"></h2>
      <div class="note-body" id="story-text"></div>
      <div class="story-widget" id="story-widget"></div>
      <p class="src" id="story-sources"></p>
      <p class="note-hint" id="story-hint">Press <kbd>Enter</kbd> to continue</p>
    </article>
    <figure class="story-polaroid" id="story-photo" hidden></figure>
    <div class="drawer-scrim" id="drawer-scrim" hidden></div>
    <aside class="story-drawer" id="story-drawer" aria-label="Chapters" hidden>
      <div class="drawer-head"><h2>Chapters</h2><button id="drawer-close" aria-label="Close chapters">✕</button></div>
      <div class="drawer-list" id="story-nav"></div>
      <button class="drawer-explore" id="explore-toggle" aria-pressed="false">Explore the machine freely</button>
    </aside>
    <div class="utility" id="story-utility"></div>`;
  wrap.insertBefore(root, main);
  root.querySelector(".story-stage-slot").append(stage);
  root.querySelector("#story-utility").append(...[...stage.querySelectorAll(".stage-tools, .export-menu")]);
  const drawer = document.createElement("section"); drawer.id = "explore-drawer"; drawer.hidden = true; drawer.className = "explore-drawer";
  drawer.innerHTML = `<div class="drawer-head"><h2>Explore freely</h2><button id="explore-close" aria-label="Back to the story">✕</button></div>`;
  wrap.insertBefore(drawer, main); drawer.append(main);
}

export async function createExplorer(M) {
  const root = document.getElementById("app") || document.body;
  root.innerHTML = template(M);
  if (M.story) mountStoryLayout(M);
  if (M.accent) document.documentElement.style.setProperty("--accent", M.accent);
  if (M.focus) document.documentElement.style.setProperty("--focus", M.focus);
  const $ = id => document.getElementById(id);
  const COLORS = M.colors || {};
  const GROUPS = M.groups || {};

  const ctx0 = {};
  let loaded;
  try { loaded = await M.load({ THREE, loadModel, fetchJSON }); }
  catch (e) { $("loading").textContent = `${M.name} could not load: ${e.message || e}`; throw e; }
  const overlay = loaded.overlay || { parts: {}, systems: {} };
  overlay.parts ||= {}; overlay.systems ||= {};
  let figures = loaded.figures || null;
  $("loading").hidden = true;

  // ---------- Stage ----------------------------------------------------------------------------
  const canvas = $("gl");
  // WebGPU when the page loads three's WebGPU build (it falls back to WebGL 2 by itself); WebGL otherwise.
  const GPU = !!THREE.WebGPURenderer;
  const renderer = GPU ? new THREE.WebGPURenderer({ canvas, antialias: true }) : new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  if (GPU) await renderer.init();
  ctx0.backend = GPU ? (renderer.backend?.isWebGPUBackend ? "WebGPU" : "WebGL 2 (WebGPU unavailable)") : "WebGL";
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const PAPER = !!M.story && M.theme !== "dark";            // warm paper studio, as on enigma.design
  scene.background = new THREE.Color(PAPER ? 0xe6e1d5 : 0x07090c);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-4, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ab8ff, 0.8); rim.position.set(6, 3, -6); scene.add(rim);
  const model = loaded.model;
  // `world` holds the model and the system overlays, so a machine may re-orient both together (ctx.world).
  const world = new THREE.Group(); scene.add(world); world.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3()), SIZE = box.getSize(new THREE.Vector3()).length();
  scene.fog = new THREE.Fog(PAPER ? 0xe6e1d5 : 0x07090c, SIZE * 1.6, SIZE * 3.6);
  const camera = new THREE.PerspectiveCamera(M.fov ?? (M.story ? 42 : 32), 16 / 9, SIZE / 500, SIZE * 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = SIZE * 0.08; controls.maxDistance = SIZE * 3;
  // Left drag orbits, middle (or right) drag moves the centre, the wheel zooms toward the cursor.
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  controls.screenSpacePanning = true; controls.zoomToCursor = true;
  canvas.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); });   // no browser auto-scroll on middle click
  const grid = new THREE.GridHelper(SIZE * 4, 80, PAPER ? 0xcfc5ae : 0x223040, PAPER ? 0xdbd3c1 : 0x141b24);
  grid.position.y = box.min.y - SIZE * 0.0002;
  grid.material.transparent = true; grid.material.opacity = 0.55;
  scene.add(grid);

  // ---------- Parts --------------------------------------------------------------------------------
  const PARTS = [], byName = new Map();
  const ghostMat = new THREE.MeshPhysicalMaterial({ color: PAPER ? 0x6b6252 : 0x9aa9bd, metalness: PAPER ? 0.1 : 0.55, roughness: 0.35, transparent: true, opacity: PAPER ? 0.14 : 0.12, depthWrite: false, side: THREE.DoubleSide });
  const ghostDim = ghostMat.clone(); ghostDim.opacity = 0.05;
  const selMat = new THREE.MeshPhysicalMaterial({ color: PAPER ? 0xf3e2b5 : 0xe6ebf2, metalness: 0.2, roughness: 0.4, emissive: new THREE.Color(M.focus || "#5fd4ff"), emissiveIntensity: 0.25 });
  const prettify = n => n.replace(/[._]\d+$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

  function addPart(node, opts = {}) {
    // A part: `root` carries the explode offset, `pivot` any articulation; meshes keep their original material.
    const meshes = []; node.traverse(o => o.isMesh && meshes.push(o));
    if (!meshes.length) return null;
    meshes.forEach(m => (m.userData.orig ??= m.material));
    model.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(node);
    const name = opts.name || node.name;
    const meta = overlay.parts[name] || {};
    const p = { name, node, meshes, hidden: false, center: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()),
      group: opts.group || meta.group || M.groupOf?.(name, node) || "other", label: opts.label || meta.label || M.labelOf?.(name, node) || prettify(name),
      facts: opts.facts || meta.facts, note: opts.note || meta.note, source: opts.source || meta.source, keepMaterial: opts.keepMaterial };
    if (opts.inPlace) { p.root = node; p.pivot = node; }
    else {
      // root (explode offset) and pivot (articulation) are identity groups inserted between the node and
      // its parent, so the node keeps its transform.
      const rootG = new THREE.Group(), pivot = new THREE.Group(); rootG.name = name + ":root";
      const parent = node.parent || model;
      parent.add(rootG); rootG.add(pivot); pivot.add(node);
      p.root = rootG; p.pivot = pivot;
    }
    p.basePos = p.root.position.clone();
    // Explode vectors may be given in world space (default) or in the part's parent frame (explodeLocal).
    const par = p.root.parent || model; par.updateMatrixWorld(true);
    const m3 = new THREE.Matrix3().setFromMatrix4(par.matrixWorld);
    const vec = opts.explode || M.explodeVector?.(p, THREE, { center, SIZE }) || p.center.clone().sub(center).normalize().multiplyScalar(SIZE * 0.25);
    if (opts.explodeLocal) { p.explodeLocal = vec.clone(); p.explodeWorld = vec.clone().applyMatrix3(m3); }
    else { p.explodeWorld = vec.clone(); p.explodeLocal = vec.clone().applyMatrix3(m3.clone().invert()); }
    p.offsetWorld = new THREE.Vector3();
    meshes.forEach(m => (m.userData.part = p));
    PARTS.push(p); byName.set(name, p);
    return p;
  }
  for (const node of (M.partNodes ? M.partNodes(model) : [...model.children])) addPart(node);

  // ---------- State ---------------------------------------------------------------------------------
  const state = { look: "solid", explode: 0, system: null, isolate: null, ...structuredClone(M.state || {}) };
  let selected = null;
  const multi = new Set();                       // shift-click selection (isolated together)

  const ctx = { ...ctx0, paper: PAPER, sceneBase: scene.background.clone(), THREE, M, state, scene, world, grid, renderer, model, camera, controls, PARTS, byName, overlay, center, SIZE, $, addPart,
    get selected() { return selected; }, colors: COLORS };

  M.setup?.(ctx);                  // add generated parts (e.g. an engine) and synthetic systems

  // ---------- Systems overlay -------------------------------------------------------------------
  const flowVS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const flowFS = `uniform vec3 uColor; uniform float uTime; uniform float uLen; uniform float uSpeed; uniform float uOn; uniform float uDash; varying vec2 vUv;
    void main(){ float s = vUv.x * uLen; float d = fract(s / uDash - uTime * uSpeed);
      float pulse = smoothstep(0.0, 0.35, d) * (1.0 - smoothstep(0.55, 0.9, d));
      float a = mix(0.18, 0.5, uOn) + uOn * pulse * 0.9;
      gl_FragColor = vec4(uColor * (0.6 + 0.8 * uOn * pulse), a); }`;
  const SYS = {};
  const sysRoot = new THREE.Group(); world.add(sysRoot);
  const labelsEl = $("labels");
  const R = M.overlayScale ?? SIZE / 600;               // tube radius and node size scale with the machine
  function hostFor(pos) {
    let best = null, bestVol = Infinity;
    for (const p of PARTS) {
      const b = new THREE.Box3().setFromCenterAndSize(p.center, p.size.clone().addScalar(SIZE * 0.006));
      if (b.containsPoint(pos)) { const v = p.size.x * p.size.y * p.size.z; if (v < bestVol) { bestVol = v; best = p; } }
    }
    return best;
  }
  function buildSystem(id, def) {
    const color = new THREE.Color(COLORS[id] || def.color || "#ffffff");
    const s = { id, def, color, group: new THREE.Group(), nodes: new Map(), edges: [] };
    s.group.visible = false; sysRoot.add(s.group);
    for (const n of def.nodes) {
      const pos = new THREE.Vector3(...n.pos);
      const host = n.host ? byName.get(n.host) : hostFor(pos);
      const small = n.kind === "junction" || n.small;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry((small ? 0.9 : 2.8) * R, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      mesh.userData.node = { sys: s, def: n };
      s.group.add(mesh);
      const tag = document.createElement("div");
      tag.className = "tag"; tag.style.setProperty("--c", COLORS[id]); tag.hidden = true;
      tag.innerHTML = `<b>●</b> ${esc(n.short || n.label)}<span class="v"></span>`;
      labelsEl.append(tag);
      s.nodes.set(n.id, { def: n, base: pos, host, mesh, tag, pos: pos.clone(), value: "" });
    }
    for (const e of def.edges) {
      if (!s.nodes.has(e.from) || !s.nodes.has(e.to)) continue;
      const uniforms = { uColor: { value: color }, uTime: { value: 0 }, uLen: { value: 1 }, uSpeed: { value: 1 }, uOn: { value: 0 }, uDash: { value: SIZE / 50 } };
      const mat = GPU ? Object.assign(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }), { uniforms })
        : new THREE.ShaderMaterial({ vertexShader: flowVS, fragmentShader: flowFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.renderOrder = 5;
      s.group.add(mesh);
      s.edges.push({ def: e, mesh, mat, on: 0, speed: 1, dir: 1 });
    }
    SYS[id] = s;
  }
  for (const [id, def] of Object.entries(overlay.systems)) buildSystem(id, def);
  ctx.SYS = SYS;
  function rebuildEdges(s) {
    for (const e of s.edges) {
      const a = s.nodes.get(e.def.from), b = s.nodes.get(e.def.to);
      const via = (e.def.via || []).map(v => { const w = new THREE.Vector3(...v); const h = a.host === b.host ? a.host : hostFor(w); return h ? w.add(h.offsetWorld) : w; });
      let pts = [a.pos, ...via, b.pos];
      if (e.dir < 0) pts = pts.slice().reverse();
      const path = new THREE.CurvePath();
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i].clone(), pts[i + 1].clone()));
      e.mesh.geometry.dispose();
      e.mesh.geometry = new THREE.TubeGeometry(path, Math.max(8, pts.length * 12), (e.def.thin ? 0.75 : 1) * R, 8, false);
      e.mat.uniforms.uLen.value = path.getLength();
    }
  }

  // ---------- Look, dismantle, isolation ---------------------------------------------------------
  const STAGES = M.dismantle || null;
  for (const p of PARTS) p.stage = STAGES ? STAGES.findIndex(st => (st.groups || []).includes(p.group) || (st.names || []).includes(p.name) || st.test?.(p)) : 0;
  for (const p of PARTS) if (p.follow) p.stage = p.follow.stage;          // hardware comes off with the part it holds
  const NSTAGE = STAGES ? STAGES.length : 1;
  function inIsolation(p) { const iso = state.isolate; return !iso || (iso.kind === "part" ? p === iso.part : iso.kind === "set" ? iso.parts.has(p) : p.group === iso.group); }
  function applyLook() {
    const sysOn = !!state.system, iso = !!state.isolate;
    for (const p of PARTS) {
      p.root.visible = !p.hidden && inIsolation(p);
      const bySys = sysOn && !!M.systemParts?.[state.system], inSys = bySys && M.systemParts[state.system](p);
      for (const m of p.meshes) {
        if ((p === selected || multi.has(p)) && state.look !== "solid" && !iso) m.material = selMat;   // the selection glows in the cutaway
        else if (iso || state.look === "solid" || inSys) m.material = m.userData.orig;          // a system's real parts stay solid
        else if (bySys) m.material = p.keepMaterial ? ghostDim : ghostMat;                        // everything else fades back; airframe stays as a faint reference
        else if (p.keepMaterial) m.material = m.userData.orig;
        else m.material = sysOn && M.dimInGhost?.(p) ? ghostDim : ghostMat;
      }
    }
    // M.overlay3D === false: no drawn overlay (dots, flow tubes, tags); a system is shown by its real parts.
    sysRoot.visible = !iso && M.overlay3D !== false;
  }
  function applyExplode() {
    const v = state.explode * NSTAGE;                      // stage-space value
    for (const p of PARTS) {
      const k = STAGES ? (p.stage < 0 ? NSTAGE - 1 : p.stage) : 0;
      // Isolated, the slider takes the visible parts apart all at once instead of stage by stage.
      const amt = STAGES && !state.isolate ? ease(v - k) * (p.stage < 0 ? 0.35 : 1) : ease(state.explode);
      p.root.position.copy(p.basePos).addScaledVector(p.explodeLocal, amt);
      p.offsetWorld.copy(p.explodeWorld).multiplyScalar(amt);
    }
    for (const s of Object.values(SYS)) for (const n of s.nodes.values()) { n.pos.copy(n.base); if (n.host) n.pos.add(n.host.offsetWorld); n.mesh.position.copy(n.pos); }
    const lab = $("explode-v");
    if (STAGES) { const k = Math.min(NSTAGE - 1, Math.floor(v - 1e-6)); lab.textContent = state.explode <= 0.001 ? "assembled" : `${k + 1}/${NSTAGE} · ${STAGES[Math.max(0, k)].label}`; }
    else lab.textContent = state.explode <= 0.001 ? "assembled" : `${Math.round(state.explode * 100)}%`;
    if (document.activeElement !== $("explode")) $("explode").value = Math.round(state.explode * 1000);
  }
  function setLook(l) { state.look = l; $("look-solid").setAttribute("aria-pressed", l === "solid"); $("look-ghost").setAttribute("aria-pressed", l === "ghost"); applyLook(); }
  $("look-solid").addEventListener("click", () => setLook("solid"));
  $("look-ghost").addEventListener("click", () => setLook("ghost"));
  $("explode").addEventListener("input", e => { state.explode = +e.target.value / 1000; applyExplode(); });
  Object.assign(ctx, { applyLook, applyExplode, setLook });

  // ---------- UI helpers for machine switches ----------------------------------------------------------
  const ui = {
    seg(options, value, onPick, label = "") {
      const d = document.createElement("div"); d.className = "seg"; d.setAttribute("role", "group"); d.setAttribute("aria-label", label);
      for (const o of options) { const b = document.createElement("button"); b.textContent = o; b.setAttribute("aria-pressed", o === value); b.addEventListener("click", () => { onPick(o); renderSwitches(); }); d.append(b); }
      return d;
    },
    row(label, control) { const r = document.createElement("div"); r.className = "row"; const s = document.createElement("span"); s.textContent = label; r.append(s, control); return r; },
    toggle(on, onChange, labels = ["On", "Off"]) { return ui.seg(labels, on ? labels[0] : labels[1], v => onChange(v === labels[0]), "switch"); },
    slider(label, min, max, step, value, fmt, onInput) {
      const id = "sl-" + Math.random().toString(36).slice(2, 8);
      const f = document.createElement("div"); f.className = "field";
      f.innerHTML = `<label for="${id}"></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><span class="readout"></span>`;
      f.querySelector("label").textContent = label;
      const out = f.querySelector(".readout"), inp = f.querySelector("input");
      out.textContent = fmt(value);
      inp.addEventListener("input", () => { onInput(+inp.value); out.textContent = fmt(+inp.value); });
      return f;
    },
    meter(id) { const m = document.createElement("div"); m.className = "meter"; m.id = id; return m; },
    note(text) { const p = document.createElement("p"); p.className = "hint"; p.textContent = text; return p; },
  };
  ctx.ui = ui;

  // ---------- Systems panel, switches, current path ----------------------------------------------
  const sysBtns = {};
  for (const [id, s] of Object.entries(SYS)) {
    const b = document.createElement("button");
    b.className = "sys"; b.style.setProperty("--c", COLORS[id]); b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<i></i>${esc(s.def.label)}`;
    b.addEventListener("click", () => setSystem(state.system === id ? null : id, true));
    $("systems").append(b); sysBtns[id] = b;
  }
  function setSystem(id, userAction = false) {
    state.system = id;
    for (const [k, s] of Object.entries(SYS)) { s.group.visible = k === id; sysBtns[k].setAttribute("aria-pressed", k === id); }
    if (id && userAction && state.look === "solid") setLook("ghost");
    M.onSystem?.(id, ctx);
    renderSwitches(); applyLook(); buildSchematic(id); figTab = null; if (id) renderFigTabs(id);
    $("trace-wrap").hidden = !id; traceSig = null;
  }
  function renderSwitches() {
    const el = $("switches"); el.replaceChildren();
    const id = state.system;
    if (!id) { el.append(ui.note(M.pickSystemHint || "Pick a system to see it run through the machine and to get its switches.")); return; }
    const add = (...nodes) => el.append(...nodes);
    M.switches?.[id]?.(ui, add, ctx);
    if (SYS[id].def.note) add(ui.note(SYS[id].def.note));
  }
  Object.assign(ctx, { setSystem, renderSwitches });

  // Current path: the chain of active edges from where the flow starts, in order (like the Enigma's
  // step-by-step current list). A machine may supply its own trace for a system.
  let traceSig = null;
  function computeTrace(s) {
    if (M.trace?.[s.id]) return M.trace[s.id](s, ctx);
    const out = new Map(), indeg = new Map();
    for (const e of s.edges) {
      if (e.on < 0.5) continue;
      const [a, b] = e.dir < 0 ? [e.def.to, e.def.from] : [e.def.from, e.def.to];
      (out.get(a) || out.set(a, []).get(a)).push(b);
      indeg.set(b, (indeg.get(b) || 0) + 1);
    }
    // Walk from the start that reaches the most (the true source) first, then the smaller side chains.
    const reach = a => { const seen = new Set([a]), q = [a]; while (q.length) for (const b of out.get(q.shift()) || []) if (!seen.has(b)) { seen.add(b); q.push(b); } return seen.size; };
    let starts = [...out.keys()].filter(a => !indeg.get(a));
    if (!starts.length) starts = [...out.keys()];
    starts.sort((a, b) => reach(b) - reach(a));
    const seen = new Set(), steps = [];
    for (const st of starts) {
      const queue = [st];
      while (queue.length) {
        const id = queue.shift(); if (seen.has(id)) continue; seen.add(id);
        const n = s.nodes.get(id); if (n) steps.push({ id, label: n.def.short || n.def.label, value: n.value });
        for (const b of out.get(id) || []) queue.push(b);
      }
    }
    return steps;
  }
  function renderTrace() {
    const s = state.system && SYS[state.system]; if (!s) return;
    const steps = computeTrace(s);
    const sig = steps.map(x => x.id + ":" + x.value).join("|");
    if (sig === traceSig) return; traceSig = sig;
    $("trace").style.setProperty("--c", COLORS[s.id]);
    $("trace-count").textContent = steps.length ? `${steps.length} steps` : "";
    $("trace").replaceChildren(...(steps.length ? steps.map(st => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${esc(st.label)}</span><span class="v">${esc(st.value || "")}</span>`;
      li.addEventListener("click", () => { const n = s.nodes.get(st.id); if (n) { selectNode(n); flashNode(n); } });
      return li;
    }) : [Object.assign(document.createElement("li"), { className: "off", textContent: M.noFlowText || "Nothing is flowing with these switch settings." })]));
  }
  function flashNode(n) { n.flash = 1; }

  // ---------- Live topology diagram -------------------------------------------------------------------
  let schem = null;
  function buildSchematic(id) {
    const svg = $("schematic"); svg.replaceChildren(); schem = null;
    $("schematic-panel").hidden = !id;
    if (!id) return;
    const s = SYS[id], kind = M.layouts?.[id] || "flow", W = kind === "bus" ? 372 : 320;
    svg.style.setProperty("--c", COLORS[id]);
    const lay = kind === "plan" ? layoutPlan(s, W, M.plan) : kind === "bus" ? layoutBus(s, W, s.def.bus) : layoutFlow(s, W);
    svg.setAttribute("viewBox", `0 0 ${W} ${Math.max(160, lay.H)}`);
    if (lay.bus) svgEl("line", { x1: lay.bus[0][0], y1: lay.bus[0][1], x2: lay.bus[1][0], y2: lay.bus[1][1], stroke: COLORS[id], "stroke-width": 5, "stroke-linecap": "round" }, svg);
    const edges = s.edges.map(e => ({ e, path: svgEl("polyline", { points: lay.route(e).map(p => p.join(",")).join(" "), class: `e ${e.def.kind || ""}` }, svg) }));
    const nodes = [...s.nodes.values()].map(n => {
      const [x, y] = lay.pos.get(n.def.id);
      const named = n.def.primary || n.def.named || n.def.kind === "load" || n.def.kind === "bus";
      const c = svgEl("circle", { cx: x, cy: y, r: n.def.primary ? 5 : 3.4, class: "n" + (n.def.primary ? " primary" : "") }, svg);
      svgEl("title", {}, c).textContent = n.def.label;
      c.addEventListener("click", () => selectNode(n));
      let tv = null;
      if (named) {
        const inline = kind !== "flow", source = kind === "bus" && s.def.bus.sources.includes(n.def.id), isMain = kind === "bus" && n.def.id === s.def.bus.main;
        const right = kind === "bus" ? true : x < W * 0.62, anchor = inline ? (right ? "start" : "end") : "middle", up = lay.above?.has(n.def.id);
        const tx = inline ? (right ? x + 9 : x - 9) : x, ty = inline ? y + 3.5 : up ? y - 20 : y + 16;
        const tl = svgEl("text", { x: tx, y: ty, "text-anchor": anchor }, svg); tl.textContent = n.def.short || n.def.label;
        tv = svgEl("text", { class: "v", x: inline && anchor === "start" ? tx + tl.getComputedTextLength() + 6 : tx, y: inline && anchor === "start" ? ty : ty + 12, "text-anchor": anchor }, svg);
        if (isMain) { tl.setAttribute("x", x - 8); tl.setAttribute("y", 14); tl.setAttribute("text-anchor", "end"); tv.setAttribute("x", x - 8); tv.setAttribute("y", 26); tv.setAttribute("text-anchor", "end"); }
        if (source) { tl.setAttribute("x", x - 8); tl.setAttribute("y", y - 10); tl.setAttribute("text-anchor", "start"); tv.setAttribute("x", x - 8); tv.setAttribute("y", y + 18); tv.setAttribute("text-anchor", "start"); }
      }
      return { n, tv };
    });
    schem = { id, edges, nodes };
  }

  // ---------- Official figures -------------------------------------------------------------------------
  const F = M.figures || null;
  const figView = new FigureView({ frame: $("fig-frame"), img: $("fig-img"), svg: $("fig-svg"), badges: $("fig-badges"), src: $("fig-src"),
    onHotspot: (key, h, f) => {
      const sys = SYS[state.system], ours = sys?.nodes.get(F?.alias?.[h.node] || h.node);
      if (ours) selectNode(ours);
      else showCard(h.printed_label || h.node, [["Figure", f.figure], ["Match", h.confidence]], `${f.caption}${f.url ? " · " + f.url : ""}`);
    } });
  let figTab = null;
  function renderFigTabs(id) {
    const keys = (F?.bySystem?.[id] || []).filter(k => figures?.figures?.[k]);
    if (!keys.includes(figTab) && figTab !== "live") figTab = keys[0] || "live";
    const tabs = [...keys.map(k => [k, F.tabLabel?.[k] || k]), ["live", "Live topology"]];
    $("fig-tabs").replaceChildren(...tabs.map(([k, label]) => {
      const b = document.createElement("button"); b.textContent = label; b.setAttribute("role", "tab"); b.setAttribute("aria-pressed", k === figTab);
      b.addEventListener("click", () => { figTab = k; renderFigTabs(id); }); return b;
    }));
    const live = figTab === "live";
    $("schem-kind").textContent = live ? (M.liveDiagramNote || "from the machine data") : (F?.kindLabel || "official figure · live");
    $("schematic").hidden = !live; $("fig-frame").hidden = live;
    if (live) { figView.build(null); $("fig-src").textContent = "Live topology from the machine data: same switches, drawn automatically."; }
    else figView.build(figTab, figures.figures[figTab], COLORS[id], { state: (k, n) => F.state(k, n, ctx), pathState: (k, p) => F.pathState(k, p, ctx), decorate: F.decorate ? (k, f, svg, mk) => F.decorate(k, f, svg, mk, ctx) : null, source: f => F.source(f) });
  }
  $("fig-expand").addEventListener("click", () => { const big = $("fig").classList.toggle("big"); $("fig-expand").setAttribute("aria-pressed", big); $("fig-expand").textContent = big ? "Close" : "Expand"; });
  if (loaded.figuresPromise) loaded.figuresPromise.then(j => { figures = j; if (state.system) renderFigTabs(state.system); }).catch(() => {});
  setInterval(() => {
    figView.update();
    if (schem && schem.id === state.system) {
      for (const { e, path } of schem.edges) { path.classList.toggle("on", e.on > 0.5); path.classList.toggle("rev", e.dir < 0); }
      for (const { n, tv } of schem.nodes) if (tv) tv.textContent = n.value || "";
    }
    renderTrace();
  }, 150);

  // ---------- Parts tree, card, selection --------------------------------------------------------------
  function renderTree() {
    const groups = {};
    for (const p of PARTS) (groups[p.group] ||= []).push(p);
    const order = [...Object.keys(GROUPS).filter(g => groups[g]), ...Object.keys(groups).filter(g => !(g in GROUPS))];
    $("tree").replaceChildren(...order.map(g => {
      const d = document.createElement("details");
      d.innerHTML = `<summary>${esc(GROUPS[g] || g)}<span>${groups[g].length}</span></summary>`;
      for (const p of groups[g].sort((a, b) => a.label.localeCompare(b.label))) {
        const r = document.createElement("div");
        r.className = "part" + (p === selected ? " sel" : "") + (p.hidden ? " hid" : "");
        r.innerHTML = `<span>${esc(p.label)}</span><button class="eye">${p.hidden ? "Show" : "Hide"}</button>`;
        r.addEventListener("click", e => { if (e.target.closest(".eye")) { p.hidden = !p.hidden; applyLook(); renderTree(); } else select(p, true); });
        d.append(r);
      }
      if (selected && selected.group === g) d.open = true;
      return d;
    }));
  }
  $("show-all").addEventListener("click", () => { PARTS.forEach(p => (p.hidden = false)); applyLook(); renderTree(); });
  const fmtL = v => (SIZE > 3 ? `${v.toFixed(2)} m` : `${(v * 1000).toFixed(0)} mm`);
  function showCard(title, facts, src) {
    $("card-title").textContent = title;
    $("card-facts").replaceChildren(...facts.flatMap(([k, v, illus]) => {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v; if (illus) dd.className = "illus";
      return [dt, dd];
    }));
    $("card-src").textContent = src || "";
  }
  function select(p, frame = false, add = false) {
    if (add && p) { if (multi.has(p) && multi.size > 1) { multi.delete(p); p = selected === p ? [...multi].pop() : selected; } else { if (selected) multi.add(selected); multi.add(p); } }
    else multi.clear();
    selected = p;
    applyLook(); renderTree();
    if (!p) { showCard("Nothing selected", [], ""); renderIsoBar(); renderInspector(null, []); return; }
    const facts = [["System", GROUPS[p.group] || p.group], ["Size", `${fmtL(p.size.x)} × ${fmtL(p.size.y)} × ${fmtL(p.size.z)}`]];
    for (const f of p.facts || []) facts.push([f.label, f.value, f.source === "illustrative"]);
    if (p.note) facts.push(["Note", p.note, true]);
    const extra = M.cardExtra?.(p, ctx) || {};
    facts.push(...(extra.facts || []));
    const srcs = [...new Set([p.source, ...(p.facts || []).map(f => f.source), extra.source].filter(s => s && s !== "illustrative"))];
    showCard(p.label, facts, extra.sourceLine || (srcs.length ? srcs.join(" · ") : `Model object "${p.name}"`));
    renderIsoBar(); renderInspector(p, [facts[0], ...(extra.facts || []), ...facts.slice(1, facts.length - (extra.facts || []).length)]);
    if (frame) frameBox(new THREE.Box3().setFromObject(p.root));
  }
  function selectNode(n) {
    const d = n.def;
    const facts = (d.facts || []).map(f => [f.label, String(f.value), f.source === "illustrative"]);
    if (n.value) facts.unshift(["Now", n.value]);
    facts.push(["Position", d.source === "illustrative" ? "illustrative" : "sourced", d.source === "illustrative"]);
    showCard(d.label, facts, d.source && d.source !== "illustrative" ? `source: ${d.source}` : "");
  }
  Object.assign(ctx, { select, selectNode, showCard });

  // ---------- Isolate ------------------------------------------------------------------------------------
  const groupOrder = () => [...Object.keys(GROUPS)];
  const ORDER = () => PARTS.filter(p => !p.hidden).sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : groupOrder().indexOf(a.group) - groupOrder().indexOf(b.group)));
  function renderIsoBar() {
    $("iso-bar").hidden = !selected; $("iso-hint").hidden = !selected;
    const iso = state.isolate;
    $("iso-exit").hidden = !iso;
    $("iso-part").setAttribute("aria-pressed", iso?.kind === "part");
    $("iso-group").setAttribute("aria-pressed", iso?.kind === "group");
    $("iso-group").textContent = selected ? `Isolate ${GROUPS[selected.group] || selected.group}` : "Isolate group";
    $("iso-chip").hidden = !iso;
    if (iso) $("iso-chip").textContent = `${iso.kind === "part" ? iso.part.label : iso.kind === "set" ? `${iso.parts.size} parts` : GROUPS[iso.group] || iso.group}  ✕`;
    if ($("only").value !== (iso?.kind === "group" ? iso.group : "")) $("only").value = iso?.kind === "group" ? iso.group : "";
    $("ins-iso").textContent = iso?.kind === "part" || iso?.kind === "set" ? "Show everything" : multi.size > 1 ? `Isolate ${multi.size} parts` : "Isolate";
    $("ins-isogroup").textContent = iso?.kind === "group" ? "Show everything" : `Isolate ${selected ? GROUPS[selected.group] || selected.group : "group"}`;
  }
  // On-stage inspector: the selected part, its first facts and the isolate / hide / step actions.
  function renderInspector(p, facts) {
    $("inspector").hidden = !p;
    if (!p) return;
    $("ins-title").textContent = multi.size > 1 ? `${multi.size} parts selected` : p.label;
    $("ins-group").textContent = multi.size > 1 ? [...new Set([...multi].map(q => GROUPS[q.group] || q.group))].join(" · ") : GROUPS[p.group] || p.group;
    $("ins-facts").replaceChildren(...(multi.size > 1 ? [...multi].slice(0, 6).map(q => [q.label, ""]) : facts.slice(1, 5)).flatMap(([k, v]) => {
      const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; return [dt, dd]; }));
  }
  function isolate(kind, p = selected) {
    if (!p) return;
    $("hover-tip").hidden = true;
    leaveTour();
    state.isolate = kind === "part" ? (multi.size > 1 ? { kind: "set", parts: new Set(multi) } : { kind, part: p }) : kind === "only" ? { kind: "group", group: p } : { kind, group: p.group };
    if (state.system) setSystem(null);
    M.onIsolate?.(ctx);
    applyLook(); applyExplode(); renderIsoBar();
    const b = new THREE.Box3();
    for (const q of PARTS) if (inIsolation(q)) b.expandByObject(q.root);
    frameBox(b);
  }
  function exitIsolate() { if (!state.isolate) return; state.isolate = null; applyLook(); applyExplode(); renderIsoBar(); tweenCamera(HOME.pos, HOME.target); }
  function stepPart(dir) {
    const iso = state.isolate;
    const pool = iso?.kind === "group" ? ORDER().filter(p => p.group === iso.group) : iso?.kind === "set" ? ORDER().filter(p => iso.parts.has(p)) : ORDER();
    if (!pool.length) return;
    const i = Math.max(0, pool.indexOf(selected));
    const next = pool[(i + dir + pool.length) % pool.length];
    if (iso?.kind === "part") { select(next); isolate("part", next); } else select(next, true);
  }
  $("iso-part").addEventListener("click", () => (state.isolate?.kind === "part" ? exitIsolate() : isolate("part")));
  $("iso-group").addEventListener("click", () => (state.isolate?.kind === "group" ? exitIsolate() : isolate("group")));
  $("iso-prev").addEventListener("click", () => stepPart(-1));
  $("iso-next").addEventListener("click", () => stepPart(1));
  $("iso-exit").addEventListener("click", exitIsolate);
  $("iso-chip").addEventListener("click", exitIsolate);
  $("ins-iso").addEventListener("click", () => (state.isolate && state.isolate.kind !== "group" ? exitIsolate() : isolate("part")));
  $("ins-isogroup").addEventListener("click", () => (state.isolate?.kind === "group" ? exitIsolate() : isolate("group")));
  $("ins-hide").addEventListener("click", () => { const list = multi.size > 1 ? [...multi] : [selected]; list.forEach(q => q && (q.hidden = true)); select(null); applyLook(); renderTree(); });
  $("ins-prev").addEventListener("click", () => stepPart(-1));
  $("ins-next").addEventListener("click", () => stepPart(1));
  $("ins-close").addEventListener("click", () => select(null));
  // "Show only" a group, from the stage.
  for (const g of [...Object.keys(GROUPS), ...new Set(PARTS.map(p => p.group))].filter((g, i, a) => a.indexOf(g) === i && PARTS.some(p => p.group === g))) {
    const o = document.createElement("option"); o.value = g; o.textContent = `Only: ${GROUPS[g] || g} (${PARTS.filter(p => p.group === g).length})`; $("only").append(o);
  }
  $("only").addEventListener("change", e => { const g = e.target.value; if (!g) exitIsolate(); else { select(null); isolate("only", g); } });
  // Find a part by name, label or group.
  const findList = $("find-list");
  let findHits = [], findIdx = 0;
  function runFind() {
    const q = $("find").value.trim().toLowerCase();
    if (!q) { findList.hidden = true; return; }
    const terms = q.split(/\s+/);
    findHits = PARTS.filter(p => { const t = `${p.label} ${p.name} ${GROUPS[p.group] || p.group}`.toLowerCase(); return terms.every(w => t.includes(w)); }).slice(0, 40);
    findIdx = 0;
    findList.replaceChildren(...(findHits.length ? findHits.map((p, i) => {
      const li = document.createElement("li"); li.setAttribute("role", "option"); li.dataset.i = i;
      li.innerHTML = `<span>${esc(p.label)}</span><small>${esc(GROUPS[p.group] || p.group)}</small>`;
      li.addEventListener("mousedown", ev => { ev.preventDefault(); chooseFind(i, ev.shiftKey); });
      return li;
    }) : [Object.assign(document.createElement("li"), { className: "none", textContent: "No part matches" })]));
    markFind(); findList.hidden = false;
  }
  function markFind() { [...findList.children].forEach((li, i) => li.setAttribute("aria-selected", i === findIdx)); }
  function chooseFind(i, iso) { const p = findHits[i]; if (!p) return; findList.hidden = true; $("find").blur(); if (state.isolate) { state.isolate = null; applyLook(); } select(p, true); if (iso) isolate("part", p); }
  $("find").addEventListener("input", runFind);
  $("find").addEventListener("focus", runFind);
  $("find").addEventListener("blur", () => setTimeout(() => (findList.hidden = true), 120));
  $("find").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { findIdx = Math.min(findHits.length - 1, findIdx + 1); markFind(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { findIdx = Math.max(0, findIdx - 1); markFind(); e.preventDefault(); }
    else if (e.key === "Enter") { chooseFind(findIdx, e.shiftKey); e.preventDefault(); }
    else if (e.key === "Escape") { $("find").value = ""; findList.hidden = true; $("find").blur(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest("input,select,textarea")) return;
    if (e.key === "Escape") { if (!$("export-menu").hidden) $("ex-close").click(); else if ($("fig").classList.contains("big")) $("fig-expand").click(); else if (state.isolate) exitIsolate(); else select(null); }
    else if (e.key === "/" ) { $("find").focus(); e.preventDefault(); }
    else if ((e.key === "h" || e.key === "H") && selected) $("ins-hide").click();
    else if ((e.key === "i" || e.key === "I") && selected) isolate("part");
    else if ((e.key === "g" || e.key === "G") && selected) isolate("group");
    else if (e.key === "ArrowRight" && selected && !e.target.closest("button")) { stepPart(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" && selected && !e.target.closest("button")) { stepPart(-1); e.preventDefault(); }
    else M.onKey?.(e, ctx);
  });
  Object.assign(ctx, { isolate, exitIsolate, stepPart, inIsolation });

  // ---------- Picking ------------------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  ray.firstHitOnly = true;
  // Picking uses bounding-volume trees (three-mesh-bvh) when the page maps it; plain raycasting otherwise.
  import("three-mesh-bvh").then(({ computeBoundsTree, acceleratedRaycast }) => {
    THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    for (const p of PARTS) for (const m of p.meshes) { const g = m.geometry; if (!m.isInstancedMesh && g?.index !== undefined && g.attributes.position.count > 300 && !g.boundsTree) try { g.computeBoundsTree(); } catch (_) {} }
  }).catch(() => {});
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (state.system && M.overlay3D !== false) {
      const hit = ray.intersectObjects(SYS[state.system].group.children.filter(o => o.userData.node), false)[0];
      if (hit) return { node: hit.object.userData.node };
    }
    const hit = ray.intersectObjects(PARTS.filter(p => !p.hidden && p.root.visible).flatMap(p => p.meshes), false)[0];
    if (hit && M.onPick?.(hit, ctx)) return { handled: true };
    return hit ? { part: hit.object.userData.part, hit } : null;
  }
  let downAt = null;
  canvas.addEventListener("pointerdown", e => (downAt = e.button === 0 ? [e.clientX, e.clientY] : null));   // only left clicks select
  canvas.addEventListener("pointerup", e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const h = pick(e);
    if (h?.handled) return;
    if (h?.node) selectNode(SYS[state.system].nodes.get(h.node.def.id));
    else select(h?.part || null, false, e.shiftKey && !!h?.part);
  });
  // Hover: name the part under the cursor.
  const tip = $("hover-tip"); let hoverRaf = 0, lastMove = null;
  canvas.addEventListener("pointermove", e => {
    lastMove = e; if (hoverRaf) return;
    hoverRaf = setTimeout(() => {
      hoverRaf = 0; const ev = lastMove;
      if (ev.buttons) { tip.hidden = true; return; }
      const h = pick(ev); canvas.style.cursor = h ? "pointer" : "grab";
      const label = h?.part ? h.part.label : h?.node ? h.node.def.label : "";
      tip.hidden = !label;
      if (label) { const r = $("stage").getBoundingClientRect(); tip.textContent = label; tip.style.transform = `translate(${Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8)}px, ${ev.clientY - r.top + 16}px)`; }
    }, 90);   // hover picking at about 11 Hz: it traces a ray through every visible part
  });
  canvas.addEventListener("pointerleave", () => (tip.hidden = true));
  canvas.addEventListener("dblclick", e => { const h = pick(e); if (h?.part) { select(h.part); isolate("part", h.part); } });

  // ---------- Camera --------------------------------------------------------------------------------------
  const HOME = M.home ? { pos: new THREE.Vector3(...M.home.pos), target: new THREE.Vector3(...M.home.target) }
    : { pos: center.clone().add(new THREE.Vector3(-0.62, 0.32, 0.72).normalize().multiplyScalar(SIZE * 0.95)), target: center.clone() };
  let camTween = null;
  function tweenCamera(pos, target, dur = 1.1) { camTween = { from: camera.position.clone(), to: pos.clone(), tf: controls.target.clone(), tt: target.clone(), t0: performance.now(), dur: dur * 1000 }; }
  function frameBox(b) {
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(controls.target).normalize();
    tweenCamera(c.clone().add(dir.multiplyScalar(Math.max(SIZE * 0.18, size * 1.8))), c);
  }
  const sph = ([az, el, d], target) => {
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    return new THREE.Vector3(target[0] + d * Math.cos(e) * Math.cos(a), target[1] + d * Math.sin(e), target[2] + d * Math.cos(e) * Math.sin(a));
  };
  $("reset-view").addEventListener("click", () => tweenCamera(HOME.pos, HOME.target));
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target);
  Object.assign(ctx, { tweenCamera, frameBox, sph, HOME });

  // ---------- Lessons ("show me on the machine") ------------------------------------------------------
  const LESSONS = M.lessons || [];
  let lessonIdx = -1;
  function patchState(patch) { for (const [k, v] of Object.entries(patch || {})) { if (v && typeof v === "object" && !Array.isArray(v) && state[k] && typeof state[k] === "object") Object.assign(state[k], v); else state[k] = v; } }
  function showLesson(i) {
    lessonIdx = i;
    [...$("lessons").children].forEach((b, k) => b.setAttribute("aria-pressed", k === i));
    const L = LESSONS[i]; if (!L) return;
    $("lesson-body").hidden = false;
    $("lesson-title").textContent = L.title;
    $("lesson-text").replaceChildren(...L.text.split(/\n\n+/).map(t => Object.assign(document.createElement("p"), { textContent: t })));
    $("lesson-next").hidden = i >= LESSONS.length - 1;
  }
  function applyShow(show) {
    leaveTour();
    if (state.isolate) { state.isolate = null; renderIsoBar(); }
    if ("look" in show) setLook(show.look);
    if ("explode" in show) { state.explode = show.explode; applyExplode(); }
    patchState(show.state);
    if ("system" in show && state.system !== show.system) setSystem(show.system);
    else renderSwitches();
    const p = show.select ? byName.get(show.select) : null;
    if (p) select(p); else if (selected) select(null);
    if (show.isolate && p) isolate(show.isolate, p);
    else { applyLook(); if (show.cam) tweenCamera(sph(show.cam, show.target), new THREE.Vector3(...show.target), 1.4); else if (p) frameBox(new THREE.Box3().setFromObject(p.root)); }
  }
  if (LESSONS.length) {
    $("learn-panel").hidden = false;
    $("lessons").replaceChildren(...LESSONS.map((L, i) => {
      const b = document.createElement("button"); b.className = "lesson-btn";
      b.innerHTML = `<span class="num">${i + 1}</span><span>${esc(L.title)}</span>`;
      b.addEventListener("click", () => showLesson(i)); return b;
    }));
    $("lesson-show").addEventListener("click", () => LESSONS[lessonIdx] && applyShow(LESSONS[lessonIdx].show));
    $("lesson-next").addEventListener("click", () => showLesson(Math.min(LESSONS.length - 1, lessonIdx + 1)));
  }
  Object.assign(ctx, { applyShow, patchState });

  // ---------- Story mode (Enigma-style): intro, pinned notes, chapters drawer ---------------------------------
  const STORY = M.story;
  let story = null;
  if (STORY) {
    story = { ci: 0, si: 0, widget: null, anchor: null };
    const chapters = STORY.chapters;
    const nav = $("story-nav");
    let num = 0;
    nav.replaceChildren(...chapters.flatMap((ch, i) => {
      const out = [];
      if (ch.group) { const g = document.createElement("h3"); g.className = "drawer-group"; g.textContent = ch.group; out.push(g); }
      const numbered = !ch.intro && !ch.unnumbered && (ch.group || chapters.slice(0, i).some(c => c.group));
      const b = document.createElement("button"); b.className = "story-chapter"; b.dataset.i = i;
      b.innerHTML = `${icon(ch.icon)}${numbered ? `<span class="num">${String(++num).padStart(2, "0")}</span>` : ""}<span class="t">${esc(ch.title)}</span>`;
      b.addEventListener("click", () => { closeDrawer(); storyGo(i, 0); });
      out.push(b); return out;
    }));
    const openDrawer = () => { $("story-drawer").hidden = false; $("drawer-scrim").hidden = false; $("story-menu").setAttribute("aria-expanded", true); nav.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest" }); };
    function closeDrawer() { $("story-drawer").hidden = true; $("drawer-scrim").hidden = true; $("story-menu").setAttribute("aria-expanded", false); }
    $("story-menu").addEventListener("click", () => ($("story-drawer").hidden ? openDrawer() : closeDrawer()));
    $("drawer-close").addEventListener("click", closeDrawer);
    $("drawer-scrim").addEventListener("click", closeDrawer);
    const para = t => String(t || "").split(/\n\n+/).map(x => Object.assign(document.createElement("p"), { textContent: x }));
    function anchorOf(st) {
      const a = st.anchor ?? st.show?.select;
      if (Array.isArray(a)) return { pos: new THREE.Vector3(...a) };
      const p = a && byName.get(a);
      return p ? { part: p } : null;
    }
    function storyGo(ci, si) {
      ci = Math.max(0, Math.min(chapters.length - 1, ci));
      const ch = chapters[ci]; si = Math.max(0, Math.min(ch.steps.length - 1, si));
      story.ci = ci; story.si = si;
      const st = ch.steps[si], intro = !!ch.intro && si === 0;
      document.body.classList.toggle("in-intro", intro);
      $("story-chapter-title").textContent = ch.title;
      $("story-prev").hidden = ci === 0 && si === 0;
      const last = ci === chapters.length - 1 && si === ch.steps.length - 1;
      $("story-next").hidden = last;
      story.widget?.destroy?.(); story.widget = null;
      if (st.show) applyShow(st.show);
      $("inspector").hidden = true;                 // the note explains the step; the part card returns on a click
      $("story-intro").hidden = !intro; $("story-note").hidden = intro;
      const w = $("story-widget"); w.replaceChildren();
      if (intro) {
        $("intro-title").textContent = st.title || ch.title;
        $("intro-body").replaceChildren(...para(st.text));
        $("intro-cta").textContent = st.cta || "See how it works";
        const gal = st.gallery || [];
        $("intro-gallery").hidden = !gal.length;
        $("intro-photos").replaceChildren(...gal.map((g, k) => { const d = document.createElement("div"); d.className = "intro-photo"; d.style.setProperty("--tilt", `${[-2.5, 1.5, -1][k % 3]}deg`); d.innerHTML = `<img src="${esc(g.file)}" alt="${esc(g.title || "")}" loading="lazy">`; return d; }));
        $("intro-caption").textContent = st.galleryCaption || gal[0]?.title || ""; $("intro-credit").textContent = st.galleryCredit || "";
        story.anchor = null;
      } else {
        $("story-step-count").textContent = ch.steps.length > 1 ? `${si + 1} of ${ch.steps.length}` : "";
        $("story-title").textContent = st.title || "";
        $("story-text").replaceChildren(...para(st.text));
        if (st.widget && M.widgets?.[st.widget]) story.widget = M.widgets[st.widget](w, ctx, st) || null;
        $("story-note").classList.toggle("wide", !!w.childElementCount);
        $("story-sources").textContent = st.sources ? `Sources: ${[].concat(st.sources).join(" · ")}` : "";
        $("story-hint").innerHTML = last ? "The end." : si < ch.steps.length - 1 ? "Press <kbd>Enter</kbd> to continue" : `Press <kbd>Enter</kbd> for <i>${esc(chapters[ci + 1].title)}</i>`;
        story.anchor = anchorOf(st);
        $("story-note").scrollTop = 0;
      }
      w.hidden = !w.childElementCount;
      const ph = $("story-photo"); ph.replaceChildren(); ph.hidden = intro || !st.photo;
      if (st.photo && !intro) {
        const img = Object.assign(document.createElement("img"), { src: st.photo.file, alt: st.photo.title || "", loading: "lazy" });
        const cap = document.createElement("figcaption"); cap.innerHTML = `<span>${esc(st.photo.title || "")}</span><small>${esc(st.photo.credit || "")}</small>`;
        ph.append(img, cap);
      }
      [...nav.querySelectorAll(".story-chapter")].forEach(b => { const i = +b.dataset.i; b.setAttribute("aria-current", i === ci ? "step" : "false"); b.classList.toggle("done", i < ci); });
      placeNote(true);
      wake?.();
      try { localStorage.setItem(`story:${M.id}`, JSON.stringify([ci, si])); } catch (_) {}
    }
    // Pin the note beside its part: project the anchor, put the note on the far side, draw the leader.
    const tmpA = new THREE.Vector3(), boxA = new THREE.Box3();
    function placeNote(force) {
      const note = $("story-note"), line = $("leader-line"), dot = $("leader-dot"), svg = $("story-leader");
      if (note.hidden) { svg.style.display = "none"; return; }
      const W = innerWidth, H = innerHeight, nw = note.offsetWidth, nh = note.offsetHeight, top = 100, pad = 20;
      let ax = null, ay = null;
      if (story.anchor) {
        if (story.anchor.part) { boxA.setFromObject(story.anchor.part.root); boxA.getCenter(tmpA); } else tmpA.copy(story.anchor.pos);
        tmpA.project(camera);
        if (tmpA.z < 1 && Math.abs(tmpA.x) < 1.1 && Math.abs(tmpA.y) < 1.1) { ax = (tmpA.x * 0.5 + 0.5) * W; ay = (-tmpA.y * 0.5 + 0.5) * H; }
      }
      let x, y;
      if (story.userPos && W >= 760) { x = Math.max(4, Math.min(W - nw - 4, story.userPos.x)); y = Math.max(4, Math.min(H - 40, story.userPos.y)); }
      else if (W < 760) { x = 12; y = H - nh - 12; ax = null; }
      else if (ax == null) { x = Math.round(W * 0.06); y = Math.max(top, Math.round(H * 0.5 - nh / 2)); }
      else {
        const left = ax > W * 0.5, gap = Math.min(220, W * 0.14);
        x = left ? ax - gap - nw : ax + gap; x = Math.max(pad, Math.min(W - nw - pad, x));
        y = Math.max(top, Math.min(H - nh - pad, ay - nh / 2));
      }
      note.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      if (ax == null) { svg.style.display = "none"; return; }
      svg.style.display = "";
      const ex = ax < x ? x : x + nw, ey = Math.max(y + 18, Math.min(y + nh - 18, ay));
      line.setAttribute("x1", ex); line.setAttribute("y1", ey); line.setAttribute("x2", ax); line.setAttribute("y2", ay);
      dot.setAttribute("cx", ax); dot.setAttribute("cy", ay);
    }
    story.placeNote = placeNote;
    makeDraggable($("story-note"), null, (x, y) => { story.userPos = { x, y }; placeNote(true); });
    $("story-note").querySelector(".note-head").addEventListener("dblclick", () => { story.userPos = null; placeNote(true); });
    makeDraggable($("story-photo"));
    makeDraggable($("inspector"), $("inspector").querySelector(".ins-head"));
    const next = () => { const ch = chapters[story.ci]; if (story.si < ch.steps.length - 1) storyGo(story.ci, story.si + 1); else if (story.ci < chapters.length - 1) storyGo(story.ci + 1, 0); };
    const prev = () => { if (story.si > 0) storyGo(story.ci, story.si - 1); else if (story.ci > 0) storyGo(story.ci - 1, chapters[story.ci - 1].steps.length - 1); };
    $("story-next").addEventListener("click", next);
    $("story-prev").addEventListener("click", prev);
    $("intro-go").addEventListener("click", next);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("story-drawer").hidden) { closeDrawer(); e.preventDefault(); return; }
      if (e.target.closest("input,select,textarea,button,a") || e.defaultPrevented) return;
      if (e.key === "Enter" || e.key === "PageDown") { next(); e.preventDefault(); }
      else if (e.key === "PageUp" || e.key === "Backspace") { prev(); e.preventDefault(); }
    });
    const toggleExplore = open => {
      const d = $("explore-drawer"); d.hidden = !open; $("explore-toggle").setAttribute("aria-pressed", open);
      document.body.classList.toggle("exploring", open); closeDrawer(); placeNote(true);
    };
    $("explore-toggle").addEventListener("click", () => toggleExplore($("explore-drawer").hidden));
    $("explore-close").addEventListener("click", () => toggleExplore(false));
    $("intro-explore").addEventListener("click", () => { storyGo(0, Math.min(1, chapters[0].steps.length - 1)); toggleExplore(true); });
    addEventListener("resize", () => placeNote(true));
    let start = [0, 0]; try { start = JSON.parse(localStorage.getItem(`story:${M.id}`)) || start; } catch (_) {}
    ctx.storyGo = storyGo; ctx.story = story;
    queueMicrotask(() => storyGo(start[0] || 0, start[1] || 0));
  }

  // ---------- Tour ---------------------------------------------------------------------------------------
  const TOUR = M.tour || [];
  let acc = 0; const starts = TOUR.map(b => { const s = acc; acc += b.dur; return s; }); const TOUR_END = acc;
  function applyTour(t, cam = camera) {
    if (!TOUR.length) return { title: "" };
    let i = TOUR.length - 1; while (i > 0 && t < starts[i]) i--;
    const b = TOUR[i], lt = t - starts[i], u = ease(lt / b.dur);
    if (state.look !== b.look) setLook(b.look);
    if (state.system !== b.system) setSystem(b.system);
    state.explode = Array.isArray(b.explode) ? b.explode[0] + (b.explode[1] - b.explode[0]) * ease((lt - 1) / (b.dur - 2.5)) : (b.explode || 0);
    applyExplode();
    patchState(M.tourReset); patchState(b.script ? b.script(lt) : null);
    const tgt = new THREE.Vector3(...b.target);
    let pos = sph(b.cam[0], b.target).lerp(sph(b.cam[1], b.target), u);
    if (i > 0 && lt < 1.2) {
      const pb = TOUR[i - 1], k = ease(lt / 1.2);
      pos = sph(pb.cam[1], pb.target).lerp(pos, k); tgt.copy(new THREE.Vector3(...pb.target).lerp(tgt, k));
    }
    cam.position.copy(pos); cam.lookAt(tgt);
    if (cam === camera) controls.target.copy(tgt);
    $("stage-beat").textContent = b.title;
    return { beat: i, title: b.title };
  }
  const tour = { t: 0, playing: false, active: false };
  TOUR.forEach((b, i) => {
    const btn = document.createElement("button"); btn.textContent = `${i + 1}. ${b.title.split(":")[0]}`;
    btn.addEventListener("click", () => { if (state.isolate) { state.isolate = null; applyLook(); renderIsoBar(); } tour.active = true; tour.t = starts[i] + 0.01; tour.playing = true; $("tour-play").textContent = "Pause tour"; });
    $("beats").append(btn);
  });
  $("tour-play").addEventListener("click", () => {
    if (state.isolate) { state.isolate = null; applyLook(); renderIsoBar(); }
    tour.playing = !tour.playing; tour.active = tour.active || tour.playing;
    $("tour-play").textContent = tour.playing ? "Pause tour" : "Play tour";
  });
  $("tour-scrub").addEventListener("input", e => { tour.active = true; tour.playing = false; $("tour-play").textContent = "Play tour"; tour.t = (+e.target.value / 1000) * TOUR_END; });
  function leaveTour() { if (tour.active) { tour.active = false; tour.playing = false; $("tour-play").textContent = "Play tour"; $("stage-beat").textContent = ""; } }
  for (const id of ["look-solid", "look-ghost", "explode", "systems", "switches", "tree", "reset-view", "card", "lessons"]) $(id).addEventListener("pointerdown", leaveTour);
  canvas.addEventListener("pointerdown", leaveTour);
  Object.assign(ctx, { applyTour, leaveTour, TOUR_END });

  // ---------- Per-frame update -----------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  function updateSystems(time, cam, w, h, drawTags) {
    M.update?.(time, ctx);
    story?.widget?.update?.(time);
    const s = state.system && SYS[state.system];
    const labels = [];
    for (const sys of Object.values(SYS)) for (const n of sys.nodes.values()) n.tag.hidden = true;
    if (!s) return labels;
    M.evaluate?.[s.id]?.(s, ctx);
    for (const e of s.edges) {
      if (e.builtDir !== e.dir || e.builtExplode !== state.explode) { rebuildEdges(s); for (const x of s.edges) { x.builtDir = x.dir; x.builtExplode = state.explode; } }
      const u = e.mat.uniforms; u.uTime.value = time; u.uOn.value += (e.on - u.uOn.value) * 0.15; u.uSpeed.value = e.speed;
    }
    for (const n of s.nodes.values()) {
      if (n.flash) { n.flash = Math.max(0, n.flash - 0.02); n.mesh.scale.setScalar(1 + 2.5 * n.flash); }
      tmp.copy(n.pos).applyMatrix4(world.matrixWorld).project(cam);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
      labels.push({ n, x, y, text: n.def.short || n.def.label, value: n.value, show: M.overlay3D !== false && visible && !!n.def.label && (n.def.primary || n.flash > 0) });
    }
    const k = w / 1100, lh = 24 * k, placed = [];
    for (const L of labels.filter(l => l.show).sort((a, b) => a.y - b.y)) {
      L.w = ((L.text.length + (L.value || "").length) * 8.4 + 44) * k; L.ly = L.y;
      for (let g = 0; g < 20; g++) { const hit = placed.find(o => L.x < o.x + o.w && o.x < L.x + L.w && Math.abs(L.ly - o.ly) < lh); if (!hit) break; L.ly = hit.ly + lh + 2 * k; }
      placed.push(L);
    }
    if (drawTags) for (const L of labels) {
      const tag = L.n.tag; tag.hidden = !L.show;
      if (L.show) { tag.style.position = "absolute"; tag.style.left = "0"; tag.style.top = "0"; tag.style.transform = `translate(${L.x + 10}px, ${L.ly}px) translateY(-50%)`; tag.querySelector(".v").textContent = L.value || ""; }
    }
    M.afterEvaluate?.(s, ctx);
    return labels;
  }
  // Full device resolution, always.
  function resize() {
    const r = $("stage").getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const w = Math.round(r.width), h = Math.round(r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); wake(); }
    // Story mode: on the intro screen the machine sits right of the title (as on enigma.design); else centred.
    if (M.story && w > 860) {
      const intro = document.body.classList.contains("in-intro"), exploring = !$("explore-drawer").hidden;
      const shift = intro ? -Math.round(w * 0.2) : exploring ? Math.round(Math.min(480, w * 0.4) / 2) : 0;
      if (shift !== (camera.view?.enabled ? camera.view.offsetX : 0)) { if (shift) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset(); camera.updateProjectionMatrix(); wake(); }
    } else if (camera.view?.enabled) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
    return [w, h];
  }
  // Draw only when something changes: input, camera motion, animation (M.animating), or a resize.
  let awakeUntil = 0;
  const wake = (ms = 1500) => { awakeUntil = Math.max(awakeUntil, performance.now() + ms); };
  for (const ev of ["pointerdown", "pointermove", "wheel", "keydown", "input", "change", "click"]) document.addEventListener(ev, () => wake(), { passive: true, capture: true });
  controls.addEventListener("change", () => wake());
  ctx.wake = wake;
  let last = performance.now(), clock = 0, exporting = false;
  function frame(now) {
    requestAnimationFrame(frame);
    if (exporting) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    const live = now < awakeUntil || camTween || tour.active || (M.animating ? M.animating(ctx) : true);
    if (!live) { controls.update(); return; }
    const [w, h] = resize();
    if (tour.active) {
      if (tour.playing) { tour.t += dt; if (tour.t >= TOUR_END) { tour.t = TOUR_END - 0.001; tour.playing = false; $("tour-play").textContent = "Play tour"; } }
      applyTour(tour.t);
      $("tour-scrub").value = Math.round((tour.t / TOUR_END) * 1000);
    } else if (camTween) {
      const k = ease((now - camTween.t0) / camTween.dur);
      camera.position.lerpVectors(camTween.from, camTween.to, k); controls.target.lerpVectors(camTween.tf, camTween.tt, k);
      if (k >= 1) camTween = null;
      controls.update();
    } else controls.update();
    $("tour-time").textContent = `${tour.t.toFixed(1)} / ${TOUR_END.toFixed(0)} s`;
    updateSystems(clock, camera, w, h, true);
    story?.placeNote?.();
    if (PAPER) { const c = scene.background, dark = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) < 0.45; if (dark !== document.body.classList.contains("dark-sky")) document.body.classList.toggle("dark-sky", dark); }
    renderer.render(scene, camera);
  }

  // ---------- Export -------------------------------------------------------------------------------------
  async function pickCodec(W, H) {
    for (const hw of ["prefer-hardware", "no-preference"]) for (const id of ["avc1.640033", "avc1.64002A", "avc1.4D002A"]) {
      const cfg = { codec: id, width: W, height: H, bitrate: 16e6, framerate: 60, hardwareAcceleration: hw, avc: { format: "avc" } };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (_) {}
    }
    return null;
  }
  function drawTags(c2, labels) {
    const col = COLORS[state.system] || "#e6ebf2";
    for (const L of labels) {
      if (!L.show) continue;
      const t1 = L.text.toUpperCase(), t2 = L.value || "";
      c2.font = `500 22px "IBM Plex Sans", sans-serif`; const w1 = c2.measureText(t1).width;
      c2.font = `400 20px "IBM Plex Mono", monospace`; const w2 = t2 ? c2.measureText(t2).width + 14 : 0;
      const x = L.x + 16, y = (L.ly ?? L.y) - 18, w = w1 + w2 + 22, h = 36;
      c2.fillStyle = "rgba(7,9,12,0.8)"; c2.strokeStyle = col; c2.lineWidth = 1.5;
      c2.beginPath(); c2.roundRect(x, y, w, h, 4); c2.fill(); c2.stroke();
      c2.fillStyle = "#e6ebf2"; c2.font = `500 22px "IBM Plex Sans", sans-serif`; c2.fillText(t1, x + 11, y + 25);
      if (t2) { c2.fillStyle = "#8a95a5"; c2.font = `400 20px "IBM Plex Mono", monospace`; c2.fillText(t2, x + 11 + w1 + 14, y + 25); }
    }
  }
  function drawTitle(c2, title) {
    c2.fillStyle = "#8a95a5"; c2.font = `500 22px "IBM Plex Sans", sans-serif`;
    if ("letterSpacing" in c2) c2.letterSpacing = "4px";
    c2.fillText((M.eyebrow || M.name).toUpperCase(), 64, 76);
    if ("letterSpacing" in c2) c2.letterSpacing = "0px";
    c2.fillStyle = "#e6ebf2"; c2.font = `italic 400 54px "Instrument Serif", Georgia, serif`; c2.fillText(title, 62, 134);
  }
  let lastVideo = null;
  $("export").addEventListener("click", async () => {
    const status = $("export-status"), prog = $("export-progress");
    if (!("VideoEncoder" in window) || typeof Mp4Muxer === "undefined") { status.textContent = "This browser has no WebCodecs video encoder. Use a current Chrome or Edge to export."; return; }
    const W = 1920, H = 1080, fps = 60, cfg = await pickCodec(W, H);
    if (!cfg) { status.textContent = "No 1080p60 encoder is available in this browser."; return; }
    exporting = true; $("export").disabled = true; prog.hidden = false;
    if (state.isolate) { state.isolate = null; applyLook(); renderIsoBar(); }
    const saved = JSON.parse(JSON.stringify({ ...state, isolate: null }));
    M.beforeExport?.(ctx);
    const glc = document.createElement("canvas"); glc.width = W; glc.height = H;
    const r2 = GPU ? new THREE.WebGPURenderer({ canvas: glc, antialias: true }) : new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
    if (GPU) await r2.init();
    r2.toneMapping = renderer.toneMapping; r2.outputColorSpace = renderer.outputColorSpace; r2.setPixelRatio(1); r2.setSize(W, H, false);
    const cam2 = new THREE.PerspectiveCamera(camera.fov, W / H, camera.near, camera.far);
    const out = document.createElement("canvas"); out.width = W; out.height = H; const c2 = out.getContext("2d");
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, video: { codec: "avc", width: W, height: H, frameRate: fps }, fastStart: "in-memory" });
    let err = null;
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => (err = e) });
    enc.configure(cfg);
    const [r0, r1] = window.__exportRange || [0, TOUR_END];          // window.__exportRange: render part of the tour (testing)
    const total = Math.round((r1 - r0) * fps), ts = performance.now();
    try {
      for (let i = 0; i < total; i++) {
        const t = r0 + i / fps;
        const { title } = applyTour(t, cam2);
        const labels = updateSystems(t, cam2, W, H, false);
        if (GPU) await r2.renderAsync(scene, cam2); else r2.render(scene, cam2);
        c2.drawImage(glc, 0, 0); drawTitle(c2, title); drawTags(c2, labels);
        const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % 120 === 0 }); vf.close();
        if (err) throw err;
        if (enc.encodeQueueSize > 6) await new Promise(r => enc.addEventListener("dequeue", r, { once: true }));
        if (i % 10 === 0) { prog.value = i / total; status.textContent = `Rendering frame ${i + 1} of ${total}`; await new Promise(r => setTimeout(r)); }
      }
      await enc.flush(); muxer.finalize();
      const secs = (performance.now() - ts) / 1000, blob = new Blob([target.buffer], { type: "video/mp4" });
      lastVideo = { blob, name: `${M.id}-tour.mp4` };
      $("export-video").src = URL.createObjectURL(blob); $("export-video").hidden = false; $("export-save").hidden = false;
      status.textContent = `${total} frames (${(total / fps).toFixed(0)} s, 1920×1080, 60 fps) in ${secs.toFixed(0)} s · ${cfg.codec} · ${(blob.size / 1e6).toFixed(1)} MB`;
      window.__lastExport = { frames: total, seconds: secs, bytes: blob.size, codec: cfg.codec };
    } catch (e) {
      status.textContent = `Export stopped: ${e.message || e}`; window.__lastExport = { error: String(e) };
    } finally {
      try { enc.close(); } catch (_) {}
      r2.dispose(); exporting = false; $("export").disabled = false; prog.hidden = true;
      for (const [k, v] of Object.entries(saved)) if (!["look", "system", "explode", "isolate"].includes(k)) { if (v && typeof v === "object") Object.assign(state[k], v); else state[k] = v; }
      state.explode = saved.explode; applyExplode(); setLook(saved.look); setSystem(saved.system);
    }
  });
  let downloadsNs;
  // Save a file: through the viewer's downloads capability when the page runs as an artifact, else a link.
  async function saveFile(filename, blob) {
    if (downloadsNs === undefined) downloadsNs = window.claude?.use ? await window.claude.use("downloads") : null;
    if (downloadsNs) {
      try { await downloadsNs.save({ filename, data: blob }); return `Saved ${filename}.`; }
      catch (e) { return e?.code === "declined" ? "Save cancelled." : e?.code === "rate_limited" ? "A save prompt is already open." : `Could not save (${e?.code || e?.message || e}).`; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove();
    return `Saved ${filename}.`;
  }
  $("export-save").addEventListener("click", async () => { if (lastVideo) $("export-status").textContent = await saveFile(lastVideo.name, lastVideo.blob); });
  // Model export (glTF / OBJ / STL / parts list).
  const exOpt = { scope: "all", format: "glb", units: "m" };
  for (const [id, key] of [["ex-scope", "scope"], ["ex-format", "format"], ["ex-units", "units"]]) {
    $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; exOpt[key] = b.dataset.v; [...$(id).children].forEach(x => x.setAttribute("aria-pressed", x === b)); exHint(); });
  }
  function exParts() {
    if (exOpt.scope === "selected") return multi.size > 1 ? [...multi] : selected ? [selected] : [];
    if (exOpt.scope === "all") return PARTS.slice();
    return PARTS.filter(p => !p.hidden && p.root.visible);
  }
  function exHint() {
    const n = exParts().length;
    $("ex-status").textContent = `${n} part${n === 1 ? "" : "s"}`;
    $("ex-hint").textContent = exOpt.format === "glb" ? "glTF keeps part names, groups, facts and sources as extras; it opens in Blender, most CAD viewers and game engines. Parts export where they are drawn, so an exploded view exports exploded."
      : exOpt.format === "obj" ? "OBJ: one named object per part, for any 3D package. Repeated hardware is written out in full, so files can be large."
      : exOpt.format === "stl" ? "STL: one watertight-ish triangle soup for printing or CAD import; no names or colours."
      : "A spreadsheet of every part: name, group, size, position, facts and sources.";
    if (exOpt.format !== "csv") $("ex-hint").textContent += " Saved as a .zip with the model, a parts list and a readme.";
  }
  $("export-open").addEventListener("click", () => { const m = $("export-menu"); m.hidden = !m.hidden; $("export-open").setAttribute("aria-expanded", !m.hidden); if (!m.hidden) exHint(); });
  $("ex-close").addEventListener("click", () => { $("export-menu").hidden = true; $("export-open").setAttribute("aria-expanded", false); });
  $("ex-go").addEventListener("click", async () => {
    const parts = exParts();
    if (!parts.length) { $("ex-status").textContent = exOpt.scope === "selected" ? "Select a part first." : "Nothing visible to export."; return; }
    $("ex-go").disabled = true; $("ex-status").textContent = "Building…";
    try {
      model.updateMatrixWorld(true);
      const { blob, filename } = await exportMachine(THREE, { model, parts, format: exOpt.format, units: exOpt.units, groups: GROUPS, name: M.id || "machine",
        meta: { machine: M.name, frame: M.exportFrame || "machine frame", sources: M.exportSources || "" } });
      $("ex-status").textContent = `${(blob.size / 1e6).toFixed(1)} MB · saving…`;
      $("ex-status").textContent = await saveFile(filename, blob);
      window.__lastModelExport = { filename, bytes: blob.size, parts: parts.length };
    } catch (e) { $("ex-status").textContent = `Export failed: ${e.message || e}`; window.__lastModelExport = { error: String(e) }; }
    finally { $("ex-go").disabled = false; }
  });

  // ---------- Boot -----------------------------------------------------------------------------------------
  applyExplode(); applyLook(); renderTree(); renderSwitches(); select(null);
  M.ready?.(ctx);
  await document.fonts.ready;
  requestAnimationFrame(frame);
  window.__app = Object.assign(ctx, { saveFile, multi, state, PARTS, SYS, setSystem, setLook, select, isolate, exitIsolate, stepPart, applyTour, applyShow, TOUR_END, overlay, showLesson });
  return ctx;
}
