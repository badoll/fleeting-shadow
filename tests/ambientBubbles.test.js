import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAmbientBubbleLayout } from '../src/ambientBubbles.js';
import {
  AMBIENT_BUBBLE_CONFIG,
  resolveAmbientTargetCount,
  resolveEffectDprCap,
} from '../src/sceneConfig.js';

function createCamera(width = 1440, height = 920) {
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function createLayout(seed = 'ambient-test', viewport = { width: 1440, height: 920 }) {
  return createAmbientBubbleLayout({
    seed,
    camera: createCamera(viewport.width, viewport.height),
    viewport,
    avoidRects: [
      { left: 10, top: 10, right: 250, bottom: 82 },
      { left: viewport.width - 370, top: 10, right: viewport.width - 10, bottom: 82 },
    ],
  });
}

function roundedInstances(layout, count = 16) {
  return layout.instances.slice(0, count).map((instance) => ({
    band: instance.depthBand,
    bucket: instance.sizeBucket,
    cohort: instance.cohortIndex,
    x: Math.round(instance.anchorPosition.x * 1000) / 1000,
    y: Math.round(instance.anchorPosition.y * 1000) / 1000,
    z: Math.round(instance.anchorPosition.z * 1000) / 1000,
    radius: Math.round(instance.radius * 10000) / 10000,
  }));
}

test('creates deterministic ambient bubbles for a seed', () => {
  const first = createLayout('same-ambient-seed');
  const second = createLayout('same-ambient-seed');
  const other = createLayout('other-ambient-seed');

  assert.deepEqual(roundedInstances(first), roundedInstances(second));
  assert.notDeepEqual(roundedInstances(first), roundedInstances(other));
  assert.equal(first.instances.length, AMBIENT_BUBBLE_CONFIG.maxCount);
});

test('keeps quality count changes as stable prefixes', () => {
  const layout = createLayout('prefix-seed');
  const lowCount = resolveAmbientTargetCount({ qualityName: 'low' });
  const mediumCount = resolveAmbientTargetCount({ qualityName: 'medium' });
  const highCount = resolveAmbientTargetCount({ qualityName: 'high' });

  assert.ok(lowCount < mediumCount);
  assert.ok(mediumCount < highCount);
  assert.deepEqual(
    roundedInstances({ instances: layout.instances.slice(0, lowCount) }, lowCount),
    roundedInstances({ instances: layout.instances.slice(0, mediumCount) }, lowCount),
  );
});

test('distributes ambient bubbles across depth and size bands', () => {
  const layout = createLayout('distribution-seed');
  const sample = layout.instances.slice(0, AMBIENT_BUBBLE_CONFIG.maxCount);
  const depthCounts = sample.reduce((counts, instance) => {
    counts[instance.depthBand] += 1;
    return counts;
  }, { near: 0, mid: 0, far: 0 });
  const sizeCounts = sample.reduce((counts, instance) => {
    counts[instance.sizeBucket] += 1;
    return counts;
  }, { small: 0, medium: 0, large: 0 });

  assert.ok(depthCounts.near >= 6 && depthCounts.near <= 10);
  assert.ok(depthCounts.mid >= 28 && depthCounts.mid <= 36);
  assert.ok(depthCounts.far >= 20 && depthCounts.far <= 28);
  assert.ok(sizeCounts.small >= 42 && sizeCounts.small <= 48);
  assert.ok(sizeCounts.medium >= 14 && sizeCounts.medium <= 18);
  assert.ok(sizeCounts.large >= 2 && sizeCounts.large <= 4);
});

test('creates varied cohorts without simple shared periods', () => {
  const layout = createLayout('cohort-seed');
  const cohorts = layout.cohorts;

  assert.ok(cohorts.length >= 5 && cohorts.length <= 7);
  assert.ok(cohorts.some((cohort, index) => index > 0 && Math.abs(cohort.periodX - cohorts[0].periodX) > 0.5));
  assert.ok(
    cohorts.every((cohort) => {
      const xyRatio = cohort.periodX / cohort.periodY;
      const yzRatio = cohort.periodY / cohort.periodZ;
      return Math.abs(xyRatio - Math.round(xyRatio)) > 0.04 &&
        Math.abs(yzRatio - Math.round(yzRatio)) > 0.04;
    }),
  );
});

test('reduces ambient density and DPR for barrier rendering', () => {
  const standard = resolveAmbientTargetCount({ qualityName: 'high' });
  const barrier = resolveAmbientTargetCount({ qualityName: 'high', barrierEnabled: true });
  const mobile = resolveAmbientTargetCount({ qualityName: 'high', isMobile: true });

  assert.ok(barrier < standard);
  assert.ok(mobile < standard);
  assert.ok(resolveEffectDprCap({ qualityName: 'low' }) < resolveEffectDprCap({ qualityName: 'high' }));
});
