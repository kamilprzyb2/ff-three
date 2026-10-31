// FusionFall's materials for the glTF files UnityPackFF writes.
//
// UnityPackFF keeps each Unity material whole in the glTF material's
// extras: the shader's name, `colors`, `floats` and `textures` (each with
// its glTF texture index, _MainTex aside, which is the base colour
// texture). GLTFLoader puts those extras in material.userData. dress()
// swaps every material it knows by that shader name for one that draws
// like the client (shader-name.js picks the family, shaders.js has the
// GLSL); terrain is terrain.js's.
import * as THREE from "three";
import { LoaderUtils } from "three";
import { classifyShader } from "./shader-name.js";
import {
  NORMAL_VERTEX, NORMAL_FRAGMENT, CHARACTER_VERTEX, TOON_FRAGMENT, LIT_FRAGMENT, OUTLINE_FRAGMENT,
  FUSION_VERTEX, FUSION_FRAGMENT, WATER_VERTEX, WATER_FRAGMENT,
} from "./shaders.js";

// A texture used as stored: no sRGB decoding, as the client.
export function raw(texture) {
  if (texture) {
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
  }
  return texture || null;
}

const WHITE = [1, 1, 1, 1];
const BLACK = [0, 0, 0, 0];
const vec4 = (a, fallback) => new THREE.Vector4().fromArray(a || fallback);

// A colour property of a Unity material (extras.colors), as RGBA.
export const colorOf = (ex, name, fallback = WHITE) => (ex && ex.colors && ex.colors[name]) || fallback;
// A float property (extras.floats).
export const floatOf = (ex, name, fallback = 0) => {
  const v = ex && ex.floats && ex.floats[name];
  return typeof v === "number" ? v : fallback;
};
// The glTF texture index of a texture property (extras.textures), or null.
export const textureIndexOf = (ex, name) => {
  const t = ex && ex.textures && ex.textures[name];
  return t && typeof t.index === "number" ? t.index : null;
};
// _MainTex's scale and offset as (sx, sy, ox, oy).
export function mainTextureST(ex) {
  const t = ex && ex.textures && ex.textures._MainTex;
  return t ? [...(t.scale || [1, 1]), ...(t.offset || [0, 0])] : [1, 1, 0, 0];
}

// The glTF texture with this index, loaded through the parser, as stored.
export async function textureAt(parser, index) {
  if (index == null) return null;
  try {
    return raw(await parser.getDependency("texture", index));
  } catch (e) {
    console.warn(`ff-three: texture ${index}:`, e);
    return null;
  }
}

// The bytes of the glTF image with this index: from the binary chunk or
// fetched from its URI (through the loader's URL modifier, if it has one).
export async function imageBytes(parser, imageIndex) {
  const def = parser.json.images[imageIndex];
  if (def.bufferView !== undefined) return new Uint8Array(await parser.getDependency("bufferView", def.bufferView));
  let url = LoaderUtils.resolveURL(def.uri, parser.options.path);
  if (parser.options.manager) url = parser.options.manager.resolveURL(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${def.uri}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// The bytes of the image behind a glTF texture index.
export function textureBytes(parser, textureIndex) {
  return imageBytes(parser, parser.json.textures[textureIndex].source);
}

const BLEND = {
  opaque: {},
  alpha: { blending: THREE.NormalBlending },
  add: { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor },
  srcalpha_one: { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor },
  srcalpha_invsrccolor: { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcColorFactor },
};

// The blend of a material whose shader ff-three doesn't know, from glTF's alphaMode.
function unknownBlend(def) {
  return def && def.alphaMode === "BLEND" ? "alpha" : "opaque";
}

// A normal_* material: `pass` is "opaque" (the alpha-tested pass of a
// two-pass Test variant, with depth) or "blend" (everything else; a
// one-pass Test variant tests alpha > _Cutoff). `vertexColors`: the
// mesh has COLOR_0 (vertexColorAD shaders use it; without it they fall
// back to the material's colours).
export function normalMaterial({ map, extras, info, pass = "blend", vertexColors = false, env }) {
  const blend = pass === "opaque" ? "opaque" : info.blend;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: raw(map) }, hasMap: { value: !!map },
      matColor: { value: vec4(colorOf(extras, "_Color")) }, matAmb: { value: vec4(colorOf(extras, "_AmbColor")) },
      matEmission: { value: vec4(colorOf(extras, "_Emission", BLACK)) }, uvST: { value: vec4(mainTextureST(extras)) },
      alphaTest: { value: pass === "opaque" ? 0.9 : info.test && !info.twoPass ? floatOf(extras, "_Cutoff") + 1 / 512 : 0.0 },
      alphaPrimary: { value: info.alphaPrimary },
      useFog: { value: info.fog }, lightDir: env.lightDir, lightColor: env.lightColor, ambient: env.ambient,
      fogColor: env.fogColor, fogDensity: env.fogDensity,
    },
    defines: vertexColors && info.vertexColor ? { FF_VERTEX_COLOR: "" } : {},
    vertexShader: NORMAL_VERTEX, fragmentShader: NORMAL_FRAGMENT,
    side: info.cull ? THREE.FrontSide : THREE.DoubleSide,
    transparent: blend !== "opaque",
    // the blended pass of a Test variant draws without depth writes
    depthWrite: pass === "opaque" ? true : info.twoPass ? false : info.zwrite,
    ...BLEND[blend],
  });
  m.name = "ff:" + (extras.shader || "unknown");
  return m;
}

// The base pass of (Skinned)ToonShading.
export function toonMaterial({ map, ramp, extras, info, env }) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: raw(map) }, hasMap: { value: !!map }, ramp: { value: ramp }, hasRamp: { value: !!ramp },
      color: { value: vec4(colorOf(extras, "_Color")) }, push: { value: floatOf(extras, "_FatFactor") },
      lightDir: env.lightDir,
    },
    vertexShader: CHARACTER_VERTEX, fragmentShader: TOON_FRAGMENT,
    side: info.cull ? THREE.FrontSide : THREE.DoubleSide,
    transparent: true,
  });
  m.name = "ff:" + extras.shader;
  return m;
}

// The outline pass: the mesh pushed out along its normals by _Outline +
// _FatFactor, front faces culled, in _OutlineColor.
export function outlineMaterial({ extras }) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: vec4(colorOf(extras, "_OutlineColor", [0, 0, 0, 1])) },
      push: { value: floatOf(extras, "_Outline") + floatOf(extras, "_FatFactor") },
      lightDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: CHARACTER_VERTEX, fragmentShader: OUTLINE_FRAGMENT,
    side: THREE.BackSide,
  });
  m.name = "ff:outline";
  return m;
}

export function litMaterial({ map, extras, info, env }) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: raw(map) }, hasMap: { value: !!map },
      color: { value: vec4(colorOf(extras, "_Color")) },
      emission: { value: new THREE.Vector3().fromArray(colorOf(extras, "_Emission", BLACK)) },
      push: { value: 0 }, lightDir: env.lightDir,
    },
    vertexShader: CHARACTER_VERTEX, fragmentShader: LIT_FRAGMENT,
    side: info.cull ? THREE.FrontSide : THREE.DoubleSide,
    transparent: true,
    depthWrite: info.zwrite,
    ...BLEND[info.blend === "opaque" ? "alpha" : info.blend],
    // the decal sits on the face it covers
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  m.name = "ff:" + extras.shader;
  return m;
}

export function fusionMaterial({ map, bubbles, glow, extras, env }) {
  for (const t of [map, bubbles, glow]) if (t) { raw(t); t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, bubbles: { value: bubbles }, glow: { value: glow },
      color: { value: vec4(colorOf(extras, "_Color")) }, emission: { value: vec4(colorOf(extras, "_Emission", BLACK)) },
      speed: { value: floatOf(extras, "_Speed", 7) }, time: env.time, lightDir: env.lightDir,
    },
    vertexShader: FUSION_VERTEX, fragmentShader: FUSION_FRAGMENT,
    transparent: true,
  });
  m.name = "ff:" + extras.shader;
  return m;
}

export function waterMaterial({ bump, reflective, extras, env }) {
  if (bump) bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  if (reflective) reflective.wrapS = reflective.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      bump: { value: raw(bump) }, hasBump: { value: !!bump }, reflective: { value: raw(reflective) }, hasReflective: { value: !!reflective },
      horizon: { value: vec4(colorOf(extras, "_HorizonColor", [0.172, 0.463, 0.435, 1])) },
      foam: { value: vec4(colorOf(extras, "_FoamColor", BLACK)) },
      waveSpeed: { value: vec4(colorOf(extras, "WaveSpeed", [19, 9, -16, -7])) },
      waveScale: { value: floatOf(extras, "_WaveScale", 0.063) },
      time: env.time, useFog: { value: true }, fogColor: env.fogColor, fogDensity: env.fogDensity,
    },
    vertexShader: WATER_VERTEX, fragmentShader: WATER_FRAGMENT,
    transparent: true, side: THREE.DoubleSide,
  });
  m.name = "ff:" + extras.shader;
  return m;
}

// Swaps the materials of every mesh under `root` (a glTF scene GLTFLoader
// loaded with `parser`) for FusionFall's. Returns a Dressing:
//   meshes      every mesh it dressed, with mesh.userData.ffInfo (the
//               shader-name info) and ffExtras
//   unique(mesh) gives the mesh materials of its own (for material
//               animation, which Unity applies per renderer) and returns them
//   dispose()   frees the materials it made
// Options: `env` (environment.js; required), `outlines` (default true: the
// toon shaders' outline pass), `onUnknown(mesh, extras)`.
export async function dress(root, parser, { env, outlines = true, onUnknown = null } = {}) {
  const made = new Set();
  const cache = new Map(); // shared materials, by source material, pass and vertex colours
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.ffSkip) meshes.push(o); });

  // What a material needs beyond its map, loaded once per source material.
  const extraTextures = new Map();
  const texturesFor = (src, extras, info) => {
    if (!extraTextures.has(src)) {
      const load = async () => {
        if (info.family === "toon") {
          const ramp = await textureAt(parser, textureIndexOf(extras, "_ShaderMap"));
          if (ramp) {
            ramp.generateMipmaps = false;
            ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
            ramp.wrapS = ramp.wrapT = THREE.ClampToEdgeWrapping;
            ramp.needsUpdate = true;
          }
          return { ramp };
        }
        if (info.family === "fusion") {
          return {
            bubbles: await textureAt(parser, textureIndexOf(extras, "_BumpMap")),
            glow: await textureAt(parser, textureIndexOf(extras, "_ShaderMap")),
          };
        }
        if (info.family === "water") {
          return {
            bump: await textureAt(parser, textureIndexOf(extras, "_BumpMap")),
            reflective: await textureAt(parser, textureIndexOf(extras, "_ReflectiveColor")),
          };
        }
        return {};
      };
      extraTextures.set(src, load());
    }
    return extraTextures.get(src);
  };

  async function build(src, extras, info, pass, vertexColors) {
    // An additive material's base colour texture is a copy with its
    // brightness as alpha, for glTF viewers; the texture itself is
    // extras.main_texture_index.
    const map = extras.main_texture_index != null ? await textureAt(parser, extras.main_texture_index) : src.map || null;
    switch (info.family) {
      case "toon": return toonMaterial({ map, ...(await texturesFor(src, extras, info)), extras, info, env });
      case "lit": return litMaterial({ map, extras, info, env });
      case "fusion": return fusionMaterial({ map, ...(await texturesFor(src, extras, info)), extras, env });
      case "water": return waterMaterial({ ...(await texturesFor(src, extras, info)), extras, env });
      default: return normalMaterial({ map, extras, info, pass, vertexColors, env });
    }
  }

  async function material(src, extras, info, pass, vertexColors, shared = true) {
    const key = `${src.uuid}:${pass}:${vertexColors}`;
    if (shared && cache.has(key)) return cache.get(key);
    const p = build(src, extras, info, pass, vertexColors).then((m) => { made.add(m); return m; });
    if (shared) cache.set(key, p);
    return p;
  }

  // The material(s) a mesh is drawn with: [main] or, for a Test variant,
  // [alpha-tested pass, blended pass]; the toon shaders add the outline.
  async function materialsFor(mesh, shared) {
    const { ffSource: src, ffExtras: extras, ffInfo: info } = mesh.userData;
    const vertexColors = !!mesh.geometry.getAttribute("color");
    if (info.family === "normal" || info.family === "unknown") {
      if (info.twoPass) return [await material(src, extras, info, "opaque", vertexColors, shared), await material(src, extras, info, "blend", vertexColors, shared)];
    }
    return [await material(src, extras, info, "blend", vertexColors, shared)];
  }

  function attach(mesh, [main, second]) {
    mesh.material = main;
    if (second) {
      // AlphaTest GEqual 0.9 with depth, then the rest blended without.
      const pass = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, second) : new THREE.Mesh(mesh.geometry, second);
      if (mesh.isSkinnedMesh) { pass.bindMode = mesh.bindMode; pass.bind(mesh.skeleton, mesh.bindMatrix); }
      pass.renderOrder = 1;
      pass.raycast = () => {};
      pass.userData.ffSkip = true;
      pass.frustumCulled = mesh.frustumCulled;
      mesh.add(pass);
      mesh.userData.ffSecond = pass;
    }
  }

  const dressed = [];
  for (const mesh of meshes) {
    const src = mesh.material;
    const extras = (src && src.userData) || {};
    if (Array.isArray(src) || extras.terrain) continue;
    const info = classifyShader(extras.shader);
    if (info.family === "unknown") {
      if (onUnknown) onUnknown(mesh, extras);
      info.blend = unknownBlend(parser.json.materials && parser.associations.get(src) ? parser.json.materials[parser.associations.get(src).materials] : null);
      info.fog = true;
    }
    mesh.userData.ffSource = src;
    mesh.userData.ffExtras = extras;
    mesh.userData.ffInfo = info;
    attach(mesh, await materialsFor(mesh, true));
    if (info.family === "toon") {
      // Fusions draw before the toon parts (queue Transparent−100), decals after.
      mesh.renderOrder = 0;
      if (outlines && floatOf(extras, "_Outline") > 0) {
        const m = outlineMaterial({ extras });
        made.add(m);
        const hull = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, m) : new THREE.Mesh(mesh.geometry, m);
        if (mesh.isSkinnedMesh) { hull.bindMode = mesh.bindMode; hull.bind(mesh.skeleton, mesh.bindMatrix); }
        hull.frustumCulled = mesh.frustumCulled;
        hull.raycast = () => {};
        hull.userData.ffSkip = true;
        mesh.add(hull);
      }
    } else if (info.family === "fusion") {
      mesh.renderOrder = -1;
    } else if (info.family === "lit") {
      mesh.renderOrder = 1;
    } else if (info.family === "water") {
      mesh.userData.water = true;
    }
    dressed.push(mesh);
  }
  const sources = new Set(dressed.map((m) => m.userData.ffSource));
  for (const s of sources) s.dispose();

  return {
    meshes: dressed,
    async unique(mesh) {
      if (mesh.userData.ffUnique) return mesh.userData.ffUnique;
      const mats = await materialsFor(mesh, false);
      mesh.material = mats[0];
      if (mats[1] && mesh.userData.ffSecond) mesh.userData.ffSecond.material = mats[1];
      mesh.userData.ffUnique = mats;
      return mats;
    },
    dispose() {
      for (const m of made) m.dispose();
      made.clear();
    },
  };
}
