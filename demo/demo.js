// The demo page: pick a model or an area from what the server has
// (cli/serve.mjs --dir) with three dropdowns (source, kind, item), or drop
// UnityPackFF GLBs and the files they point to. The URL follows the pick:
// ?model=<url>[&clips=pack][&npc=<number>] or ?world=<url>&area=tx0,ty0,tx1,ty1.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mountModel, packClipUrl } from "../src/model-viewer.js";
import { mountArea } from "../src/area-viewer.js";
import { World, createFiles } from "../src/world.js";
import { tileKey, areaTiles } from "../src/jobs.js";
import { ItemList } from "./item-list.js";

const DROP = "https://dropped.invalid/";
const $ = (id) => document.getElementById(id);
const stage = $("stage"), controls = $("controls");
const status = (text) => { $("status").textContent = text; };

// ---------------------------------------------------------------- viewing
let current = null, token = 0;

async function open(item, { updateUrl = true, npc } = {}) {
  const mine = ++token;
  if (current) { current.dispose(); current = null; }
  controls.replaceChildren();
  clearPanel();
  status("Loading…");
  if (updateUrl && item.query) history.replaceState(null, "", "?" + item.query);
  try {
    const viewer = await item.open({ npc });
    if (mine !== token) { viewer.dispose(); return; }
    current = window.ffViewer = viewer;
    status(item.title || item.label);
    if (viewer.shown) viewer.shown();
  } catch (e) {
    console.error(e);
    if (mine === token) status(`Could not show ${item.label}: ${e.message || e}`);
  }
}

// Whether the hitbox shows: kept from model to model, and over reloads.
let hitboxOn = false;
try { hitboxOn = localStorage.getItem("ff-three-demo-hitbox") === "1"; } catch { /* no storage */ }
const keepHitbox = (v) => {
  hitboxOn = v;
  try { localStorage.setItem("ff-three-demo-hitbox", v ? "1" : "0"); } catch { /* no storage */ }
};

// A mob or NPC model's sizes: the NPC rows that use it (files.json's
// `rows` with a size, from the pack's tables.json) by the model's scale
// (m_fScale) and the hitbox (m_iRadius, m_iHeight), smallest first. Each is
// one of the viewer's variants.
function sizesOf(rows) {
  const sizes = new Map();
  for (const n of rows) {
    if (!n.radius) continue;
    const key = `${n.scale}/${n.radius}/${n.height}`;
    if (!sizes.has(key)) sizes.set(key, { radius: n.radius, height: n.height, scale: n.scale, rows: [] });
    sizes.get(key).rows.push(n);
  }
  return [...sizes.values()].sort((a, b) => a.scale - b.scale || a.radius - b.radius || a.height - b.height);
}
const num = (v) => String(+v.toFixed(2));
const el = (tag, props = {}, children = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e; };
const chips = (s) => [
  el("span", { className: "chip", textContent: `model ×${num(s.scale)}`, title: "The model's scale (m_fScale)" }),
  el("span", { className: "chip", textContent: `hitbox ${num(s.radius)} × ${num(s.height)} m`, title: "The hitbox cylinder's radius and height (m_iRadius, m_iHeight)" }),
];
// a mob's or a nano's type (m_iNpcStyle, m_iStyle), the game's colours
const STYLES = ["Adaptium", "Blastons", "Cosmix"];
const styleBadge = (n) => (STYLES[n.style]
  ? [el("span", { className: `style style-${"abc"[n.style]}`, textContent: "ABC"[n.style], title: STYLES[n.style] })] : []);
const icon = (n) => (n.icon ? el("img", { src: n.icon, alt: "", loading: "lazy", decoding: "async" }) : el("span", { className: "noicon" }));

// The panel beside the stage: the table rows that use the model. A mob or
// NPC model's under their sizes, where picking one shows the model at its
// scale with its hitbox; any other's (eggs, items) as a list. And the label
// on the stage, naming the NPC shown, or the one row a model has.
const panel = $("variants"), label = $("stage-label");
function clearPanel() {
  panel.hidden = label.hidden = true;
  panel.replaceChildren();
  stage.parentElement.parentElement.classList.remove("with-variants");
}
function showLabel(n, s) {
  label.replaceChildren(el("strong", {}, [...(n.icon && !s ? [icon(n)] : []), n.name]),
    ...(n.level ? [el("span", { textContent: `Lv ${n.level}` })] : []),
    ...(STYLES[n.style] ? [el("span", { className: `style-${"abc"[n.style]}`, textContent: STYLES[n.style] })] : []),
    ...(s ? chips(s) : []));
  label.hidden = false;
}
function showRows(item, viewer, rows, sizes, shown) {
  if (!sizes.length && rows.length === 1) { showLabel(rows[0]); return; }
  if (!sizes.length && !rows.length) return;
  // a name more than once: its rows told apart by their comments
  const count = new Map();
  for (const n of rows) count.set(n.name, (count.get(n.name) || 0) + 1);
  const buttons = [];
  const line = (n, gi) => {
    const parts = [icon(n), el("span", { className: "name", textContent: n.name },
      count.get(n.name) > 1 && n.note ? [el("span", { className: "note", textContent: ` ${n.note}` })] : []),
      ...styleBadge(n), ...(n.level ? [el("span", { className: "level", textContent: `Lv ${n.level}` })] : [])];
    if (gi == null) return el("li", { className: "row", title: n.id != null ? `#${n.id}` : "" }, parts);
    const b = el("button", { type: "button", title: `NPC ${n.id}` }, parts);
    b.setAttribute("aria-pressed", String(n === shown));
    b.addEventListener("click", () => {
      viewer.variant(gi);
      for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
      showLabel(n, sizes[gi]);
      history.replaceState(null, "", `?${item.query}&npc=${n.id}`);
    });
    buttons.push(b);
    return el("li", {}, [b]);
  };
  const plain = rows.filter((n) => !n.radius);
  const groups = sizes.map((s, gi) => el("section", {}, [
    el("h3", {}, [...chips(s), el("span", { className: "count", textContent: s.rows.length })]),
    el("ul", {}, s.rows.map((n) => line(n, gi))),
  ]));
  if (plain.length) {
    groups.push(el("section", {}, [
      ...(sizes.length ? [el("h3", {}, ["no hitbox", el("span", { className: "count", textContent: plain.length })])] : []),
      el("ul", {}, plain.map((n) => line(n, null))),
    ]));
  }
  const npcs = sizes.reduce((c, s) => c + s.rows.length, 0);
  const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  panel.replaceChildren(el("h2", {}, sizes.length
    ? ["Variants ", el("span", { textContent: `${plural(npcs, "NPC")}, ${plural(sizes.length, "size")}` })]
    : ["Used by ", el("span", { textContent: plural(rows.length, "row") })]),
  el("div", { className: "variants-list" }, groups));
  panel.hidden = false;
  stage.parentElement.parentElement.classList.add("with-variants");
  if (!shown) return;
  showLabel(shown, sizes.find((s) => s.rows.includes(shown)));
  // the one shown, in the middle of the list (scrolling only the list, not the page)
  const on = buttons.find((b) => b.getAttribute("aria-pressed") === "true");
  const list = panel.querySelector(".variants-list");
  if (on) list.scrollTop = on.offsetTop - list.clientHeight / 2;
}

// A model. The boy and girl actors get the player's capsule for a hitbox;
// mobs and NPCs their variants (opening with `npc`, the NPC's number, or the
// first at the model's own scale).
const modelItem = (label, url, clips, rows = []) => ({
  label, title: url, key: `model:${url}`, query: `model=${encodeURIComponent(url)}${clips === "pack" ? "&clips=pack" : ""}`,
  async open({ npc } = {}) {
    const sizes = sizesOf(rows);
    const all = sizes.flatMap((s) => s.rows);
    const first = all.find((n) => n.id === npc) || (sizes.find((s) => s.scale === 1) || sizes[0] || { rows: [] }).rows[0];
    const variant = sizes.findIndex((s) => s.rows.includes(first));
    const viewer = await mountModel(stage, url, {
      controls, hitboxOn, onHitbox: keepHitbox,
      hitbox: /\/avatar\/actor\/[^/]+\/[^/]+\.glb$/i.test(url) ? "player" : sizes.length ? sizes : null,
      ...(sizes.length ? { variant, variantPicker: false } : {}),
      ...(clips === "pack" ? { clipUrl: (name) => packClipUrl(url, name) } : {}),
    });
    viewer.shown = () => showRows(this, viewer, rows, sizes, first);
    return viewer;
  },
});

const areaItem = (label, worldUrl, area, title) => ({
  label, title: title || label, key: `world:${worldUrl}|${area.join(",")}`, query: `world=${encodeURIComponent(worldUrl)}&area=${area.join(",")}`,
  open: () => mountArea(stage, worldUrl, { area, tiles: areaTiles(area, 1) }, { controls, onStatus: status }),
});

// ---------------------------------------------------------------- what there is
// sources: name → kind → [item]
const sources = new Map();
function add(source, kind, item) {
  if (!sources.has(source)) sources.set(source, new Map());
  const kinds = sources.get(source);
  if (!kinds.has(kind)) kinds.set(kind, []);
  kinds.get(kind).push(item);
}

// Wear by its folder's prefix, as the client names its files.
const WEAR = {
  m: "Boys' clothes", f: "Girls' clothes", pistol: "Pistols", rifle: "Rifles", sword: "Melee weapons", thrown: "Grenades",
  bazooka: "Rocket launchers", helmet: "Hats", hat: "Hats", glass: "Glasses", back: "Back items", vehicle: "Vehicles",
};

// A folder name without its kind's prefix: nano_eduardo → eduardo.
const bare = (folder, prefix) => (folder.startsWith(prefix) ? folder.slice(prefix.length) : folder).replace(/_/g, " ");

function addModel(m) {
  const parts = m.group.split("/");
  const [folder, file] = m.name.includes("/") ? m.name.split("/") : [null, m.name];
  const variant = file.replace(/\.glb$/i, "");
  const tail = parts.slice(-2).join("/");
  if (folder && (tail === "models/mob" || tail === "models/nano" || tail === "avatar/wear" || tail === "avatar/actor")) {
    const source = parts.slice(0, -2).join("/") || "(top)";
    const named = (name) => (variant === "default" || variant === folder ? name : `${name} · ${variant}`);
    let kind, label;
    if (tail === "models/nano") { kind = "Nanos"; label = bare(folder, "nano_"); }
    else if (tail === "avatar/actor") { kind = "Characters"; label = { m: "boy", w: "girl" }[folder] || folder; }
    else if (tail === "avatar/wear") { kind = `Wear: ${WEAR[folder.split("_")[0]] || "other"}`; label = folder.replace(/_/g, " "); }
    else if (folder.startsWith("fusion_")) { kind = "Fusions"; label = bare(folder, "fusion_"); }
    else if (folder.startsWith("mob_")) { kind = "Mobs"; label = bare(folder, "mob_"); }
    else if (folder.startsWith("npc_")) { kind = "NPCs"; label = bare(folder, "npc_"); }
    else { kind = "Other models"; label = folder.replace(/_/g, " "); }
    // by the asset's name (the in-game names are in the panel), found by either
    const item = modelItem(named(label), m.url, m.clips, m.rows);
    item.folder = named(label);
    item.icon = m.icon || null;
    item.search = `${item.label} ${(m.names || []).join(" ")} ${item.folder}`.toLowerCase();
    add(source, kind, item);
    return;
  }
  add(m.group || "(top)", "Models", modelItem((folder ? `${folder}/` : "") + variant.replace(/\.kfm$/i, ""), m.url, m.clips));
}

function addWorld(w) {
  const source = decodeURIComponent(w.url.replace(/^\/files\//, "").replace(/\/?world\/$/, "").replace(/\/$/, "")) || "(top)";
  for (const a of w.areas) add(source, "Areas", areaItem(`${a.name}${a.zone ? ` (${a.zone})` : ""}`, w.url, a.area, `${a.name}, tiles ${a.area.join(",")}`));
  for (const t of w.tiles) {
    const [tx, ty] = t.split("_").map(Number);
    add(source, "Tiles", areaItem(`tile ${t}`, w.url, [tx, ty, tx, ty]));
  }
}

const KIND_ORDER = ["Areas", "Tiles", "Nanos", "Fusions", "Mobs", "NPCs", "Other models", "Characters", "Models", "Files"];
const kindRank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? (k.startsWith("Wear") ? 50 : 60) : i; };

// ---------------------------------------------------------------- the dropdowns
const sourceSel = $("source"), kindSel = $("kind"), itemSel = new ItemList($("item"), "Item"), filter = $("filter");
const option = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });

function fillKinds() {
  const kinds = sources.get(sourceSel.value) || new Map();
  const names = [...kinds.keys()].sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b));
  kindSel.replaceChildren(...names.map((k) => option(k, `${k} (${kinds.get(k).length})`)));
  fillItems();
}

function fillItems() {
  const items = (sources.get(sourceSel.value) || new Map()).get(kindSel.value) || [];
  const q = filter.value.trim().toLowerCase();
  const shown = items.map((it, i) => [it, i]).filter(([it]) => !q || (it.search || it.label.toLowerCase()).includes(q));
  itemSel.setOptions(shown.length ? `Pick one of ${shown.length}…` : "Nothing matches",
    shown.map(([it, i]) => ({ value: String(i), label: it.label, icon: it.icon || null, title: it.title })));
}

function refresh() {
  const names = [...sources.keys()].sort((a, b) => (a === "Dropped files") - (b === "Dropped files") || a.localeCompare(b));
  const keep = sourceSel.value;
  sourceSel.replaceChildren(...names.map((n) => option(n, n)));
  if (names.includes(keep)) sourceSel.value = keep;
  $("picker").hidden = !names.length;
  fillKinds();
}

sourceSel.addEventListener("change", () => { filter.value = ""; fillKinds(); });
kindSel.addEventListener("change", () => { filter.value = ""; fillItems(); });
filter.addEventListener("input", fillItems);
itemSel.addEventListener("change", () => {
  const items = sources.get(sourceSel.value).get(kindSel.value);
  if (itemSel.value !== "") open(items[+itemSel.value]);
});

// Selects the item with `key` in the dropdowns, if there is one.
function select(key) {
  for (const [source, kinds] of sources) {
    for (const [kind, items] of kinds) {
      const i = items.findIndex((it) => it.key === key);
      if (i < 0) continue;
      sourceSel.value = source;
      fillKinds();
      kindSel.value = kind;
      fillItems();
      itemSel.value = String(i);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- dropped files
let files = new Map(); // path in the drop → File

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
  const v = new DataView(await file.slice(0, 20).arrayBuffer());
  if (v.getUint32(0, true) !== 0x46546c67) return null;
  return JSON.parse(await file.slice(20, 20 + v.getUint32(12, true)).text());
}

// A GLB is a world tile when it carries a scene's settings or a terrain.
function tileOf(json) {
  const scene = (json.scenes || [])[json.scene || 0] || {};
  const isScene = (scene.extras && (scene.extras.colors || scene.extras.render_settings)) || (json.materials || []).some((m) => m.extras && m.extras.terrain);
  if (!isScene) return null;
  const t = (json.nodes[(scene.nodes || [])[0]] || {}).translation || [0, 0, 0];
  return tileKey(Math.max(0, Math.round(-t[0] / 512)), Math.max(0, Math.round(t[2] / 512)));
}

async function loadDropped(list) {
  for (const b of blobs.values()) URL.revokeObjectURL(b);
  blobs.clear();
  files = new Map(list.map(({ path, file }) => [path, file]));
  sources.delete("Dropped files");
  const tiles = new Map();
  const entries = [];
  for (const [path, file] of files) {
    if (!path.toLowerCase().endsWith(".glb") || /@[^/]*\.glb$/i.test(path) || /(^|\/)clips\//.test(path)) continue;
    const json = await readJson(file).catch(() => null);
    if (!json) continue;
    const tile = tileOf(json);
    if (tile) tiles.set(tile, path);
    entries.push({ path, tile });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  for (const e of entries) {
    if (e.tile) {
      add("Dropped files", "Files", { label: `${e.path} (tile ${e.tile})`, key: `drop:${e.path}`, open: () => {
        const world = new World(DROP, { files: createFiles({ fetchBytes: async (url) => {
          const f = lookup(url);
          if (!f) throw new Error(`not among the dropped files: ${url}`);
          return f.arrayBuffer();
        } }) });
        world.tileUrl = (key) => DROP + tiles.get(key);
        world.hasTile = (key) => tiles.has(key);
        const [tx, ty] = e.tile.split("_").map(Number);
        return mountArea(stage, world, { area: [tx, ty, tx, ty], tiles: areaTiles([tx, ty, tx, ty], 1) }, { controls, onStatus: status });
      } });
    } else {
      add("Dropped files", "Files", { label: e.path, key: `drop:${e.path}`, open: () => {
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(blobUrl);
        return mountModel(stage, DROP + e.path, { controls, loader: new GLTFLoader(manager) });
      } });
    }
  }
  if (!entries.length) { status("No GLB among the dropped files"); refresh(); return; }
  sourceSel.value = "Dropped files";
  refresh();
  select(`drop:${entries[0].path}`);
  open(sources.get("Dropped files").get("Files")[0], { updateUrl: false });
}

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
  loadDropped(list);
});
for (const id of ["files", "folder"]) {
  $(id).addEventListener("change", (e) => loadDropped([...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))));
}

// ---------------------------------------------------------------- start
try {
  const r = await fetch("files.json");
  if (r.ok) {
    const index = await r.json();
    for (const w of index.worlds) addWorld(w);
    for (const m of index.models) addModel(m);
    for (const kinds of sources.values()) {
      for (const items of kinds.values()) {
        // two items with the same names (variants the tables don't tell apart): add the folder
        const count = new Map();
        for (const it of items) count.set(it.label, (count.get(it.label) || 0) + 1);
        for (const it of items) if (it.folder && count.get(it.label) > 1 && it.label !== it.folder) it.label += ` (${it.folder})`;
        items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      }
    }
  }
} catch {
  // no list: dropping files still works
}
refresh();

// ?model=[&npc=] or ?world=&area=: the item the URL names, picked in the dropdowns
// when the list has it
const q = new URLSearchParams(location.search);
const wanted = q.get("model")
  ? modelItem(q.get("model").split("/").pop(), q.get("model"), q.get("clips"))
  : q.get("world") && q.get("area") ? areaItem(`area ${q.get("area")}`, q.get("world"), q.get("area").split(",").map(Number)) : null;
if (wanted) {
  const npc = q.get("npc") ? Number(q.get("npc")) : undefined;
  if (select(wanted.key)) open(sources.get(sourceSel.value).get(kindSel.value)[+itemSel.value], { updateUrl: false, npc });
  else open(wanted, { updateUrl: false, npc });
}
