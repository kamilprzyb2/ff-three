# What ff-three reads from a world directory

The area viewer (`mountArea`), `World` and the render CLI read a world directory as ff-unpack writes it (its `PACK_FORMAT.md`, section `world/`, is the specification). This file lists the parts ff-three uses, so that both sides know what they can change.

```
<world>/
  manifest.json                    optional
  tile/<XX_YY>.glb                 required for every tile shown
  shared/…                         whatever the tiles point to
  effect/<name>.glb                optional: the effect prefabs the tiles' scripts place
  sky/<set>/skybox_<side>tex.png   optional (no skybox without it)
```

## Tiles

`tile/<XX_YY>.glb`: a map scene exported whole by UnityPackFF (`GLTFWriter.add_scene`, or `bin/export_gltf.py` on `BuildPlayer-Map_XX_YY`), at its world position. ff-three places tiles exactly where they are: tile (tx, ty) covers glTF x ∈ [−512(tx + 1), −512tx] and z ∈ [512ty, 512(ty + 1)] (east is −x, north +z). Files the tile points to (images, mesh data) resolve relative to the GLB, as glTF says.

From each tile ff-three reads:

- every mesh and its material's `extras` (`shader`, `colors`, `floats`, `textures` with glTF indices, and `main_texture_index` when UnityPackFF writes it);
- `COLOR_0` where UnityPackFF writes it (vertex colours for the `vertexColorAD` shaders);
- the terrain: the mesh whose material has `extras.terrain` (`splats` with `texture`, `tile_size` and `tile_offset`; `controls`; `lightmap`; `details`), with UnityPackFF's vertex layout (vertex z·W + x, texture coordinates = position / size, v flipped);
- the scene's `extras.render_settings.ambient` and `extras.colors` (`fog_depth`, `fog`);
- nodes' `extras.animation`, the animations' `extras.float_curves` and the document's `extras.material_clips`;
- nodes' `extras.scripts` (UnityPackFF's `--scripts`), when the pack has them: moving platforms and the effects to place (docs/SCRIPTS.md).

## manifest.json

All optional:

| Field | Used for |
|---|---|
| `tiles` | which tiles exist (an object keyed by `XX_YY`, or a list); a view's ring tiles that aren't there are sea. Without it, every tile is tried and missing ones are skipped |
| `partial` | `true` for a pack of only some tiles (ff-unpack `--tiles`): tiles it lacks aren't drawn as sea, since they may be land |
| `light` | `{ "direction": [x, y, z], "color": [r, g, b], "intensity": n }`, towards the light, glTF space. Default: main.unity3d's light of the three builds, `[0.8937, 0.309, 0.3253]`, white, 1 |
| `sky.fusion_rects` | `[[x, y, width, height], …]` in map metres (x east, y north): where the area viewer uses the fusion sky by default |
| `effects` | `{ name: { file } }`: the effect prefabs the tiles' scripts place, `file` relative to the world directory (`effect/<name>.glb`); `name` is the prefab's name in lower case, as the scripts' `nifObject` names it |
| `fingerprint` | the render CLI's record of what each picture was made from: when it changes, renders are redone |

## Sky

`sky/normal/` and `sky/fusion/`, each with `skybox_{front,back,left,right,up,down}tex.png`: the faces of `RenderFX/Skybox` as the client stores them.
