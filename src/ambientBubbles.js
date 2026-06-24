import * as THREE from 'three';
import {
  createSafeViewport,
  projectBubbleToScreen,
  screenRadiusToWorld,
  worldFromCameraNdc,
} from './bubbleLayout.js';
import { seededRandom } from './domain.js';
import {
  AMBIENT_BUBBLE_CONFIG,
  VISUAL_COMPOSITION,
  resolveAmbientTargetCount,
} from './sceneConfig.js';

const TWO_PI = Math.PI * 2;
const DEPTH_BAND_SLOTS = Object.freeze([
  'near', 'mid', 'far', 'mid', 'far', 'mid', 'near', 'mid',
  'far', 'mid', 'far', 'mid', 'far', 'mid', 'far', 'mid',
  'near', 'mid', 'far', 'mid', 'far', 'mid', 'far', 'mid',
  'near', 'mid', 'far', 'mid', 'far', 'mid', 'far', 'mid',
  'near', 'mid', 'far', 'mid', 'far', 'mid', 'far', 'mid',
]);
const SIZE_BUCKET_SLOTS = Object.freeze([
  'small', 'small', 'medium', 'small', 'small',
  'medium', 'small', 'small', 'small', 'large',
  'small', 'medium', 'small', 'small', 'small',
  'medium', 'small', 'small', 'medium', 'small',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function getCameraBasis(camera) {
  camera.updateMatrixWorld();
  return {
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize(),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize(),
  };
}

function getVisibleHalfSizeAtDepth(camera, depth) {
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * depth;
  return {
    halfWidth: halfHeight * camera.aspect,
    halfHeight,
  };
}

function pickDepthBand(index) {
  return DEPTH_BAND_SLOTS[index % DEPTH_BAND_SLOTS.length];
}

function pickSizeBucket(index) {
  return SIZE_BUCKET_SLOTS[index % SIZE_BUCKET_SLOTS.length];
}

function isInsideAvoidRect(ndcX, ndcY, viewport, radiusPx) {
  const x = (ndcX * 0.5 + 0.5) * viewport.width;
  const y = (-ndcY * 0.5 + 0.5) * viewport.height;
  return viewport.avoidRects.some((rect) =>
    x >= rect.left - radiusPx &&
    x <= rect.right + radiusPx &&
    y >= rect.top - radiusPx &&
    y <= rect.bottom + radiusPx,
  );
}

function pickNdcPosition(random, viewport, depthBand, radiusPx) {
  let best = null;
  const quietZone = VISUAL_COMPOSITION.centerQuietZone;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let ndcX = lerp(viewport.ndc.minX, viewport.ndc.maxX, random());
    let ndcY = lerp(viewport.ndc.minY, viewport.ndc.maxY, random());
    const quietDistance =
      (ndcX / quietZone.radiusX) * (ndcX / quietZone.radiusX) +
      (ndcY / quietZone.radiusY) * (ndcY / quietZone.radiusY);
    const quietPassThrough = depthBand === 'far'
      ? quietZone.ambientPassThrough * 1.5
      : quietZone.ambientPassThrough;

    if (depthBand === 'near' && Math.abs(ndcX) < 0.28 && Math.abs(ndcY) < 0.24) {
      ndcX += ndcX < 0 ? -0.32 : 0.32;
      ndcY += ndcY < 0 ? -0.16 : 0.16;
    } else if (quietDistance < 1 && random() > quietPassThrough) {
      ndcX += ndcX < 0 ? -quietZone.radiusX * 0.9 : quietZone.radiusX * 0.9;
      ndcY += ndcY < 0 ? -quietZone.radiusY * 0.35 : quietZone.radiusY * 0.35;
    }

    ndcX = clamp(ndcX, viewport.ndc.minX, viewport.ndc.maxX);
    ndcY = clamp(ndcY, viewport.ndc.minY, viewport.ndc.maxY);
    best = { ndcX, ndcY };

    if (!isInsideAvoidRect(ndcX, ndcY, viewport, radiusPx)) break;
  }

  return best;
}

function createCohorts(seed, config = AMBIENT_BUBBLE_CONFIG) {
  const random = seededRandom(`${seed}:ambient:cohorts`);
  const count = Math.round(lerp(config.cohortCount[0], config.cohortCount[1], random()));

  return Array.from({ length: count }, (_, index) => {
    const band = pickDepthBand(index);
    const motion = config.cohortMotion[band] ?? config.cohortMotion.mid;
    const periodBase = lerp(motion.period[0], motion.period[1], random());

    return {
      index,
      depthBand: band,
      centerNdcX: lerp(-0.28, 0.28, random()),
      centerNdcY: lerp(-0.2, 0.2, random()),
      amplitudeNdcX: lerp(motion.ndcX[0], motion.ndcX[1], random()),
      amplitudeNdcY: lerp(motion.ndcY[0], motion.ndcY[1], random()),
      amplitudeDepth: lerp(motion.depth[0], motion.depth[1], random()),
      periodX: periodBase * lerp(0.82, 1.04, random()),
      periodY: periodBase * lerp(1.12, 1.4, random()),
      periodZ: periodBase * lerp(1.55, 1.96, random()),
      phaseX: random() * TWO_PI,
      phaseY: random() * TWO_PI,
      phaseZ: random() * TWO_PI,
      secondaryRateX: lerp(0.31, 0.49, random()),
      secondaryRateY: lerp(0.37, 0.58, random()),
      secondaryRateZ: lerp(0.27, 0.43, random()),
      secondaryWeight: lerp(0.16, 0.3, random()),
    };
  });
}

export function createAmbientBubbleLayout({
  seed = 'ambient-bubbles',
  maxCount = AMBIENT_BUBBLE_CONFIG.maxCount,
  camera,
  viewport = {},
  avoidRects = [],
  config = AMBIENT_BUBBLE_CONFIG,
} = {}) {
  if (!camera) throw new Error('createAmbientBubbleLayout requires a camera');

  const normalizedViewport = {
    width: Math.max(2, Number(viewport.width) || 2),
    height: Math.max(2, Number(viewport.height) || 2),
  };
  const isMobile =
    normalizedViewport.width < 700 ||
    normalizedViewport.height > normalizedViewport.width * 1.35;
  const safeViewport = createSafeViewport(normalizedViewport, { isMobile, avoidRects });
  const basis = getCameraBasis(camera);
  const cohorts = createCohorts(seed, config);
  const instances = [];

  for (let index = 0; index < maxCount; index += 1) {
    const random = seededRandom(`${seed}:ambient:${index}`);
    const depthBand = pickDepthBand(index);
    const sizeBucket = pickSizeBucket(index);
    const depthRange = config.depthRanges[depthBand] ?? config.depthRanges.mid;
    const sizeRange = config.screenDiameterRatios[sizeBucket] ?? config.screenDiameterRatios.small;
    const depth = lerp(depthRange[0], depthRange[1], random()) * (isMobile ? 0.92 : 1);
    const diameterRatio = lerp(sizeRange[0], sizeRange[1], random()) * (isMobile ? 0.88 : 1);
    const screenRadius = safeViewport.shortSide * diameterRatio * 0.5;
    const radius = screenRadiusToWorld(screenRadius, depth, camera, safeViewport);
    const { ndcX, ndcY } = pickNdcPosition(random, safeViewport, depthBand, screenRadius * 1.8);
    const anchorPosition = worldFromCameraNdc({
      camera,
      basis,
      ndcX,
      ndcY,
      depth,
      target: new THREE.Vector3(),
    }).clone();
    const cohortIndex = Math.floor(random() * cohorts.length);
    const motion = config.cohortMotion[depthBand] ?? config.cohortMotion.mid;
    const individualRatio = lerp(config.individualMotionRatio[0], config.individualMotionRatio[1], random());

    instances.push({
      index,
      depthBand,
      sizeBucket,
      cohortIndex,
      anchorPosition,
      lastPosition: anchorPosition.clone(),
      radius,
      depth,
      ndcX,
      ndcY,
      individualNdcX: lerp(motion.ndcX[0], motion.ndcX[1], random()) * individualRatio,
      individualNdcY: lerp(motion.ndcY[0], motion.ndcY[1], random()) * individualRatio,
      individualDepth: lerp(motion.depth[0], motion.depth[1], random()) * individualRatio,
      periodX: lerp(motion.period[0] * 0.82, motion.period[1] * 1.16, random()),
      periodY: lerp(motion.period[0] * 0.94, motion.period[1] * 1.28, random()),
      periodZ: lerp(motion.period[0] * 1.12, motion.period[1] * 1.54, random()),
      phaseX: random() * TWO_PI,
      phaseY: random() * TWO_PI,
      phaseZ: random() * TWO_PI,
      secondaryPhaseX: random() * TWO_PI,
      secondaryPhaseY: random() * TWO_PI,
      secondaryPhaseZ: random() * TWO_PI,
      secondaryWeight: lerp(0.1, 0.24, random()),
      timeOffset: lerp(0, 64, random()),
      brightness: lerp(0.66, 0.98, random()) * (
        depthBand === 'near' ? 0.94 : depthBand === 'far' ? 0.48 : 0.68
      ),
      motionRoleFactor: index % 5 === 0 ? 0.92 : index % 4 === 0 ? 0.22 : 0.58,
      scalePhase: random() * TWO_PI,
    });
  }

  const metrics = instances.reduce((summary, instance) => {
    summary.depthCounts[instance.depthBand] += 1;
    summary.sizeCounts[instance.sizeBucket] += 1;
    return summary;
  }, {
    total: instances.length,
    depthCounts: { near: 0, mid: 0, far: 0 },
    sizeCounts: { small: 0, medium: 0, large: 0 },
    cohortCount: cohorts.length,
  });

  return {
    seed,
    viewport: safeViewport,
    cohorts,
    instances,
    metrics,
  };
}

export class AmbientBubbleController {
  constructor({
    camera,
    group,
    seed = 'ambient-bubbles',
    envMap = null,
    fallbackEnvMap = null,
    rendererProfile = {},
  } = {}) {
    this.camera = camera;
    this.group = group;
    this.seed = seed;
    this.envMap = envMap;
    this.fallbackEnvMap = fallbackEnvMap;
    this.qualityName = rendererProfile.qualityPreset ?? 'high';
    this.layout = null;
    this.targetCount = 0;
    this.visibleCount = 0;
    this.motionTime = 0;
    this.lastViewportKey = '';
    this.lastSeed = '';

    this.geometry = new THREE.SphereGeometry(1, 24, 12);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xf0fff8,
      transparent: true,
      opacity: VISUAL_COMPOSITION.ambientMaterial.opacity,
      depthWrite: false,
      vertexColors: true,
      fog: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      AMBIENT_BUBBLE_CONFIG.maxCount,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(AMBIENT_BUBBLE_CONFIG.maxCount * 3),
      3,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -6;
    this.mesh.raycast = () => {};
    this.mesh.count = 0;
    this.group?.add(this.mesh);

    this.matrixObject = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.tmpOffset = new THREE.Vector3();
    this.tmpGroupOffset = new THREE.Vector3();
    this.tmpIndividualOffset = new THREE.Vector3();
    this.tmpProjected = new THREE.Vector3();
  }

  configure({
    seed = this.seed,
    viewport = {},
    avoidRects = [],
    qualityName = this.qualityName,
    barrierEnabled = false,
    reducedMotion = false,
    empty = false,
    forceRebuild = false,
  } = {}) {
    this.seed = seed;
    this.qualityName = qualityName;
    const viewportKey = `${Math.round(viewport.width || 0)}x${Math.round(viewport.height || 0)}:${avoidRects.length}`;
    if (forceRebuild || !this.layout || this.lastSeed !== seed || this.lastViewportKey !== viewportKey) {
      this.layout = createAmbientBubbleLayout({
        seed,
        camera: this.camera,
        viewport,
        avoidRects,
      });
      this.lastSeed = seed;
      this.lastViewportKey = viewportKey;
      if (this.visibleCount === 0) this.visibleCount = Math.min(this.targetCount, this.layout.instances.length);
    }

    this.targetCount = resolveAmbientTargetCount({
      qualityName,
      isMobile:
        (viewport.width || 0) < 700 ||
        (viewport.height || 0) > (viewport.width || 1) * 1.35,
      barrierEnabled,
      reducedMotion,
      empty,
    });
  }

  setEnvironmentMap(envMap, fallbackEnvMap = this.fallbackEnvMap) {
    this.envMap = envMap;
    this.fallbackEnvMap = fallbackEnvMap;
    this.material.needsUpdate = true;
  }

  setQualityName(qualityName) {
    this.qualityName = qualityName;
  }

  setOfficialReferenceMotion(enabled) {
    this.officialReferenceMotion = Boolean(enabled);
  }

  update(delta, {
    elapsed = this.motionTime,
    viewport = {},
    focusAmount = 0,
    focusActive = false,
    reducedMotion = false,
    pageVisible = true,
    officialReferenceMotion = false,
  } = {}) {
    if (!this.layout || !pageVisible) return;

    const focus = clamp(focusAmount, 0, 1);
    const speedScale = (focusActive ? lerp(1, AMBIENT_BUBBLE_CONFIG.speed.focus, focus) : 1) *
      (reducedMotion ? AMBIENT_BUBBLE_CONFIG.speed.reducedMotion : 1);
    const amplitudeScale = reducedMotion ? 0.16 : lerp(1, 0.42, focus);
    const brightness = lerp(
      AMBIENT_BUBBLE_CONFIG.brightness.browsing,
      AMBIENT_BUBBLE_CONFIG.brightness.focus,
      focus,
    ) * (reducedMotion ? AMBIENT_BUBBLE_CONFIG.brightness.reducedMotion : 1);
    this.motionTime += Math.max(0, delta) * speedScale;
    this.material.opacity =
      VISUAL_COMPOSITION.ambientMaterial.opacity *
      lerp(1, VISUAL_COMPOSITION.ambientMaterial.focusOpacityScale, focus) *
      (reducedMotion ? VISUAL_COMPOSITION.ambientMaterial.reducedMotionOpacityScale : 1);

    if (this.visibleCount !== this.targetCount) {
      const difference = this.targetCount - this.visibleCount;
      const step = Math.max(1, Math.ceil(Math.abs(difference) * (difference > 0 ? 0.12 : 0.08)));
      this.visibleCount += Math.sign(difference) * step;
      if (Math.sign(difference) !== Math.sign(this.targetCount - this.visibleCount)) {
        this.visibleCount = this.targetCount;
      }
      this.visibleCount = clamp(this.visibleCount, 0, this.layout.instances.length);
    }

    const count = Math.min(this.visibleCount, this.layout.instances.length);
    this.mesh.count = count;
    if (count <= 0) return;

    for (let index = 0; index < count; index += 1) {
      const instance = this.layout.instances[index];
      const cohort = this.layout.cohorts[instance.cohortIndex] ?? this.layout.cohorts[0];
      const depth = instance.depth;
      const { halfWidth, halfHeight } = getVisibleHalfSizeAtDepth(this.camera, depth);
      const t = officialReferenceMotion ? elapsed * 0.82 : this.motionTime + instance.timeOffset;

      if (officialReferenceMotion) {
        this.tmpOffset.set(
          Math.cos(t + index) * halfWidth * 0.5,
          Math.sin(t + index * 1.1) * halfHeight * 0.42,
          Math.sin(t * 0.74 + index * 0.37) * depth * 0.08,
        );
      } else {
        const roleFactor = reducedMotion ? Math.min(instance.motionRoleFactor, 0.18) : instance.motionRoleFactor;
        this.tmpGroupOffset.set(
          (
            Math.cos((t * TWO_PI) / cohort.periodX + cohort.phaseX) +
            Math.sin((t * TWO_PI * cohort.secondaryRateX) / cohort.periodX + cohort.phaseY) * cohort.secondaryWeight
          ) * halfWidth * cohort.amplitudeNdcX * amplitudeScale * roleFactor,
          (
            Math.sin((t * TWO_PI) / cohort.periodY + cohort.phaseY) +
            Math.cos((t * TWO_PI * cohort.secondaryRateY) / cohort.periodY + cohort.phaseZ) * cohort.secondaryWeight
          ) * halfHeight * cohort.amplitudeNdcY * amplitudeScale * roleFactor,
          (
            Math.sin((t * TWO_PI) / cohort.periodZ + cohort.phaseZ) +
            Math.cos((t * TWO_PI * cohort.secondaryRateZ) / cohort.periodZ + cohort.phaseX) * cohort.secondaryWeight
          ) * depth * cohort.amplitudeDepth * amplitudeScale * roleFactor,
        );

        this.tmpIndividualOffset.set(
          (
            Math.sin((t * TWO_PI) / instance.periodX + instance.phaseX) +
            Math.sin((t * TWO_PI * 0.47) / instance.periodX + instance.secondaryPhaseX) * instance.secondaryWeight
          ) * halfWidth * instance.individualNdcX * amplitudeScale * roleFactor,
          (
            Math.cos((t * TWO_PI) / instance.periodY + instance.phaseY) +
            Math.sin((t * TWO_PI * 0.41) / instance.periodY + instance.secondaryPhaseY) * instance.secondaryWeight
          ) * halfHeight * instance.individualNdcY * amplitudeScale * roleFactor,
          (
            Math.sin((t * TWO_PI) / instance.periodZ + instance.phaseZ) +
            Math.cos((t * TWO_PI * 0.36) / instance.periodZ + instance.secondaryPhaseZ) * instance.secondaryWeight
          ) * depth * instance.individualDepth * amplitudeScale * roleFactor,
        );

        this.tmpOffset.copy(this.tmpGroupOffset).add(this.tmpIndividualOffset);
      }

      this.matrixObject.position.copy(instance.anchorPosition).add(this.tmpOffset);
      this.tmpProjected.copy(this.matrixObject.position).project(this.camera);
      if (Math.abs(this.tmpProjected.x) > 1.18) {
        this.matrixObject.position.x -= Math.sign(this.tmpProjected.x) * (Math.abs(this.tmpProjected.x) - 1.18) * halfWidth * 0.62;
      }
      if (Math.abs(this.tmpProjected.y) > 1.16) {
        this.matrixObject.position.y -= Math.sign(this.tmpProjected.y) * (Math.abs(this.tmpProjected.y) - 1.16) * halfHeight * 0.62;
      }

      const breath = reducedMotion ? 0 : Math.sin(t * 0.73 + instance.scalePhase) * 0.035;
      this.matrixObject.scale.setScalar(instance.radius * (1 + breath));
      this.matrixObject.updateMatrix();
      this.mesh.setMatrixAt(index, this.matrixObject.matrix);
      this.tmpColor.setScalar(brightness * instance.brightness);
      this.mesh.setColorAt(index, this.tmpColor);
      instance.lastPosition.copy(this.matrixObject.position);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  getSnapshot({ camera = this.camera, viewport = {} } = {}) {
    const width = Math.max(2, viewport.width || 2);
    const height = Math.max(2, viewport.height || 2);
    const sampleCount = Math.min(this.visibleCount, this.layout?.instances.length ?? 0, 60);
    const samples = [];

    for (let index = 0; index < sampleCount; index += 1) {
      const instance = this.layout.instances[index];
      const screen = projectBubbleToScreen({
        position: instance.lastPosition,
        radius: instance.radius,
        camera,
        viewport: { width, height },
      });
      samples.push({
        index,
        depthBand: instance.depthBand,
        sizeBucket: instance.sizeBucket,
        x: screen.x,
        y: screen.y,
        radius: screen.radius,
        visible: screen.isVisible,
      });
    }

    return {
      targetCount: this.targetCount,
      visibleCount: this.visibleCount,
      qualityName: this.qualityName,
      cohortCount: this.layout?.cohorts.length ?? 0,
      metrics: this.layout?.metrics ?? null,
      samples,
    };
  }

  dispose() {
    this.group?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
