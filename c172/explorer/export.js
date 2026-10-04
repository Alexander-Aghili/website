// Export the machine (or the visible / isolated / selected parts) for other software: glTF binary
// (Blender, CAD viewers, game engines; part names, groups, facts and sources travel as glTF extras),
// OBJ, STL, and a parts list (CSV). Geometry is exported in the machine's own frame and pose (exploded
// parts export where they are drawn), scaled to the chosen units.

const UNITS = { m: 1, mm: 1000, in: 1 / 0.0254 };

async function exporters() {
  const [{ GLTFExporter }, { OBJExporter }, { STLExporter }, BGU] = await Promise.all([
    import("three/addons/exporters/GLTFExporter.js"), import("three/addons/exporters/OBJExporter.js"),
    import("three/addons/exporters/STLExporter.js"), import("three/addons/utils/BufferGeometryUtils.js")]);
  return { GLTFExporter, OBJExporter, STLExporter, BGU };
}

const safe = s => String(s).replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "part";
const plainFacts = facts => (facts || []).map(f => ({ label: f.label, value: String(f.value), ...(f.source ? { source: f.source } : {}) }));

// Clone the chosen parts into one tree in the model frame. `expand` turns instanced meshes into plain
// meshes (OBJ/STL have no instancing).
function buildTree(THREE, BGU, { model, parts, units, expand, groups }) {
  const root = new THREE.Group(); root.name = "machine";
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const byGroup = new Map();
  for (const p of parts) {
    const holder = new THREE.Group(); holder.name = safe(p.name);
    holder.userData = { name: p.name, label: p.label, group: p.group, groupLabel: groups[p.group] || p.group, source: p.source || "", note: p.note || "", facts: plainFacts(p.facts) };
    p.root.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    p.root.traverse(o => {
      if (!o.visible && o !== p.root) return;
      if (!o.isMesh && !o.isLine) return;
      if (!o.geometry?.attributes?.position) return;
      m.multiplyMatrices(toModel, o.matrixWorld);
      const mat = o.userData.orig || o.material;
      const material = Array.isArray(mat) ? mat.map(fixMat) : fixMat(mat);
      if (o.isInstancedMesh && expand) {
        const geos = [], im = new THREE.Matrix4();
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); const g = o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, im)); geos.push(stripAttrs(g)); }
        const merged = geos.length ? BGU.mergeGeometries(geos, false) : null;
        if (merged) { const mesh = new THREE.Mesh(merged, material); mesh.name = safe(o.name || p.name); holder.add(mesh); }
      } else if (o.isInstancedMesh) {
        const im2 = new THREE.InstancedMesh(o.geometry, material, o.count); im2.name = safe(o.name || p.name);
        const im = new THREE.Matrix4();
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); im2.setMatrixAt(i, im); }
        im2.matrixAutoUpdate = false; im2.matrix.copy(m); holder.add(im2);
      } else {
        const mesh = o.isLine ? new THREE.Line(o.geometry, material) : new THREE.Mesh(o.geometry, material);
        mesh.name = safe(o.name || p.name); mesh.matrixAutoUpdate = false; mesh.matrix.copy(m);
        if (expand) { const g = stripAttrs(o.geometry.clone()); g.applyMatrix4(m); mesh.geometry = g; mesh.matrix.identity(); }
        holder.add(mesh);
      }
    });
    if (!holder.children.length) continue;
    let g = byGroup.get(p.group);
    if (!g) { g = new THREE.Group(); g.name = safe(groups[p.group] || p.group); g.userData = { group: p.group }; byGroup.set(p.group, g); root.add(g); }
    g.add(holder);
  }
  root.scale.setScalar(UNITS[units] || 1);
  root.updateMatrixWorld(true);
  return root;

  function fixMat(mat) {
    if (!mat) return new THREE.MeshStandardMaterial();
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return new THREE.MeshStandardMaterial({ color: mat.uniforms?.uColor?.value || 0x999999 });
    return mat;
  }
  function stripAttrs(g) {   // keep attributes every geometry has, so merges succeed
    const g2 = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g2.attributes)) if (!["position", "normal", "uv"].includes(k)) g2.deleteAttribute(k);
    if (!g2.attributes.normal) g2.computeVertexNormals();
    if (!g2.attributes.uv) g2.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g2.attributes.position.count * 2), 2));
    return g2;
  }
}

// A ZIP archive with stored (uncompressed) entries: the hosted viewer saves .zip files but not .glb/.obj/.stl.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(files) {   // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(), chunks = [], central = []; let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dt, true); ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + size;
  }
  const csize = central.reduce((a, c) => a + c.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

function partsCSV(parts, groups) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["name", "label", "group", "size_x_m", "size_y_m", "size_z_m", "center_x_m", "center_y_m", "center_z_m", "facts", "source"]];
  for (const p of parts) rows.push([p.name, p.label, groups[p.group] || p.group, ...p.size.toArray().map(v => v.toFixed(4)), ...p.center.toArray().map(v => v.toFixed(4)),
    plainFacts(p.facts).map(f => `${f.label}: ${f.value}`).join("; "), p.source || ""]);
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

export async function exportMachine(THREE, { model, parts, format, units = "m", groups = {}, name = "machine", meta = {} }) {
  const inner = await exportRaw(THREE, { model, parts, format, units, groups, name, meta });
  if (format === "csv") return inner;
  // Model formats go out as a ZIP: the model, its parts list, and a readme (units, frame, sources).
  const enc = new TextEncoder();
  const readme = [`${meta.machine || name}: ${parts.length} parts exported ${new Date().toISOString()}`, "",
    `File: ${inner.filename} (${format.toUpperCase()})`, `Units: ${units}`, `Frame: ${meta.frame || "machine frame"}`,
    "Parts export where they were drawn (an exploded view exports exploded).", format === "glb" ? "glTF extras on each node carry the part's name, group, facts and source." : "",
    "", "Sources and licences:", meta.sources || ""].join("\n");
  const zip = makeZip([{ name: inner.filename, data: new Uint8Array(await inner.blob.arrayBuffer()) }, { name: `${name}-parts.csv`, data: enc.encode(partsCSV(parts, groups)) }, { name: "README.txt", data: enc.encode(readme) }]);
  return { blob: zip, filename: inner.filename.replace(/\.[a-z]+$/, "") + `-${format}.zip` };
}

async function exportRaw(THREE, { model, parts, format, units = "m", groups = {}, name = "machine", meta = {} }) {
  if (format === "csv") {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["name", "label", "group", "size_x_m", "size_y_m", "size_z_m", "center_x_m", "center_y_m", "center_z_m", "facts", "source"]];
    for (const p of parts) rows.push([p.name, p.label, groups[p.group] || p.group, ...p.size.toArray().map(v => v.toFixed(4)), ...p.center.toArray().map(v => v.toFixed(4)),
      plainFacts(p.facts).map(f => `${f.label}: ${f.value}`).join("; "), p.source || ""]);
    return { blob: new Blob([rows.map(r => r.map(esc).join(",")).join("\n")], { type: "text/csv" }), filename: `${name}-parts.csv` };
  }
  const { GLTFExporter, OBJExporter, STLExporter, BGU } = await exporters();
  const tree = buildTree(THREE, BGU, { model, parts, units, expand: format !== "glb", groups });
  tree.userData = { ...meta, units, frame: meta.frame || "machine frame", exported: new Date().toISOString(), parts: parts.length };
  const suffix = units === "m" ? "" : `-${units}`;
  if (format === "glb") {
    const ab = await new GLTFExporter().parseAsync(tree, { binary: true, onlyVisible: false, maxTextureSize: 4096 });
    return { blob: new Blob([ab], { type: "model/gltf-binary" }), filename: `${name}${suffix}.glb` };
  }
  if (format === "obj") return { blob: new Blob([new OBJExporter().parse(tree)], { type: "text/plain" }), filename: `${name}${suffix}.obj` };
  if (format === "stl") return { blob: new Blob([new STLExporter().parse(tree, { binary: true })], { type: "model/stl" }), filename: `${name}${suffix}.stl` };
  throw new Error(`unknown format ${format}`);
}
