// The area viewer: an area's tiles from a world directory, drawn with the
// client's shaders, the sea and the skybox around them, explorable with
// the mouse or by touch. Grass shows near the camera, props animate.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createEnvironment, fogDensityOf } from "./environment.js";
import { World, createSurroundings, SEA_LEVEL } from "./world.js";
import { areaBounds, areaTiles } from "./jobs.js";
import { frameArea, groundLevel } from "./render.js";
import { skySetAt } from "./sky.js";

// Mounts the viewer in `stage` and resolves to { dispose }. `world`: a
// World or its URL. `spec`: { area: [tx0, ty0, tx1, ty1], tiles (default:
// the area's), sky ("normal" | "fusion"; default: from the manifest's
// fusion rects) }. Options: controls (an element for the buttons), pitch
// (degrees, default 26), onStatus(text).
export async function mountArea(stage, world, spec, { controls = null, pitch = 26, onStatus = () => {} } = {}) {
  if (typeof world === "string") world = await World.open(world);
  const area = spec.area;
  const [x0, x1, z0, z1] = areaBounds(area);
  const keys = (spec.tiles || areaTiles(area)).filter((k) => world.hasTile(k));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the client does no gamma handling
  const scene = new THREE.Scene();
  const env = createEnvironment();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 9000);
  let disposed = false;

  const tiles = [];
  for (const [i, key] of keys.entries()) {
    onStatus(`Loading tile ${i + 1} of ${keys.length}…`);
    try {
      tiles.push(await world.loadTile(scene, key, { env }));
    } catch (e) {
      console.warn(`ff-three: tile ${key}:`, e);
    }
    if (disposed) break;
  }
  if (disposed || !tiles.length) {
    for (const t of tiles) t.dispose();
    world.files.forget();
    if (!disposed) throw new Error("no tile of the area loaded");
    return { dispose() {} };
  }
  const surroundings = createSurroundings(tiles, env);
  scene.add(surroundings);
  const settings = tiles[tiles.length - 1].settings;
  const skySet = spec.sky || skySetAt((x0 + x1) / 2, (z0 + z1) / 2, world.fusionRects);
  let sky = null;
  try {
    sky = await world.sky(skySet, settings);
    scene.add(sky);
  } catch (e) {
    console.warn("ff-three: sky:", e);
  }
  const inArea = tiles.filter((t) => t.tx >= area[0] && t.tx <= area[2] && t.ty >= area[1] && t.ty <= area[3]);
  const ground = groundLevel(inArea.length ? inArea : tiles);
  // Ground under a point: a tile's, or the sea.
  const groundAt = (x, z) => {
    for (const t of tiles) {
      const h = t.heightAt(x, z);
      if (Number.isFinite(h)) return Math.max(h, SEA_LEVEL);
    }
    return SEA_LEVEL;
  };

  stage.replaceChildren(renderer.domElement);
  const size = () => {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();
  const resize = new ResizeObserver(size);
  resize.observe(stage);

  // Start where the area's picture is taken from: the south, at `pitch`,
  // backed off until the whole area fits.
  const orbit = new OrbitControls(camera, renderer.domElement);
  Object.assign(orbit, { enableDamping: true, dampingFactor: 0.1, screenSpacePanning: false, maxPolarAngle: Math.PI * 0.48, minDistance: 15 });
  const home = () => {
    const r = frameArea(camera, area, ground, THREE.MathUtils.degToRad(pitch));
    orbit.target.set((x0 + x1) / 2, ground, (z0 + z1) / 2);
    orbit.maxDistance = r * 2.5;
    orbit.update();
    return camera.position.distanceTo(new THREE.Vector3((x0 + x1) / 2, ground, z1));
  };
  const farDist = home();

  // Fog: the pictures' (a third at the area's far edge) or the game's own,
  // which hides everything past a few hundred metres.
  const clearFog = 0.65 / farDist, gameFog = fogDensityOf(settings.colors);
  let useGameFog = false;
  const setFog = () => { env.fogDensity.value = useGameFog ? gameFog : clearFog; };
  setFog();

  if (controls) {
    const row = document.createElement("div");
    row.className = "ff-row";
    const button = (label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ff-button";
      b.textContent = label;
      b.addEventListener("click", () => onClick(b));
      row.appendChild(b);
      return b;
    };
    button("Reset view", () => home());
    button("From above", () => {
      orbit.target.set((x0 + x1) / 2, ground, (z0 + z1) / 2);
      camera.position.set((x0 + x1) / 2 + 0.01, ground + Math.max(x1 - x0, z1 - z0) * 1.3, (z0 + z1) / 2);
      orbit.update();
    });
    const fog = button("Game fog", (b) => { useGameFog = !useGameFog; b.setAttribute("aria-pressed", String(useGameFog)); setFog(); });
    fog.setAttribute("aria-pressed", "false");
    fog.title = "The fog as the game draws it: it hides everything past a few hundred metres";
    controls.appendChild(row);
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  let frame = 0;
  const tick = (t) => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.1);
    env.time.value += dt;
    for (const tile of tiles) if (tile.animations) tile.animations.update(dt);
    orbit.update();
    // keep the pivot on the area and the camera above the ground
    orbit.target.x = THREE.MathUtils.clamp(orbit.target.x, x0 - 256, x1 + 256);
    orbit.target.z = THREE.MathUtils.clamp(orbit.target.z, z0 - 256, z1 + 256);
    orbit.target.y += (groundAt(orbit.target.x, orbit.target.z) - orbit.target.y) * 0.15;
    const floor = groundAt(camera.position.x, camera.position.z) + 2;
    if (camera.position.y < floor) camera.position.y = floor;
    if (sky) {
      sky.position.copy(camera.position);
      sky.scale.setScalar(camera.far * 0.5);
    }
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  return {
    scene, camera, env, tiles, controls: orbit,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      timer.dispose();
      resize.disconnect();
      orbit.dispose();
      for (const t of tiles) t.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        for (const m of [].concat(o.material || [])) m.dispose();
      });
      if (sky) for (const m of sky.material) m.uniforms.map.value.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      world.files.forget();
    },
  };
}
