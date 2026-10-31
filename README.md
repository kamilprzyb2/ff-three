# ff-three

FusionFall's shaders for [three.js](https://threejs.org), for the glTF files [UnityPackFF](https://github.com/kamilprzyb2/UnityPackFF) exports from the game client. It has:

- **Materials** that draw like the client: the fixed-function prop shaders (`normal_*`), toon shading with outlines, the face decal, the fusions' moving skin, water, terrain splat passes, the skybox and grass. They are picked by the shader name UnityPackFF keeps in each material's `extras`.
- **A model viewer** for characters, mobs, NPCs, nanos and items, with the game's idle cycle and a picker for every clip.
- **An area viewer** for the world: tiles side by side with sea, sky and fog, animated props, and grass near the camera.
- **A render CLI** that draws tiles from above and areas at an angle in headless Chromium, once, for pages that show pictures.
- **A demo page** where you drop in a GLB, or a folder of them.

ff-three needs only the client's data, through UnityPackFF. Nothing here is game art: you export your own from your own client files.

## Input

Any GLB that UnityPackFF writes (`bin/export_gltf.py`, or its `GLTFWriter`):

- **Models**: a prefab's GLB. With `--split-clips`, the clips sit beside it as `<model>@<clip>.glb` and the viewer loads each one when it's picked.
- **World tiles**: a map scene (`BuildPlayer-Map_XX_YY`) exported whole, at its world position. The area viewer and the render CLI read a world directory laid out as ff-unpack writes it (`tile/`, `shared/`, `sky/`, `manifest.json`). [docs/WORLD_INPUT.md](docs/WORLD_INPUT.md) lists what ff-three reads.

UnityPackFF keeps each Unity material whole in the glTF material's `extras` (`shader`, `colors`, `floats`, `textures` with glTF texture indices). [docs/SHADERS.md](docs/SHADERS.md) describes each shader family and which properties it reads.

## Using it in a page

three.js is a peer dependency (r180 to r189; tested with r186). The modules import `three` and `three/addons/…`, so a page needs an import map:

```html
<script type="importmap">
{ "imports": { "three": "/vendor/three/build/three.module.js", "three/addons/": "/vendor/three/examples/jsm/" } }
</script>
<script type="module">
import { mountModel, mountArea } from "/vendor/ff-three/src/index.js";

// a model, with its controls (clip picker, pause, speed, turntable) in #controls
const viewer = await mountModel(document.querySelector("#stage"), "/models/mob_npc_grim.kfm.glb", {
  controls: document.querySelector("#controls"),
});

// an area of a world directory: tile 04_02 and the ring of tiles around it
const area = await mountArea(document.querySelector("#stage"), "/world/", { area: [4, 2, 4, 2], tiles: ["03_01", "04_01", /* … */] });

viewer.dispose(); // frees the GPU resources
</script>
```

Lower down, `dress(root, parser, { env })` swaps the materials of any glTF scene GLTFLoader loaded, `World` loads tiles into your own scene, and `createEnvironment()` holds the light, fog and time every material reads. `src/index.js` lists every export.

`mountModel` options: `controls`, `kind` (`"player"`, `"creature"` or `"item"`: how it's framed), `clips` (`{ name: url }`, as an ff-unpack manifest lists a prefab's clips), `menu` (picker groups, `[{ title, hide_weapon, clips: [{ clip, label, icon, then }] }]`), `idles` (a human NPC's idle clips), `clipUrl(name)`, `iconUrl(icon)`, `weapon`, `loader`. Each can also come from the GLB's root `extras`. Clips are looked for in the GLB, then in `clips`, then beside it as UnityPackFF's `--split-clips` names them (`<model>@<clip>.glb`); for an ff-unpack pack without its manifest at hand, pass `clipUrl: (name) => packClipUrl(url, name)` (`<prefab>/clips/<clip>.glb`).

## Render CLI

```sh
ff-three-render --world <world dir> --out <dir> --topdown all             # every tile from above
ff-three-render --world <world dir> --out <dir> --jobs jobs.json --browsers 2
```

It needs Node 22 or later and a Chromium binary (`--chrome` or `$CHROME`; a headless shell is enough, rendering in software GL). Jobs:

```json
[
  { "name": "04_02", "type": "topdown", "tile": "04_02", "size": 1024 },
  { "name": "orchid-bay", "type": "view", "area": [4, 2, 4, 2], "sky": "normal", "width": 1280, "height": 720, "pitch": 26 }
]
```

- `topdown`: a tile straight down, orthographic, north up and east right, no fog or sky, transparent where nothing is drawn.
- `view`: an area's tiles (`[tx0, ty0, tx1, ty1]`) seen from the south at `pitch` degrees, the camera backed off until they all fit. `tiles` lists the tiles to load (default: the area and the ring around it; tiles the world doesn't have are sea).

Each job writes `<out>/<name>.png`. `<out>/renders.json` records each job with a key made of the job, ff-three's version and the world's fingerprint (`manifest.json`'s `fingerprint`). A job whose picture exists under the same key is skipped, so an interrupted run resumes and only changed jobs are redone (`--force` redoes everything). Jobs that fail are retried with one browser: software GL sometimes loses its context when several browsers run at once.

The renders are made once, never on request: an area view takes 5 to 45 s in software GL.

## Demo

```sh
npm install
node cli/serve.mjs --dir <a directory of UnityPackFF output>
```

Open the printed URL. With `--dir` (a folder of UnityPackFF output, ff-unpack packs, or both), the page lists what's in it: every world with its named areas and tiles, and every model, searchable. The links are `?model=/files/<path>.glb` (`&clips=pack` for a pack prefab) and `?world=/files/<world>/&area=4,2,4,2`. You can also drop GLBs or a folder from your own machine on the page (tiles need their `shared/` folder, and `sky/` for the skybox).

## Development

```sh
npm test                           # unit tests; with CHROME set, also renders a made-up world end to end
node dev/shot.mjs --dir <files> --page "/demo/?model=/files/x.glb" --out shot.png   # a screenshot of a demo page
```

The tests make their own data (`test/helpers.js`): no game files are needed or committed.

## Status

Version 0.1.0, unreleased. The licence and the package name aren't decided yet.
