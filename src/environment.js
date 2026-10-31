// The light, fog and time every FusionFall material reads, shared as
// uniforms: change a value and every material follows.
import * as THREE from "three";

// main.unity3d's "Directional light": forward (0.894, −0.309, −0.325) in
// Unity's world space, white, intensity 1. Toward the light, x mirrored for
// glTF. A world pack's manifest can carry its own ("light").
export const DEFAULT_LIGHT_DIRECTION = [0.8937, 0.309, 0.3253];

// RenderSettings.m_AmbientLight in every scene of the three builds.
export const DEFAULT_AMBIENT = [0.2, 0.2, 0.2];

export function createEnvironment() {
  return {
    lightDir: { value: new THREE.Vector3().fromArray(DEFAULT_LIGHT_DIRECTION).normalize() }, // world space, toward the light
    lightColor: { value: new THREE.Color(1, 1, 1) },
    ambient: { value: new THREE.Color().fromArray(DEFAULT_AMBIENT) },
    time: { value: 0 }, // seconds
    fogColor: { value: new THREE.Color(0, 0, 0) },
    fogDensity: { value: 0 }, // exp2 fog: 0 is none
    lightmapScale: { value: 1 },
  };
}

// The fog colour cnPlayerCamera uses for a scene's DongColorSetup fog
// colour: halfway to white. The skybox is tinted with it too.
export function fogColorOf(colors) {
  const fog = (colors && colors.fog) || [0.5, 0.5, 0.5, 1];
  return fog.slice(0, 3).map((c) => c * 0.5 + 0.5);
}

// The game's fog density for a scene: exp2, DongColorSetup.fogDepth × 0.01.
export function fogDensityOf(colors) {
  return ((colors && colors.fog_depth) || 0) * 0.01;
}

// Sets the environment from a tile's scene extras (UnityPackFF's
// render_settings and colors) and, if given, a world manifest's light
// ({ direction, color, intensity }). Returns the fog colour.
export function applySceneSettings(env, extras = {}, light = null) {
  const fog = fogColorOf(extras.colors);
  env.fogColor.value.setRGB(...fog);
  env.fogDensity.value = fogDensityOf(extras.colors);
  const ambient = extras.render_settings && extras.render_settings.ambient;
  env.ambient.value.setRGB(...(ambient || DEFAULT_AMBIENT).slice(0, 3));
  if (light && light.direction) env.lightDir.value.fromArray(light.direction).normalize();
  if (light && light.color) {
    const k = light.intensity ?? 1;
    env.lightColor.value.setRGB(light.color[0] * k, light.color[1] * k, light.color[2] * k);
  }
  return fog;
}
