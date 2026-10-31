// Still pictures of the world: a tile straight down, or an area at an
// angle. render.html runs one job in headless Chromium for the render CLI
// (cli/render.mjs); a page can call these directly too.
//
// Jobs (JSON):
//   { "type": "topdown", "tile": "04_02", "size": 1024 }
//       the tile straight down: orthographic, north up, east right, no fog
//       or sky, transparent where nothing is drawn
//   { "type": "view", "area": [tx0, ty0, tx1, ty1], "tiles": ["03_01", …],
//     "sky": "normal", "width": 1280, "height": 720, "pitch": 26 }
//       the area's tiles seen from the south at `pitch` degrees, the camera
//       backed off until they all fit; `tiles` are loaded (the area's and a
//       ring around them, say: missing ones are skipped), with the sea
//       around them, the skybox and a light fog
import * as THREE from "three";
import { createEnvironment } from "./environment.js";
import { TILE_SIZE, parseTileKey, createSurroundings, SEA_LEVEL } from "./world.js";
import { normalizeJob, areaBounds } from "./jobs.js";

export { JOB_DEFAULTS, normalizeJob, areaTiles, areaBounds } from "./jobs.js";

// Places `camera` south of an area, looking north and down at `pitch`
// (radians) at its centre at height `ground`, backed off until the area's
// corners fit inside `margin` of the frame. Returns the distance to the
// target.
export function frameArea(camera, area, ground, pitch, margin = 0.94) {
  const [x0, x1, z0, z1] = areaBounds(area);
  const target = new THREE.Vector3((x0 + x1) / 2, ground, (z0 + z1) / 2);
  const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => new THREE.Vector3(x, ground, z));
  const place = (r) => {
    camera.position.set(target.x, target.y + r * Math.sin(pitch), target.z - r * Math.cos(pitch));
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  let lo = 10, hi = 30000;
  const p = new THREE.Vector3();
  for (let i = 0; i < 50; i++) {
    const r = (lo + hi) / 2;
    place(r);
    const out = corners.some((c) => { p.copy(c).project(camera); return Math.abs(p.x) > margin || Math.abs(p.y) > margin; });
    if (out) lo = r; else hi = r;
  }
  place(hi);
  return hi;
}

// The ground level of loaded tiles: the median of their terrain heights
// on an 8 × 8 grid each, not below the sea's. Tiles without terrain count as
// the sea.
export function groundLevel(tiles) {
  const heights = [];
  for (const t of tiles) {
    const [ox, oz] = [-t.tx * TILE_SIZE, t.ty * TILE_SIZE];
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      const h = t.heightAt(ox - (a + 0.5) * 64, oz + (b + 0.5) * 64);
      heights.push(Number.isFinite(h) ? h : SEA_LEVEL);
    }
  }
  heights.sort((a, b) => a - b);
  return Math.max(heights[heights.length >> 1] ?? SEA_LEVEL + 2, SEA_LEVEL - 8);
}

function makeRenderer(width, height, alpha) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the client does no gamma handling
  if (alpha) renderer.setClearColor(0x000000, 0);
  return renderer;
}

// Draws twice (textures finish uploading in between) and checks the
// context: software GL in parallel browsers sometimes loses it, and the
// image is then blank without an error.
async function draw(renderer, scene, camera) {
  renderer.render(scene, camera);
  await new Promise((r) => setTimeout(r, 200));
  renderer.render(scene, camera);
  if (renderer.getContext().isContextLost()) throw new Error("WebGL context lost");
}

// Runs a job on `world` (a World); resolves to the renderer, whose canvas
// holds the picture. The caller disposes it.
export async function renderJob(world, job, { onStatus = () => {} } = {}) {
  const j = normalizeJob(job);
  const env = createEnvironment();
  const scene = new THREE.Scene();
  if (j.type === "topdown") {
    const renderer = makeRenderer(j.size, j.size, true);
    const tile = await world.loadTile(scene, j.tile, { env, onStatus, grass: false });
    env.fogDensity.value = 0;
    env.time.value = 0;
    const [tx, ty] = parseTileKey(j.tile);
    const [x0, x1, z0, z1] = areaBounds([tx, ty, tx, ty]);
    const half = TILE_SIZE / 2;
    const camera = new THREE.OrthographicCamera(-half, half, half, -half, 1, 4000);
    camera.position.set((x0 + x1) / 2, 1500, (z0 + z1) / 2);
    camera.up.set(0, 0, 1); // north up; east (−x) comes out on the right
    camera.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2);
    camera.updateMatrixWorld();
    await draw(renderer, scene, camera);
    tile.dispose();
    return renderer;
  }

  const renderer = makeRenderer(j.width, j.height, false);
  const inArea = ([tx, ty]) => tx >= j.area[0] && tx <= j.area[2] && ty >= j.area[1] && ty <= j.area[3];
  // The ring first, then the area: the last tile loaded sets the light,
  // ambient and fog colour.
  const keys = j.tiles.filter((k) => world.hasTile(k)).sort((a, b) => inArea(parseTileKey(a)) - inArea(parseTileKey(b)));
  const loaded = [];
  for (const key of keys) {
    try {
      loaded.push(await world.loadTile(scene, key, { env, onStatus, grass: false }));
    } catch (e) {
      if (inArea(parseTileKey(key))) throw e;
      console.warn(`ff-three: ring tile ${key}:`, e); // a missing neighbour is sea
    }
  }
  const areaTilesLoaded = loaded.filter((t) => inArea([t.tx, t.ty]));
  if (!areaTilesLoaded.length) throw new Error("none of the area's tiles loaded");
  const ground = groundLevel(areaTilesLoaded);
  const camera = new THREE.PerspectiveCamera(45, j.width / j.height, 1, 8000);
  frameArea(camera, j.area, ground, THREE.MathUtils.degToRad(j.pitch));
  // Fog: a third at the area's far edge, more over the ring behind it.
  const [x0, x1, , z1] = areaBounds(j.area);
  env.fogDensity.value = 0.65 / camera.position.distanceTo(new THREE.Vector3((x0 + x1) / 2, ground, z1));
  env.time.value = 0;
  // the sea beyond the tiles, unless the pack has only some (a missing tile may be land)
  if (!world.partial) scene.add(createSurroundings(loaded, env));
  const sky = await world.sky(j.sky, areaTilesLoaded[areaTilesLoaded.length - 1].settings);
  sky.position.copy(camera.position);
  sky.scale.setScalar(camera.far * 0.5);
  scene.add(sky);
  await draw(renderer, scene, camera);
  for (const t of loaded) t.dispose();
  return renderer;
}
