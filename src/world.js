// World tiles: the map scenes (Map_XX_YY) as UnityPackFF exports them, from
// a world directory laid out as docs/WORLD_INPUT.md describes:
//
//   <world>/manifest.json            optional: light, sky, tiles
//   <world>/tile/<XX_YY>.glb         one per scene, at its world position
//   <world>/shared/<hash>.png|.bin   images and mesh data the tiles share
//   <world>/sky/<set>/skybox_<side>tex.png
//
// Coordinates are the game's, mirrored along x as glTF is: tile (tx, ty)
// covers x ∈ [−512(tx+1), −512tx] and z ∈ [512ty, 512(ty+1)], so east is −x
// and north +z.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createEnvironment, applySceneSettings, fogColorOf } from "./environment.js";
import { dress } from "./materials.js";
import { terrainMaterial, terrainHeights } from "./terrain.js";
import { grassFor } from "./grass.js";
import { playAnimations } from "./animation.js";
import { createSky } from "./sky.js";
import { TILE_SIZE, tileKey, parseTileKey } from "./jobs.js";

export { TILE_SIZE, tileKey, parseTileKey };

// Sea level, where the world beyond the loaded tiles is drawn (the client's
// water planes lie between −120 and −55 m; most at about −58).
export const SEA_LEVEL = -62;

// The corner of tile (tx, ty) nearest the world origin, in glTF space; the
// tile spans x ∈ [ox − 512, ox], z ∈ [oz, oz + 512].
export const tileOrigin = (tx, ty) => [-tx * TILE_SIZE, ty * TILE_SIZE];

// Fetches files a few at a time, each once. A tile points at dozens to
// hundreds of shared files: left to GLTFLoader, all are requested at once
// and browsers refuse some (ERR_INSUFFICIENT_RESOURCES). `fetchBytes(url)`
// can replace the network (the demo page serves dropped files with it).
export function createFiles({ concurrency = 8, fetchBytes = null } = {}) {
  const fetched = new Map();
  const waiting = [];
  let active = 0;
  const get = fetchBytes || (async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  function pump() {
    while (active < concurrency && waiting.length) {
      const { url, resolve, reject, tries } = waiting.shift();
      active++;
      Promise.resolve().then(() => get(url))
        .then(resolve, (e) => (tries < 2 ? waiting.push({ url, resolve, reject, tries: tries + 1 }) : reject(e)))
        .finally(() => { active--; pump(); });
    }
  }
  return {
    get(url) {
      if (!fetched.has(url)) fetched.set(url, new Promise((resolve, reject) => { waiting.push({ url, resolve, reject, tries: 0 }); pump(); }));
      return fetched.get(url);
    },
    forget() { fetched.clear(); },
  };
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

// Loads a GLB with its external files through `files`; resolves to
// { gltf, release } (release() frees the blob URLs, once nothing reads
// them any more).
export async function loadGlb(url, files) {
  const href = new URL(url, globalThis.location ? location.href : undefined).href;
  const data = await files.get(href);
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${url}: not a GLB file`);
  const n = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, n)));
  const uris = [...(json.buffers || []), ...(json.images || [])].map((x) => x.uri).filter((u) => u && !u.startsWith("data:")).map((u) => new URL(u, href).href);
  const unique = [...new Set(uris)];
  const contents = await Promise.all(unique.map((u) => files.get(u)));
  const blobs = new Map(unique.map((u, i) => [u, URL.createObjectURL(new Blob([contents[i]], { type: MIME[u.split(".").pop().toLowerCase()] || "application/octet-stream" }))]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => blobs.get(new URL(u, href).href) || u);
  const release = () => { for (const b of blobs.values()) URL.revokeObjectURL(b); };
  try {
    const gltf = await new GLTFLoader(manager).parseAsync(data, href.slice(0, href.lastIndexOf("/") + 1));
    return { gltf, release };
  } catch (e) {
    release();
    throw e;
  }
}

// Dresses a loaded tile (or any scene UnityPackFF exported whole): the
// client's materials, terrain, grass, animated props. Returns
// { root, settings, terrain, heightAt(x, z), animations, dressing, dispose() }.
// `settings` is the scene's extras (render_settings, colors); heightAt is in
// world space, −Infinity off the terrain.
export async function setUpScene(gltf, { env, grass = true, grassDistance = 80, animate = true } = {}) {
  const root = gltf.scene;
  const parser = gltf.parser;
  const settings = (parser.json.scenes[parser.json.scene || 0] || {}).extras || {};
  const dressing = await dress(root, parser, { env });
  const owned = [];
  let terrain = null;
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.material && o.material.userData && o.material.userData.terrain) meshes.push(o); });
  for (const mesh of meshes) {
    const ex = mesh.material.userData.terrain;
    const src = mesh.material;
    mesh.material = await terrainMaterial(parser, ex, mesh.geometry, { env });
    owned.push(mesh.material, ...mesh.material.userData.ffOwned);
    src.dispose();
    mesh.userData.terrain = true;
    if (grass) {
      const g = await grassFor(parser, ex, mesh, { env, distance: grassDistance });
      if (g) {
        mesh.add(g);
        g.traverse((o) => { if (o.isMesh) owned.push(o.material, o.geometry); });
      }
    }
    terrain = terrain || mesh;
  }
  root.updateMatrixWorld(true);
  let heightAt = () => -Infinity;
  if (terrain) {
    const local = terrainHeights(terrain.geometry);
    const box = new THREE.Box3().setFromObject(terrain);
    const v = new THREE.Vector3();
    heightAt = (x, z) => {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) return -Infinity;
      terrain.worldToLocal(v.set(x, 0, z));
      const y = local(v.x, v.z);
      return terrain.localToWorld(v.set(v.x, y, v.z)).y;
    };
  }
  const animations = animate ? await playAnimations(gltf, dressing) : null;
  return {
    root, settings, terrain, heightAt, animations, dressing,
    dispose() {
      if (animations) animations.stop();
      dressing.dispose();
      for (const o of owned) o.dispose();
      root.traverse((o) => { if (o.geometry && !o.geometry.isInstancedBufferGeometry) o.geometry.dispose(); });
    },
  };
}

// A world directory (URL, ending in "/" or not). World.open() reads its
// manifest if it has one.
export class World {
  constructor(base, { manifest = null, files = createFiles() } = {}) {
    this.base = base.endsWith("/") ? base : base + "/";
    this.manifest = manifest;
    this.files = files;
  }

  static async open(base, options = {}) {
    const world = new World(base, options);
    try {
      const r = await fetch(world.base + "manifest.json");
      if (r.ok) world.manifest = await r.json();
    } catch {
      // no manifest: defaults
    }
    return world;
  }

  tileUrl(key) { return `${this.base}tile/${key}.glb`; }
  skyDir(set) { return `${this.base}sky/${set}`; }
  get light() { return (this.manifest && this.manifest.light) || null; }
  get fusionRects() { return (this.manifest && this.manifest.sky && this.manifest.sky.fusion_rects) || []; }
  hasTile(key) {
    const tiles = this.manifest && this.manifest.tiles;
    if (!tiles) return true;
    return Array.isArray(tiles) ? tiles.includes(key) : key in tiles;
  }

  // Loads tile `key` into `scene` and sets the environment from it (the
  // last tile loaded sets the light, ambient and fog). Returns setUpScene()'s
  // result plus { key, tx, ty }.
  async loadTile(scene, key, { env, onStatus = () => {}, ...options } = {}) {
    onStatus(`Loading tile ${key}…`);
    const { gltf, release } = await loadGlb(this.tileUrl(key), this.files);
    try {
      onStatus(`Preparing tile ${key}…`);
      const tile = await setUpScene(gltf, { env, ...options });
      applySceneSettings(env, tile.settings, this.light);
      scene.add(tile.root);
      const [tx, ty] = parseTileKey(key);
      return { ...tile, key, tx, ty };
    } finally {
      release();
    }
  }

  // The skybox for a sky set ("normal" or "fusion") tinted with the fog
  // colour of `settings` (a tile's scene extras).
  sky(set, settings) {
    return createSky(this.skyDir(set), fogColorOf(settings && settings.colors), { load: (url) => this.texture(url) });
  }

  // An image of the world directory as a texture, fetched through `files`.
  async texture(url) {
    const bytes = await this.files.get(new URL(url, globalThis.location ? location.href : undefined).href);
    const blob = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try {
      return await new THREE.TextureLoader().loadAsync(blob);
    } finally {
      URL.revokeObjectURL(blob);
    }
  }
}

// Beyond the loaded tiles the world is open sea: a plane at sea level,
// fogged like the rest, out to the horizon, so no tile edge hangs over the
// sky. Its colour is the client's water as it renders from above at an
// angle (ffWater's horizon colour, a little darker); it leaves out the
// loaded tiles, whose ground can lie below it (the Darklands' goo at
// −120 m). Skirts in the same colour hang from every outer tile edge, up to
// at least sea level, so seen from outside an edge meets the sea instead of
// showing the sky under the terrain. `tiles`: [{ tx, ty, heightAt }].
// Returns the group (add it to the scene; dispose its geometry and
// materials when done).
export function createSurroundings(tiles, env, { sea = SEA_LEVEL, color = [0.175, 0.435, 0.41] } = {}) {
  const group = new THREE.Group();
  group.name = "surroundings";
  const placed = tiles.map((t) => ({ ...t, origin: tileOrigin(t.tx, t.ty) }));
  const holes = placed.map(({ origin: [ox, oz] }) => new THREE.Vector4(ox - TILE_SIZE, ox, oz, oz + TILE_SIZE));
  const seaMaterial = (cut, n = Math.max(cut.length, 1)) => new THREE.ShaderMaterial({
    uniforms: {
      fogColor: env.fogColor, fogDensity: env.fogDensity, color: { value: new THREE.Color(...color) },
      holes: { value: cut.length ? cut : [new THREE.Vector4()] }, n: { value: cut.length },
    },
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vView; varying vec3 vWorld;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vec4 mv = viewMatrix * wp; vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 fogColor; uniform float fogDensity; uniform vec3 color; uniform vec4 holes[${n}]; uniform int n;
      varying vec3 vView; varying vec3 vWorld;
      void main() {
        for (int i = 0; i < ${n}; i++) {
          vec4 r = holes[i];
          if (i < n && vWorld.x > r.x && vWorld.x < r.y && vWorld.z > r.z && vWorld.z < r.w) discard;
        }
        float fd = length(vView) * fogDensity;
        gl_FragColor = vec4(mix(fogColor, color, clamp(exp(-fd * fd), 0.0, 1.0)), 1.0);
      }`,
  });
  const cx = placed.reduce((s, t) => s + t.origin[0] - TILE_SIZE / 2, 0) / Math.max(placed.length, 1);
  const cz = placed.reduce((s, t) => s + t.origin[1] + TILE_SIZE / 2, 0) / Math.max(placed.length, 1);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), seaMaterial(holes));
  plane.position.set(cx, sea, cz);
  plane.renderOrder = -1;
  group.add(plane);
  const have = new Set(placed.map((t) => `${t.tx},${t.ty}`));
  const pos = [];
  const wall = (h, x0, z0, x1, z1) => {
    for (let i = 0; i < 64; i++) {
      const a = i / 64, b = (i + 1) / 64;
      const xa = x0 + (x1 - x0) * a, za = z0 + (z1 - z0) * a, xb = x0 + (x1 - x0) * b, zb = z0 + (z1 - z0) * b;
      const ya = Math.max(h(xa, za), sea), yb = Math.max(h(xb, zb), sea), lo = -400;
      pos.push(xa, ya, za, xb, yb, zb, xb, lo, zb, xa, ya, za, xb, lo, zb, xa, lo, za);
    }
  };
  const S = TILE_SIZE;
  for (const { tx, ty, heightAt: h, origin: [ox, oz] } of placed) {
    if (!have.has(`${tx},${ty - 1}`)) wall(h, ox, oz + 0.5, ox - S, oz + 0.5);
    if (!have.has(`${tx},${ty + 1}`)) wall(h, ox, oz + S - 0.5, ox - S, oz + S - 0.5);
    if (!have.has(`${tx - 1},${ty}`)) wall(h, ox - 0.5, oz, ox - 0.5, oz + S);
    if (!have.has(`${tx + 1},${ty}`)) wall(h, ox - S + 0.5, oz, ox - S + 0.5, oz + S);
  }
  if (pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    group.add(new THREE.Mesh(geo, seaMaterial([])));
  }
  return group;
}

export { createEnvironment };
