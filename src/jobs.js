// Render jobs as data: what src/render.js draws and cli/render.mjs plans,
// skips and records. No three.js here, so the CLI and tests can use it.

export const TILE_SIZE = 512;

export const JOB_DEFAULTS = {
  topdown: { size: 1024 },
  view: { sky: "normal", width: 1280, height: 720, pitch: 26 },
};

export const tileKey = (tx, ty) => `${String(tx).padStart(2, "0")}_${String(ty).padStart(2, "0")}`;
export const parseTileKey = (key) => key.split("_").map(Number);

// The tile keys of an area [tx0, ty0, tx1, ty1] and `ring` tiles around it.
export function areaTiles([tx0, ty0, tx1, ty1], ring = 0) {
  const keys = [];
  for (let ty = ty0 - ring; ty <= ty1 + ring; ty++) {
    for (let tx = tx0 - ring; tx <= tx1 + ring; tx++) if (tx >= 0 && ty >= 0) keys.push(tileKey(tx, ty));
  }
  return keys;
}

// An area's extent in glTF space: [xMin, xMax, zMin, zMax] (east is −x).
export function areaBounds([tx0, ty0, tx1, ty1]) {
  return [-(tx1 + 1) * TILE_SIZE, -tx0 * TILE_SIZE, ty0 * TILE_SIZE, (ty1 + 1) * TILE_SIZE];
}

// A job with its defaults filled in and nothing else (its name and any
// other field dropped); throws on a job that can't run.
export function normalizeJob(job) {
  if (!job || !JOB_DEFAULTS[job.type]) throw new Error(`unknown job type ${job && job.type}`);
  const j = { type: job.type };
  for (const k of Object.keys(JOB_DEFAULTS[job.type])) j[k] = job[k] ?? JOB_DEFAULTS[job.type][k];
  if (job.type === "topdown") {
    if (!/^\d+_\d+$/.test(job.tile || "")) throw new Error(`topdown job: tile must be XX_YY, not ${job.tile}`);
    j.tile = job.tile;
    if (!Number.isInteger(j.size) || j.size < 16 || j.size > 8192) throw new Error(`topdown job: bad size ${j.size}`);
  } else {
    const a = job.area;
    if (!Array.isArray(a) || a.length !== 4 || a.some((v) => !Number.isInteger(v) || v < 0) || a[2] < a[0] || a[3] < a[1]) {
      throw new Error("view job: area must be [tx0, ty0, tx1, ty1]");
    }
    j.area = [...a];
    j.tiles = job.tiles ? [...job.tiles] : areaTiles(a, 1);
    if (j.tiles.some((k) => !/^\d+_\d+$/.test(k))) throw new Error("view job: tiles must be XX_YY keys");
    if (!["normal", "fusion"].includes(j.sky)) throw new Error(`view job: sky must be normal or fusion, not ${j.sky}`);
    for (const k of ["width", "height"]) if (!Number.isInteger(j[k]) || j[k] < 16 || j[k] > 8192) throw new Error(`view job: bad ${k} ${j[k]}`);
  }
  return j;
}

// A stable JSON text (keys sorted), for comparing jobs.
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

// File names jobs may write: letters, digits, _ - . only, no leading dot.
export const validName = (name) => typeof name === "string" && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(name);
