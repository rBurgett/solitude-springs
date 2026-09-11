// Runtime lookup of fetched assets via public/assets/fetched/index.json (written by
// tools/fetch-assets.mjs). Everything degrades gracefully when the index or a file is missing.
import * as THREE from 'three';

export interface AssetIndex {
  generatedAt?: string;
  assets: Record<string, { file?: string; dir?: string; type?: string; files?: Record<string, { map?: string; main?: boolean }>; license?: string; title?: string }>;
}

const BASE = `${import.meta.env.BASE_URL}assets/fetched/`;

export async function loadAssetIndex(): Promise<AssetIndex> {
  try {
    const res = await fetch(BASE + 'index.json', { cache: 'no-cache' });
    if (!res.ok) return { assets: {} };
    return (await res.json()) as AssetIndex;
  } catch {
    return { assets: {} };
  }
}

export function hdriUrl(index: AssetIndex, id: string): string | undefined {
  const a = index.assets[id];
  if (!a?.dir || !a.files) return undefined;
  const file = Object.keys(a.files).find((f) => f.endsWith('.hdr'));
  return file ? `${BASE}${a.dir}/${file}` : undefined;
}

export interface TextureSet {
  color?: THREE.Texture;
  normal?: THREE.Texture;
  arm?: THREE.Texture;
}

/** Load a Poly Haven texture set (Diffuse / nor_gl / arm) by manifest id; missing maps are undefined. */
export async function textureSet(index: AssetIndex, id: string, loader = new THREE.TextureLoader()): Promise<TextureSet> {
  const a = index.assets[id];
  const out: TextureSet = {};
  if (!a?.dir || !a.files) return out;
  const load = async (map: string): Promise<THREE.Texture | undefined> => {
    const file = Object.entries(a.files!).find(([, f]) => f.map === map)?.[0];
    if (!file) return undefined;
    try {
      return await loader.loadAsync(`${BASE}${a.dir}/${file}`);
    } catch {
      return undefined;
    }
  };
  const [color, normal, arm] = await Promise.all([load('Diffuse'), load('nor_gl'), load('arm')]);
  out.color = color;
  out.normal = normal;
  out.arm = arm;
  return out;
}

/** URL of the main .gltf of a Poly Haven model entry. */
export function modelUrl(index: AssetIndex, id: string): string | undefined {
  const a = index.assets[id];
  if (!a?.dir || !a.files) return undefined;
  const file = Object.entries(a.files).find(([, f]) => f.main)?.[0];
  return file ? `${BASE}${a.dir}/${file}` : undefined;
}
