# ff-three

FusionFall's shaders for [three.js](https://threejs.org), for the glTF files [UnityPackFF](https://github.com/kamilprzyb2/UnityPackFF) (my fork of [dongresource/UnityPackFF](https://github.com/dongresource/UnityPackFF)) exports from the game client. It has:

- **Materials** that draw like the client: the fixed-function prop shaders (`normal_*`), toon shading with outlines, the face decal, the fusions' moving skin, water, terrain splat passes, the skybox and grass. They are picked by the shader name UnityPackFF keeps in each material's `extras`.
- **A model viewer** for characters, mobs, NPCs, nanos and items, with the game's idle cycle and a picker for every clip.
- **An area viewer** for the world: tiles side by side with sea, sky and fog, animated props, grass near the camera, and, from the scene's scripts, the Infected Zones' moving platforms and barrier effects ([docs/SCRIPTS.md](docs/SCRIPTS.md)).
- **A render CLI** that draws tiles from above and areas at an angle in headless Chromium, once, for pages that show pictures.
- **A demo page** that picks models and areas from a folder of UnityPackFF output or ff-unpack packs, or shows GLBs you drop on it.

ff-three needs only the client's data, through UnityPackFF. Nothing here is game art: you export your own from your own client files.

## Input

Any GLB that UnityPackFF writes (`bin/export_gltf.py`, or its `GLTFWriter`):

- **Models**: a prefab's GLB. With `--split-clips`, the clips sit beside it as `<model>@<clip>.glb` and the viewer loads each one when it's picked.
- **World tiles**: a map scene (`BuildPlayer-Map_XX_YY`) exported whole, at its world position. The area viewer and the render CLI read a world directory laid out as ff-unpack writes it (`tile/`, `shared/`, `effect/`, `sky/`, `manifest.json`). [docs/WORLD_INPUT.md](docs/WORLD_INPUT.md) lists what ff-three reads.

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
- `view`: an area's tiles (`[tx0, ty0, tx1, ty1]`) seen from the south at `pitch` degrees, the camera backed off until they all fit. `tiles` lists the tiles to load (default: the area and the ring around it; tiles the world doesn't have are sea, unless its manifest marks it `partial`).

Each job writes `<out>/<name>.png`. `<out>/renders.json` records each job with a key made of the job, ff-three's version and the world's fingerprint (`manifest.json`'s `fingerprint`). A job whose picture exists under the same key is skipped, so an interrupted run resumes and only changed jobs are redone (`--force` redoes everything). Jobs that fail are retried with one browser: software GL sometimes loses its context when several browsers run at once.

Rendering in software GL is slow, so make the pictures once and serve them, rather than rendering on request.

## Demo

```sh
npm install
node cli/serve.mjs --dir <a directory of UnityPackFF output>
```

Open the printed URL. With `--dir` (a folder of UnityPackFF output, ff-unpack packs, or both), three dropdowns pick what to show: the source (a build or a folder), the kind (areas, tiles, nanos, fusions, mobs, NPCs, characters, wear by type) and the item, with a filter for long lists. The page's URL follows the pick (`?model=/files/<path>.glb`, `&clips=pack` for a pack prefab, or `?world=/files/<world>/&area=4,2,4,2`), so a view can be linked to. You can also drop GLBs or a folder from your own machine on the page (tiles need their `shared/` folder, and `sky/` for the skybox).

## Development

```sh
npm test                           # unit tests; with CHROME set, also renders a made-up world end to end
node dev/shot.mjs --dir <files> --page "/demo/?model=/files/x.glb" --out shot.png   # a screenshot of a demo page
```

The tests make their own data (`test/helpers.js`): no game files are needed or committed.

### Project structure

```
src/                  the library: ES modules for the browser, importing three
  index.js            every export
  shader-name.js      what a FusionFall shader name says: family, blend, depth, culling
  shaders.js          the GLSL
  materials.js        dress(): swaps a glTF scene's materials for the client's shaders
  environment.js      the light, fog and time every material reads
  terrain.js          terrain splat passes and height lookups
  grass.js            grass scattered from the terrain's detail densities
  sky.js              the skybox
  animation.js        props' clips and material curves
  scripts.js          what the scene's scripts do: moving platforms, placed effects
  png.js              a PNG decoder that keeps the stored bytes (control maps, densities)
  world.js            World: tiles from a world directory, the sea around them
  jobs.js             render jobs as data (no three: the CLI uses it too)
  render.js           drawing a job: a tile from above, an area at an angle
  model-viewer.js     mountModel()
  area-viewer.js      mountArea()
cli/
  render.mjs          ff-three-render: runs render jobs in headless Chromium
  server.mjs          the static file server render.mjs and serve.mjs use
  serve.mjs           the demo server
render.html           the page render.mjs drives, one job per load
demo/                 the demo page
docs/                 how ff-three draws the client, and what it reads from a world pack
test/                 node:test tests; browser.test.js renders in headless Chromium
dev/shot.mjs          screenshots of demo pages, for checking by eye
```

## Licence

MIT, see [LICENSE](LICENSE).
