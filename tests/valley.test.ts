import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createValley } from '../src/world/valley.ts';
import { BRIDGES, SPAWN, ZONES } from '../src/data/world.ts';

const v = createValley(7);

test('the river is below the water line and the banks above it', () => {
  for (const z of [-165, -110, -60, 0, 62, 120, 200]) {
    const cx = v.riverCenterX(z);
    assert.ok(v.heightAt(cx, z) < -0.5, `channel at z=${z} is ${v.heightAt(cx, z)}`);
    assert.ok(v.waterDepthAt(cx, z) > 0.5);
    const bank = cx + v.riverHalfWidth(z) + 6;
    assert.ok(v.heightAt(bank, z) > 0.2, `bank at z=${z} is ${v.heightAt(bank, z)}`);
    assert.equal(v.waterDepthAt(bank, z), 0);
  }
  assert.ok(v.waterDepthAt(v.riverCenterX(-170), -170) > 4, 'the pool is deep');
  assert.ok(v.waterDepthAt(v.riverCenterX(215), 215) < 1.6, 'the marsh is shallow');
});

test('the trailhead sits high on the north ridge above the pool and the switchback descends', () => {
  const top = v.heightAt(SPAWN.x, SPAWN.z);
  assert.ok(top > 35 && top < 50, `trailhead height ${top}`);
  assert.ok(v.heightAt(v.eastTrailX(-150), -150) < 6);
});

test('zones and areas resolve, bridges have both ends above water', () => {
  assert.equal(v.zoneAt(v.riverCenterX(-170), -170)?.id, 'pool');
  assert.equal(v.zoneAt(v.riverCenterX(215), 215)?.water, 'marsh');
  assert.equal(v.zoneAt(200, -60), null);
  assert.equal(v.areaAt(0, -252)?.id, 'trailhead');
  for (const a of v.areas) assert.ok(Number.isFinite(a.x), a.id);
  assert.ok(v.edgeDistance(v.campground.x, v.campground.z) > 8, 'campground is on dry land');
  assert.ok(v.edgeDistance(v.sandyBend.x, v.sandyBend.z) > 2, 'beach is on the bank');
  for (const [x, z] of v.switchback) assert.ok(v.edgeDistance(x, z) > 1, `switchback point ${x},${z} is on land`);
  for (const b of BRIDGES) {
    const ends = v.bridgeEnds(b.id)!;
    assert.ok(ends.west[0] < v.riverCenterX(b.z) && ends.east[0] > v.riverCenterX(b.z));
    assert.ok(ends.west[1] > 0 && ends.east[1] > 0);
    // the approaches rise to meet the deck
    assert.ok(v.heightAt(ends.east[0], ends.east[2]) > b.clearance - 0.3);
  }
  for (let i = 1; i < ZONES.length; i++) assert.equal(ZONES[i]!.zMin, ZONES[i - 1]!.zMax);
});

test('trails and bounds', () => {
  assert.ok(v.trailDistance(v.eastTrailX(0), 0) < 0.01);
  assert.ok(v.trailDistance(v.eastTrailX(0) + 30, 0) > 5);
  assert.equal(v.boundaryPush(0, 0), null);
  const p = v.boundaryPush(-270, 0)!;
  assert.ok(p.x > 0.9);
  assert.ok(v.heightAt(-280, 0) > v.heightAt(-240, 0) + 5, 'boundary ridge rises');
  assert.ok(v.forestAt(-140, 40) > 0.5, 'deep woods are forested');
  assert.ok(v.forestAt(34, -60) < 0.2, 'campground is a clearing');
});
