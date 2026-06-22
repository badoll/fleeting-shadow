import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPlatform,
  detectPlatformCapabilities,
  getPlatformIssueMessages,
  getRuntimeProfile,
  isConstrainedDevice,
} from '../src/platform.js';

function createMatchMedia(matches = {}) {
  return (query) => ({
    matches: Boolean(matches[query]),
  });
}

function createWebglDocument(supported = true) {
  return {
    createElement() {
      return {
        getContext(name) {
          if (!supported) return null;
          return name === 'webgl2' || name === 'webgl' ? {} : null;
        },
      };
    },
  };
}

test('detects iOS Safari as a constrained touch runtime', () => {
  const capabilities = detectPlatformCapabilities({
    navigatorObject: {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
      hardwareConcurrency: 4,
      deviceMemory: 4,
    },
    windowObject: {
      innerWidth: 390,
      innerHeight: 844,
      PointerEvent: function PointerEvent() {},
      matchMedia: createMatchMedia({ '(pointer: coarse)': true }),
    },
    documentObject: createWebglDocument(true),
  });
  const profile = getRuntimeProfile(capabilities);

  assert.equal(classifyPlatform(capabilities), 'ios-safari');
  assert.equal(capabilities.isMobile, true);
  assert.equal(capabilities.isTouch, true);
  assert.equal(isConstrainedDevice(capabilities), true);
  assert.equal(profile.renderer.maxPreviewVideos, 1);
  assert.equal(profile.media.maxFiles, 48);
});

test('detects Android Chrome separately from mobile WebView', () => {
  const chrome = detectPlatformCapabilities({
    navigatorObject: {
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    },
    windowObject: {
      innerWidth: 412,
      innerHeight: 915,
      PointerEvent: function PointerEvent() {},
      matchMedia: createMatchMedia(),
    },
    documentObject: createWebglDocument(true),
  });
  const webView = detectPlatformCapabilities({
    navigatorObject: {
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 wv',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    },
    windowObject: {
      innerWidth: 412,
      innerHeight: 915,
      PointerEvent: function PointerEvent() {},
      matchMedia: createMatchMedia(),
    },
    documentObject: createWebglDocument(true),
  });

  assert.equal(classifyPlatform(chrome), 'android-chrome');
  assert.equal(classifyPlatform(webView), 'mobile-webview');
});

test('reports missing platform capabilities', () => {
  const messages = getPlatformIssueMessages({
    webgl: { supported: false },
    fileInput: false,
    pointerEvents: false,
  });

  assert.deepEqual(messages, [
    '当前浏览器没有可用的 WebGL，回忆空间无法启动',
    '当前环境不支持浏览器文件选择器',
    '当前浏览器缺少 Pointer Events，触控体验可能受限',
  ]);
});
