// GLSL for FusionFall's shaders, written from what the client's shaders
// do (docs/SHADERS.md). Vertex shaders that can draw skinned meshes use
// three.js's skinning chunks: three switches them on for a SkinnedMesh.
//
// Every shader samples textures as stored and writes its result as is: the
// client does no colour-space conversion, so neither do these (textures get
// THREE.NoColorSpace and renderers LinearSRGBColorSpace output).

// exp2 fog, as the client's: density = fogDepth × 0.01.
const FOG = `
uniform bool useFog; uniform vec3 fogColor; uniform float fogDensity;
vec3 fog(vec3 c, vec3 view) {
  if (!useFog) return c;
  float fd = length(view) * fogDensity;
  return mix(fogColor, c, clamp(exp(-fd * fd), 0.0, 1.0));
}`;

const SKINNED_BEGIN = `
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>`;

// The fixed-function prop shaders (normal_*), lit per vertex:
// primary = emission + ambient·globalAmbient + diffuse·light·max(N·L, 0),
// colour = texture × primary × 2, alpha = texture alpha (or × primary alpha).
// With vertex colours (vertexColorAD) they replace ambient and diffuse.
export const NORMAL_VERTEX = `
#include <common>
#include <skinning_pars_vertex>
#ifdef FF_VERTEX_COLOR
attribute vec4 color;
#endif
uniform vec3 lightDir; uniform vec3 lightColor; uniform vec3 ambient;
uniform vec4 matColor; uniform vec4 matAmb; uniform vec4 matEmission; uniform vec4 uvST;
varying vec2 vUv; varying vec4 vPrim; varying vec3 vView;
void main() {
  ${SKINNED_BEGIN}
#ifdef FF_VERTEX_COLOR
  vec4 diff = color; vec4 amb = color;
#else
  vec4 diff = matColor; vec4 amb = matAmb;
#endif
  vec3 n = normalize(normalMatrix * objectNormal);
  vec3 l = normalize((viewMatrix * vec4(lightDir, 0.0)).xyz);
  vec3 c = matEmission.rgb + amb.rgb * ambient + diff.rgb * lightColor * max(dot(n, l), 0.0);
  vPrim = clamp(vec4(c, diff.a), 0.0, 1.0);
  // Unity's texture scale and offset; glTF's v is 1 − Unity's
  vUv = vec2(uv.x * uvST.x + uvST.z, 1.0 - ((1.0 - uv.y) * uvST.y + uvST.w));
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

export const NORMAL_FRAGMENT = `
uniform sampler2D map; uniform bool hasMap; uniform float alphaTest; uniform bool alphaPrimary;
${FOG}
varying vec2 vUv; varying vec4 vPrim; varying vec3 vView;
void main() {
  vec4 tex = hasMap ? texture2D(map, vUv) : vec4(1.0);
  float a = alphaPrimary ? tex.a * vPrim.a : tex.a;
  if (a < alphaTest) discard;
  gl_FragColor = vec4(fog(min(tex.rgb * vPrim.rgb * 2.0, 1.0), vView), a);
}`;

// The character shaders push vertices out along their normals: the outline
// pass by _Outline + _FatFactor, the base pass by _FatFactor.
export const CHARACTER_VERTEX = `
#include <common>
#include <skinning_pars_vertex>
uniform float push; uniform vec3 lightDir;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; varying vec3 vLight;
void main() {
  vUv = uv;
  ${SKINNED_BEGIN}
  transformed += normalize(objectNormal) * push;
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vNormal = normalize(normalMatrix * objectNormal);
  vLight = normalize((viewMatrix * vec4(lightDir, 0.0)).xyz);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// (Skinned)ToonShading: texture × _Color × 2 × ramp(u), with
// u = clamp(N·L + clamp((1 − N·V)(V·−L) + N·L, 0, 1), 0.01, 0.99).
export const TOON_FRAGMENT = `
uniform sampler2D map; uniform bool hasMap; uniform sampler2D ramp; uniform bool hasRamp; uniform vec4 color;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; varying vec3 vLight;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  vec3 light = normalize(vLight);
  if (!gl_FrontFacing) n = -n;
  float nl = dot(n, light);
  float u = clamp(nl + clamp((1.0 - dot(n, v)) * dot(v, -light) + nl, 0.0, 1.0), 0.01, 0.99);
  vec4 tex = hasMap ? texture2D(map, vUv) : vec4(1.0);
  vec3 r = hasRamp ? texture2D(ramp, vec2(u, 0.75)).rgb : vec3(1.0);
  gl_FragColor = vec4(min(tex.rgb * color.rgb * 2.0, 1.0) * r, min(tex.a * color.a * 2.0, 1.0));
}`;

// Skin_DirLight (the eyes-and-mouth decal): texture × (emission + _Color × N·L) × 2.
export const LIT_FRAGMENT = `
uniform sampler2D map; uniform bool hasMap; uniform vec4 color; uniform vec3 emission;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vLight;
void main() {
  vec3 lit = emission + color.rgb * max(dot(normalize(vNormal), normalize(vLight)), 0.0);
  vec4 tex = hasMap ? texture2D(map, vUv) : vec4(1.0);
  gl_FragColor = vec4(min(tex.rgb * lit * 2.0, 1.0), tex.a);
}`;

export const OUTLINE_FRAGMENT = `
uniform vec4 color;
void main() { gl_FragColor = vec4(color.rgb, 1.0); }`;

// Skin_FusionEffect (the fusions' green skin): _MainTex scrolls along v,
// _BumpMap (bubbles) the other way, _ShaderMap (glow) is looked up by the
// projected normal; colour = Tex0 × (N·L × _Color + _Emission) × 2 + Tex1 +
// Tex2, each step clamped. _Time.x = t / 20.
export const FUSION_VERTEX = `
#include <common>
#include <skinning_pars_vertex>
uniform float time; uniform float speed; uniform vec3 lightDir; uniform vec4 color; uniform vec4 emission;
varying vec2 vUv0; varying vec2 vUv1; varying vec2 vUv2; varying vec4 vPrim;
void main() {
  ${SKINNED_BEGIN}
  float t = speed * time / 20.0;
  // glTF v = 1 − Unity v, so the scroll directions flip
  vUv0 = vec2(uv.x, uv.y - t);
  vUv1 = vec2(uv.x, uv.y + t);
  vec4 c = projectionMatrix * modelViewMatrix * vec4(objectNormal, 1.0);
  vUv2 = vec2(t + c.x, c.y);
  vec3 l = normalize((viewMatrix * vec4(lightDir, 0.0)).xyz);
  float nl = max(dot(normalize(normalMatrix * objectNormal), l), 0.0);
  vPrim = vec4(nl * color.rgb + emission.rgb, clamp(nl * color.a + color.a, 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}`;

export const FUSION_FRAGMENT = `
uniform sampler2D map; uniform sampler2D bubbles; uniform sampler2D glow;
varying vec2 vUv0; varying vec2 vUv1; varying vec2 vUv2; varying vec4 vPrim;
void main() {
  vec4 tex = texture2D(map, vUv0);
  vec3 c = min(tex.rgb * vPrim.rgb * 2.0, 1.0);
  c = min(c + texture2D(bubbles, vUv1).rgb, 1.0);
  c = min(c + texture2D(glow, vUv2).rgb, 1.0);
  gl_FragColor = vec4(c, tex.a * vPrim.a);
}`;

// ffWater, "simple" subshader: two scrolling bump lookups, a fresnel term
// indexing _ReflectiveColor, mixed toward the horizon colour.
export const WATER_VERTEX = `
uniform float time; uniform vec4 waveSpeed; uniform float waveScale;
varying vec2 vUv0; varying vec2 vUv1; varying vec3 vToEye; varying float vNy; varying vec3 vView;
void main() {
  vec4 r = (waveSpeed * (time / 20.0) + position.xzxz) * waveScale;
  vUv0 = r.xy * vec2(0.4, 0.45); vUv1 = r.wz;
  vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vToEye = (camObj - position).xzy; vNy = normal.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz; gl_Position = projectionMatrix * mv;
}`;

export const WATER_FRAGMENT = `
uniform sampler2D bump; uniform bool hasBump; uniform sampler2D reflective; uniform bool hasReflective;
uniform vec4 horizon; uniform vec4 foam;
${FOG}
varying vec2 vUv0; varying vec2 vUv1; varying vec3 vToEye; varying float vNy; varying vec3 vView;
void main() {
  vec3 b = hasBump ? texture2D(bump, vUv1).rgb + texture2D(bump, vUv0).rgb - 1.0 : vec3(0.0, 0.0, 1.0);
  float f = dot(normalize(vToEye), b);
  vec4 refl = hasReflective ? texture2D(reflective, vec2(f, f)) : horizon;
  vec3 c = mix(refl.rgb, horizon.rgb, refl.a);
  c = foam.rgb + vNy * (c - foam.rgb);
  gl_FragColor = vec4(fog(c, vView), clamp(refl.a * horizon.a * 2.0, 0.0, 1.0));
}`;

// Terrain, as FusionFall's TerrainEngine splat shaders: the first four
// splats with Lightmap-FirstPass (Σ wᵢ·splatᵢ), every further group of four
// with Lightmap-BlendPass (lerp(lerp(lerp(s0, s1, y), s2, z), s3, w),
// alpha = x+y+z+w, blended over), all × lightmap. The painted weights rely
// on this: later groups often sum to more than 1. Missing splats are white.
export const TERRAIN_VERTEX = `
varying vec2 vUv; varying vec3 vView;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`;

export const terrainFragment = (splats, groups) => `
precision highp sampler2DArray;
uniform sampler2DArray splats; uniform sampler2DArray controls; uniform sampler2D lightmap; uniform bool hasLightmap;
uniform vec4 tiles[${Math.max(splats, 1)}]; uniform float lightmapScale;
${FOG}
varying vec2 vUv; varying vec3 vView;
vec3 splat(int i) { return i < ${splats} ? texture(splats, vec3(vUv * tiles[i].xy + tiles[i].zw, float(i))).rgb : vec3(1.0); }
void main() {
  vec4 w = texture(controls, vec3(vUv, 0.0));
  vec3 col = w.x * splat(0) + w.y * splat(1) + w.z * splat(2) + w.w * splat(3);
  for (int g = 1; g < ${groups}; g++) {
    w = texture(controls, vec3(vUv, float(g)));
    float a = clamp(w.x + w.y + w.z + w.w, 0.0, 1.0);
    if (a < 0.002) continue;
    vec3 c = mix(mix(mix(splat(4 * g), splat(4 * g + 1), w.y), splat(4 * g + 2), w.z), splat(4 * g + 3), w.w);
    col = mix(col, c, a);
  }
  if (hasLightmap) col *= texture2D(lightmap, vUv).rgb * lightmapScale;
  gl_FragColor = vec4(fog(min(col, 1.0), vView), 1.0);
}`;

// RenderFX/Skybox (Unity 2.x): `combine texture +- primary` with primary =
// _Tint: texture + tint − 0.5.
export const SKY_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const SKY_FRAGMENT = `uniform sampler2D map; uniform vec3 tint; varying vec2 vUv;
void main() { gl_FragColor = vec4(clamp(texture2D(map, vUv).rgb + tint - 0.5, 0.0, 1.0), 1.0); }`;

// Grass (Hidden/TerrainEngine/Details/BillboardWavingDoublePass): quads
// that face the camera, swaying with the wind, coloured between the
// prototype's healthy and dry colours and by the terrain's lightmap;
// texture × colour, alpha-tested at 0.5; drawn only near the camera, as
// Unity does.
export const GRASS_VERTEX = `
attribute vec3 offset; // the base, in the terrain's space
attribute vec4 grass; // width, height, healthy-to-dry mix, sway phase
uniform float time; uniform vec4 wave; uniform float distance; uniform vec3 healthy; uniform vec3 dry;
uniform sampler2D lightmap; uniform float lightmapFactor; uniform vec2 terrainSize; uniform vec3 tint;
varying vec2 vUv; varying vec3 vColor; varying vec3 vView;
void main() {
  vUv = uv;
  vec3 base = (modelMatrix * vec4(offset, 1.0)).xyz;
  vec3 toCam = cameraPosition - base;
  float far = step(distance * distance, dot(toCam, toCam));
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  // wave: strength, amount, speed (TerrainData's waving grass)
  float w = sin(time * wave.z * 4.0 + grass.w);
  float sway = w * wave.y * wave.x * 0.3 * position.y;
  vec3 p = base + right * (position.x * grass.x) + vec3(0.0, position.y * grass.y, 0.0) + vec3(sway, 0.0, sway * 0.5);
  p = mix(p, base, far); // beyond the detail distance: collapsed, not drawn
  // the swaying tips take on the waving tint: × (1 + wave · (2·tint − 1))
  vColor = mix(healthy, dry, grass.z) * (1.0 + max(w, 0.0) * position.y * wave.y * (2.0 * tint - 1.0));
  vec3 lm = texture2D(lightmap, vec2(-offset.x / terrainSize.x, 1.0 - offset.z / terrainSize.y)).rgb;
  vColor *= mix(vec3(1.0), lm, lightmapFactor);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

export const GRASS_FRAGMENT = `
uniform sampler2D map;
${FOG}
varying vec2 vUv; varying vec3 vColor; varying vec3 vView;
void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.5) discard;
  gl_FragColor = vec4(fog(min(tex.rgb * vColor, 1.0), vView), 1.0);
}`;
