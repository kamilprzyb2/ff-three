// The render CLI end to end in headless Chromium, on a world made here
// (test/helpers.js makeTile): needs CHROME, skipped without.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../cli/render.mjs";
import { decodePng } from "../src/png.js";
import { makeTile, solidPng } from "./helpers.js";

const chrome = process.env.CHROME;

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-three-world-"));
  for (const sub of ["tile", "shared", "sky/normal"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const [tx, ty, ground] of [[4, 2, 0], [5, 2, -20]]) {
    const { glb, shared } = makeTile(tx, ty, { ground });
    fs.writeFileSync(path.join(dir, "tile", `0${tx}_0${ty}.glb`), glb);
    for (const [name, bytes] of Object.entries(shared)) fs.writeFileSync(path.join(dir, "shared", name), bytes);
  }
  for (const side of ["front", "back", "left", "right", "up", "down"]) fs.writeFileSync(path.join(dir, "sky/normal", `skybox_${side}tex.png`), solidPng(4, [128, 128, 255]));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ format: "ff-unpack/world", fingerprint: "test", tiles: { "04_02": {}, "05_02": {} } }));
  return dir;
}

const at = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test("renders a tile from above and an area at an angle", { skip: !chrome && "set CHROME to a Chromium binary", timeout: 240000 }, async () => {
  const dir = world(), out = fs.mkdtempSync(path.join(os.tmpdir(), "ff-three-out-"));
  const jobs = path.join(out, "jobs.json");
  fs.writeFileSync(jobs, JSON.stringify([{ name: "view", type: "view", area: [4, 2, 4, 2], width: 320, height: 180 }]));
  const log = console.log;
  console.log = () => {};
  let code;
  try {
    code = await main(["--world", dir, "--out", out, "--topdown", "04_02", "--size", "128", "--jobs", jobs]);
  } finally {
    console.log = log;
  }
  assert.equal(code, 0);

  const top = await decodePng(fs.readFileSync(path.join(out, "04_02.png")));
  assert.deepEqual([top.width, top.height], [128, 128]);
  // west on the left: splat 0 (red) by the control map; east: splat 1 (blue)
  assert.ok(near(at(top, 10, 10), [200, 0, 0, 255]), `west ${at(top, 10, 10)}`);
  assert.ok(near(at(top, 117, 117), [0, 0, 200, 255]), `east ${at(top, 117, 117)}`);
  // the box's top in the middle: texture × (emission + ambient·0.2 + diffuse·N·L) × 2
  const nl = 0.309 / Math.hypot(0.8937, 0.309, 0.3253);
  const k = (0.25 + 0.3 * 0.2 + 0.3 * nl) * 2;
  assert.ok(near(at(top, 64, 64), [Math.round(128 * k), Math.round(255 * k), Math.round(128 * k), 255]), `box ${at(top, 64, 64)}`);

  const view = await decodePng(fs.readFileSync(path.join(out, "view.png")));
  assert.deepEqual([view.width, view.height], [320, 180]);
  const centre = at(view, 160, 120);
  assert.ok(centre[3] === 255 && (centre[0] > 60 || centre[2] > 60), `ground in view ${centre}`);

  const record = JSON.parse(fs.readFileSync(path.join(out, "renders.json"), "utf8"));
  assert.deepEqual(Object.keys(record.renders).sort(), ["04_02", "view"]);
  assert.equal(record.world, "test");
  // a second run renders nothing
  const before = fs.statSync(path.join(out, "04_02.png")).mtimeMs;
  console.log = () => {};
  try {
    assert.equal(await main(["--world", dir, "--out", out, "--topdown", "04_02", "--size", "128", "--jobs", jobs]), 0);
  } finally {
    console.log = log;
  }
  assert.equal(fs.statSync(path.join(out, "04_02.png")).mtimeMs, before);
});
