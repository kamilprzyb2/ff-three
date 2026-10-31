# How ff-three draws FusionFall

FusionFall (Unity 2.5) draws almost everything with its own shaders, most of them fixed-function. This file describes what each one does, as ff-three reproduces it, and which of UnityPackFF's material `extras` it reads. The GLSL is in `src/shaders.js`, the materials in `src/materials.js`.

Two rules hold everywhere:

- **No colour management.** The client samples textures as stored and writes its result as is. Every texture gets `THREE.NoColorSpace`, and renderers use `LinearSRGBColorSpace` output, which writes values unchanged.
- **Mirrored along x.** Unity is left-handed and glTF right-handed, so UnityPackFF negates x and flips v (glTF's v = 1 − Unity's v). Shaders that work in Unity's texture space flip v back.

## Choosing a shader

`src/shader-name.js` reads the shader name (`extras.shader`). FusionFall's shaders spell their render state out in their names:

| Name | Family |
|---|---|
| `normal`, `normal_<blend>[Test][_zwriteOff][_cullOff][_vertexColorAD]`, `normal_glow_*` | props: fixed-function lighting |
| `ToonShading_*`, `SkinnedToonShading_*[_cullOff]` | characters: toon ramp and outline |
| `Skin_DirLight_*` | the face decal (eyes and mouth) |
| `Skin_FusionEffect_*` | the fusions' moving skin |
| `ffWater`, `ffPoison` | water planes |
| anything else | drawn like a prop, blended if glTF's `alphaMode` is `BLEND` |

Blends: `blendSrcalphaInvsrcalpha` (SrcAlpha OneMinusSrcAlpha), `blendOneOne` (One One, no fog), `blendSrcalphaOne` (SrcAlpha One), `blendSrcalphaInvsrccolor` (SrcAlpha OneMinusSrcColor); none means opaque. `zwriteOff` turns depth writes off, `cullOff` draws both sides.

Terrain isn't a named shader: a mesh whose material has `extras.terrain` is drawn by `src/terrain.js`.

## Props (`normal_*`)

`Material { Diffuse [_Color] Ambient [_AmbColor] Emission [_Emission] } Lighting On`, then `texture * primary DOUBLE`. Per vertex:

- primary = `_Emission` + `_AmbColor` × ambient + `_Color` × light × max(N·L, 0)
- colour = texture × primary × 2, clamped; alpha = the texture's (× primary's alpha for `blendSrcalphaOne_zwriteOff_vertexColorAD`)

The light is main.unity3d's directional light (white, intensity 1, towards `(0.894, 0.309, 0.325)` in glTF space, a low sun) and the ambient is `RenderSettings.m_AmbientLight` (0.2). With the materials' usual values (diffuse 0.29, emission 0.24) surfaces come out at 0.6 to 1.2 times their texture: the flat cartoon look.

- **`vertexColorAD`** (`ColorMaterial AmbientAndDiffuse`): the vertex colour replaces `_Color` and `_AmbColor`. UnityPackFF writes vertex colours as `COLOR_0`; a mesh without them falls back to the material's colours.
- **`Test`**: with alpha blending, two passes: `AlphaTest GEqual 0.9` with depth writes, then everything else blended without depth writes (queue Transparent−100). The additive `blendOneOneTest` is one pass, `Alphatest Greater [_Cutoff]`, and writes no depth although its name doesn't say `zwriteOff` (of the 21 prop shaders checked against the client, the only name that doesn't spell out its whole state).
- **`_MainTex` scale and offset** (`extras.textures._MainTex`) apply to the texture coordinates.
- **Additive shaders**: UnityPackFF's base colour texture is a copy with its brightness as alpha, so that plain glTF viewers blend it about right. ff-three draws the texture itself (`extras.main_texture_index`) with the real blend.
- **Fog**: exp2, colour and density from the area (below); One One passes have none.
- `normal_glow_*` adds a glow texture (`_BumpMap`) that the client's camera glow filter picks up. ff-three draws these like plain props.

## Characters

**`(Skinned)ToonShading`**: colour = texture × `_Color` × 2 × ramp(u), alpha-blended, with N the normal, V towards the eye and L towards the light in view space:

u = clamp(N·L + clamp((1 − N·V)(V·−L) + N·L, 0, 1), 0.01, 0.99)

The ramp is `_ShaderMap` (`ToonRamp9`, 256 × 2, three steps), read at v = 0.75 without mipmaps. A second pass draws the outline: the mesh pushed out along its normals by `_Outline` + `_FatFactor`, front faces culled, in `_OutlineColor`. The base pass is pushed by `_FatFactor` (a character's build; 0 unless an animation sets it).

**`Skin_DirLight`** (the face decal): texture × (`_Emission` + `_Color` × N·L) × 2. On faces `_Color` is black and `_Emission` 0.5, so the texture shows unchanged. It's drawn after the toon parts, with a polygon offset.

**`Skin_FusionEffect`** (the fusions' green skin, no outline, drawn before the toon parts): with t = `_Speed` × seconds / 20 (`_Speed` is 7),

- primary = N·L × `_Color` + `_Emission`, alpha N·L × `_Color.a` + `_Color.a`
- `_MainTex` scrolls along v by t, `_BumpMap` (bubbles) the other way, `_ShaderMap` (glow) is looked up by the projected normal, offset by t
- colour = `_MainTex` × primary × 2 + bubbles + glow, each step clamped; alpha = texture alpha × primary alpha

In the model viewer the light stays fixed on screen: upper left, in front.

## Water (`ffWater`, `ffPoison`)

The "simple" subshader. Two bump lookups at `(position.xzxz + WaveSpeed × seconds / 20) × _WaveScale` (the first scaled by (0.4, 0.45)); fresnel = dot(view direction, bump − 1); colour = lerp(`_ReflectiveColor`(fresnel).rgb, `_HorizonColor`, its alpha); alpha = its alpha × `_HorizonColor.a` × 2. Coastal and sea tiles have a generated 512 m plane at about −58 m.

## Terrain

FusionFall's own `Hidden/TerrainEngine/Splatmap` shaders. Splats 0–3 are drawn by `Lightmap-FirstPass` (Σ wᵢ · splatᵢ), every further group of four by `Lightmap-BlendPass` (lerp(lerp(lerp(s0, s1, y), s2, z), s3, w), alpha x + y + z + w, blended over), all times the lightmap. The painted weights depend on this: the first control map sums to at most 1, later ones often to 2 or 3 (a layer painted fully over the base). Each splat is tiled by `uv × terrain size / tile_size + tile_offset / tile_size`.

UnityPackFF exports the terrain as a mesh (the heightmap with its shifts applied) and keeps in `extras.terrain` the splats (glTF texture, `tile_size`, `tile_offset`), the control maps (glTF textures) and the lightmap. The terrain's size comes from the mesh: each vertex's texture coordinates are its position over the size.

A control map's alpha is the fourth splat's weight, not transparency. Browsers that decode a PNG premultiplied by alpha (a 2D canvas always, an `<img>` in Safari) zero the other three weights wherever the fourth is 0. So ff-three decodes the splats and control maps itself (`src/png.js`) and uploads them as array textures.

## Grass

The client's terrain details are all billboard textures (`Hidden/TerrainEngine/Details/BillboardWavingDoublePass`): quads that face the camera and sway with the wind. Colour = texture × lerp(healthy, dry) × the lightmap under it, brightened towards the waving tint as it sways; alpha-tested at 0.5. UnityPackFF gives a density texture per prototype (instances per cell, laid over the terrain like the control maps). Unity scatters the instances at random as it draws them, so ff-three does too, from a fixed seed. Like Unity, it draws only grass within 80 m of the camera (the default detail distance): pictures from above or afar have none.

## The area around

- **Fog**: `cnPlayerCamera` sets the fog colour to the area's `DongColorSetup.fogColor` × 0.5 + 0.5, and exp2 density to `fogDepth` × 0.01 (UnityPackFF: scene `extras.colors`). That hides everything beyond a few hundred metres, so the area viewer and the views use a lighter fog by default, a third at the area's far edge. The area viewer can switch to the game's.
- **Sky**: `RenderFX/Skybox`, `combine texture +- primary` with primary = `_Tint`, so texture + tint − 0.5, the tint being the fog colour. The client uses the fusion sky (the dark aurora) inside the Future and tutorial rectangles and the normal sky (grey clouds) elsewhere. Unity's +X face is `_LeftTex` (the side faces join front → left → back → right). The scene is mirrored and a box seen from inside shows each face mirrored, so three's +x face takes `_LeftTex` as well.
- **Sea**: beyond the loaded tiles, a plane at −62 m in the client's water colour seen from above (ffWater's horizon colour, a little darker), fogged, with skirts down from every outer tile edge so that no edge hangs over the sky.

## Animated props

Map scenes are full of Animation components (Map_04_02 has 611): signs, water wheels, boats, flags. UnityPackFF keeps how each one plays its clips in its node's `extras.animation`. Every enabled one that plays automatically plays its default clip, looped (all of them in the three builds have one clip, `nif-default`, wrap mode Default).

Clips also animate material properties (`_Color`, `_Emission`, `_AmbColor`, `_MainTex`'s offset), in the animation's `extras.float_curves` or the document's `extras.material_clips`. Unity applies them to the renderer on that node, so its meshes get materials of their own and the curves drive their uniforms.

## What isn't drawn

- The camera's `GlowEffect` filter (light × 0.6 + 0.4, intensity 1.8, a faint tint).
- Effects, particles and other shaders with real combiner programs. A ShaderLab tokenizer in UnityPackFF and a combiner-to-GLSL translator here would cover them; that work is parked.
- Lights other than the sun (UnityPackFF exports them as `KHR_lights_punctual`).
