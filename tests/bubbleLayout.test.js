import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createMemoryCloudLayout,
  updateBubbleDrift,
} from '../src/bubbleLayout.js';

function createCamera(width = 1440, height = 920) {
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function createMemories(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `memory-${index}`,
    name: `Memory ${index + 1}`,
  }));
}

function createLayout(count, seed = 'layout-test') {
  const viewport = { width: 1440, height: 920 };
  const camera = createCamera(viewport.width, viewport.height);
  return createMemoryCloudLayout({
    memories: createMemories(count),
    camera,
    viewport,
    seed,
    avoidRects: [
      { left: 10, top: 10, right: 250, bottom: 82 },
      { left: viewport.width - 370, top: 10, right: viewport.width - 10, bottom: 82 },
    ],
  });
}

function roundedSnapshot(layout) {
  return layout.items.map((item) => ({
    id: item.memoryId,
    x: Math.round(item.anchorPosition.x * 1000) / 1000,
    y: Math.round(item.anchorPosition.y * 1000) / 1000,
    z: Math.round(item.anchorPosition.z * 1000) / 1000,
    depthBand: item.depthBand,
    sizeBucket: item.sizeBucket,
  }));
}

test('creates deterministic memoryCloud anchors for the same seed', () => {
  const first = createLayout(20, 'same-seed');
  const second = createLayout(20, 'same-seed');
  const other = createLayout(20, 'other-seed');

  assert.deepEqual(roundedSnapshot(first), roundedSnapshot(second));
  assert.notDeepEqual(roundedSnapshot(first), roundedSnapshot(other));
});

test('balances region and depth counts across requested media totals', () => {
  for (const count of [1, 3, 8, 20, 50, 100]) {
    const layout = createLayout(count, `count-${count}`);
    assert.equal(layout.items.length, count);

    const maxDiameter = Math.max(...layout.items.map((item) => item.screen.radius * 2), 0);
    assert.ok(maxDiameter <= 920 * 0.19, `${count} bubbles should keep ordinary bubbles below viewport cap`);

    if (count >= 8) {
      const { quadrantCounts, depthCounts, overlapCount } = layout.metrics;
      const regionValues = Object.values(quadrantCounts);
      assert.ok(Math.max(...regionValues) <= Math.ceil(count * 0.4), `${count} bubbles should not overfill one region`);
      assert.ok(depthCounts.near > 0 && depthCounts.mid > 0 && depthCounts.far > 0);
      assert.ok(overlapCount <= Math.ceil(count * 0.08), `${count} bubbles should avoid severe screen overlaps`);
    }
  }
});

test('computes bounded independent drift from anchor data', () => {
  const [item] = createLayout(1, 'drift-seed').items;
  const first = new THREE.Vector3();
  const second = new THREE.Vector3();

  item.driftTime = 1.25;
  updateBubbleDrift(item, first, 1);
  item.driftTime = 7.5;
  updateBubbleDrift(item, second, 1);

  assert.notDeepEqual(first.toArray(), second.toArray());
  assert.ok(first.length() < item.radius * 1.2);
  assert.ok(second.length() < item.radius * 1.2);

  updateBubbleDrift(item, first, 0);
  assert.deepEqual(first.toArray(), [0, 0, 0]);
});

test('creates deterministic macro motion profiles for roaming bubbles', () => {
  const first = createLayout(12, 'motion-seed');
  const second = createLayout(12, 'motion-seed');
  const profiles = first.items.map((item) => item.motionProfile);

  assert.ok(profiles.every(Boolean), 'each bubble should receive a macro motion profile');
  assert.deepEqual(
    profiles.map((profile) => profile.phasePrimary.toArray()),
    second.items.map((item) => item.motionProfile.phasePrimary.toArray()),
  );
  assert.ok(
    profiles.some((profile, index) => index > 0 && profile.phasePrimary.distanceTo(profiles[0].phasePrimary) > 0.1),
    'motion phases should vary by stable memory id instead of sharing one curve',
  );
});
