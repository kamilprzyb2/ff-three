// The model viewer: a character, mob, NPC, nano or item from a UnityPackFF
// GLB, drawn with the client's shaders (materials.js: toon with outlines,
// the face decal, the fusions' skin, normal_* parts), turning on the spot,
// cycling its idle stands as the game does, with a picker for its other
// clips.
//
// Clips come from the GLB itself or, for GLBs exported with
// --split-clips, from <model>@<clip>.glb beside it (loaded when picked):
// those have the same nodes in the same order, so their channels are bound
// to the model's objects by node index (names aren't unique). The clip list is the Animation's own
// (extras.animation on the model's root) unless options.menu gives one.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createEnvironment } from "./environment.js";
import { dress } from "./materials.js";
import { clipFromGltf } from "./animation.js";

// Toward the light, in view space: upper left, in front (as the portraits).
export const VIEW_LIGHT = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();

// The clip every prefab carries: its bind pose. Not offered.
export const BIND_POSE_CLIP = "nif-default";

// The URL of a split clip: <model>@<clip>.glb, with the clip name as
// UnityPackFF's export_gltf.py writes file names.
export function splitClipUrl(modelUrl, clip) {
  const i = modelUrl.toLowerCase().lastIndexOf(".glb");
  const stem = i >= 0 ? modelUrl.slice(0, i) : modelUrl;
  return `${stem}@${clip.replace(/[^\w.@-]/g, "_")}.glb${i >= 0 ? modelUrl.slice(i + 4) : ""}`;
}

// The URL of a clip in an ff-unpack pack: <prefab>/clips/<clip>.glb beside
// <prefab>/<variant>.glb (its manifest lists them too).
export function packClipUrl(modelUrl, clip) {
  const q = modelUrl.indexOf("?");
  const path = q >= 0 ? modelUrl.slice(0, q) : modelUrl;
  return `${path.slice(0, path.lastIndexOf("/") + 1)}clips/${encodeURIComponent(clip)}.glb${q >= 0 ? modelUrl.slice(q) : ""}`;
}

// The clips the model's Animation lists, in order (names), from the
// extras.animation of its first node that has one.
export function animationClipNames(json) {
  for (const node of json.nodes || []) {
    const info = node.extras && node.extras.animation;
    if (info) return info.clips.map((c) => c.name).filter((n) => n && n !== BIND_POSE_CLIP);
  }
  return [];
}

// The idle cycle (cnAvatarAnimation): when stand1 ends the next idle is
// stand1–4 at random, the others go back to stand1, each change
// cross-fading over 0.3 s. Human NPCs pick one of their `idles` at random
// each time instead. play() plays one clip, then back to the idles
// ("idle", as the game's emotes), again ("loop") or held ("hold").
export function animator(mixer, getClip, names, idles, onIdle) {
  const stands = {};
  for (const n of names) {
    const m = /stand([1-4])$/.exec(n);
    if (m && !stands[m[1]]) stands[m[1]] = n;
  }
  const npc = (idles || []).filter((n) => names.includes(n));
  const first = npc[0] || stands["1"] || Object.values(stands)[0] || names[0] || null;
  let current = null, mode = "idles", token = 0;

  async function start(name, fade, loop) {
    const mine = ++token;
    const clip = await getClip(name);
    if (!clip || mine !== token) return false;
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.reset().play();
    if (current && current !== action) current.crossFadeTo(action, fade, false);
    current = action;
    return true;
  }

  mixer.addEventListener("finished", (e) => {
    if (e.action !== current) return;
    if (mode === "idle") { api.idle(); return; }
    if (mode !== "idles") return;
    const name = current.getClip().name;
    let next;
    if (npc.length) next = npc[Math.floor(Math.random() * npc.length)];
    else next = name === first ? stands[String(1 + Math.floor(Math.random() * 4))] || first : first;
    start(next, 0.3, false);
  });

  const api = {
    first,
    idle() {
      mode = "idles";
      onIdle();
      return first ? start(first, 0.3, !Object.keys(stands).length && !npc.length) : Promise.resolve(false);
    },
    play(name, then = "loop") {
      mode = then;
      return start(name, 0.15, then === "loop");
    },
  };
  return api;
}

// A soft round shadow on the floor under `box`.
function floorShadow(box) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.28)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const r = Math.max(0.32, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.45);
  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2, r * 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.002, (box.min.z + box.max.z) / 2);
  disc.renderOrder = -2;
  return disc;
}

function el(tag, props, children) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  for (const c of children || []) e.append(c);
  return e;
}

// A player's collider: the CharacterController capsule on the client's
// player containers (radius 0.3 m, 1.6 m tall), the same for everyone.
export const PLAYER_HITBOX = { label: "player", radius: 0.3, height: 1.6, capsule: true };

// The hitboxes an option gives: "player", one { radius, height, … } or a list.
export function hitboxList(option) {
  if (!option) return [];
  return [].concat(option).map((h) => (h === "player" ? PLAYER_HITBOX : h));
}

// A hitbox as a wireframe standing on the model's origin, where the game
// places it: a vertical cylinder for NPCs and mobs (their NPC row's
// m_iRadius and m_iHeight, in metres), a capsule for players. In game the
// model is scaled by its NPC row's m_fScale and the hitbox isn't, so it's
// drawn divided by `scale` to sit right against the unscaled model.
export function hitboxObject({ radius, height, capsule = false, scale = 1 }) {
  const r = radius / scale, h = height / scale;
  const geometry = capsule
    ? new THREE.CapsuleGeometry(r, Math.max(h - 2 * r, 0), 4, 16).translate(0, h / 2, 0)
    : new THREE.CylinderGeometry(r, r, h, 24, 1, true).translate(0, h / 2, 0);
  const lines = new THREE.LineSegments(new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.85, depthTest: false }));
  geometry.dispose();
  lines.renderOrder = 10;
  lines.raycast = () => {};
  lines.name = "hitbox";
  return lines;
}

// The picker: emote icons, every clip by group, pause, speed, turntable,
// and the hitbox. `menu`: [{ title, hide_weapon, clips: [{ clip, label,
// icon, then }] }]; `hitboxes`: hitboxList()'s.
function picker(box, menu, iconUrl, on, hitboxes = []) {
  const select = el("select", { className: "ff-input", ariaLabel: "Animation" });
  select.append(el("option", { value: "", textContent: "Idle" }));
  const entries = new Map();
  menu.forEach((g, gi) => {
    const og = el("optgroup", { label: g.title });
    g.clips.forEach((c, ci) => {
      const key = gi + ":" + ci;
      entries.set(key, { entry: c, group: g });
      og.append(el("option", { value: key, textContent: c.label || c.clip }));
    });
    select.append(og);
  });
  select.addEventListener("change", () => {
    const e = entries.get(select.value);
    if (e) on.play(e.entry, e.group); else on.idle();
  });

  const icons = el("div", { className: "ff-emotes" });
  menu.forEach((g, gi) => g.clips.forEach((c, ci) => {
    if (!c.icon || !iconUrl) return;
    const b = el("button", { type: "button", className: "ff-emote", title: c.label, ariaLabel: c.label });
    // the chat icons are small white glyphs: a mask takes the page's ink
    const glyph = el("span", { className: "ff-emote-icon" });
    glyph.style.maskImage = glyph.style.webkitMaskImage = `url("${iconUrl(c.icon)}")`;
    b.append(glyph);
    b.addEventListener("click", () => { select.value = gi + ":" + ci; on.play(c, g); });
    icons.append(b);
  }));

  const pause = el("button", { type: "button", className: "ff-button" });
  const showPaused = (p) => {
    pause.textContent = p ? "Play" : "Pause";
    pause.setAttribute("aria-pressed", String(p));
  };
  showPaused(on.paused());
  pause.addEventListener("click", () => showPaused(on.togglePause()));
  const speed = el("select", { className: "ff-input", ariaLabel: "Speed" });
  for (const s of [0.25, 0.5, 1, 2]) speed.append(el("option", { value: s, textContent: s + "×", selected: s === 1 }));
  speed.addEventListener("change", () => on.speed(+speed.value));
  const turn = el("button", { type: "button", className: "ff-button", textContent: "Turntable" });
  turn.setAttribute("aria-pressed", String(on.turntable(null)));
  turn.addEventListener("click", () => turn.setAttribute("aria-pressed", String(on.turntable(turn.getAttribute("aria-pressed") !== "true"))));

  const extra = [];
  if (hitboxes.length) {
    // off by default; a list when the model's NPC rows differ in size
    const which = el("select", { className: "ff-input", ariaLabel: "Hitbox" });
    hitboxes.forEach((h, i) => which.append(el("option", { value: i, textContent: h.label || `${h.radius} × ${h.height} m` })));
    const toggle = el("button", { type: "button", className: "ff-button", textContent: "Hitbox" });
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "The hitbox the game uses: a cylinder for NPCs and mobs, a capsule for players";
    const show = () => on.hitbox(toggle.getAttribute("aria-pressed") === "true" ? +which.value : null);
    toggle.addEventListener("click", () => { toggle.setAttribute("aria-pressed", String(toggle.getAttribute("aria-pressed") !== "true")); show(); });
    which.addEventListener("change", show);
    extra.push(toggle);
    if (hitboxes.length > 1) extra.push(which);
  }
  const row = el("div", { className: "ff-row" }, [...(menu.length ? [select, pause, speed, turn] : [turn]), ...extra]);
  box.replaceChildren(...(icons.childElementCount ? [icons] : []), row);
  return { idle() { select.value = ""; }, showPaused };
}

// Mounts the viewer for the GLB at `url` in `stage` (an element; its
// controls go in options.controls) and resolves to { dispose, gltf }.
// Options (each can also come from the GLB's root extras):
//   kind       "player" | "creature" | "item" (framing; default: creature,
//              or player for ActorSkinCombiner rigs)
//   menu       the picker's groups (default: the model's clips, one group)
//   idles      human NPCs' idle clips
//   clips      { name: URL } of its clips (an ff-unpack manifest's, relative
//              to the model); without it, the clips the GLB holds or its
//              Animation lists
//   clipUrl    name → URL of a clip file (default: from `clips`, else
//              splitClipUrl; packClipUrl for an ff-unpack pack)
//   iconUrl    icon → URL for the menu's emote icons
//   weapon     lay a tall item on its side (weapons hang pointing down)
//   hitbox     "player", or { radius, height, scale, label } in metres (an NPC
//              row's m_iRadius and m_iHeight / 100 and its m_fScale), or a
//              list of them: a "Hitbox" toggle in the controls, off at first
//   loader     a GLTFLoader to use (one with a LoadingManager for dropped files)
export async function mountModel(stage, url, options = {}) {
  const base = new URL(url, location.href).href;
  const loader = options.loader || new GLTFLoader();
  const gltf = await loader.loadAsync(base);
  const info = { ...(gltf.userData || {}), ...options };
  const env = createEnvironment();
  const scene = new THREE.Scene();
  const pivot = new THREE.Group();
  pivot.add(gltf.scene);
  scene.add(pivot);

  const dressing = await dress(gltf.scene, gltf.parser, { env });
  gltf.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const objects = new Map();
  gltf.scene.traverse((o) => {
    const a = gltf.parser.associations.get(o);
    if (a && a.nodes !== undefined && !objects.has(a.nodes)) objects.set(a.nodes, o);
  });
  const objectOf = (i) => objects.get(i) || null;
  const json = gltf.parser.json;
  const own = new Map((json.animations || []).map((a, i) => [a.name, i]).filter(([n]) => n !== BIND_POSE_CLIP));
  const listed = info.clips ? Object.keys(info.clips).filter((n) => n !== BIND_POSE_CLIP) : null;
  const names = own.size ? [...own.keys()] : listed || animationClipNames(json);
  const clipUrl = info.clipUrl || (info.clips ? (name) => info.clips[name] : (name) => splitClipUrl(base, name));
  const loaded = new Map();
  function getClip(name) {
    if (!loaded.has(name)) {
      const clip = own.has(name)
        ? clipFromGltf(gltf.parser, own.get(name), objectOf)
        : loader.loadAsync(new URL(clipUrl(name), base).href).then((from) => (from.parser.json.animations ? clipFromGltf(from.parser, 0, objectOf) : null));
      loaded.set(name, clip.catch((e) => { console.warn(`ff-three: clip ${name}:`, e); return null; }));
    }
    return loaded.get(name);
  }
  let weapon = null;
  gltf.scene.traverse((o) => { if (o.userData && o.userData.slot === "weapon") weapon = o; });
  let ui = null;
  const anim = animator(mixer, getClip, names, info.idles, () => {
    if (weapon) weapon.visible = true;
    if (ui) ui.idle();
  });

  // Frame on the first idle's first frame (prefabs' rest poses are their
  // bind poses).
  const firstClip = anim.first ? await getClip(anim.first) : null;
  if (firstClip) { mixer.clipAction(firstClip).play(); mixer.update(0); }
  const rigid = info.kind === "item";
  const player = info.kind === "player";
  const hitboxes = hitboxList(info.hitbox);
  const box = new THREE.Box3().setFromObject(pivot, true);
  const size0 = box.getSize(new THREE.Vector3());
  if (rigid && info.weapon && size0.y > Math.max(size0.x, size0.z)) pivot.rotation.z = Math.PI / 2;
  // turned a little, like the portraits
  pivot.rotation.y = rigid ? 0 : THREE.MathUtils.degToRad(20);
  pivot.updateMatrixWorld(true);
  box.setFromObject(pivot, true);
  const body = new THREE.Box3();
  pivot.traverse((o) => { if (o.isSkinnedMesh) body.expandByObject(o, true); });
  if (box.isEmpty()) {
    // nothing drawn (a bare skeleton, such as the player actors): frame the
    // hitbox, or a person's size
    if (hitboxes.length) box.setFromObject(hitboxObject(hitboxes[0]));
    else box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.8, 0.5));
  }
  if (body.isEmpty()) body.copy(box);
  mixer.stopAllAction();
  if (!rigid) scene.add(floorShadow(body));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the client does no gamma handling
  stage.replaceChildren(renderer.domElement);

  // Straight on: centred on the body, far enough for its height and for
  // wings, weapons or a mob's tail.
  const center = body.getCenter(new THREE.Vector3());
  center.y = (box.min.y + box.max.y) / 2;
  const reach = Math.max(center.x - box.min.x, box.max.x - center.x, rigid ? (box.max.z - box.min.z) / 2 : 0);
  const tan = Math.tan(THREE.MathUtils.degToRad(15));
  const aspect = (stage.clientWidth || 1) / (stage.clientHeight || 1);
  const fit = Math.max((box.max.y - box.min.y) / 2, reach / aspect, 0.05) / tan * (player ? 1.1 : 1.2);
  const camera = new THREE.PerspectiveCamera(30, aspect, fit * 0.01, fit * 20);
  camera.position.set(center.x, center.y + fit * (rigid ? 0.25 : player ? 0.07 : 0.03), center.z + fit);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.copy(center);
  orbit.enablePan = false;
  orbit.enableDamping = true;
  orbit.minDistance = fit * 0.35;
  orbit.maxDistance = fit * 1.8;
  orbit.autoRotate = rigid && !reduce;
  orbit.autoRotateSpeed = 2.5;
  orbit.update();

  function resize() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  let speed = 1, paused = reduce, running = true;
  let shownHitbox = null;
  const on = {
    async play(entry, group) {
      if (weapon) weapon.visible = !group.hide_weapon;
      await anim.play(entry.clip, entry.then || "loop");
      if (paused) { paused = false; if (ui) ui.showPaused(false); }
    },
    idle() { anim.idle(); },
    paused() { return paused; },
    togglePause() { paused = !paused; return paused; },
    speed(s) { speed = s; },
    turntable(v) { if (v !== null) orbit.autoRotate = v; return orbit.autoRotate; },
    hitbox(index) {
      if (shownHitbox) { pivot.remove(shownHitbox); shownHitbox.geometry.dispose(); shownHitbox.material.dispose(); shownHitbox = null; }
      if (index != null && hitboxes[index]) pivot.add(shownHitbox = hitboxObject(hitboxes[index]));
    },
  };
  const menu = info.menu || (names.length > 1 ? [{ title: "Clips", hide_weapon: false, clips: names.map((n) => ({ clip: n, label: n, then: "loop" })) }] : []);
  if (options.controls) ui = picker(options.controls, menu, info.iconUrl, on, hitboxes);

  if (anim.first) await anim.idle();
  mixer.update(0);

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((t) => {
    if (!running) return;
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.1);
    if (!paused) {
      mixer.update(dt * speed);
      env.time.value += dt * speed;
    }
    orbit.update();
    // the light stays where it is on screen as the camera turns
    env.lightDir.value.copy(VIEW_LIGHT).applyQuaternion(camera.quaternion);
    renderer.render(scene, camera);
  });

  return {
    gltf,
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      timer.dispose();
      observer.disconnect();
      orbit.dispose();
      dressing.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.material.isShaderMaterial) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      for (const p of gltf.parser.associations.keys()) if (p && p.isTexture) p.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
