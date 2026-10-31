// What the client's own scripts do with a scene, replayed from the fields
// UnityPackFF writes into each node's extras.scripts (export_gltf.py
// --scripts): the Infected Zones' moving platforms (EpPlatformTrigger) and
// the effects the client places at runtime (EffectEmitterController: the
// zones' barriers). docs/SCRIPTS.md describes both.
//
// Script fields are as Unity stores them, so the motion is worked out in
// Unity's (left-handed) space and mirrored into glTF's at the end.
import * as THREE from "three";

// EpPlatformTrigger.MoveType
export const MOVE_TYPES = ["Line", "xCurve", "zCurve", "yCurve", "xRotate", "zRotate", "xRotate_Move", "zRotate_Move", "Line_Path", "xRotate_Path", "zRotate_Path"];

// Unity ↔ glTF: positions negate x, rotations (x, y, z, w) → (x, −y, −z, w).
// Both are their own inverse.
export const mirrorVector = (v) => new THREE.Vector3(-v.x, v.y, v.z);
export const mirrorQuaternion = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);

const vec = (v) => new THREE.Vector3(v ? v.x : 0, v ? v.y : 0, v ? v.z : 0);
const DEG = Math.PI / 180;
// Quaternion.Euler(x, 0, 0) and (0, 0, z), degrees
const eulerX = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg * DEG);
const eulerZ = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * DEG);

// The scripts of node `index` in a glTF document's JSON.
export function scriptsOf(json, index) {
  const node = json.nodes && json.nodes[index];
  return (node && node.extras && node.extras.scripts) || [];
}

// A path's waypoints (their `point`s, Unity vectors) from `head`, following
// each Waypoint's `next` through the nodes' scripts.
export function waypointPoints(json, head, count) {
  const points = [];
  let ref = head;
  for (let i = 0; ref && ref.node != null && i < Math.max(count, 1) + 1; i++) {
    const wp = scriptsOf(json, ref.node).find((s) => s.script === "Waypoint");
    if (!wp) break;
    points.push(vec(wp.fields.point));
    ref = wp.fields.next;
  }
  return points;
}

// A platform's motion as the client's EpPlatformTrigger works it out:
// returns (seconds) → { position, rotation } in Unity's world space, or null
// for a platform that doesn't move. `start`: { position (Vector3),
// rotation (Quaternion), scaleX } of its Transform in Unity's world space;
// `points`: its path's waypoints, for the *_Path types.
export function platformMotion(fields, start, points = []) {
  const type = MOVE_TYPES[fields.moveType] || "Line";
  const from = vec(fields.from), to = vec(fields.to);
  const moveLength = from.distanceTo(to);
  const velocity = fields.velocity || 0;
  if ((moveLength < 0.01 && type === "Line") || velocity === 0) return null;
  const R = start.rotation, P = start.position, s = start.scaleX ?? 1;
  const spin = fields.spinvelocity || 0;
  const center = to.clone().sub(from).multiplyScalar(0.5);
  const worldTo = to.clone().sub(from).applyQuaternion(R);
  const ease = (t) => Math.max(0, Math.min(1, t - Math.sin(t * 2 * Math.PI) * 0.15));

  if (type.endsWith("_Path")) {
    const n = Math.max(fields.waypointCount || points.length, 1);
    return (seconds) => {
      const timer = (seconds * velocity) % 1;
      let rotation = R;
      if (type === "xRotate_Path") rotation = R.clone().multiply(eulerX(timer * 2 * 180 * spin));
      if (type === "zRotate_Path") rotation = R.clone().multiply(eulerZ(timer * 2 * 180 * spin));
      const step = 1 / n, i = Math.min(Math.floor(timer / step), n - 1), f = (timer - step * i) / step;
      const a = points[i] || new THREE.Vector3(), b = points[i + 1];
      const p = b ? a.clone().multiplyScalar(1 - f).add(b.clone().multiplyScalar(f)) : a.clone();
      return { position: p.multiplyScalar(s).applyQuaternion(R).add(P), rotation };
    };
  }

  return (seconds) => {
    // MoveToTo while the timer runs up to 1, MoveToFrom on the way back
    const phase = (seconds * velocity) % 2;
    const out = phase < 1, timer = out ? phase : 2 - phase;
    let position = P.clone(), rotation = R;
    if (type === "xCurve" || type === "yCurve" || type === "zCurve") {
      const angle = out ? timer * Math.PI + Math.PI / 2 : 2 * Math.PI - timer * Math.PI + Math.PI / 2;
      const a = Math.sin(angle), b = Math.cos(angle);
      const v = type === "xCurve" ? new THREE.Vector3(0, a, b) : type === "yCurve" ? new THREE.Vector3(a, 0, b) : new THREE.Vector3(a, b, 0);
      position = v.multiplyScalar(moveLength * 0.5).add(center).multiplyScalar(s).applyQuaternion(R).add(P);
    } else {
      const e = ease(timer);
      if (type.startsWith("xRotate")) rotation = R.clone().multiply(eulerX(e * 180 * spin));
      if (type.startsWith("zRotate")) rotation = R.clone().multiply(eulerZ(e * 180 * spin));
      if (type === "Line" || type.endsWith("_Move")) position = P.clone().add(worldTo.clone().multiplyScalar(e));
    }
    return { position, rotation };
  };
}

// Starts every moving platform of a loaded scene. Returns
// { count, update(seconds) } moving the platforms' nodes to where they are
// `seconds` after the scene starts.
export function startPlatforms(gltf) {
  const json = gltf.parser.json;
  const objects = new Map();
  gltf.scene.traverse((o) => {
    const a = gltf.parser.associations.get(o);
    if (a && a.nodes !== undefined && !objects.has(a.nodes)) objects.set(a.nodes, o);
  });
  gltf.scene.updateMatrixWorld(true);
  const moving = [];
  for (const [i] of (json.nodes || []).entries()) {
    const platform = scriptsOf(json, i).find((s) => s.script === "EpPlatformTrigger" && s.enabled);
    const object = objects.get(i);
    if (!platform || !object) continue;
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    object.matrixWorld.decompose(position, rotation, scale);
    const f = platform.fields;
    const motion = platformMotion(f, { position: mirrorVector(position), rotation: mirrorQuaternion(rotation), scaleX: object.scale.x },
      f.head ? waypointPoints(json, f.head, f.waypointCount) : []);
    if (motion) moving.push({ object, motion });
  }
  const parentRotation = new THREE.Quaternion(), local = new THREE.Vector3();
  return {
    count: moving.length,
    update(seconds) {
      for (const { object, motion } of moving) {
        const { position, rotation } = motion(seconds);
        // world → the parent's space
        local.copy(mirrorVector(position));
        if (object.parent) object.parent.worldToLocal(local);
        object.position.copy(local);
        const world = mirrorQuaternion(rotation);
        if (object.parent) object.parent.getWorldQuaternion(parentRotation); else parentRotation.identity();
        object.quaternion.copy(parentRotation.invert().multiply(world));
      }
    },
  };
}

// The effects a scene's EffectEmitterController scripts place, as
// [{ node, object, name }]: `name` is the effect prefab's name (its
// nifObject), lower case, as a world pack's manifest lists it.
export function effectPlacements(gltf) {
  const json = gltf.parser.json;
  const objects = new Map();
  gltf.scene.traverse((o) => {
    const a = gltf.parser.associations.get(o);
    if (a && a.nodes !== undefined && !objects.has(a.nodes)) objects.set(a.nodes, o);
  });
  const out = [];
  for (const [i] of (json.nodes || []).entries()) {
    for (const s of scriptsOf(json, i)) {
      if (s.script !== "EffectEmitterController" || !s.enabled) continue;
      const prefab = s.fields.nifObject;
      if (!prefab || !prefab.object || !objects.get(i)) continue;
      out.push({ node: i, object: objects.get(i), name: prefab.object.toLowerCase(), effect: s.fields.effectName });
    }
  }
  return out;
}
