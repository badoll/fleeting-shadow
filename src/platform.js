const IOS_RE = /\b(iPad|iPhone|iPod)\b/i;
const ANDROID_RE = /\bAndroid\b/i;
const SAFARI_RE = /\bSafari\b/i;
const CHROME_RE = /\b(CriOS|Chrome)\b/i;
const WEBVIEW_RE = /\b(wv|Version\/[\d.]+.*Chrome\/[\d.]+ Mobile Safari|FBAN|FBAV|Instagram|MicroMessenger)\b/i;

function getViewportSize(windowObject) {
  return {
    width: Number(windowObject?.innerWidth) || 0,
    height: Number(windowObject?.innerHeight) || 0,
  };
}

function matchesMedia(windowObject, query) {
  return Boolean(windowObject?.matchMedia?.(query)?.matches);
}

export function detectWebglSupport({ documentObject = globalThis.document } = {}) {
  if (!documentObject?.createElement) {
    return {
      supported: false,
      version: null,
    };
  }

  try {
    const canvas = documentObject.createElement('canvas');
    const webgl2 = canvas.getContext?.('webgl2');
    if (webgl2) return { supported: true, version: 'webgl2' };

    const webgl = canvas.getContext?.('webgl') || canvas.getContext?.('experimental-webgl');
    return {
      supported: Boolean(webgl),
      version: webgl ? 'webgl' : null,
    };
  } catch {
    return {
      supported: false,
      version: null,
    };
  }
}

export function detectPlatformCapabilities({
  navigatorObject = globalThis.navigator,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  webgl = detectWebglSupport({ documentObject }),
} = {}) {
  const userAgent = String(navigatorObject?.userAgent || '');
  const platform = String(navigatorObject?.platform || '');
  const maxTouchPoints = Number(navigatorObject?.maxTouchPoints) || 0;
  const viewport = getViewportSize(windowObject);
  const iosByTouchMac = platform === 'MacIntel' && maxTouchPoints > 1;
  const isIOS = IOS_RE.test(userAgent) || iosByTouchMac;
  const isAndroid = ANDROID_RE.test(userAgent);
  const isSafari = SAFARI_RE.test(userAgent) && !CHROME_RE.test(userAgent) && !/Android/i.test(userAgent);
  const isChrome = CHROME_RE.test(userAgent) && !/Edg\//i.test(userAgent);
  const isWebView = WEBVIEW_RE.test(userAgent) || Boolean(windowObject?.ReactNativeWebView);
  const isNarrow = viewport.width > 0 && viewport.width < 760;
  const isTallMobile = viewport.width > 0 && viewport.height > viewport.width * 1.35;
  const isMobile = isIOS || isAndroid || /Mobile|Phone/i.test(userAgent) || isNarrow || isTallMobile;
  const isTouch = maxTouchPoints > 0 || matchesMedia(windowObject, '(pointer: coarse)');
  const reducedMotion = matchesMedia(windowObject, '(prefers-reduced-motion: reduce)');
  const standalone =
    matchesMedia(windowObject, '(display-mode: standalone)') ||
    Boolean(navigatorObject?.standalone);
  const pointerEvents = Boolean(windowObject?.PointerEvent);
  const fileInput = Boolean(documentObject?.createElement);
  const deviceMemory = Number(navigatorObject?.deviceMemory) || null;
  const hardwareConcurrency = Number(navigatorObject?.hardwareConcurrency) || null;

  return {
    userAgent,
    platform,
    viewport,
    isIOS,
    isAndroid,
    isSafari,
    isChrome,
    isWebView,
    isMobile,
    isTouch,
    reducedMotion,
    standalone,
    pointerEvents,
    fileInput,
    deviceMemory,
    hardwareConcurrency,
    webgl,
  };
}

export function classifyPlatform(capabilities = {}) {
  if (capabilities.isIOS && capabilities.isSafari) return 'ios-safari';
  if (capabilities.isAndroid && capabilities.isChrome && !capabilities.isWebView) return 'android-chrome';
  if (capabilities.isWebView && capabilities.isMobile) return 'mobile-webview';
  if (capabilities.isMobile) return 'mobile-browser';
  return 'desktop-browser';
}

export function isConstrainedDevice(capabilities = {}) {
  const memory = Number(capabilities.deviceMemory);
  const cores = Number(capabilities.hardwareConcurrency);
  return (
    Boolean(capabilities.isMobile) ||
    (Number.isFinite(memory) && memory > 0 && memory <= 4) ||
    (Number.isFinite(cores) && cores > 0 && cores <= 4)
  );
}

export function getRuntimeProfile(capabilities = {}) {
  const platform = classifyPlatform(capabilities);
  const constrained = isConstrainedDevice(capabilities);
  const mobile = Boolean(capabilities.isMobile);
  const reducedMotion = Boolean(capabilities.reducedMotion);

  return {
    platform,
    constrained,
    mobile,
    touch: Boolean(capabilities.isTouch),
    reducedMotion,
    renderer: {
      antialias: !constrained,
      maxPreviewVideos: reducedMotion ? 0 : constrained ? 1 : mobile ? 2 : 3,
      pixelRatioLimit: reducedMotion ? 1.1 : constrained ? 1.25 : mobile ? 1.5 : 1.75,
      powerPreference: constrained ? 'default' : 'high-performance',
    },
    media: {
      maxFiles: constrained ? 48 : 96,
      maxFileBytes: (constrained ? 320 : 500) * 1024 * 1024,
      maxTotalBytes: (constrained ? 900 : 1400) * 1024 * 1024,
    },
  };
}

export function getPlatformIssueMessages(capabilities = {}) {
  const messages = [];

  if (!capabilities.webgl?.supported) {
    messages.push('当前浏览器没有可用的 WebGL，回忆空间无法启动');
  }

  if (!capabilities.fileInput) {
    messages.push('当前环境不支持浏览器文件选择器');
  }

  if (!capabilities.pointerEvents) {
    messages.push('当前浏览器缺少 Pointer Events，触控体验可能受限');
  }

  return messages;
}
