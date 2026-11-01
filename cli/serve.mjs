#!/usr/bin/env node
// Serves the demo page (at /demo/) and, with --dir, a directory of
// UnityPackFF output or ff-unpack packs at /files/. The demo page lists what
// it finds there (/demo/files.json): every model, and every world directory
// with its named areas (from the pack's areas/areas.json).
//   node cli/serve.mjs [--dir <dir>] [--port 8080] [--host 127.0.0.1]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "./server.mjs";
import { areaTiles } from "../src/jobs.js";

// Folders that hold no models of their own: content-addressed parts, clips,
// a world's pieces.
const SKIP = new Set(["shared", "clips", "sky", "attr", "bgm", "node_modules", ".git"]);

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// The tiles an area of areas.json covers ({ x, y, width, height } in map
// metres, x east, y north).
export const areaOf = (a) => [Math.floor(a.x / 512), Math.floor(a.y / 512), Math.ceil((a.x + a.width) / 512) - 1, Math.ceil((a.y + a.height) / 512) - 1];

// The client's icon files by m_iIconType (AvatarUtil): <prefix>_<number, two digits>.png
export const ICON_PREFIXES = ["wpnicon", "nanoicon", "skillicon", "cosicon", "npcicon", "nanoready", "questitemicon",
  "generalitemicon", "mobicon", "fusionicon", "hnpcicon", "transport", "vehicle"];

// The in-game names and icons of the models a sub-pack's tables.json names
// (ff-unpack copies the client's XDT tables): Map of "<model folder>" and
// "<model folder>/<variant>" (lower case) → { names, icon }: the names in
// table order, the icon file of the first row with one. Every
// table works the same way: a row's m_iMesh picks a mesh row, whose
// m_pstrMMeshModelString (and m_pstrFMeshModelString) is the model's
// folder and whose m_pstrMTextureString names the variant (or, where it
// has none, the row its m_iTexture picks: ff-unpack names a variant's file
// after its first texture); and
// its m_i…Name (m_iNpcName, m_iNanoName, m_iItemName, …) a string row,
// whose m_strName is its name; its m_iIcon1 (items: m_iIcon) picks an icon
// row, { m_iIconNumber, m_iIconType }, naming its icon file.
export function packNames(tables) {
  const names = new Map();
  for (const table of Object.values(tables || {})) {
    const lists = Object.entries(table || {});
    const data = lists.find(([k]) => k.endsWith("Data") && !/Mesh|String/.test(k));
    const meshes = (lists.find(([k]) => k.endsWith("MeshData")) || [])[1];
    const strings = (lists.find(([k]) => k.endsWith("StringData")) || [])[1];
    const icons = (lists.find(([k]) => k.endsWith("IconData")) || [])[1] || [];
    if (!data || !meshes || !strings) continue;
    for (const row of data[1]) {
      const nameKey = Object.keys(row).find((k) => /^m_i\w*Name$/.test(k));
      const mesh = meshes[row.m_iMesh];
      const name = nameKey && strings[row[nameKey]] && strings[row[nameKey]].m_strName;
      if (!mesh || !name || name === "null") continue;
      const texRow = row.m_iTexture ? meshes[row.m_iTexture] : null;
      const tex = (mesh.m_pstrMTextureString && mesh.m_pstrMTextureString !== "null" && mesh.m_pstrMTextureString)
        || (texRow && texRow.m_pstrMTextureString);
      const iconRow = icons[row.m_iIcon1 ?? row.m_iIcon];
      const prefix = iconRow && (row.m_iIcon1 ?? row.m_iIcon) ? ICON_PREFIXES[iconRow.m_iIconType] : null;
      const icon = prefix ? `${prefix}_${String(iconRow.m_iIconNumber).padStart(2, "0")}.png` : null;
      const add = (key) => {
        if (!names.has(key)) names.set(key, { names: [], icon: null });
        const entry = names.get(key);
        if (!entry.names.includes(name)) entry.names.push(name);
        if (!entry.icon && icon) entry.icon = icon;
      };
      for (const model of [mesh.m_pstrMMeshModelString, mesh.m_pstrFMeshModelString]) {
        if (!model || model === "null") continue;
        add(model.toLowerCase());
        if (tex && tex !== "null") add(`${model}/${tex}`.toLowerCase());
      }
    }
  }
  return names;
}

// What a directory holds, for the demo page: { worlds: [{ url, tiles,
// areas: [{ name, zone, area }] }], models: [{ url, group, name, clips,
// names, icon }] }, URLs under `prefix`. `clips` is "pack" for a prefab in
// an ff-unpack pack, whose folder is part of its `name` and whose category
// folder is its `group`; `names` are its in-game names and `icon` the URL of
// its icon, where the pack's tables.json has them (packNames()) and its
// icons/ the file.
export function indexFiles(root, prefix = "/files/") {
  const worlds = [], models = [];
  const url = (rel) => prefix + rel.split(path.sep).map(encodeURIComponent).join("/");
  const namesIn = new Map(); // sub-pack → packNames()
  const namesOf = (packRoot) => {
    if (!namesIn.has(packRoot)) {
      let tables = null;
      try { tables = JSON.parse(fs.readFileSync(path.join(root, packRoot, "tables.json"), "utf8")); } catch { /* none */ }
      namesIn.set(packRoot, packNames(tables));
    }
    return namesIn.get(packRoot);
  };
  // packRoot: the relative path of the ff-unpack sub-pack (a folder with a
  // manifest.json) the walk is in; its files are <category>/<prefab>/<file>
  const walk = (dir, rel, depth, packRoot) => {
    if (depth > 8) return;
    let names;
    try { names = fs.readdirSync(dir).sort(); } catch { return; }
    if (names.includes("tile") && isDir(path.join(dir, "tile"))) {
      const tiles = fs.readdirSync(path.join(dir, "tile")).filter((n) => /^\d+_\d+\.glb$/.test(n)).map((n) => n.slice(0, -4));
      let areas = [];
      try {
        // an area made of several rectangles (Orchid Bay has four) is one
        // link, over the tiles of all of them
        const byName = new Map();
        for (const a of JSON.parse(fs.readFileSync(path.join(dir, "..", "areas", "areas.json"), "utf8"))) {
          const r = areaOf(a), key = `${a.zone}\n${a.name}`;
          const have = byName.get(key);
          byName.set(key, { name: a.name, zone: a.zone, area: have
            ? [Math.min(have.area[0], r[0]), Math.min(have.area[1], r[1]), Math.max(have.area[2], r[2]), Math.max(have.area[3], r[3])] : r });
        }
        areas = [...byName.values()].filter((a) => a.area.every((v) => v >= 0) && areaTiles(a.area).some((k) => tiles.includes(k)));
      } catch { /* not in a pack: tiles only */ }
      worlds.push({ url: url(rel) + "/", tiles, areas });
      return;
    }
    if (packRoot == null && names.includes("manifest.json")) packRoot = rel;
    const hasClips = names.includes("clips") && isDir(path.join(dir, "clips"));
    for (const n of names) {
      const p = path.join(dir, n), r = rel ? path.join(rel, n) : n;
      // hidden folders: ff-unpack's sub-packs while they're being written, and the like
      if (isDir(p)) { if (!SKIP.has(n) && !n.startsWith(".")) walk(p, r, depth + 1, packRoot); continue; }
      if (!n.toLowerCase().endsWith(".glb") || n.includes("@")) continue; // split clips go with their model
      const parts = rel.split(path.sep);
      const inPack = packRoot != null && parts.length - (packRoot ? packRoot.split(path.sep).length : 0) >= 2;
      // a pack prefab's folder is part of its name; its category folder is the group
      const group = (inPack ? parts.slice(0, -1) : parts).join("/");
      const name = inPack ? `${parts[parts.length - 1]}/${n}` : n;
      const entry = { url: url(r), group, name, clips: hasClips ? "pack" : null };
      // the variant's own names, else the model's
      const folder = parts[parts.length - 1].toLowerCase(), variant = n.slice(0, -4).toLowerCase();
      const known = inPack ? namesOf(packRoot).get(`${folder}/${variant}`) || namesOf(packRoot).get(folder) : null;
      if (known) {
        entry.names = known.names;
        // the pack's icons/ sits beside its sub-packs
        const iconRel = known.icon && path.join(packRoot, "..", "icons", known.icon);
        if (iconRel && fs.existsSync(path.join(root, iconRel))) entry.icon = url(path.normalize(iconRel));
      }
      models.push(entry);
    }
  };
  walk(root, "", 0, null);
  return { worlds, models };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  const { values } = parseArgs({ options: { dir: { type: "string" }, port: { type: "string", default: "8080" }, host: { type: "string", default: "127.0.0.1" } } });
  const dir = values.dir && path.resolve(values.dir);
  let index = null;
  const { url } = await serve(dir ? { "/files/": dir } : {}, {
    host: values.host, port: Number(values.port),
    routes: { "/demo/files.json": () => (index = index || (dir ? indexFiles(dir) : { worlds: [], models: [] })) },
  });
  console.log(`${url}/demo/`);
}
