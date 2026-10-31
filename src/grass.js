// Grass: a terrain's detail prototypes (all billboard textures in the three
// builds) scattered over it from their densities.
//
// UnityPackFF exports each prototype's density as a texture laid over the
// terrain like the control maps, each pixel the number of instances in that
// cell. Unity scatters them at random when it draws them, so this does too,
// from a fixed seed (the same tile always gets the same grass). Like Unity,
// only grass near the camera is drawn (`distance`, Unity's default
// detailObjectDistance of 80 m): an area seen from above or afar has none.
import * as THREE from "three";
import { decodePng } from "./png.js";
import { textureAt, textureBytes } from "./materials.js";
import { GRASS_VERTEX, GRASS_FRAGMENT } from "./shaders.js";
import { terrainSize, terrainHeights } from "./terrain.js";

// mulberry32
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Instances for one prototype: base positions in the terrain mesh's space
// and (width, height, dryness, phase), from its density (RGBA bytes of a
// res × res image, top row first, count in red) over a terrain of
// sizeX × sizeZ with heights from heightAt(x, z).
export function scatter(density, prototype, [sizeX, sizeZ], heightAt, seed = 1) {
  const { width: res, data } = density;
  const rnd = random(seed);
  const offsets = [], grass = [];
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const n = data[(row * res + col) * 4];
      for (let k = 0; k < n; k++) {
        // the image is upright: its top row is the terrain's far (+z) edge
        const px = ((col + rnd()) / res) * sizeX, pz = (1 - (row + rnd()) / res) * sizeZ;
        const x = -px, z = pz; // glTF: x mirrored
        const t = rnd();
        offsets.push(x, heightAt(x, z), z);
        grass.push(
          prototype.min_width + (prototype.max_width - prototype.min_width) * t,
          prototype.min_height + (prototype.max_height - prototype.min_height) * t,
          rnd() * Math.min(1, prototype.noise_spread * 10),
          rnd() * Math.PI * 2,
        );
      }
    }
  }
  return { offsets: new Float32Array(offsets), grass: new Float32Array(grass) };
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

const quad = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); // glTF images: v = 0 at the top
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();

// A group of grass meshes for a terrain mesh whose material extras.terrain
// has `details`; add it to the terrain mesh. Null if there's no grass.
export async function grassFor(parser, ex, terrainMesh, { env, distance = 80, seed = 1 } = {}) {
  const details = ex.details;
  if (!details || !details.prototypes || !details.prototypes.length) return null;
  const size = terrainSize(terrainMesh.geometry);
  const heightAt = terrainHeights(terrainMesh.geometry);
  const lightmap = await textureAt(parser, ex.lightmap);
  const group = new THREE.Group();
  group.name = "grass";
  const w = details.waving_grass || { strength: 0.5, amount: 0.5, speed: 0.5 };
  for (const [i, p] of details.prototypes.entries()) {
    if (p.density == null || p.texture == null || p.use_mesh) continue;
    let density;
    try {
      density = await decodePng(await textureBytes(parser, p.density));
    } catch (e) {
      console.warn("ff-three: grass density:", e);
      continue;
    }
    const { offsets, grass } = scatter(density, p, size, heightAt, seed + i * 7919);
    const count = offsets.length / 3;
    if (!count) continue;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    geometry.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute("grass", new THREE.InstancedBufferAttribute(grass, 4));
    geometry.instanceCount = count;
    const map = await textureAt(parser, p.texture);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map }, time: env.time, distance: { value: distance },
        wave: { value: new THREE.Vector4(w.strength, w.amount, w.speed, 0) },
        healthy: { value: new THREE.Color().fromArray(p.healthy_color) }, dry: { value: new THREE.Color().fromArray(p.dry_color) },
        lightmap: { value: lightmap || WHITE }, lightmapFactor: { value: lightmap ? p.lightmap_factor : 0 },
        tint: { value: new THREE.Color().fromArray(w.tint || [0.7, 0.6, 0.5]) },
        terrainSize: { value: new THREE.Vector2(...size) },
        useFog: { value: true }, fogColor: env.fogColor, fogDensity: env.fogDensity,
      },
      vertexShader: GRASS_VERTEX, fragmentShader: GRASS_FRAGMENT,
      side: THREE.DoubleSide,
    });
    material.name = "ff:grass";
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.userData.ffSkip = true;
    mesh.renderOrder = -1; // queue Transparent−101: before the props
    group.add(mesh);
  }
  return group.children.length ? group : null;
}
