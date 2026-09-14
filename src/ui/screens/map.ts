// The Map screen (plan §16.2): a painted park map drawn from the valley data — forest wash, the
// river, trails, bridges, the dock, area names, zone names along the water, trashed zones marked,
// "you are here" and the boat. Nothing is rendered from the 3D scene; it is a brochure.
import { el } from '../el.ts';
import type { Valley } from '../../world/valley.ts';
import type { ZoneState } from '../../sim/zones.ts';
import { ZONES, BRIDGES, BOUNDARY } from '../../data/world.ts';
import { isTrashed } from '../../sim/zones.ts';

export interface MapActions {
  valley: Valley;
  zones: Map<string, ZoneState>;
  player: { x: number; z: number; yaw: number };
  boat: { x: number; z: number } | null;
  onClose(): void;
}

export function mapScreen(a: MapActions): HTMLElement {
  const W = 620;
  const H = 620;
  const canvas = el('canvas', { class: 'map-canvas', width: String(W), height: String(H), 'aria-label': 'Park map' }) as HTMLCanvasElement;
  paintMap(canvas, a);
  const legend = el('div', { class: 'map-legend' }, [
    el('span', { style: '--dot:#d94b4b' }, 'You are here'),
    el('span', { style: '--dot:#6fa8c9' }, 'The river'),
    el('span', { style: '--dot:#b58a4a' }, 'Trails and bridges'),
    el('span', { style: '--dot:#d9a441' }, 'Trashed water'),
    el('span', { style: '--dot:#8a6240' }, 'The boat'),
  ]);
  return el('div', { class: 'screen dim' }, [
    el('div', { class: 'panel map' }, [
      el('div', { class: 'row between' }, [el('h1', {}, 'Solitude Springs'), el('button', { class: 'secondary small', onclick: a.onClose, 'data-action': 'close' }, 'Close (M)')]),
      el('p', { class: 'tagline' }, 'Find Your Peace. It is on here somewhere.'),
      canvas,
      legend,
    ]),
  ]);
}

function paintMap(canvas: HTMLCanvasElement, a: MapActions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const v = a.valley;
  const W = canvas.width;
  const H = canvas.height;
  const pad = 26;
  const sx = (W - pad * 2) / (BOUNDARY.xMax - BOUNDARY.xMin);
  const sz = (H - pad * 2) / (BOUNDARY.zMax - BOUNDARY.zMin);
  const X = (x: number): number => pad + (x - BOUNDARY.xMin) * sx;
  const Z = (z: number): number => pad + (z - BOUNDARY.zMin) * sz;
  // paper
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c9b88f';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  // forest wash
  const cell = 8;
  for (let z = BOUNDARY.zMin; z < BOUNDARY.zMax; z += cell) {
    for (let x = BOUNDARY.xMin; x < BOUNDARY.xMax; x += cell) {
      const f = v.forestAt(x + cell / 2, z + cell / 2);
      if (f < 0.35) continue;
      ctx.fillStyle = `rgba(88, 132, 78, ${Math.min(0.55, (f - 0.3) * 0.9)})`;
      ctx.fillRect(X(x), Z(z), cell * sx + 0.5, cell * sz + 0.5);
    }
  }
  // the river: left bank down, right bank back up
  ctx.beginPath();
  const step = 3;
  for (let z = v.spline.zMin; z <= v.spline.zMax; z += step) {
    const x = v.riverCenterX(z) - v.riverHalfWidth(z);
    if (z === v.spline.zMin) ctx.moveTo(X(x), Z(z));
    else ctx.lineTo(X(x), Z(z));
  }
  for (let z = v.spline.zMax; z >= v.spline.zMin; z -= step) ctx.lineTo(X(v.riverCenterX(z) + v.riverHalfWidth(z)), Z(z));
  ctx.closePath();
  ctx.fillStyle = '#6fa8c9';
  ctx.fill();
  ctx.strokeStyle = '#4c86a8';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // trashed zones: an amber blotch on the water
  for (const zd of ZONES) {
    const zs = a.zones.get(zd.id);
    if (!zs || !isTrashed(zs)) continue;
    const zc = (zd.zMin + zd.zMax) / 2;
    const cx = X(v.riverCenterX(zc));
    ctx.fillStyle = 'rgba(217, 164, 65, 0.75)';
    ctx.beginPath();
    ctx.ellipse(cx, Z(zc), Math.max(10, v.riverHalfWidth(zc) * sx + 6), ((zd.zMax - zd.zMin) / 2) * sz, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // trails
  ctx.strokeStyle = '#b58a4a';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let z = -152; z <= 266; z += 4) {
    const x = v.eastTrailX(z);
    if (z === -152) ctx.moveTo(X(x), Z(z));
    else ctx.lineTo(X(x), Z(z));
  }
  ctx.stroke();
  ctx.beginPath();
  for (let z = -114; z <= 124; z += 4) {
    const x = v.westTrailX(z);
    if (z === -114) ctx.moveTo(X(x), Z(z));
    else ctx.lineTo(X(x), Z(z));
  }
  ctx.stroke();
  ctx.beginPath();
  v.switchback.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(X(x), Z(z)) : ctx.lineTo(X(x), Z(z))));
  ctx.stroke();
  ctx.setLineDash([]);
  // bridges and the dock
  ctx.strokeStyle = '#7a5a34';
  ctx.lineWidth = 4;
  for (const b of BRIDGES) {
    const ends = v.bridgeEnds(b.id);
    if (!ends) continue;
    ctx.beginPath();
    ctx.moveTo(X(ends.west[0]), Z(ends.west[2]));
    ctx.lineTo(X(ends.east[0]), Z(ends.east[2]));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(X(v.dock.root[0]), Z(v.dock.root[2]));
  ctx.lineTo(X(v.dock.end[0]), Z(v.dock.end[2]));
  ctx.stroke();
  // area names
  ctx.fillStyle = '#2c3a2e';
  ctx.font = 'italic 13px Georgia, serif';
  ctx.textAlign = 'center';
  for (const area of v.areas) {
    if (area.id === 'deep_woods') ctx.fillText(area.name, X(area.x + 30), Z(area.z));
    else if (area.id.endsWith('_bridge')) ctx.fillText(area.name, X(area.x), Z(area.z) - 8);
    else ctx.fillText(area.name, X(area.x), Z(area.z) + 4);
  }
  // zone names along the water, small
  ctx.font = '10px Georgia, serif';
  ctx.fillStyle = 'rgba(44, 58, 46, 0.7)';
  for (const zd of ZONES) {
    const zc = (zd.zMin + zd.zMax) / 2;
    const x = v.riverCenterX(zc) + v.riverHalfWidth(zc) + 12;
    ctx.textAlign = 'left';
    ctx.fillText(zd.name, X(x) + 18, Z(zc) + 3);
  }
  // the boat
  if (a.boat) {
    ctx.fillStyle = '#8a6240';
    ctx.beginPath();
    ctx.ellipse(X(a.boat.x), Z(a.boat.z), 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // you are here: a triangle pointing where the player faces (+z is down the map)
  const px = X(a.player.x);
  const pz = Z(a.player.z);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(Math.PI - a.player.yaw);
  ctx.fillStyle = '#d94b4b';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 7);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#d94b4b';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('you are here', px, pz + 22);
}
