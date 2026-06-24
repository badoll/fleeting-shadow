import './styles.css';
import { createIcons } from './icons.js';
import Cuboid from 'lucide/dist/esm/icons/cuboid.mjs';
import ImageIcon from 'lucide/dist/esm/icons/image.mjs';
import ImagePlus from 'lucide/dist/esm/icons/image-plus.mjs';
import Info from 'lucide/dist/esm/icons/info.mjs';
import RotateCcw from 'lucide/dist/esm/icons/rotate-ccw.mjs';
import Settings2 from 'lucide/dist/esm/icons/settings-2.mjs';
import Shuffle from 'lucide/dist/esm/icons/shuffle.mjs';
import Sparkles from 'lucide/dist/esm/icons/sparkles.mjs';
import Volume2 from 'lucide/dist/esm/icons/volume-2.mjs';
import VolumeX from 'lucide/dist/esm/icons/volume-x.mjs';
import X from 'lucide/dist/esm/icons/x.mjs';
import {
  classifyBackground,
  classifyCubeFace,
  createMediaRecordsFromFiles,
  disposeMediaRecords,
  hashString,
  seededRandom,
  summarizeMediaValidation,
  validateMediaFiles,
} from './domain.js';
import { AmbientBgm } from './audio.js';
import { createSampleMemories, prepareMemoryRecords } from './media.js';
import {
  detectPlatformCapabilities,
  getPlatformIssueMessages,
  getRuntimeProfile,
} from './platform.js';
import { registerAppShellServiceWorker } from './pwa.js';
import { MemoryBubbleScene } from './scene.js';
import {
  DEFAULT_MOTION_PRESET,
  DEFAULT_VIEW_MODE,
  MOTION_PRESET_LABELS,
  VIEW_MODE_LABELS,
} from './bubbleMotionConfig.js';

createIcons({
  attrs: {
    width: 18,
    height: 18,
    'stroke-width': 1.85,
  },
  icons: {
    Cuboid,
    Image: ImageIcon,
    ImagePlus,
    Info,
    RotateCcw,
    Settings2,
    Shuffle,
    Sparkles,
    Volume2,
    VolumeX,
    X,
  },
});

const InteractionState = Object.freeze({
  EMPTY: 'EMPTY',
  LOADING: 'LOADING',
  BROWSING: 'BROWSING',
  HOVERING: 'HOVERING',
  FOCUSING: 'FOCUSING',
  VIEWING: 'VIEWING',
  EXITING: 'EXITING',
  ERROR: 'ERROR',
});

const app = document.querySelector('#app');
const canvas = document.querySelector('#memory-canvas');
const fileInput = document.querySelector('#file-input');
const backgroundInput = document.querySelector('#background-input');
const panoramaBackgroundInput = document.querySelector('#panorama-background-input');
const cubeBackgroundInput = document.querySelector('#cube-background-input');
const emptyState = document.querySelector('#empty-state');
const loadingOverlay = document.querySelector('#loading-overlay');
const loadingTitle = document.querySelector('#loading-title');
const loadingDetail = document.querySelector('#loading-detail');
const loadingProgress = document.querySelector('#loading-progress');
const memoryCount = document.querySelector('#memory-count');
const topAddButton = document.querySelector('#top-add-button');
const mobileAddButtons = document.querySelectorAll('[data-mobile-add]');
const randomControls = document.querySelectorAll('[data-random-control]');
const resetButton = document.querySelector('#reset-button');
const parallaxButton = document.querySelector('#parallax-button');
const barrierButton = document.querySelector('#barrier-button');
const reduceMotionButton = document.querySelector('#reduce-motion-button');
const viewModeInputs = document.querySelectorAll('input[name="view-mode"]');
const motionPresetInputs = document.querySelectorAll('input[name="motion-preset"]');
const bubbleSizeInput = document.querySelector('#bubble-size');
const bubbleSizeValue = document.querySelector('#bubble-size-value');
const ambientVolumeInput = document.querySelector('#ambient-volume');
const ambientVolumeValue = document.querySelector('#ambient-volume-value');
const settingsButton = document.querySelector('#settings-button');
const settingsPanel = document.querySelector('#settings-panel');
const closeSettingsButton = document.querySelector('#close-settings');
const focusView = document.querySelector('#focus-view');
const focusStage = document.querySelector('#focus-stage');
const focusTitle = document.querySelector('#focus-title');
const focusKind = document.querySelector('#focus-kind');
const focusMeta = document.querySelector('#focus-meta');
const videoSoundState = document.querySelector('#video-sound-state');
const closeFocusButton = document.querySelector('#close-focus');
const backgroundModal = document.querySelector('#background-modal');
const closeBackgroundButton = document.querySelector('#close-background');
const backgroundModeList = document.querySelector('#background-mode-list');
const backgroundConfig = document.querySelector('#background-config');
const backgroundTitle = document.querySelector('#background-title');
const backgroundSubtitle = document.querySelector('#background-subtitle');
const backgroundUploadArea = document.querySelector('#background-upload-area');
const backgroundBackButton = document.querySelector('#background-back');
const backgroundApplyButton = document.querySelector('#background-apply');
const statusLine = document.querySelector('#status-line');
const audioButtons = document.querySelectorAll('[data-audio-toggle]');
const bubbleHint = document.querySelector('#bubble-hint');
const memoryA11yList = document.querySelector('#memory-a11y-list');
const capabilityNote = document.querySelector('#capability-note');

let memories = [];
let focusedMemory = null;
let interactionState = InteractionState.EMPTY;
let parallaxEnabled = true;
let barrierEnabled = false;
let userReducedMotion = false;
let viewMode = DEFAULT_VIEW_MODE;
let motionPreset = DEFAULT_MOTION_PRESET;
let bubbleScale = 1;
let backgroundObjectUrls = [];
let pendingBackgroundMode = null;
let pendingSingleBackgroundFile = null;
let pendingSingleBackgroundInfo = null;
let pendingCubeBackgroundFiles = new Map();
let pendingCubeBackgroundInfo = new Map();
let pendingCubeFaceKey = null;
let pendingBackgroundFeedback = null;
let pendingPreviewUrls = new Map();
let backgroundSelectionToken = 0;
let statusTimer = 0;
let randomSource = seededRandom('initial-memory-random');
let openedMemoryIds = new Set();
let activeOpenToken = 0;
let lastFocusReturnTarget = null;
let lastSettingsReturnTarget = null;
let viewDirty = false;

const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const platformCapabilities = detectPlatformCapabilities();
const runtimeProfile = getRuntimeProfile(platformCapabilities);

const BACKGROUND_MAX_BYTES = 30 * 1024 * 1024;
const BACKGROUND_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BACKGROUND_ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const BACKGROUND_EXTENSION_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const CUBE_FACE_RECOMMENDED_SIZE = 2048;
const CUBE_BACKGROUND_FACES = Object.freeze([
  { key: 'px', label: '右', code: 'px / +X', hint: '右侧面' },
  { key: 'nx', label: '左', code: 'nx / -X', hint: '左侧面' },
  { key: 'py', label: '上', code: 'py / +Y', hint: '顶部' },
  { key: 'ny', label: '下', code: 'ny / -Y', hint: '底部' },
  { key: 'pz', label: '前', code: 'pz / +Z', hint: '前方' },
  { key: 'nz', label: '后', code: 'nz / -Z', hint: '后方' },
]);
const CUBE_BACKGROUND_FACE_KEYS = CUBE_BACKGROUND_FACES.map((face) => face.key);

const BACKGROUND_MODE_COPY = {
  panorama: {
    title: '上传 360° 全景图',
    subtitle: '需接近 2:1；推荐 4096×2048 以上。',
    apply: '应用 360° 全景',
  },
  flat: {
    title: '上传普通背景',
    subtitle: '推荐 1920×1080 以上；系统会居中裁剪。',
    apply: '应用普通背景',
  },
  cube: {
    title: '上传 Cube 六面图',
    subtitle: '请按 px/nx/py/ny/pz/nz 对应右、左、上、下、前、后选择六张同尺寸方图。',
    apply: '应用 Cube 背景',
  },
};

function createFallbackScene() {
  return {
    setMemories() {},
    pulseMemory() {},
    focusBubble: () => Promise.resolve(true),
    clearFocus: () => Promise.resolve(true),
    setParallaxMode() {},
    setBarrierMode: () => false,
    setMotionPreset: () => true,
    setViewMode: () => true,
    setBubbleScale() {},
    resetView() {},
    setReducedMotion() {},
    setPageVisible() {},
    resetBackground() {},
    setFlatBackgroundImage() {},
    setPanoramaBackground() {},
    setCubeBackground() {},
    getMaxTextureSize: () => 2048,
    dispose() {},
  };
}

function handleRenderStatus({ status }) {
  document.body.dataset.renderStatus = status;
  if (status === 'lost') {
    showStatus('WebGL 暂时中断，浏览器恢复后会尝试重建空间');
  }
  if (status === 'restored') {
    showStatus('WebGL 已恢复，回忆空间已重建');
  }
}

let scene;
let webglReady = Boolean(platformCapabilities.webgl?.supported);

try {
  if (!webglReady) throw new Error('WebGL unavailable');
  scene = new MemoryBubbleScene({
    canvas,
    rendererProfile: runtimeProfile.renderer,
    onRenderStatus: handleRenderStatus,
    onPick: (memory) => {
      void openMemory(memory, { source: 'bubble' });
    },
    onHoverChange: handleBubbleHover,
  });
} catch (error) {
  console.warn(error);
  webglReady = false;
  scene = createFallbackScene();
}

const bgm = new AmbientBgm();
const DEFAULT_AMBIENT_AUDIO_ENABLED = true;
const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
const AUDIO_UNLOCK_OPTIONS = { capture: true, passive: true };
let desiredAudioEnabled = DEFAULT_AMBIENT_AUDIO_ENABLED;
let defaultAudioUnlockAttached = false;
let defaultAudioUnlockInFlight = false;

function delay(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function isReducedMotion() {
  return userReducedMotion || systemReducedMotion.matches;
}

function setInteractionState(nextState) {
  interactionState = nextState;
  app.dataset.state = nextState.toLowerCase();
  document.body.dataset.memoryState = nextState.toLowerCase();
  updateControls();
}

function showStatus(message) {
  window.clearTimeout(statusTimer);
  statusLine.textContent = message;
  statusLine.classList.add('is-visible');
  statusTimer = window.setTimeout(() => {
    statusLine.classList.remove('is-visible');
  }, 3200);
}

function hideStatus() {
  window.clearTimeout(statusTimer);
  statusLine.classList.remove('is-visible');
}

function applyRuntimeProfile() {
  document.body.dataset.platform = runtimeProfile.platform;
  document.body.classList.toggle('touch-runtime', runtimeProfile.touch);
  document.body.classList.toggle('constrained-runtime', runtimeProfile.constrained);
  document.body.classList.toggle('webgl-unavailable', !webglReady);
  app.dataset.platform = runtimeProfile.platform;

  const issueMessages = getPlatformIssueMessages({
    ...platformCapabilities,
    webgl: {
      ...platformCapabilities.webgl,
      supported: webglReady,
    },
  });

  if (issueMessages.length === 0) {
    capabilityNote.hidden = true;
    capabilityNote.textContent = '';
    return;
  }

  capabilityNote.hidden = false;
  capabilityNote.textContent = issueMessages.join('；');
}

function setControlDisabled(button, disabled, reason) {
  button.disabled = disabled;
  button.setAttribute('aria-disabled', String(disabled));
  if (disabled) {
    button.title = reason;
    button.setAttribute('aria-label', reason);
    return;
  }

  const label = button.dataset.enabledLabel || button.textContent.trim() || button.title;
  button.title = label;
  button.setAttribute('aria-label', label);
}

function updateControls() {
  const hasMemories = memories.length > 0;
  const isLoading = interactionState === InteractionState.LOADING;
  const busy =
    interactionState === InteractionState.LOADING ||
    interactionState === InteractionState.FOCUSING ||
    interactionState === InteractionState.EXITING;

  memoryCount.textContent = `${memories.length} 段回忆`;
  emptyState.hidden = hasMemories || isLoading;
  loadingOverlay.hidden = !isLoading;
  topAddButton.hidden = !hasMemories;
  mobileAddButtons.forEach((button) => {
    button.hidden = !hasMemories;
  });

  randomControls.forEach((button) => {
    const reason = hasMemories ? '回忆正在展开，请稍候' : '添加回忆后可使用';
    setControlDisabled(button, !hasMemories || busy, reason);
  });

  setControlDisabled(resetButton, !viewDirty, '视角变化后可使用');
  settingsButton.setAttribute('aria-expanded', String(!settingsPanel.hidden));
  renderAccessibleMemoryActions();
}

function updateLoadingProgress({ completed = 0, total = 1, current, status = 'processing' } = {}) {
  const safeTotal = Math.max(total, 1);
  const displayCompleted = Math.min(completed, safeTotal);
  loadingProgress.max = safeTotal;
  loadingProgress.value = displayCompleted;
  loadingTitle.textContent = '正在让回忆显影';

  if (status === 'done') {
    loadingDetail.textContent = `已处理 ${displayCompleted} / ${safeTotal}`;
    return;
  }

  const name = current?.name ? `：${current.name}` : '';
  loadingDetail.textContent = `正在处理 ${displayCompleted + 1} / ${safeTotal}${name}`;
}

function updateAudioButtons() {
  const label = desiredAudioEnabled ? '关闭环境音乐' : '开启环境音乐';

  audioButtons.forEach((button) => {
    button.classList.toggle('is-active', desiredAudioEnabled);
    button.setAttribute('aria-pressed', String(desiredAudioEnabled));
    button.setAttribute('aria-label', label);
    button.title = label;
    const text = button.querySelector('span');
    if (text) text.textContent = desiredAudioEnabled ? '开启' : '关闭';
  });
}

function setDefaultAudioUnlockListeners(enabled) {
  if (defaultAudioUnlockAttached === enabled) return;
  defaultAudioUnlockAttached = enabled;
  const method = enabled ? 'addEventListener' : 'removeEventListener';
  AUDIO_UNLOCK_EVENTS.forEach((eventName) => {
    document[method](eventName, handleDefaultAudioUnlock, AUDIO_UNLOCK_OPTIONS);
  });
}

async function requestAmbientAudio({ announce = false, deferOnBlocked = false } = {}) {
  desiredAudioEnabled = true;

  try {
    await bgm.unmute();
    defaultAudioUnlockInFlight = false;
    setDefaultAudioUnlockListeners(false);
    updateAudioButtons();
    if (announce) showStatus('环境音乐已轻轻响起');
    return true;
  } catch {
    defaultAudioUnlockInFlight = Boolean(deferOnBlocked);
    setDefaultAudioUnlockListeners(defaultAudioUnlockInFlight);
    updateAudioButtons();
    if (announce) showStatus('环境音乐会在浏览器允许后播放');
    return false;
  }
}

function disableAmbientAudio({ announce = false } = {}) {
  desiredAudioEnabled = false;
  defaultAudioUnlockInFlight = false;
  setDefaultAudioUnlockListeners(false);
  bgm.mute();
  updateAudioButtons();
  if (announce) showStatus('环境音乐已关闭');
}

function handleDefaultAudioUnlock(event) {
  if (!desiredAudioEnabled || !defaultAudioUnlockInFlight || bgm.isEnabled) return;
  if (event.target?.closest?.('[data-audio-toggle]')) return;
  void requestAmbientAudio({ deferOnBlocked: true });
}

async function toggleAudio() {
  if (desiredAudioEnabled) {
    if (!bgm.isEnabled) {
      await requestAmbientAudio({ announce: true, deferOnBlocked: true });
      return;
    }

    disableAmbientAudio({ announce: true });
    return;
  }

  await requestAmbientAudio({ announce: true, deferOnBlocked: true });
}

function enableDefaultAmbientAudio() {
  if (!DEFAULT_AMBIENT_AUDIO_ENABLED) return;
  void requestAmbientAudio({ deferOnBlocked: true });
}

function setAmbientVolume(value, { announce = false } = {}) {
  const numericValue = Number(value);
  const percent = Number.isFinite(numericValue) ? Math.max(0, Math.min(numericValue, 100)) : 42;
  ambientVolumeValue.textContent = `${percent}%`;
  bgm.setVolume(percent / 100);
  if (announce) showStatus(`环境音乐音量 ${percent}%`);
}

function syncReducedMotion() {
  const enabled = isReducedMotion();
  document.body.classList.toggle('reduced-motion', enabled);
  scene.setReducedMotion(enabled);
  reduceMotionButton.setAttribute('aria-pressed', String(enabled));
  reduceMotionButton.textContent = enabled ? '开启' : '关闭';
  reduceMotionButton.title = systemReducedMotion.matches
    ? '系统已请求减少动态效果'
    : '切换减少动态效果';
}

function toggleReducedMotion() {
  if (systemReducedMotion.matches && !userReducedMotion) {
    showStatus('系统已开启减少动态效果');
    syncReducedMotion();
    return;
  }

  userReducedMotion = !userReducedMotion;
  syncReducedMotion();
  showStatus(userReducedMotion ? '已减少空间动态效果' : '空间动态效果已恢复');
}

function markViewDirty() {
  viewDirty = true;
  updateControls();
}

function releaseCurrentMemories() {
  disposeMediaRecords(memories);
  memories = [];
  openedMemoryIds = new Set();
  focusedMemory = null;
  scene.setMemories([], 'empty');
  setInteractionState(InteractionState.EMPTY);
}

async function replaceMemories(nextRecords, seed) {
  await closeFocusedMemory({ silent: true, immediate: true, restoreFocus: false });
  releaseCurrentMemories();
  setInteractionState(InteractionState.LOADING);
  updateLoadingProgress({ completed: 0, total: nextRecords.length });
  showStatus('正在处理照片和视频...');

  try {
    memories = await prepareMemoryRecords(nextRecords, {
      onProgress: updateLoadingProgress,
    });
    openedMemoryIds = new Set();
    randomSource = seededRandom(`${seed}:${memories.length}`);
    scene.setMemories(memories, seed);
    setInteractionState(memories.length > 0 ? InteractionState.BROWSING : InteractionState.EMPTY);
    showStatus(`${memories.length} 段回忆已漂浮起来`);
  } catch {
    disposeMediaRecords(nextRecords);
    memories = [];
    scene.setMemories([], 'error');
    setInteractionState(InteractionState.ERROR);
    showStatus('有回忆暂时无法处理，请换一组文件试试');
  }
}

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    showStatus('没有选择文件');
    return;
  }

  const validation = validateMediaFiles(fileList, runtimeProfile.media);
  const { records, unsupported } = createMediaRecordsFromFiles(validation.acceptedFiles);
  const rejectedFiles = [
    ...validation.rejectedFiles,
    ...unsupported.map((file) => ({
      file,
      code: 'preview-unavailable',
      reason: '当前浏览器无法创建本地预览',
    })),
  ];

  if (records.length === 0) {
    showStatus(summarizeMediaValidation({ acceptedCount: 0, rejectedFiles }) || '未找到可预览的照片或视频');
    return;
  }

  const seed = Array.from(validation.acceptedFiles)
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .join('|');
  await replaceMemories(records, `files:${hashString(seed)}`);

  if (rejectedFiles.length > 0) {
    showStatus(
      summarizeMediaValidation({
        acceptedCount: records.length,
        rejectedFiles,
      }),
    );
  }
}

async function loadSamples() {
  const samples = createSampleMemories(50);
  await replaceMemories(samples, 'sample-memory-set');
}

function getMemoryIndex(memory) {
  return Math.max(0, memories.findIndex((item) => item.id === memory?.id));
}

function getNextRandomMemory() {
  if (memories.length === 0) return null;
  if (memories.length === 1) return memories[0];

  const currentId = focusedMemory?.id;
  const unseen = memories.filter((memory) => memory.id !== currentId && !openedMemoryIds.has(memory.id));
  const pool = unseen.length > 0
    ? unseen
    : memories.filter((memory) => memory.id !== currentId);
  const candidates = pool.length > 0 ? pool : memories;
  const index = Math.floor(randomSource() * candidates.length);
  return candidates[Math.max(0, Math.min(index, candidates.length - 1))];
}

async function openRandomMemory(triggerElement = document.activeElement) {
  const memory = getNextRandomMemory();
  if (!memory) {
    showStatus('添加回忆后，才能随机遇见');
    return;
  }

  await openMemory(memory, { triggerElement, source: 'random' });
}

async function openMemory(memory, { triggerElement = document.activeElement } = {}) {
  if (!memory) return;

  const blockedStates = [
    InteractionState.LOADING,
    InteractionState.FOCUSING,
    InteractionState.EXITING,
  ];
  if (blockedStates.includes(interactionState)) return;

  closeSettings({ silent: true });
  closeBackgroundModal({ silent: true });

  if (focusedMemory || !focusView.hidden) {
    await closeFocusedMemory({ silent: true, immediate: true, restoreFocus: false });
  }

  const openRequestId = ++activeOpenToken;
  lastFocusReturnTarget = triggerElement instanceof HTMLElement
    ? triggerElement
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  focusedMemory = memory;
  openedMemoryIds.add(memory.id);
  setInteractionState(InteractionState.FOCUSING);
  scene.pulseMemory(memory.id);
  bgm.playMemoryCue();
  bgm.setDucked(false);

  const focusFinished = await scene.focusBubble(memory.id);
  if (openRequestId !== activeOpenToken) return;
  if (!focusFinished) {
    focusedMemory = null;
    setInteractionState(memories.length > 0 ? InteractionState.BROWSING : InteractionState.EMPTY);
    showStatus('这段回忆暂时还没准备好，请再试一次');
    return;
  }

  hideStatus();
  renderFocusedMemory(memory);
  focusView.hidden = false;
  focusView.classList.remove('is-exiting');
  document.body.classList.add('memory-focused');
  setInteractionState(InteractionState.VIEWING);
  closeFocusButton.focus({ preventScroll: true });
}

function renderFocusedMemory(memory) {
  const index = getMemoryIndex(memory);
  focusStage.replaceChildren();
  focusTitle.textContent = memory.name || '未命名回忆';
  focusKind.textContent = memory.kind === 'video' ? '视频回忆' : '照片回忆';
  focusMeta.textContent = `第 ${index + 1} 段 / 共 ${memories.length} 段`;
  videoSoundState.textContent = memory.kind === 'video'
    ? '视频原声待播放'
    : '照片静静展开';

  const frame = document.createElement('div');
  frame.className = 'media-frame';

  const placeholder = document.createElement('div');
  placeholder.className = 'media-placeholder';
  placeholder.textContent = '正在显影...';

  const mediaElement =
    memory.kind === 'video'
      ? document.createElement('video')
      : document.createElement('img');

  mediaElement.src = memory.source;
  mediaElement.className = 'focused-media';

  if (memory.kind === 'video') {
    const manualPlayButton = document.createElement('button');
    manualPlayButton.type = 'button';
    manualPlayButton.className = 'manual-play-button';
    manualPlayButton.textContent = '播放视频';
    manualPlayButton.hidden = true;

    const attemptPlay = () => {
      manualPlayButton.hidden = true;
      mediaElement
        .play()
        .then(() => {
          videoSoundState.textContent = '视频原声播放中，环境音乐已降低';
          bgm.setDucked(true);
        })
        .catch(() => {
          manualPlayButton.hidden = false;
          videoSoundState.textContent = '这个视频暂时无法自动播放，请点击播放按钮';
          bgm.setDucked(false);
        });
    };

    mediaElement.controls = true;
    mediaElement.autoplay = true;
    mediaElement.playsInline = true;
    mediaElement.setAttribute('playsinline', '');
    mediaElement.setAttribute('webkit-playsinline', '');
    mediaElement.preload = 'metadata';
    mediaElement.muted = false;
    mediaElement.addEventListener('loadedmetadata', () => {
      placeholder.remove();
      attemptPlay();
    }, { once: true });
    mediaElement.addEventListener('play', () => {
      videoSoundState.textContent = '视频原声播放中，环境音乐已降低';
      bgm.setDucked(true);
    });
    mediaElement.addEventListener('pause', () => {
      if (!focusView.hidden) videoSoundState.textContent = '视频已暂停';
      bgm.setDucked(false);
    });
    mediaElement.addEventListener('ended', () => {
      videoSoundState.textContent = '视频已播放完';
      bgm.setDucked(false);
    });
    mediaElement.addEventListener('error', () => {
      manualPlayButton.hidden = false;
      videoSoundState.textContent = '这个视频暂时无法播放';
      showStatus('这个视频暂时无法播放');
      bgm.setDucked(false);
    });
    manualPlayButton.addEventListener('click', attemptPlay);

    frame.append(placeholder, mediaElement, manualPlayButton);
  } else {
    mediaElement.alt = memory.name || '打开的回忆照片';
    mediaElement.decoding = 'async';
    mediaElement.addEventListener('load', () => placeholder.remove(), { once: true });
    mediaElement.addEventListener('error', () => {
      placeholder.textContent = '这张照片暂时无法显示';
      showStatus('这张照片暂时无法显示');
    });
    frame.append(placeholder, mediaElement);
  }

  focusStage.append(frame);
}

function pauseFocusedMedia() {
  const activeVideo = focusStage.querySelector('video');
  activeVideo?.pause();
  bgm.setDucked(false);
}

async function closeFocusedMemory({
  silent = false,
  immediate = false,
  restoreFocus = true,
} = {}) {
  if (!focusedMemory && focusView.hidden && interactionState !== InteractionState.FOCUSING) {
    return;
  }

  const closeRequestId = ++activeOpenToken;
  pauseFocusedMedia();
  focusView.classList.add('is-exiting');
  setInteractionState(InteractionState.EXITING);

  const overlayDelay = immediate ? 0 : isReducedMotion() ? 90 : 220;
  await Promise.all([
    scene.clearFocus({ immediate }),
    delay(overlayDelay),
  ]);

  if (closeRequestId !== activeOpenToken) return;

  focusStage.replaceChildren();
  focusedMemory = null;
  focusView.hidden = true;
  focusView.classList.remove('is-exiting');
  document.body.classList.remove('memory-focused');
  setInteractionState(memories.length > 0 ? InteractionState.BROWSING : InteractionState.EMPTY);

  if (restoreFocus && lastFocusReturnTarget?.isConnected) {
    lastFocusReturnTarget.focus({ preventScroll: true });
  }

  if (!silent) showStatus('回到泡泡空间');
}

function toggleParallax() {
  parallaxEnabled = !parallaxEnabled;
  scene.setParallaxMode(parallaxEnabled);
  parallaxButton.setAttribute('aria-pressed', String(parallaxEnabled));
  parallaxButton.textContent = parallaxEnabled ? '开启' : '关闭';
  parallaxButton.classList.toggle('is-active', parallaxEnabled);
  markViewDirty();
  showStatus(parallaxEnabled ? '空间视角已开启' : '空间视角已关闭');
}

function toggleBarrierEffect() {
  barrierEnabled = !barrierEnabled;
  barrierEnabled = scene.setBarrierMode(barrierEnabled);
  barrierButton.setAttribute('aria-pressed', String(barrierEnabled));
  barrierButton.textContent = barrierEnabled ? '开启' : '关闭';
  barrierButton.classList.toggle('is-active', barrierEnabled);
  markViewDirty();
  showStatus(barrierEnabled ? '栅栏视差实验模式已开启' : '栅栏视差实验模式已关闭');
}

function setMotionPreset(value, { announce = true, markDirty = true } = {}) {
  const nextPreset = scene.setMotionPreset(value) ? value : DEFAULT_MOTION_PRESET;
  if (nextPreset !== value) scene.setMotionPreset(nextPreset);
  motionPreset = nextPreset;
  motionPresetInputs.forEach((input) => {
    input.checked = input.value === nextPreset;
  });
  if (markDirty) markViewDirty();
  if (announce) showStatus(`动态强度：${MOTION_PRESET_LABELS[nextPreset] ?? nextPreset}`);
}

function setViewMode(value, { announce = true, markDirty = true } = {}) {
  const nextMode = scene.setViewMode(value) ? value : DEFAULT_VIEW_MODE;
  if (nextMode !== value) scene.setViewMode(nextMode);
  viewMode = nextMode;
  viewModeInputs.forEach((input) => {
    input.checked = input.value === nextMode;
  });
  if (markDirty) markViewDirty();
  if (announce) showStatus(`视角模式：${VIEW_MODE_LABELS[nextMode] ?? nextMode}`);
}

function setBubbleScale(value, { markDirty = true } = {}) {
  const numericValue = Number(value);
  bubbleScale = Number.isFinite(numericValue) ? numericValue / 100 : 1;
  scene.setBubbleScale(bubbleScale);
  bubbleSizeValue.textContent = `${bubbleScale.toFixed(1)}x`;
  if (markDirty && Math.abs(bubbleScale - 1) > 0.01) markViewDirty();
}

function resetView() {
  parallaxEnabled = true;
  scene.setParallaxMode(true);
  parallaxButton.setAttribute('aria-pressed', 'true');
  parallaxButton.textContent = '开启';
  parallaxButton.classList.add('is-active');
  bubbleSizeInput.value = '100';
  setBubbleScale(100, { markDirty: false });
  scene.resetView();
  viewDirty = false;
  updateControls();
  showStatus('已回到初始视角');
}

function clearCustomBackground() {
  scene.resetBackground();
  backgroundObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  backgroundObjectUrls = [];
}

function createBackgroundUrls(files) {
  backgroundObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  backgroundObjectUrls = Array.from(files).map((file) => URL.createObjectURL(file));
  return backgroundObjectUrls;
}

function clearPendingPreviewUrls() {
  pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  pendingPreviewUrls = new Map();
}

function resetPendingBackground() {
  backgroundSelectionToken += 1;
  clearPendingPreviewUrls();
  pendingBackgroundMode = null;
  pendingSingleBackgroundFile = null;
  pendingSingleBackgroundInfo = null;
  pendingCubeBackgroundFiles = new Map();
  pendingCubeBackgroundInfo = new Map();
  pendingCubeFaceKey = null;
  pendingBackgroundFeedback = null;
  backgroundInput.value = '';
  panoramaBackgroundInput.value = '';
  cubeBackgroundInput.value = '';
}

function clearPendingPreview(key) {
  const existingUrl = pendingPreviewUrls.get(key);
  if (existingUrl) URL.revokeObjectURL(existingUrl);
  pendingPreviewUrls.delete(key);
}

function setPendingPreview(key, file) {
  const existingUrl = pendingPreviewUrls.get(key);
  if (existingUrl) URL.revokeObjectURL(existingUrl);
  pendingPreviewUrls.set(key, URL.createObjectURL(file));
}

function getCubePreviewKey(faceKey) {
  return `cube:${faceKey}`;
}

function getCubeFace(faceKey) {
  return CUBE_BACKGROUND_FACES.find((face) => face.key === faceKey) || null;
}

function getSelectedCubeFaceCount() {
  return CUBE_BACKGROUND_FACE_KEYS.filter((faceKey) => pendingCubeBackgroundFiles.has(faceKey)).length;
}

function getCubeDimensionMismatch() {
  let base = null;

  for (const face of CUBE_BACKGROUND_FACES) {
    const info = pendingCubeBackgroundInfo.get(face.key);
    if (!info?.dimensions) continue;

    const dimensions = info.dimensions;
    if (!base) {
      base = { face, dimensions };
      continue;
    }

    if (dimensions.width !== base.dimensions.width || dimensions.height !== base.dimensions.height) {
      return {
        base,
        mismatch: { face, dimensions },
      };
    }
  }

  return null;
}

function getCubeProgressFeedback() {
  const selectedCount = getSelectedCubeFaceCount();
  if (selectedCount === 0) return null;

  const mismatch = getCubeDimensionMismatch();
  if (mismatch) {
    return createValidationFeedback(
      'warning',
      `六张 Cube 面图必须同尺寸；${mismatch.base.face.label} 为 ${formatDimensions(
        mismatch.base.dimensions,
      )}，${mismatch.mismatch.face.label} 为 ${formatDimensions(mismatch.mismatch.dimensions)}。`,
    );
  }

  if (selectedCount < CUBE_BACKGROUND_FACES.length) {
    return createValidationFeedback(
      'info',
      `已选择 ${selectedCount}/${CUBE_BACKGROUND_FACES.length} 张 Cube 面图，继续补齐剩余方向。`,
    );
  }

  const hasLowQualityFace = CUBE_BACKGROUND_FACE_KEYS.some(
    (faceKey) => pendingCubeBackgroundInfo.get(faceKey)?.classification?.quality === 'low',
  );

  return createValidationFeedback(
    hasLowQualityFace ? 'warning' : 'info',
    hasLowQualityFace
      ? `六张 Cube 面图已齐，低于推荐 ${CUBE_FACE_RECOMMENDED_SIZE}×${CUBE_FACE_RECOMMENDED_SIZE} 时画面可能偏糊。`
      : '六张 Cube 面图已齐，将按 px/nx/py/ny/pz/nz 生成环境背景。',
  );
}

function isCubeBackgroundReady() {
  return (
    CUBE_BACKGROUND_FACE_KEYS.every((faceKey) => pendingCubeBackgroundFiles.has(faceKey)) &&
    !getCubeDimensionMismatch()
  );
}

function getFileExtension(file) {
  const extension = String(file?.name || '').split('.').pop();
  return extension ? extension.toLowerCase() : '';
}

function getBackgroundMimeType(file) {
  const type = String(file?.type || '').toLowerCase();
  if (BACKGROUND_ALLOWED_TYPES.has(type)) return type;
  return BACKGROUND_EXTENSION_TYPES[getFileExtension(file)] || 'image/jpeg';
}

function isAllowedBackgroundFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (BACKGROUND_ALLOWED_TYPES.has(type)) return true;
  return BACKGROUND_ALLOWED_EXTENSIONS.has(getFileExtension(file));
}

function formatDimensions({ width, height }) {
  return `${Math.round(width)}×${Math.round(height)}`;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片尺寸'));
    };

    image.decoding = 'async';
    image.src = url;
  });
}

async function readImageDimensions(file) {
  const image = await loadImageElement(file);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function createValidationFeedback(kind, text) {
  return { kind, text };
}

async function validateBackgroundSelection(mode, file) {
  if (!file) {
    return {
      accepted: false,
      feedback: createValidationFeedback('warning', '没有选择图片'),
    };
  }

  if (!isAllowedBackgroundFile(file)) {
    return {
      accepted: false,
      feedback: createValidationFeedback('warning', '只支持 JPG、PNG、WebP 格式'),
    };
  }

  if ((file.size || 0) > BACKGROUND_MAX_BYTES) {
    return {
      accepted: false,
      feedback: createValidationFeedback('warning', '图片不能超过 30 MB'),
    };
  }

  let dimensions;
  try {
    dimensions = await readImageDimensions(file);
  } catch (error) {
    return {
      accepted: false,
      feedback: createValidationFeedback('warning', error.message || '无法读取图片尺寸'),
    };
  }

  const automatic = classifyBackground(dimensions.width, dimensions.height);
  const dimensionText = formatDimensions(dimensions);

  if (mode === 'panorama') {
    if (!automatic.accepted || automatic.mode !== 'panorama') {
      return {
        accepted: false,
        dimensions,
        feedback: createValidationFeedback(
          'warning',
          `360° 全景图需接近 2:1；当前为 ${dimensionText}`,
        ),
      };
    }

    const isLowQuality = automatic.quality === 'low';
    return {
      accepted: true,
      dimensions,
      classification: automatic,
      feedback: createValidationFeedback(
        isLowQuality ? 'warning' : 'info',
        isLowQuality
          ? `已选择 ${dimensionText}，低于推荐 4096×2048，画面可能偏糊。`
          : `已选择 ${dimensionText}，将作为 360° 全景使用。`,
      ),
    };
  }

  if (mode === 'cube') {
    const cubeFace = classifyCubeFace(dimensions.width, dimensions.height);
    if (!cubeFace.accepted) {
      return {
        accepted: false,
        dimensions,
        feedback: createValidationFeedback(
          'warning',
          `Cube 每一面需为正方形；当前为 ${dimensionText}`,
        ),
      };
    }

    const isLowQuality = cubeFace.quality === 'low';
    return {
      accepted: true,
      dimensions,
      classification: cubeFace,
      feedback: createValidationFeedback(
        isLowQuality ? 'warning' : 'info',
        isLowQuality
          ? `已选择 ${dimensionText}，低于推荐 ${CUBE_FACE_RECOMMENDED_SIZE}×${CUBE_FACE_RECOMMENDED_SIZE}，画面可能偏糊。`
          : `已选择 ${dimensionText}，可作为 Cube 面图使用。`,
      ),
    };
  }

  const longSide = Math.max(dimensions.width, dimensions.height);
  const shortSide = Math.min(dimensions.width, dimensions.height);

  const quality = longSide >= 1920 && shortSide >= 1080 ? 'normal' : 'low';
  const mayAlsoBePanorama = automatic.accepted && automatic.mode === 'panorama';
  const qualityText =
    quality === 'low'
      ? `已选择 ${dimensionText}，低于推荐 1920×1080，画面可能偏糊。`
      : `已选择 ${dimensionText}，普通背景将居中裁剪显示。`;

  return {
    accepted: true,
    dimensions,
    classification: {
      accepted: true,
      mode: 'flat',
      quality,
    },
    feedback: createValidationFeedback(
      quality === 'low' ? 'warning' : 'info',
      mayAlsoBePanorama
        ? `${qualityText} 这张图也接近 2:1，可切换到 360° 全景预览确认。`
        : qualityText,
    ),
  };
}

async function prepareBackgroundFileForTexture(file, dimensions) {
  const maxTextureSize = scene.getMaxTextureSize?.() || Infinity;
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  const longestSide = Math.max(width, height);

  if (!Number.isFinite(maxTextureSize) || !Number.isFinite(longestSide) || longestSide <= maxTextureSize) {
    return {
      file,
      resized: false,
      dimensions,
    };
  }

  const scale = maxTextureSize / longestSide;
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  const image = await loadImageElement(file);
  const canvasElement = document.createElement('canvas');
  canvasElement.width = targetWidth;
  canvasElement.height = targetHeight;
  const context = canvasElement.getContext('2d');

  if (!context) {
    throw new Error('无法处理超大背景图');
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const mimeType = getBackgroundMimeType(file);
  const blob = await new Promise((resolve) => {
    canvasElement.toBlob(resolve, mimeType, 0.92);
  });

  if (!blob) {
    throw new Error('无法缩小背景图');
  }

  const resizedFile =
    typeof File === 'function'
      ? new File([blob], file.name || 'background', {
        type: blob.type || mimeType,
        lastModified: file.lastModified || Date.now(),
      })
      : blob;

  return {
    file: resizedFile,
    resized: true,
    dimensions: {
      width: targetWidth,
      height: targetHeight,
    },
  };
}

function createUploadSlot({ key, label, hint, file, previewUrl, large = false, action = 'single' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = large ? 'image-slot image-slot-large' : 'image-slot';
  button.title = file?.name || hint;
  if (action === 'cube') {
    button.dataset.cubeFace = key;
  } else {
    button.dataset.singleBackground = key;
  }

  const frame = document.createElement('span');
  frame.className = 'image-slot-frame';

  if (previewUrl) {
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = `${label}预览`;
    image.decoding = 'async';
    frame.append(image);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = label;
    frame.append(placeholder);
  }

  const copy = document.createElement('span');
  copy.className = 'image-slot-copy';

  const title = document.createElement('strong');
  title.textContent = label;

  const detail = document.createElement('small');
  detail.textContent = file?.name || hint;

  copy.append(title, detail);
  button.append(frame, copy);
  return button;
}

function renderSingleUploadArea(mode) {
  const isFlatMode = mode === 'flat';
  const label = isFlatMode ? '普通背景图' : '360° 全景图';
  const hint = isFlatMode ? 'JPG / PNG / WebP，最大 30 MB' : '接近 2:1，最大 30 MB';
  const note = document.createElement('p');
  note.className = isFlatMode ? 'background-note background-warning' : 'background-note';
  note.textContent = isFlatMode
    ? '支持 JPG、PNG、WebP。普通背景不限制最小尺寸，推荐 1920×1080 以上；不会被强行拉成 360° 全景。'
    : '支持 JPG、PNG、WebP。360° 全景需接近 2:1，不限制最小尺寸，推荐 4096×2048 以上。';

  const children = [
    note,
    createUploadSlot({
      key: mode,
      label,
      hint,
      file: pendingSingleBackgroundFile,
      previewUrl: pendingPreviewUrls.get(mode),
      large: true,
    }),
  ];

  if (pendingBackgroundFeedback) {
    const feedback = document.createElement('p');
    feedback.className =
      pendingBackgroundFeedback.kind === 'warning'
        ? 'background-note background-warning'
        : 'background-note';
    feedback.textContent = pendingBackgroundFeedback.text;
    children.push(feedback);
  }

  backgroundUploadArea.replaceChildren(...children);
}

function renderCubeUploadArea() {
  const note = document.createElement('p');
  note.className = 'background-note';
  note.textContent =
    '请选择同一套 cubemap 导出的六张正方形图片，按 px/nx/py/ny/pz/nz 对应右、左、上、下、前、后；不限制最小尺寸，六张必须同尺寸、边缘连续，推荐 2048×2048 以上。';

  const grid = document.createElement('div');
  grid.className = 'cube-face-grid';
  CUBE_BACKGROUND_FACES.forEach((face) => {
    grid.append(
      createUploadSlot({
        key: face.key,
        label: `${face.label}`,
        hint: `${face.code} · ${face.hint}`,
        file: pendingCubeBackgroundFiles.get(face.key),
        previewUrl: pendingPreviewUrls.get(getCubePreviewKey(face.key)),
        action: 'cube',
      }),
    );
  });

  const children = [note, grid];

  if (pendingBackgroundFeedback) {
    const feedback = document.createElement('p');
    feedback.className =
      pendingBackgroundFeedback.kind === 'warning'
        ? 'background-note background-warning'
        : 'background-note';
    feedback.textContent = pendingBackgroundFeedback.text;
    children.push(feedback);
  }

  backgroundUploadArea.replaceChildren(...children);
}

function updateBackgroundApplyState() {
  backgroundApplyButton.disabled =
    pendingBackgroundMode === 'cube'
      ? !isCubeBackgroundReady()
      : !pendingSingleBackgroundFile;
}

function showBackgroundModeSelection() {
  resetPendingBackground();
  backgroundTitle.textContent = '选择背景模式';
  backgroundSubtitle.textContent = '普通背景不会被当作全景；360° 全景可用单张或 Cube 六面图。';
  backgroundModeList.hidden = false;
  backgroundConfig.hidden = true;
}

function showBackgroundConfig(mode) {
  resetPendingBackground();
  pendingBackgroundMode = mode;

  const copy = BACKGROUND_MODE_COPY[mode];
  backgroundTitle.textContent = copy.title;
  backgroundSubtitle.textContent = copy.subtitle;
  backgroundApplyButton.textContent = copy.apply;
  backgroundApplyButton.disabled = true;
  backgroundModeList.hidden = true;
  backgroundConfig.hidden = false;
  if (mode === 'cube') {
    pendingBackgroundFeedback = createValidationFeedback(
      'info',
      '从 cubemap 工具或素材包中选择同一组 px、nx、py、ny、pz、nz；256×256 等低清图也可用，但画面会偏糊。',
    );
    renderCubeUploadArea();
  } else {
    renderSingleUploadArea(mode);
  }
}

function openSettings(triggerElement = document.activeElement) {
  if (!settingsPanel.hidden) return;
  lastSettingsReturnTarget = triggerElement instanceof HTMLElement ? triggerElement : null;
  settingsPanel.hidden = false;
  document.body.classList.add('settings-open');
  settingsButton.setAttribute('aria-expanded', 'true');
  closeSettingsButton.focus({ preventScroll: true });
}

function closeSettings({ silent = false } = {}) {
  if (settingsPanel.hidden) return;
  settingsPanel.hidden = true;
  document.body.classList.remove('settings-open');
  settingsButton.setAttribute('aria-expanded', 'false');
  if (!silent) {
    lastSettingsReturnTarget?.focus?.({ preventScroll: true });
    showStatus('设置已收起');
  }
}

function openBackgroundPicker() {
  closeSettings({ silent: true });
  showBackgroundModeSelection();
  backgroundModal.hidden = false;
  document.body.classList.add('background-open');
  closeBackgroundButton.focus({ preventScroll: true });
}

function closeBackgroundModal({ silent = false } = {}) {
  if (backgroundModal.hidden) return;
  backgroundModal.hidden = true;
  document.body.classList.remove('background-open');
  resetPendingBackground();
  if (!silent) showStatus('背景配置已关闭');
}

async function handleSingleBackgroundSelection(mode, file) {
  const selectionRequestId = ++backgroundSelectionToken;
  pendingSingleBackgroundFile = null;
  pendingSingleBackgroundInfo = null;
  pendingBackgroundFeedback = createValidationFeedback('info', '正在读取图片尺寸...');
  clearPendingPreview(mode);
  renderSingleUploadArea(mode);
  updateBackgroundApplyState();

  const result = await validateBackgroundSelection(mode, file);
  if (selectionRequestId !== backgroundSelectionToken || pendingBackgroundMode !== mode) return;

  pendingBackgroundFeedback = result.feedback;

  if (!result.accepted) {
    clearPendingPreview(mode);
    renderSingleUploadArea(mode);
    updateBackgroundApplyState();
    showStatus(result.feedback.text);
    return;
  }

  pendingSingleBackgroundFile = file;
  pendingSingleBackgroundInfo = {
    dimensions: result.dimensions,
    classification: result.classification,
  };
  setPendingPreview(mode, file);
  renderSingleUploadArea(mode);
  updateBackgroundApplyState();
  showStatus(result.feedback.text);
}

async function handleCubeBackgroundSelection(faceKey, file) {
  const face = getCubeFace(faceKey);
  if (!face) return;

  const selectionRequestId = ++backgroundSelectionToken;
  pendingCubeBackgroundFiles.delete(face.key);
  pendingCubeBackgroundInfo.delete(face.key);
  pendingBackgroundFeedback = createValidationFeedback('info', `正在读取${face.label}侧图片尺寸...`);
  clearPendingPreview(getCubePreviewKey(face.key));
  renderCubeUploadArea();
  updateBackgroundApplyState();

  const result = await validateBackgroundSelection('cube', file);
  if (selectionRequestId !== backgroundSelectionToken || pendingBackgroundMode !== 'cube') return;

  if (!result.accepted) {
    pendingBackgroundFeedback = result.feedback;
    renderCubeUploadArea();
    updateBackgroundApplyState();
    showStatus(result.feedback.text);
    return;
  }

  pendingCubeBackgroundFiles.set(face.key, file);
  pendingCubeBackgroundInfo.set(face.key, {
    dimensions: result.dimensions,
    classification: result.classification,
  });
  setPendingPreview(getCubePreviewKey(face.key), file);
  pendingBackgroundFeedback = getCubeProgressFeedback() || result.feedback;
  renderCubeUploadArea();
  updateBackgroundApplyState();
  showStatus(pendingBackgroundFeedback.text);
}

async function setFlatBackground(file, info) {
  if (!file) {
    showStatus('没有选择背景');
    return false;
  }

  const prepared = await prepareBackgroundFileForTexture(file, info?.dimensions);
  clearCustomBackground();
  const [url] = createBackgroundUrls([prepared.file]);
  scene.setFlatBackgroundImage(url);
  const resizedText = prepared.resized ? `，已按设备上限缩小到 ${formatDimensions(prepared.dimensions)}` : '';
  showStatus(`普通背景已更新，不会产生 360° 环顾${resizedText}`);
  return true;
}

async function setPanoramaBackground(file, info) {
  if (!file) {
    showStatus('没有选择 360 全景图');
    return false;
  }

  const prepared = await prepareBackgroundFileForTexture(file, info?.dimensions);
  clearCustomBackground();
  const [url] = createBackgroundUrls([prepared.file]);
  scene.setPanoramaBackground(url);
  const resizedText = prepared.resized ? `，已按设备上限缩小到 ${formatDimensions(prepared.dimensions)}` : '';
  showStatus(`360° 全景已启用${resizedText}`);
  return true;
}

async function setCubeBackground(filesByFace, infoByFace) {
  if (!isCubeBackgroundReady()) {
    showStatus('请补齐六张同尺寸 Cube 面图');
    return false;
  }

  const preparedFaces = await Promise.all(
    CUBE_BACKGROUND_FACES.map((face) =>
      prepareBackgroundFileForTexture(filesByFace.get(face.key), infoByFace.get(face.key)?.dimensions),
    ),
  );

  clearCustomBackground();
  const urls = createBackgroundUrls(preparedFaces.map((prepared) => prepared.file));
  scene.setCubeBackground(urls);

  const resized = preparedFaces.find((prepared) => prepared.resized);
  const resizedText = resized ? `，已按设备上限缩小到 ${formatDimensions(resized.dimensions)}` : '';
  showStatus(`Cube 背景已启用${resizedText}`);
  return true;
}

async function applyPendingBackground() {
  if (pendingBackgroundMode === 'cube' && !isCubeBackgroundReady()) {
    showStatus('请先补齐六张同尺寸 Cube 面图');
    return;
  }

  if (pendingBackgroundMode !== 'cube' && !pendingSingleBackgroundFile) {
    showStatus('请先选择背景图');
    return;
  }

  backgroundApplyButton.disabled = true;
  showStatus('正在处理背景图...');

  try {
    let applied = false;
    if (pendingBackgroundMode === 'cube') {
      applied = await setCubeBackground(pendingCubeBackgroundFiles, pendingCubeBackgroundInfo);
    } else if (pendingBackgroundMode === 'panorama') {
      applied = await setPanoramaBackground(pendingSingleBackgroundFile, pendingSingleBackgroundInfo);
    } else {
      applied = await setFlatBackground(pendingSingleBackgroundFile, pendingSingleBackgroundInfo);
    }

    if (applied) closeBackgroundModal({ silent: true });
  } catch (error) {
    console.error(error);
    showStatus(error.message || '背景处理失败，请换一张图片');
    updateBackgroundApplyState();
  }
}

function handleBubbleHover(memory, position) {
  if (
    interactionState === InteractionState.FOCUSING ||
    interactionState === InteractionState.VIEWING ||
    interactionState === InteractionState.EXITING ||
    interactionState === InteractionState.LOADING
  ) {
    bubbleHint.hidden = true;
    return;
  }

  if (!memory || !position) {
    bubbleHint.hidden = true;
    if (interactionState === InteractionState.HOVERING) {
      setInteractionState(memories.length > 0 ? InteractionState.BROWSING : InteractionState.EMPTY);
    }
    return;
  }

  bubbleHint.textContent = memory.name ? `打开回忆：${memory.name}` : '打开回忆';
  bubbleHint.style.left = `${position.x}px`;
  bubbleHint.style.top = `${position.y}px`;
  bubbleHint.hidden = false;
  if (interactionState === InteractionState.BROWSING) {
    setInteractionState(InteractionState.HOVERING);
  }
}

function renderAccessibleMemoryActions() {
  memoryA11yList.replaceChildren();
  if (memories.length === 0) return;

  const title = document.createElement('p');
  title.textContent = '可打开的回忆';
  memoryA11yList.append(title);

  memories.slice(0, 12).forEach((memory, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.memoryOpen = memory.id;
    button.textContent = `打开第 ${index + 1} 段回忆：${memory.name || '未命名回忆'}`;
    memoryA11yList.append(button);
  });
}

document.addEventListener('click', (event) => {
  const memoryButton = event.target.closest('[data-memory-open]');
  if (memoryButton) {
    const memory = memories.find((item) => item.id === memoryButton.dataset.memoryOpen);
    void openMemory(memory, { triggerElement: memoryButton });
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  if (actionButton.disabled) return;

  const action = actionButton.dataset.action;
  if (action === 'pick') {
    showStatus('请选择照片或视频');
    fileInput.click();
  }
  if (action === 'settings') openSettings(actionButton);
  if (action === 'close-settings') closeSettings();
  if (action === 'background') openBackgroundPicker();
  if (action === 'sample') void loadSamples();
  if (action === 'random') void openRandomMemory(actionButton);
  if (action === 'reset') resetView();
  if (action === 'parallax') toggleParallax();
  if (action === 'barrier') toggleBarrierEffect();
  if (action === 'reduce-motion') toggleReducedMotion();
  if (action === 'audio') void toggleAudio();
});

fileInput.addEventListener('change', async (event) => {
  await handleFiles(event.target.files);
  event.target.value = '';
});

backgroundInput.addEventListener('change', (event) => {
  void handleSingleBackgroundSelection('flat', event.target.files?.[0]);
  event.target.value = '';
});

panoramaBackgroundInput.addEventListener('change', (event) => {
  void handleSingleBackgroundSelection('panorama', event.target.files?.[0]);
  event.target.value = '';
});

cubeBackgroundInput.addEventListener('change', (event) => {
  void handleCubeBackgroundSelection(pendingCubeFaceKey, event.target.files?.[0]);
  event.target.value = '';
});

backgroundModeList.addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-background-mode]');
  if (!modeButton) return;

  const mode = modeButton.dataset.backgroundMode;
  if (mode === 'default') {
    clearCustomBackground();
    closeBackgroundModal({ silent: true });
    showStatus('已恢复默认背景');
    return;
  }

  showBackgroundConfig(mode);
});

backgroundUploadArea.addEventListener('click', (event) => {
  const cubeSlot = event.target.closest('[data-cube-face]');
  if (cubeSlot) {
    pendingCubeFaceKey = cubeSlot.dataset.cubeFace;
    cubeBackgroundInput.click();
    return;
  }

  const singleSlot = event.target.closest('[data-single-background]');
  if (!singleSlot) return;

  if (singleSlot.dataset.singleBackground === 'panorama') {
    panoramaBackgroundInput.click();
  } else {
    backgroundInput.click();
  }
});

backgroundBackButton.addEventListener('click', showBackgroundModeSelection);
backgroundApplyButton.addEventListener('click', () => {
  void applyPendingBackground();
});
closeBackgroundButton.addEventListener('click', () => closeBackgroundModal());

backgroundModal.addEventListener('pointerdown', (event) => {
  if (event.target === backgroundModal) closeBackgroundModal();
});

bubbleSizeInput.addEventListener('input', (event) => {
  setBubbleScale(event.target.value);
});

ambientVolumeInput.addEventListener('input', (event) => {
  setAmbientVolume(event.target.value);
});

ambientVolumeInput.addEventListener('change', (event) => {
  setAmbientVolume(event.target.value, { announce: true });
});

motionPresetInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) setMotionPreset(input.value);
  });
});

viewModeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) setViewMode(input.value);
  });
});

closeFocusButton.addEventListener('click', () => {
  void closeFocusedMemory();
});

focusStage.addEventListener('pointerdown', (event) => {
  if (event.target === focusStage) void closeFocusedMemory();
});

focusView.addEventListener('pointerdown', (event) => {
  if (event.target === focusView) void closeFocusedMemory();
});

settingsPanel.addEventListener('pointerdown', (event) => {
  if (event.target === settingsPanel) closeSettings();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  if (!backgroundModal.hidden) {
    closeBackgroundModal();
    return;
  }

  if (!settingsPanel.hidden) {
    closeSettings();
    return;
  }

  if (
    interactionState === InteractionState.FOCUSING ||
    interactionState === InteractionState.VIEWING
  ) {
    void closeFocusedMemory();
  }
});

document.addEventListener('visibilitychange', () => {
  const isVisible = document.visibilityState === 'visible';
  scene.setPageVisible(isVisible);
  if (!isVisible) pauseFocusedMedia();
});

window.addEventListener('beforeinstallprompt', () => {
  showStatus('浏览器已准备好添加到主屏幕');
});

window.addEventListener('beforeunload', () => {
  setDefaultAudioUnlockListeners(false);
  disposeMediaRecords(memories);
  backgroundObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  clearPendingPreviewUrls();
  bgm.dispose();
  scene.dispose();
});

systemReducedMotion.addEventListener('change', syncReducedMotion);

if (import.meta.env.PROD) {
  void registerAppShellServiceWorker({
    onUpdate: () => {
      showStatus('应用外壳已更新，下次打开会更快');
    },
  }).catch(() => {});
}

applyRuntimeProfile();
updateControls();
updateAudioButtons();
setAmbientVolume(ambientVolumeInput.value);
setBubbleScale(bubbleSizeInput.value, { markDirty: false });
setViewMode(viewMode, { announce: false, markDirty: false });
setMotionPreset(motionPreset, { announce: false, markDirty: false });
parallaxButton.setAttribute('aria-pressed', 'true');
parallaxButton.textContent = '开启';
enableDefaultAmbientAudio();
parallaxButton.classList.add('is-active');
barrierButton.setAttribute('aria-pressed', 'false');
barrierButton.textContent = '关闭';
barrierButton.classList.remove('is-active');
syncReducedMotion();
