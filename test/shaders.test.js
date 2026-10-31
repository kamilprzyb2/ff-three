import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { classifyShader } from "../src/shader-name.js";
import { normalMaterial, colorOf, floatOf, textureIndexOf, mainTextureST } from "../src/materials.js";
import { createEnvironment, applySceneSettings, fogColorOf } from "../src/environment.js";

test("FusionFall's prop shaders spell out their render state", () => {
  const s = classifyShader("normal_blendSrcalphaInvsrcalphaTest_cullOff_vertexColorAD");
  assert.equal(s.family, "normal");
  assert.equal(s.blend, "alpha");
  assert.equal(s.test, true);
  assert.equal(s.cull, false);
  assert.equal(s.zwrite, true);
  assert.equal(s.vertexColor, true);
  assert.equal(s.fog, true);

  const add = classifyShader("normal_blendOneOne_zwriteOff_cullOff");
  assert.deepEqual([add.blend, add.zwrite, add.cull, add.fog, add.test], ["add", false, false, false, false]);
  assert.equal(classifyShader("normal_blendSrcalphaOne_zwriteOff").blend, "srcalpha_one");
  assert.equal(classifyShader("normal_blendSrcalphaInvsrccolor").blend, "srcalpha_invsrccolor");
  assert.equal(classifyShader("normal").blend, "opaque");
  assert.equal(classifyShader("normal_blendOneOneTest").test, true);
  // only the alpha-blended Test shaders draw two passes
  assert.equal(classifyShader("normal_blendSrcalphaInvsrcalphaTest").twoPass, true);
  assert.equal(classifyShader("normal_blendOneOneTest_cullOff").twoPass, false);
  assert.equal(classifyShader("normal_blendSrcalphaOne_zwriteOff_vertexColorAD").alphaPrimary, true);
  assert.equal(classifyShader("normal_glow_blendSrcalphaInvsrcalpha").glow, true);
});

test("character, water and unknown shaders", () => {
  assert.deepEqual([classifyShader("SkinnedToonShading_blendSrcalphaInvsrcalpha").family, classifyShader("SkinnedToonShading_blendSrcalphaInvsrcalpha").skinned], ["toon", true]);
  assert.deepEqual([classifyShader("ToonShading_blendSrcalphaInvsrcalpha").family, classifyShader("ToonShading_blendSrcalphaInvsrcalpha").skinned], ["toon", false]);
  assert.equal(classifyShader("SkinnedToonShading_blendSrcalphaInvsrcalpha_cullOff").cull, false);
  assert.equal(classifyShader("Skin_DirLight_AmbLight_blendSrcalphaInvsrcalpha").family, "lit");
  assert.equal(classifyShader("Skin_FusionEffect_blendSrcalphaInvsrcalpha").family, "fusion");
  assert.equal(classifyShader("ffWater").family, "water");
  assert.equal(classifyShader("ffPoison").family, "water");
  assert.equal(classifyShader("Diffuse").family, "unknown");
  assert.equal(classifyShader(null).family, "unknown");
  // "normals" isn't "normal"
  assert.equal(classifyShader("normalsomething").family, "unknown");
});

test("reading UnityPackFF's material extras", () => {
  const ex = {
    colors: { _Color: [0.5, 0.5, 0.5, 1] }, floats: { _Outline: 0.005 },
    textures: { _MainTex: { texture: "a", scale: [2, 3], offset: [0.25, 0.5] }, _ShaderMap: { texture: "ramp", scale: [1, 1], offset: [0, 0], index: 4 }, _SpecMap: { texture: null, scale: [1, 1], offset: [0, 0] } },
  };
  assert.deepEqual(colorOf(ex, "_Color"), [0.5, 0.5, 0.5, 1]);
  assert.deepEqual(colorOf(ex, "_Emission", [0, 0, 0, 0]), [0, 0, 0, 0]);
  assert.equal(floatOf(ex, "_Outline"), 0.005);
  assert.equal(floatOf(ex, "_FatFactor"), 0);
  assert.equal(textureIndexOf(ex, "_ShaderMap"), 4);
  assert.equal(textureIndexOf(ex, "_SpecMap"), null);
  assert.deepEqual(mainTextureST(ex), [2, 3, 0.25, 0.5]);
  assert.deepEqual(mainTextureST({}), [1, 1, 0, 0]);
});

test("normal_* materials: blending, depth and vertex colours", () => {
  const env = createEnvironment();
  const extras = { shader: "normal_blendSrcalphaInvsrcalphaTest_vertexColorAD", colors: {}, floats: {}, textures: {} };
  const info = classifyShader(extras.shader);
  const opaque = normalMaterial({ map: null, extras, info, pass: "opaque", vertexColors: true, env });
  const blend = normalMaterial({ map: null, extras, info, pass: "blend", vertexColors: true, env });
  assert.equal(opaque.transparent, false);
  assert.equal(opaque.uniforms.alphaTest.value, 0.9);
  assert.equal(opaque.depthWrite, true);
  // the blended pass of a Test variant writes no depth
  assert.equal(blend.transparent, true);
  assert.equal(blend.depthWrite, false);
  assert.ok("FF_VERTEX_COLOR" in blend.defines);
  // without COLOR_0, the material's colours
  const plain = normalMaterial({ map: null, extras, info, pass: "blend", vertexColors: false, env });
  assert.ok(!("FF_VERTEX_COLOR" in plain.defines));
  // the environment's uniforms are shared, not copied
  assert.equal(blend.uniforms.lightDir, env.lightDir);

  const oneTest = { shader: "normal_blendOneOneTest_cullOff", floats: { _Cutoff: 0.25 } };
  const single = normalMaterial({ map: null, extras: oneTest, info: classifyShader(oneTest.shader), env });
  assert.ok(Math.abs(single.uniforms.alphaTest.value - 0.25) < 0.01);
  assert.equal(single.depthWrite, false); // the client's source says ZWrite Off, though the name doesn't

  const add = normalMaterial({ map: null, extras: { shader: "normal_blendOneOne_zwriteOff" }, info: classifyShader("normal_blendOneOne_zwriteOff"), env });
  assert.deepEqual([add.blending, add.blendSrc, add.blendDst, add.depthWrite, add.uniforms.useFog.value], [THREE.CustomBlending, THREE.OneFactor, THREE.OneFactor, false, false]);
});

test("a scene's settings set the environment", () => {
  const env = createEnvironment();
  const fog = applySceneSettings(env, { render_settings: { ambient: [0.1, 0.2, 0.3, 1] }, colors: { fog_depth: 0.77, fog: [0.4, 0.6, 1, 1] } },
    { direction: [0, 2, 0], color: [1, 0.5, 0.5], intensity: 2 });
  assert.deepEqual(fog, [0.7, 0.8, 1]);
  assert.deepEqual(fogColorOf({ fog: [0.4, 0.6, 1, 1] }), fog);
  assert.ok(Math.abs(env.fogDensity.value - 0.0077) < 1e-9);
  assert.deepEqual(env.ambient.value.toArray().map((v) => +v.toFixed(3)), [0.1, 0.2, 0.3]);
  assert.deepEqual(env.lightDir.value.toArray(), [0, 1, 0]);
  assert.deepEqual(env.lightColor.value.toArray(), [2, 1, 1]);
});
