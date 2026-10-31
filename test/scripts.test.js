import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { platformMotion, waypointPoints, mirrorVector, mirrorQuaternion, MOVE_TYPES } from "../src/scripts.js";

const start = (x = 0, y = 0, z = 0) => ({ position: new THREE.Vector3(x, y, z), rotation: new THREE.Quaternion(), scaleX: 1 });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const at = (v) => v.toArray().map((c) => +c.toFixed(4) || 0);

test("a platform eases from `from` to `to` and back, as EpPlatformTrigger", () => {
  // velocity 0.1: 10 s out, 10 s back
  const m = platformMotion({ moveType: 0, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 10, z: 0 }, velocity: 0.1 }, start(5, 1, 2));
  assert.deepEqual(at(m(0).position), [5, 1, 2]);
  assert.deepEqual(at(m(5).position), [5, 6, 2]); // halfway: the ease (t − sin 2πt · 0.15) is 0.5
  assert.deepEqual(at(m(10).position), [5, 11, 2]);
  assert.deepEqual(at(m(15).position), [5, 6, 2]); // on the way back
  assert.deepEqual(at(m(20).position), [5, 1, 2]);
  // eased: a quarter of the time is less than a quarter of the way
  const q = m(2.5).position.y - 1;
  assert.ok(near(q, 10 * (0.25 - Math.sin(Math.PI / 2) * 0.15)));
});

test("platforms that can't move are left alone", () => {
  assert.equal(platformMotion({ moveType: 0, from: { x: 1, y: 1, z: 1 }, to: { x: 1, y: 1, z: 1 }, velocity: 1 }, start()), null);
  assert.equal(platformMotion({ moveType: 0, from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 }, velocity: 0 }, start()), null);
});

test("the platform's rotation turns its path, and spinners spin", () => {
  // turned 90° about y: Unity's +x becomes −z
  const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const m = platformMotion({ moveType: 0, from: {}, to: { x: 10, y: 0, z: 0 }, velocity: 0.1 }, { position: new THREE.Vector3(), rotation: r, scaleX: 1 });
  assert.deepEqual(at(m(10).position), [0, 0, -10]);
  // zRotate: half a turn (spinvelocity 1) when the timer reaches 1, in place
  const spin = platformMotion({ moveType: MOVE_TYPES.indexOf("zRotate"), from: {}, to: { x: 0, y: 0, z: 0 }, velocity: 0.5, spinvelocity: 1 }, start(3, 0, 0));
  const { position, rotation } = spin(2);
  assert.deepEqual(at(position), [3, 0, 0]);
  assert.ok(near(Math.abs(rotation.z), 1, 1e-6)); // 180° about z
});

test("a curve swings along half a circle and back along the other half", () => {
  const m = platformMotion({ moveType: MOVE_TYPES.indexOf("yCurve"), from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 10 }, velocity: 1 }, start());
  // centre (0, 0, 5), radius 5: starts at (0, 0, 5) + 5 · (sin, 0, cos)(π/2) = (5, 0, 5)
  assert.deepEqual(at(m(0).position), [5, 0, 5]);
  assert.deepEqual(at(m(0.5).position), [0, 0, 0]);
  assert.deepEqual(at(m(1).position), [-5, 0, 5]);
  assert.deepEqual(at(m(1.5).position), [0, 0, 10]); // back along the other side
});

test("a path follows its waypoints, looping", () => {
  const json = { nodes: [
    { extras: { scripts: [{ script: "Waypoint", fields: { point: { x: 0, y: 0, z: 0 }, next: { node: 1, component: "Waypoint" } } }] } },
    { extras: { scripts: [{ script: "Waypoint", fields: { point: { x: 10, y: 0, z: 0 }, next: { node: 2, component: "Waypoint" } } }] } },
    { extras: { scripts: [{ script: "Waypoint", fields: { point: { x: 10, y: 10, z: 0 }, next: null } }] } },
  ] };
  const points = waypointPoints(json, { node: 0 }, 2);
  assert.deepEqual(points.map(at), [[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
  const m = platformMotion({ moveType: MOVE_TYPES.indexOf("Line_Path"), from: {}, to: {}, velocity: 0.5, waypointCount: 2 }, start(1, 0, 0), points);
  assert.deepEqual(at(m(0).position), [1, 0, 0]);
  assert.deepEqual(at(m(0.5).position), [6, 0, 0]); // timer 0.25: halfway along the first leg
  assert.deepEqual(at(m(1.5).position), [11, 5, 0]);
  assert.deepEqual(at(m(2).position), [1, 0, 0]); // round again
});

test("Unity and glTF mirror into each other", () => {
  assert.deepEqual(mirrorVector(new THREE.Vector3(1, 2, 3)).toArray(), [-1, 2, 3]);
  const q = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9);
  assert.deepEqual(mirrorQuaternion(mirrorQuaternion(q)).toArray(), q.toArray());
});
