import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { hitboxObject, hitboxList, PLAYER_HITBOX } from "../src/model-viewer.js";

const bounds = (o) => {
  o.geometry.computeBoundingBox();
  return o.geometry.boundingBox.min.toArray().concat(o.geometry.boundingBox.max.toArray()).map((v) => +v.toFixed(3) || 0);
};

test("an NPC's hitbox is a cylinder on its origin, its row's size", () => {
  // Fusion Eduardo: m_iRadius 170, m_iHeight 450
  assert.deepEqual(bounds(hitboxObject({ radius: 1.7, height: 4.5 })), [-1.7, 0, -1.7, 1.7, 4.5, 1.7]);
});

test("the hitbox doesn't grow with the model's scale, so it's drawn divided by it", () => {
  // a model drawn at ×1 that the game shows at ×2: its 1 m hitbox is half as big beside it
  assert.deepEqual(bounds(hitboxObject({ radius: 1, height: 2, scale: 2 })), [-0.5, 0, -0.5, 0.5, 1, 0.5]);
});

test("a player's is the 0.3 × 1.6 m capsule", () => {
  assert.deepEqual(hitboxList("player"), [PLAYER_HITBOX]);
  const b = bounds(hitboxObject(PLAYER_HITBOX));
  assert.deepEqual(b, [-0.3, 0, -0.3, 0.3, 1.6, 0.3]);
  assert.equal(hitboxObject(PLAYER_HITBOX).isLineSegments, true);
});

test("one hitbox, a list, or none", () => {
  assert.deepEqual(hitboxList(null), []);
  assert.deepEqual(hitboxList({ radius: 1, height: 2 }), [{ radius: 1, height: 2 }]);
  assert.equal(hitboxList([{ radius: 1, height: 2 }, "player"]).length, 2);
});
