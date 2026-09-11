// Day/night lighting rig: HDRI image-based lighting by day (PMREM), a procedural moonlit sky at
// night, a sun/moon directional light with a shadow map, hemisphere fill and fog (plan §7.3, §17).
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface SkyPreset {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  /** Which HDRI to use (key into the loaded set); null = procedural night dome. */
  hdri: 'day' | 'golden' | null;
  envIntensity: number;
  /** Fallback sky gradient (also used for the water reflection when no HDRI is loaded). */
  zenith: THREE.Color;
  horizon: THREE.Color;
}

export const SKY_PRESETS: Record<TimeOfDay, SkyPreset> = {
  day: {
    sunAzimuthDeg: 225, sunElevationDeg: 52,
    sunColor: new THREE.Color(1.0, 0.96, 0.88), sunIntensity: 2.8,
    hemiSky: new THREE.Color(0.55, 0.7, 1.0), hemiGround: new THREE.Color(0.3, 0.32, 0.2), hemiIntensity: 0.15,
    fogColor: new THREE.Color(0.72, 0.8, 0.88), fogDensity: 0.009, exposure: 0.78,
    hdri: 'day', envIntensity: 0.45,
    zenith: new THREE.Color(0.2, 0.42, 0.85), horizon: new THREE.Color(0.72, 0.82, 0.92),
  },
  dawn: {
    sunAzimuthDeg: 95, sunElevationDeg: 9,
    sunColor: new THREE.Color(1.0, 0.7, 0.45), sunIntensity: 2.2,
    hemiSky: new THREE.Color(0.65, 0.6, 0.75), hemiGround: new THREE.Color(0.25, 0.22, 0.18), hemiIntensity: 0.3,
    fogColor: new THREE.Color(0.9, 0.78, 0.7), fogDensity: 0.014, exposure: 0.8,
    hdri: 'golden', envIntensity: 0.5,
    zenith: new THREE.Color(0.3, 0.4, 0.7), horizon: new THREE.Color(1.0, 0.75, 0.55),
  },
  dusk: {
    sunAzimuthDeg: 275, sunElevationDeg: 7,
    sunColor: new THREE.Color(1.0, 0.6, 0.35), sunIntensity: 2.0,
    hemiSky: new THREE.Color(0.6, 0.5, 0.7), hemiGround: new THREE.Color(0.25, 0.2, 0.16), hemiIntensity: 0.3,
    fogColor: new THREE.Color(0.85, 0.66, 0.6), fogDensity: 0.014, exposure: 0.78,
    hdri: 'golden', envIntensity: 0.5,
    zenith: new THREE.Color(0.25, 0.3, 0.6), horizon: new THREE.Color(1.0, 0.65, 0.45),
  },
  night: {
    sunAzimuthDeg: 160, sunElevationDeg: 48,
    sunColor: new THREE.Color(0.62, 0.74, 1.0), sunIntensity: 1.0,
    hemiSky: new THREE.Color(0.2, 0.26, 0.46), hemiGround: new THREE.Color(0.05, 0.06, 0.05), hemiIntensity: 1.0,
    fogColor: new THREE.Color(0.035, 0.055, 0.1), fogDensity: 0.014, exposure: 1.15,
    hdri: null, envIntensity: 0.25,
    zenith: new THREE.Color(0.01, 0.02, 0.06), horizon: new THREE.Color(0.06, 0.09, 0.16),
  },
};

export function sunDirection(p: SkyPreset, out = new THREE.Vector3()): THREE.Vector3 {
  const az = (p.sunAzimuthDeg * Math.PI) / 180;
  const el = (p.sunElevationDeg * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

/** Procedural night dome: gradient, stars, a moon with glow. */
export function createNightDome(radius = 900): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: SKY_PRESETS.night.zenith },
      uHorizon: { value: SKY_PRESETS.night.horizon },
      uMoonDir: { value: sunDirection(SKY_PRESETS.night) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uZenith, uHorizon, uMoonDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float t = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(t, 0.6));
        // stars: cells on the sphere with a random bright point in some of them
        vec3 cell = floor(d * 140.0);
        float s = hash(cell);
        vec3 cp = (cell + 0.5 + vec3(hash(cell + 1.0), hash(cell + 2.0), hash(cell + 3.0)) - 0.5) / 140.0;
        float dist = length(d - normalize(cp)) * 140.0;
        float star = smoothstep(0.35, 0.0, dist) * step(0.93, s) * t;
        col += vec3(0.9, 0.95, 1.0) * star * (0.6 + 0.8 * hash(cell + 7.0));
        // moon + glow
        float m = dot(d, uMoonDir);
        float disc = smoothstep(0.9993, 0.9996, m);
        float glow = pow(max(m, 0.0), 300.0) * 0.5 + pow(max(m, 0.0), 30.0) * 0.06;
        col += vec3(0.85, 0.9, 1.0) * (disc * 3.0 + glow);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.frustumCulled = false;
  return mesh;
}

export interface LightingRig {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  nightDome: THREE.Mesh;
  /** Equirect HDRI textures by key (loaded lazily), for the water reflection. */
  hdris: Partial<Record<'day' | 'golden', THREE.Texture>>;
  apply(scene: THREE.Scene, renderer: THREE.WebGLRenderer, time: TimeOfDay): void;
  /** Point the shadow frustum at a world position. */
  follow(target: THREE.Vector3): void;
  preset: SkyPreset;
}

export interface HdriSources {
  day?: string;
  golden?: string;
}

export async function createLightingRig(renderer: THREE.WebGLRenderer, sources: HdriSources, shadowSize = 2048): Promise<LightingRig> {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  const nightDome = createNightDome();
  nightDome.visible = false;
  const hdris: Partial<Record<'day' | 'golden', THREE.Texture>> = {};
  const envs: Partial<Record<'day' | 'golden', THREE.Texture>> = {};
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const loader = new HDRLoader();
  await Promise.all(
    (['day', 'golden'] as const).map(async (key) => {
      const url = sources[key];
      if (!url) return;
      try {
        const tex = await loader.loadAsync(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        hdris[key] = tex;
        envs[key] = pmrem.fromEquirectangular(tex).texture;
      } catch (err) {
        console.warn(`HDRI ${key} failed to load (${url}); using gradient fallback`, err);
      }
    }),
  );
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let preset = SKY_PRESETS.day;
  const rig: LightingRig = {
    sun,
    hemi,
    nightDome,
    hdris,
    preset,
    apply(scene, r, time) {
      preset = SKY_PRESETS[time];
      rig.preset = preset;
      sunDirection(preset, dir);
      sun.color.copy(preset.sunColor);
      sun.intensity = preset.sunIntensity;
      hemi.color.copy(preset.hemiSky);
      hemi.groundColor.copy(preset.hemiGround);
      hemi.intensity = preset.hemiIntensity;
      scene.fog = new THREE.FogExp2(preset.fogColor.getHex(), preset.fogDensity);
      r.toneMappingExposure = preset.exposure;
      const env = preset.hdri ? envs[preset.hdri] : undefined;
      if (env) {
        scene.environment = env;
        scene.environmentIntensity = preset.envIntensity;
        scene.background = hdris[preset.hdri as 'day' | 'golden'] ?? null;
        scene.backgroundIntensity = preset.envIntensity;
        scene.backgroundBlurriness = 0;
        nightDome.visible = false;
      } else {
        scene.environment = null;
        scene.background = preset.zenith;
        nightDome.visible = time === 'night';
      }
      rig.follow(target);
    },
    follow(t) {
      target.copy(t);
      sun.target.position.copy(t);
      sun.position.copy(t).addScaledVector(dir, 60);
      sun.target.updateMatrixWorld();
    },
  };
  return rig;
}
