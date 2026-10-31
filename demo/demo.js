// The demo page: drop UnityPackFF GLBs (and the files they point to) and
// see them with FusionFall's shaders. ?model=<url> opens a model and
// ?world=<url>&area=tx0,ty0,tx1,ty1 an area of a world directory, from a
// server (cli/serve.mjs --dir <dir> serves <dir> at /files/).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mountModel } from "../src/model-viewer.js";
import { mountArea } from "../src/area-viewer.js";
import { World, createFiles } from "../src/world.js";
import { tileKey, areaTiles } from "../src/jobs.js";

const DROP = "https://dropped.invalid/";
const $ = (id) => document.getElementById(id);
const stage = $("stage"), controls = $("controls"), pick = $("pick");
const status = (text) => { $("status").textContent = text; };

let files = new Map(); // path in the drop → File
let current = null;

// The dropped file a URL names: by its path, the end of its path, or its
// name (UnityPackFF's shared files are named by their content).
function lookup(url) {
  const path = decodeURIComponent(url.startsWith(DROP) ? url.slice(DROP.length) : new URL(url).pathname.slice(1));
  if (files.has(path)) return files.get(path);
  const clean = path.split("/").filter((p) => p && p !== "." && p !== "..").join("/");
  for (const [p, f] of files) if (p === clean || p.endsWith("/" + clean)) return f;
  const name = clean.split("/").pop();
  for (const [p, f] of files) if (p.split("/").pop() === name) return f;
  return null;
}

const blobs = new Map();
function blobUrl(url) {
  const f = lookup(url);
  if (!f) return url;
  if (!blobs.has(f)) blobs.set(f, URL.createObjectURL(f));
  return blobs.get(f);
}

async function readJson(file) {
  const data = await file.slice(0, 20).arrayBuffer();
  const v = new DataView(data);
  if (v.getUint32(0, true) !== 0x46546c67) return null;
  const n = v.getUint32(12, true);
  return JSON.parse(await file.slice(20, 20 + n).text());
}

// A GLB is a world tile when it carries a scene's settings or a terrain.
function tileOf(json) {
  const scene = (json.scenes || [])[json.scene || 0] || {};
  const isScene = (scene.extras && (scene.extras.colors || scene.extras.render_settings)) || (json.materials || []).some((m) => m.extras && m.extras.terrain);
  if (!isScene) return null;
  const root = json.nodes[(scene.nodes || [])[0]] || {};
  const t = root.translation || [0, 0, 0];
  return tileKey(Math.max(0, Math.round(-t[0] / 512)), Math.max(0, Math.round(t[2] / 512)));
}

async function show(entry) {
  if (current) { current.dispose(); current = null; }
  controls.replaceChildren();
  status("Loading…");
  try {
    if (entry.tile) {
      const tiles = new Map(entries.filter((e) => e.tile).map((e) => [e.tile, e.path]));
      const world = new World(DROP, { files: createFiles({ fetchBytes: async (url) => {
        const f = lookup(url);
        if (!f) throw new Error(`not among the dropped files: ${url}`);
        return f.arrayBuffer();
      } }) });
      world.tileUrl = (key) => DROP + tiles.get(key);
      world.hasTile = (key) => tiles.has(key);
      const [tx, ty] = entry.tile.split("_").map(Number);
      current = await mountArea(stage, world, { area: [tx, ty, tx, ty], tiles: areaTiles([tx, ty, tx, ty], 1) }, { controls, onStatus: status });
    } else {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(blobUrl);
      current = await mountModel(stage, DROP + entry.path, { controls, loader: new GLTFLoader(manager) });
    }
    status(entry.tile ? `Tile ${entry.tile}` : entry.path);
  } catch (e) {
    console.error(e);
    status(`Could not show ${entry.path}: ${e.message || e}`);
  }
}

let entries = [];
async function load(list) {
  for (const b of blobs.values()) URL.revokeObjectURL(b);
  blobs.clear();
  files = new Map(list.map(({ path, file }) => [path, file]));
  entries = [];
  for (const [path, file] of files) {
    if (!path.toLowerCase().endsWith(".glb") || /@[^/]*\.glb$/i.test(path)) continue; // split clips go with their model
    const json = await readJson(file).catch(() => null);
    if (json) entries.push({ path, tile: tileOf(json) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  pick.replaceChildren(...entries.map((e, i) => Object.assign(document.createElement("option"), { value: i, textContent: e.tile ? `${e.path} (tile ${e.tile})` : e.path })));
  pick.disabled = !entries.length;
  if (!entries.length) {
    pick.replaceChildren(Object.assign(document.createElement("option"), { textContent: "No GLB among the files" }));
    status("");
    return;
  }
  show(entries[0]);
}
pick.addEventListener("change", () => show(entries[+pick.value]));

// Every file under a dropped folder, with its path.
async function walk(entry, prefix = "") {
  if (entry.isFile) return [{ path: prefix + entry.name, file: await new Promise((r, j) => entry.file(r, j)) }];
  const reader = entry.createReader();
  const out = [];
  for (;;) {
    const batch = await new Promise((r, j) => reader.readEntries(r, j));
    if (!batch.length) break;
    for (const e of batch) out.push(...(await walk(e, prefix + entry.name + "/")));
  }
  return out;
}

const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const list = items.length ? (await Promise.all(items.map((i) => walk(i)))).flat() : [...e.dataTransfer.files].map((f) => ({ path: f.name, file: f }));
  load(list);
});
for (const id of ["files", "folder"]) {
  $(id).addEventListener("change", (e) => load([...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))));
}

// From a server
const q = new URLSearchParams(location.search);
if (q.get("model")) {
  status("Loading…");
  mountModel(stage, q.get("model"), { controls }).then((v) => { current = window.ffViewer = v; status(q.get("model")); }, (e) => status(String(e)));
} else if (q.get("world") && q.get("area")) {
  const area = q.get("area").split(",").map(Number);
  mountArea(stage, q.get("world"), { area, tiles: q.get("ring") === "0" ? undefined : areaTiles(area, 1), sky: q.get("sky") || undefined }, { controls, onStatus: status })
    .then((v) => { current = window.ffViewer = v; status(`Area ${area.join(",")}`); }, (e) => status(String(e)));
}
