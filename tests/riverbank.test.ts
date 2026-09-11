import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiverbank } from '../src/world/riverbank.ts';

const layout = createRiverbank(64, 11);

test('river channel lies below water level and banks above it', () => {
  for (let z = -30; z <= 30; z += 2) {
    const cx = layout.spline.centerX(z);
    assert.ok(layout.sample(cx, z).height < -0.5, `channel centre at z=${z} is not submerged`);
    const w = layout.spline.halfWidth(z);
    assert.ok(layout.sample(cx - w - 6, z).height > 0.2, `east bank at z=${z} is not above water`);
    assert.ok(layout.sample(cx + w + 6, z).height > 0.5, `west bank at z=${z} is not above water`);
  }
});

test('splat weights are normalised and the trail is dirt', () => {
  for (let z = -30; z <= 30; z += 3) {
    for (let x = -30; x <= 30; x += 3) {
      const s = layout.sample(x, z).splat;
      const sum = s[0] + s[1] + s[2] + s[3];
      assert.ok(Math.abs(sum - 1) < 1e-6, `splat sum ${sum} at ${x},${z}`);
      for (const w of s) assert.ok(w >= 0 && w <= 1);
    }
    const tx = layout.trailX(z);
    const trail = layout.sample(tx, z).splat;
    assert.ok(trail[2] > 0.6, `trail weight ${trail[2]} at z=${z}`);
  }
});

test('edge distance is negative inside the channel and positive outside', () => {
  const z = 3;
  const cx = layout.spline.centerX(z);
  assert.ok(layout.edgeDistance(cx, z) < 0);
  assert.ok(layout.edgeDistance(cx + layout.spline.halfWidth(z) + 1, z) > 0);
});
