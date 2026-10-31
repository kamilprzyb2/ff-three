// What a FusionFall shader does, from its name.
//
// FusionFall's own shaders spell their render state out in their names
// (normal_blendSrcalphaInvsrcalphaTest_cullOff, ...), so the name picks the
// shader ff-three draws a material with and its blending, depth and culling.
// UnityPackFF writes the name into each glTF material's extras.shader.
// docs/SHADERS.md describes each family.

// Blend modes, as the names spell them: SrcAlpha OneMinusSrcAlpha, One One,
// SrcAlpha One, SrcAlpha OneMinusSrcColor; "opaque" when the name has none.
export const BLENDS = ["opaque", "alpha", "add", "srcalpha_one", "srcalpha_invsrccolor"];

function blendOf(lo) {
  if (lo.includes("blendoneone")) return "add";
  if (lo.includes("blendsrcalphaone")) return "srcalpha_one";
  if (lo.includes("blendsrcalphainvsrccolor")) return "srcalpha_invsrccolor";
  if (lo.includes("blendsrcalphainvsrcalpha")) return "alpha";
  return "opaque";
}

// { family, blend, test, twoPass, zwrite, cull, vertexColor, fog,
// alphaPrimary, skinned, glow } for a shader name (null or "" gives family "unknown").
//
// Families: "normal" (the fixed-function prop shaders, normal_*), "toon"
// (ToonShading_* and SkinnedToonShading_*), "lit" (Skin_DirLight_*, the
// face decal), "fusion" (Skin_FusionEffect_*), "water" (ffWater and
// ffPoison), "unknown" (anything else: drawn like "normal" with the blend
// glTF's alphaMode gives).
export function classifyShader(name) {
  const lo = (name || "").toLowerCase();
  const blend = blendOf(lo);
  const info = {
    family: "unknown",
    blend,
    // Test: with alpha blending, an alpha-tested pass with depth and then
    // the rest blended without (twoPass); with other blends, one pass
    // alpha-tested at _Cutoff
    test: /test(_|$)/.test(lo) || lo.includes("cutout"),
    twoPass: false,
    zwrite: !lo.includes("zwriteoff"),
    cull: !lo.includes("culloff"),
    // ColorMaterial AmbientAndDiffuse: vertex colours replace both
    vertexColor: lo.includes("vertexcolorad"),
    // One One passes add no fog
    fog: blend !== "add",
    // `texture * primary` alpha, not just the texture's
    alphaPrimary: lo.includes("blendsrcalphaone_zwriteoff_vertexcolorad"),
    skinned: false,
    glow: false,
  };
  if (/^normal(_|$)/.test(lo)) {
    info.family = "normal";
    info.glow = lo.startsWith("normal_glow");
    info.twoPass = info.test && blend === "alpha";
    // the one name that doesn't tell all: the additive Test shader writes no depth
    if (info.test && blend === "add") info.zwrite = false;
  } else if (lo.startsWith("skinnedtoonshading") || lo.startsWith("toonshading")) {
    info.family = "toon";
    info.skinned = lo.startsWith("skinned");
  } else if (lo.startsWith("skin_dirlight")) {
    info.family = "lit";
  } else if (lo.startsWith("skin_fusioneffect")) {
    info.family = "fusion";
  } else if (lo === "ffwater" || lo === "ffpoison") {
    info.family = "water";
  }
  return info;
}
