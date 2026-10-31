// The client's skybox: RenderFX/Skybox (Unity 2.x), `combine texture +-
// primary` with primary = _Tint, i.e. texture + tint − 0.5. cnPlayerCamera
// sets _Tint to the area's fog colour (environment.js fogColorOf) and uses
// the "fusion" set (Skybox_FreeZone, the dark aurora) inside the Future and
// Tutorial zones, the "normal" set (grey clouds) elsewhere.
import * as THREE from "three";
import { SKY_VERTEX, SKY_FRAGMENT } from "./shaders.js";

export const SKY_SIDES = ["left", "right", "up", "down", "front", "back"];

// The URL of one face of a sky set's directory, as a world pack lays it out.
export const skyFaceUrl = (dir, side) => `${dir.replace(/\/$/, "")}/skybox_${side}tex.png`;

// A box with the six faces, drawn behind everything; keep it on the camera
// (sky.position.copy(camera.position)) and inside the far plane
// (sky.scale.setScalar(camera.far * 0.5)). Faces: Unity's +X is _LeftTex
// (the side textures join up front → left → back → right). The scene is
// x-mirrored and a BackSide box shows each face mirrored, so three's +x face
// gets _LeftTex as well. `tint`: RGB.
export async function createSky(dir, tint, { load = null } = {}) {
  const loader = new THREE.TextureLoader();
  const face = (side) => (load ? load(skyFaceUrl(dir, side)) : loader.loadAsync(skyFaceUrl(dir, side))).then((t) => {
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
  const faces = await Promise.all(SKY_SIDES.map(face));
  const tintUniform = { value: new THREE.Vector3(...tint) };
  const materials = faces.map((map) => new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, tint: tintUniform },
    vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  }));
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
  box.name = "sky";
  box.renderOrder = -1000;
  box.frustumCulled = false;
  box.raycast = () => {};
  box.userData.tint = tintUniform;
  return box;
}

// Which sky set a world position (glTF x, z) gets: "fusion" inside any of
// `rects` ([x, y, w, h] in Unity world metres, as the world manifest's
// sky.fusion_rects), "normal" elsewhere.
export function skySetAt(x, z, rects = []) {
  const ux = -x, uz = z;
  return rects.some(([rx, ry, rw, rh]) => ux >= rx && ux <= rx + rw && uz >= ry && uz <= ry + rh) ? "fusion" : "normal";
}
