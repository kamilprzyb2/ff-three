// Animated props: what a scene's Animation components play by themselves.
//
// UnityPackFF writes how each Animation plays its clips into its node's
// extras.animation (clips in order, each a glTF animation or an index into
// the document's extras.material_clips; the default; wrap mode; play
// automatically; enabled). Clips' curves on material properties (_Color,
// _Emission, _AmbColor, _MainTex's offset) are in the animation's
// extras.float_curves, or in a material clip's, sampled at the clip's rate:
// {"<path>:<property>": {input, output, node}}, accessors of times and
// values. Unity applies them to the renderer on that node, so its meshes get
// materials of their own (materials.js Dressing.unique()).
//
// Every enabled Animation that plays automatically plays its default clip,
// looped: the three builds' map props all have one clip (nif-default), wrap
// mode Default, and loop in the game (water wheels, flags, signs).
import * as THREE from "three";

// glTF animation `index` of `json` as a clip whose tracks bind to the
// objects GLTFLoader made for the nodes (by uuid: names aren't unique).
export async function clipFromGltf(parser, index, objectOf) {
  const def = parser.json.animations[index];
  const tracks = [];
  for (const ch of def.channels) {
    const target = objectOf(ch.target.node);
    if (!target) continue;
    const sampler = def.samplers[ch.sampler];
    const [input, output] = await Promise.all([parser.getDependency("accessor", sampler.input), parser.getDependency("accessor", sampler.output)]);
    const times = Float32Array.from(input.array);
    const values = Float32Array.from(output.array);
    const name = `${target.uuid}.${{ translation: "position", rotation: "quaternion", scale: "scale" }[ch.target.path]}`;
    const Track = ch.target.path === "rotation" ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(name, times, values, THREE.InterpolateLinear));
  }
  return new THREE.AnimationClip(def.name || `animation ${index}`, -1, tracks);
}

// Which uniform and component a material property animates: "_Color.r" →
// ["matColor", 0], "_MainTex.offset.y" → ["uvST", 3]. Null for those the
// shaders don't use (_SpecColor, _MainTex.rotation).
export function uniformOf(property) {
  const m = /^(_Color|_AmbColor|_Emission)\.([rgba])$/.exec(property);
  if (m) return [{ _Color: "matColor", _AmbColor: "matAmb", _Emission: "matEmission" }[m[1]], "rgba".indexOf(m[2])];
  const t = /^_MainTex\.offset\.([xy])$/.exec(property);
  if (t) return ["uvST", t[1] === "x" ? 2 : 3];
  return null;
}

// Linear interpolation in sampled (times, values) at time t.
export function sample(times, values, t) {
  const n = times.length;
  if (n === 1 || t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  const f = (t - times[lo]) / (times[hi] - times[lo] || 1);
  return values[lo] + (values[hi] - values[lo]) * f;
}

async function floatTrack(parser, track) {
  if (track.times) return { times: track.times, values: track.values.map((v) => v ?? 0) };
  const [input, output] = await Promise.all([parser.getDependency("accessor", track.input), parser.getDependency("accessor", track.output)]);
  return { times: input.array, values: output.array };
}

// The meshes a node's renderer draws: the node itself, or the primitives
// GLTFLoader put under it as children.
function meshesOf(object, parser, node) {
  if (!object) return [];
  if (object.isMesh) return [object];
  return object.children.filter((c) => {
    const a = parser.associations.get(c);
    return c.isMesh && a && a.nodes === undefined && a.meshes !== undefined && parser.json.nodes[node].mesh === a.meshes;
  });
}

// Starts every automatic Animation in a loaded glTF (`gltf` from
// GLTFLoader, dressed with materials.js `dressing`). Returns
// { mixer, update(dt), stop() }; update() advances the transforms and the
// material curves, and is cheap when nothing animates.
export async function playAnimations(gltf, dressing) {
  const parser = gltf.parser;
  const json = parser.json;
  const objects = new Map();
  gltf.scene.traverse((o) => {
    const a = parser.associations.get(o);
    if (a && a.nodes !== undefined && !objects.has(a.nodes)) objects.set(a.nodes, o);
  });
  const objectOf = (i) => objects.get(i) || null;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const materialTracks = []; // { times, values, uniforms: [{ value: Vector4 }], component, duration }
  const clipCache = new Map();
  let playing = 0;

  async function addFloatCurves(curves, duration) {
    for (const [key, track] of Object.entries(curves || {})) {
      const property = key.slice(key.lastIndexOf(":") + 1);
      const target = uniformOf(property);
      if (!target || track.node == null) continue;
      const meshes = meshesOf(objectOf(track.node), parser, track.node).filter((m) => m.userData.ffInfo && (m.userData.ffInfo.family === "normal" || m.userData.ffInfo.family === "unknown"));
      if (!meshes.length) continue;
      const uniforms = [];
      for (const mesh of meshes) {
        for (const mat of await dressing.unique(mesh)) if (mat.uniforms && mat.uniforms[target[0]]) uniforms.push(mat.uniforms[target[0]]);
      }
      const { times, values } = await floatTrack(parser, track);
      materialTracks.push({ times, values, uniforms, component: target[1], duration });
    }
  }

  for (const [i, node] of (json.nodes || []).entries()) {
    const info = node.extras && node.extras.animation;
    if (!info || !info.enabled || !info.play_automatically || info.default == null) continue;
    const entry = info.clips[info.default];
    if (!entry) continue;
    if (entry.animation != null) {
      const def = json.animations[entry.animation];
      if (!clipCache.has(entry.animation)) clipCache.set(entry.animation, await clipFromGltf(parser, entry.animation, objectOf));
      const clip = clipCache.get(entry.animation);
      if (clip.tracks.length) mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
      const extras = def.extras || {};
      await addFloatCurves(extras.float_curves, clip.duration);
      playing++;
    } else if (entry.material_clip != null) {
      const mc = json.extras.material_clips[entry.material_clip];
      let duration = 0;
      for (const t of Object.values(mc.float_curves || {})) {
        const ft = await floatTrack(parser, t);
        duration = Math.max(duration, ft.times[ft.times.length - 1] || 0);
      }
      await addFloatCurves(mc.float_curves, duration);
      playing++;
    }
  }

  let time = 0;
  return {
    mixer,
    playing,
    update(dt) {
      mixer.update(dt);
      time += dt;
      for (const tr of materialTracks) {
        const t = tr.duration > 0 ? time % tr.duration : 0;
        const v = sample(tr.times, tr.values, t);
        for (const u of tr.uniforms) u.value.setComponent(tr.component, v);
      }
    },
    stop() {
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
    },
  };
}
