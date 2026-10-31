import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { terrainSize, terrainHeights } from "../src/terrain.js";
import { scatter, random } from "../src/grass.js";
import { uniformOf, sample } from "../src/animation.js";
import { skySetAt } from "../src/sky.js";
import { tileOrigin, World } from "../src/world.js";
import { splitClipUrl, packClipUrl, animationClipNames } from "../src/model-viewer.js";

// A terrain grid as UnityPackFF writes one: vertex z·W + x, x mirrored,
// uv = (x, z) / size with v flipped; heights rise along z; vertex `shifted`
// moved one cell along +x.
function terrain(W = 5, size = 40, shifted = 7) {
  const pos = [], uv = [];
  const step = size / (W - 1);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    let px = x * step;
    if (z * W + x === shifted) px += step;
    pos.push(-px, z * 2, z * step);
    uv.push(px / size, 1 - (z * step) / size);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

test("the terrain's size and heights come from its mesh", () => {
  const g = terrain();
  assert.deepEqual(terrainSize(g).map((v) => +v.toFixed(6)), [40, 40]);
  const h = terrainHeights(g);
  assert.equal(h(-5, 0), 0);
  assert.equal(+h(-20, 15).toFixed(6), 3); // z 15 is 1.5 cells: height 1.5 × 2
  // outside the grid: its edge
  assert.ok(Math.abs(h(10, 100) - 8) < 0.01);
});

test("grass lands in its cells, the same way every time", () => {
  const res = 4, data = new Uint8Array(res * res * 4);
  data[(1 * res + 2) * 4] = 3; // row 1 (from the top), column 2: 3 instances
  const proto = { min_width: 1, max_width: 2, min_height: 0.5, max_height: 1, noise_spread: 0.1 };
  const a = scatter({ width: res, height: res, data }, proto, [40, 40], () => 7, 5);
  const b = scatter({ width: res, height: res, data }, proto, [40, 40], () => 7, 5);
  assert.deepEqual(a, b);
  assert.equal(a.offsets.length, 9);
  for (let i = 0; i < 3; i++) {
    const [x, y, z] = a.offsets.slice(i * 3, i * 3 + 3);
    assert.ok(-x >= 20 && -x <= 30, `x ${x}`); // column 2 of 4 over 40 m, mirrored
    assert.ok(z >= 20 && z <= 30, `z ${z}`); // row 1 from the top: the second band from the far edge
    assert.equal(y, 7);
    const [w, hgt] = a.grass.slice(i * 4, i * 4 + 2);
    assert.ok(w >= 1 && w <= 2 && hgt >= 0.5 && hgt <= 1);
  }
  const r = random(1);
  assert.ok(r() !== r());
});

test("material curves drive the shaders' uniforms", () => {
  assert.deepEqual(uniformOf("_Color.g"), ["matColor", 1]);
  assert.deepEqual(uniformOf("_Emission.r"), ["matEmission", 0]);
  assert.deepEqual(uniformOf("_AmbColor.b"), ["matAmb", 2]);
  assert.deepEqual(uniformOf("_MainTex.offset.y"), ["uvST", 3]);
  assert.equal(uniformOf("_SpecColor.r"), null);
  assert.equal(uniformOf("_MainTex.rotation"), null);
  const times = [0, 1, 2], values = [0, 10, 0];
  assert.equal(sample(times, values, 0.5), 5);
  assert.equal(sample(times, values, 1.5), 5);
  assert.equal(sample(times, values, 5), 0);
  assert.equal(sample([0], [3], 9), 3);
});

test("a partial pack's missing tiles aren't sea", () => {
  assert.equal(new World("/w/", { manifest: { partial: true, tiles: { "04_05": {} } } }).partial, true);
  assert.equal(new World("/w/", { manifest: { partial: false } }).partial, false);
  assert.equal(new World("/w/").partial, false);
});

test("world positions", () => {
  assert.deepEqual(tileOrigin(4, 2), [-2048, 1024]);
  // the Future: Unity x 5632–7680, z 512–2560 (glTF x mirrored)
  assert.equal(skySetAt(-6000, 1000, [[5632, 512, 2048, 2048]]), "fusion");
  assert.equal(skySetAt(6000, 1000, [[5632, 512, 2048, 2048]]), "normal");
  assert.equal(skySetAt(-6000, 1000), "normal");
});

test("split clips sit beside their model", () => {
  assert.equal(splitClipUrl("/m/mob_drum.kfm.glb", "stand1"), "/m/mob_drum.kfm@stand1.glb");
  assert.equal(splitClipUrl("/m/x.glb?v=2", "a b"), "/m/x@a_b.glb?v=2");
  assert.equal(packClipUrl("/models/mob/mob_drum/default.glb", "stand1"), "/models/mob/mob_drum/clips/stand1.glb");
  assert.equal(packClipUrl("/a/b/c.glb?v=1", "x y"), "/a/b/clips/x%20y.glb?v=1");
  const json = { nodes: [{}, { extras: { animation: { clips: [{ name: "nif-default" }, { name: "stand1" }, { name: null }, { name: "run" }] } } }] };
  assert.deepEqual(animationClipNames(json), ["stand1", "run"]);
});
