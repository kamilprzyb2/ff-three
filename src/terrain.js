// Terrain: UnityPackFF exports a TerrainData as a mesh (its heightmap with
// the shifts applied) whose material's extras.terrain keeps what the
// client's splat shaders need: each splat's glTF texture and tiling, the
// control maps (glTF textures, RGBA weights for four splats each), the
// lightmap, and the details (grass, see grass.js).
//
// Splats and control maps are decoded with png.js and uploaded as array
// textures: a control map's alpha is a weight, which a browser's image
// decoding may premultiply away.
import * as THREE from "three";
import { decodePng, resizeRgba } from "./png.js";
import { textureAt, textureBytes } from "./materials.js";
import { TERRAIN_VERTEX, terrainFragment } from "./shaders.js";

// The terrain's size along x and z (glTF's x being mirrored Unity x), read
// from the mesh: UnityPackFF sets each vertex's texture coordinates to its
// position over the size, (x, z) / size, with v flipped for glTF.
export function terrainSize(geometry) {
  const pos = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  let sx = 0, sz = 0, bu = 0, bv = 0;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = 1 - uv.getY(i);
    if (u > bu) { bu = u; sx = -pos.getX(i) / u; }
    if (v > bv) { bv = v; sz = pos.getZ(i) / v; }
  }
  return [sx, sz];
}

async function decodeTexture(parser, index) {
  if (index == null) return null;
  try {
    return await decodePng(await textureBytes(parser, index));
  } catch (e) {
    console.warn(`ff-three: terrain texture ${index}:`, e);
    return null;
  }
}

// Layers of one size as an array texture.
function arrayTexture(images, size) {
  const data = new Uint8Array(size * size * 4 * images.length);
  images.forEach((img, i) => data.set(img ? resizeRgba(img, size) : new Uint8Array(size * size * 4).fill(255), i * size * size * 4));
  return new THREE.DataArrayTexture(data, size, size, images.length);
}

// The terrain material for a terrain mesh's extras.terrain (`ex`).
// `splatSize`: the side every splat is resampled to (they share one array
// texture); the default is the largest splat's, at most 512.
export async function terrainMaterial(parser, ex, geometry, { env, splatSize = null } = {}) {
  const splatImages = await Promise.all(ex.splats.map((s) => decodeTexture(parser, s.texture)));
  const S = splatSize || Math.min(512, Math.max(1, ...splatImages.filter(Boolean).map((i) => Math.max(i.width, i.height))));
  const splats = arrayTexture(splatImages, S);
  splats.wrapS = splats.wrapT = THREE.RepeatWrapping;
  splats.generateMipmaps = true;
  splats.minFilter = THREE.LinearMipmapLinearFilter;
  splats.magFilter = THREE.LinearFilter;
  splats.anisotropy = 8;
  splats.needsUpdate = true;

  const controlImages = await Promise.all(ex.controls.map((c) => decodeTexture(parser, c)));
  const first = controlImages.find(Boolean);
  const C = first ? first.width : 1;
  // a missing control map weighs nothing (its splats don't show)
  const controls = arrayTexture(controlImages.map((c) => c || { width: 1, height: 1, data: new Uint8Array(4) }), C);
  controls.minFilter = controls.magFilter = THREE.LinearFilter;
  controls.needsUpdate = true;

  const lightmap = await textureAt(parser, ex.lightmap);
  const [sizeX, sizeZ] = terrainSize(geometry);
  const tiles = ex.splats.map((s) => {
    const [tx, ty] = s.tile_size || [1, 1], [ox, oy] = s.tile_offset || [0, 0];
    return new THREE.Vector4(sizeX / tx, sizeZ / ty, ox / tx, oy / ty);
  });
  const m = new THREE.ShaderMaterial({
    uniforms: {
      splats: { value: splats }, controls: { value: controls }, lightmap: { value: lightmap }, hasLightmap: { value: !!lightmap },
      tiles: { value: tiles.length ? tiles : [new THREE.Vector4()] }, lightmapScale: env.lightmapScale,
      useFog: { value: true }, fogColor: env.fogColor, fogDensity: env.fogDensity,
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: terrainFragment(ex.splats.length, Math.max(1, ex.controls.length)),
  });
  m.name = "ff:terrain";
  m.userData.ffOwned = [splats, controls];
  return m;
}

// Height lookups on a terrain mesh: (x, z) in the mesh's own space → y,
// from its grid (vertex z·W + x is heightmap vertex (x, z), x mirrored).
// The step comes from the size, not from vertex positions, which the shifts
// move sideways.
export function terrainHeights(geometry) {
  const pos = geometry.getAttribute("position");
  const W = Math.round(Math.sqrt(pos.count));
  const [sizeX, sizeZ] = terrainSize(geometry);
  const stepX = sizeX / (W - 1), stepZ = sizeZ / (W - 1);
  return (x, z) => {
    const gx = THREE.MathUtils.clamp(-x / stepX, 0, W - 1.001), gz = THREE.MathUtils.clamp(z / stepZ, 0, W - 1.001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const h = (a, b) => pos.getY(b * W + a);
    return (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz) + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz;
  };
}
