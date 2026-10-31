import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePng, resizeRgba } from "../src/png.js";
import { encodePng, rgbaPng } from "./helpers.js";

const px = (img, x, y) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test("RGBA keeps the colour under zero alpha (no premultiplying)", async () => {
  // a terrain control map: the fourth weight in alpha, often 0
  const data = new Uint8Array([255, 128, 7, 0, 1, 2, 3, 4, 10, 20, 30, 255, 0, 0, 0, 0]);
  const img = await decodePng(rgbaPng(2, 2, data));
  assert.deepEqual([img.width, img.height], [2, 2]);
  assert.deepEqual(Array.from(img.data), Array.from(data));
});

test("every row filter", async () => {
  const w = 7, h = 10, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 3) * 11) & 255;
  for (const f of [0, 1, 2, 3, 4]) {
    const img = await decodePng(rgbaPng(w, h, data, [f]));
    assert.deepEqual(Array.from(img.data), Array.from(data), `filter ${f}`);
  }
  const mixed = await decodePng(rgbaPng(w, h, data, [4, 3, 2, 1, 0]));
  assert.deepEqual(Array.from(mixed.data), Array.from(data));
});

test("greyscale, with and without alpha, and 16-bit samples", async () => {
  const grey = await decodePng(encodePng({ width: 2, height: 1, colorType: 0, rows: [new Uint8Array([0, 200])] }));
  assert.deepEqual(Array.from(grey.data), [0, 0, 0, 255, 200, 200, 200, 255]);
  const ga = await decodePng(encodePng({ width: 1, height: 1, colorType: 4, rows: [new Uint8Array([90, 30])] }));
  assert.deepEqual(Array.from(ga.data), [90, 90, 90, 30]);
  // 16-bit RGB: the high byte of each sample
  const rgb16 = await decodePng(encodePng({ width: 1, height: 1, depth: 16, colorType: 2, rows: [new Uint8Array([1, 2, 3, 4, 5, 6])] }));
  assert.deepEqual(Array.from(rgb16.data), [1, 3, 5, 255]);
});

test("low bit depths scale to 0–255", async () => {
  // 1-bit grey: 1 0 1 1 0 0 0 1 → bits 10110001
  const one = await decodePng(encodePng({ width: 8, height: 1, depth: 1, colorType: 0, rows: [new Uint8Array([0b10110001])] }));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((x) => px(one, x, 0)[0]), [255, 0, 255, 255, 0, 0, 0, 255]);
  // 4-bit grey: 0xF and 0x5
  const four = await decodePng(encodePng({ width: 2, height: 1, depth: 4, colorType: 0, rows: [new Uint8Array([0xf5])] }));
  assert.deepEqual([px(four, 0, 0)[0], px(four, 1, 0)[0]], [255, 85]);
});

test("palettes with transparency, and a transparent key colour", async () => {
  const palette = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const trns = new Uint8Array([255, 0]); // entry 1 transparent, entry 2 opaque (missing)
  const img = await decodePng(encodePng({ width: 3, height: 1, depth: 2, colorType: 3, rows: [new Uint8Array([0b00011000])], palette, trns }));
  assert.deepEqual([px(img, 0, 0), px(img, 1, 0), px(img, 2, 0)], [[255, 0, 0, 255], [0, 255, 0, 0], [0, 0, 255, 255]]);
  const keyed = await decodePng(encodePng({ width: 2, height: 1, colorType: 2, rows: [new Uint8Array([1, 2, 3, 4, 5, 6])], trns: new Uint8Array([0, 4, 0, 5, 0, 6]) }));
  assert.deepEqual([px(keyed, 0, 0)[3], px(keyed, 1, 0)[3]], [255, 0]);
});

test("rejects what it can't read", async () => {
  await assert.rejects(decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /not a PNG/);
  await assert.rejects(decodePng(encodePng({ width: 1, height: 1, colorType: 6, rows: [new Uint8Array(4)], interlace: 1 })), /interlaced/);
});

test("resizing averages when shrinking and interpolates when growing", () => {
  const img = { width: 2, height: 2, data: new Uint8Array([0, 0, 0, 0, 100, 100, 100, 100, 200, 200, 200, 200, 40, 40, 40, 40]) };
  assert.deepEqual(Array.from(resizeRgba(img, 1)), [85, 85, 85, 85]);
  const big = resizeRgba(img, 4);
  assert.equal(big.length, 4 * 4 * 4);
  assert.equal(resizeRgba(img, 2), img.data);
});
