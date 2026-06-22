# Short-Term Web/PWA Platform Support

Status: short-term validation target

## Target Matrix

| Platform | Target browser | Support intent |
| --- | --- | --- |
| macOS desktop | Chrome, Safari, or other modern desktop browser | Core browsing, keyboard, hover, file picker, audio, video, WebGL |
| iPhone | iOS Safari | Touch browsing, local file picker, inline-focused media where Safari allows it, add-to-home-screen metadata |
| Android | Chrome | Touch browsing, local file picker, PWA manifest/installability basics |
| Mobile WebView | Common mobile in-app browser contexts | Best-effort smoke target; quirks are documented rather than treated as native-app scope |

## Release Checks

Run the release bundle, not only the dev server:

```bash
npm test
npm run build
npm run preview
npm run test:smoke
```

The smoke script captures desktop, iPhone-width, Android-width, and landscape screenshots in `.scratch/fusheng-paoying/screenshots/`. It also checks that the WebGL canvas is nonblank at key states.

## PWA Scope

- `public/manifest.webmanifest` provides name, icons, display mode, colors, and start/scope metadata.
- `public/sw.js` precaches only the application shell and app icons. Larger bundled audio/texture assets are cached only after the browser requests them. User-selected photos and videos remain session-local object URLs and are not cached for offline persistence.
- Installability is browser-dependent. Chrome can use the manifest/service worker path; iOS Safari uses the Apple web app metadata and home-screen icon.

## Known Limits

- User media is not persisted across reloads. This is intentional until a separate storage PRD exists.
- iOS may still force fullscreen playback for some video formats or settings. Focused videos request inline playback and keep a manual play button for autoplay restrictions.
- WebGL memory limits vary by device. The app lowers pixel ratio and preview-video count on constrained/mobile profiles, but very large media sets remain out of scope.
- WebView behavior is best-effort. Missing Pointer Events, blocked file pickers, or media restrictions should be recorded as platform notes rather than solved with native bridges in this PRD.
