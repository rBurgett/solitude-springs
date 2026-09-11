// Renderer setup and quality presets (plan §17, §16.1 Graphics).
import * as THREE from 'three';
import type { Settings } from '../core/settings.ts';

export interface RendererBundle {
  renderer: THREE.WebGLRenderer;
  /** Re-fit to the canvas' CSS size (call on resize and after changing render scale). */
  resize(): void;
  applyGraphics(g: Settings['graphics']): void;
  graphics: Settings['graphics'];
}

export function createRenderer(canvas: HTMLCanvasElement, graphics: Settings['graphics']): RendererBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = graphics.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const bundle: RendererBundle = {
    renderer,
    graphics,
    resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * bundle.graphics.renderScale);
      renderer.setSize(w, h, false);
    },
    applyGraphics(g) {
      bundle.graphics = g;
      renderer.shadowMap.enabled = g.shadows;
      renderer.shadowMap.needsUpdate = true;
      bundle.resize();
    },
  };
  bundle.resize();
  return bundle;
}
