# ParallaxBarrierIOS

Native iOS implementation of a two-view parallax-barrier renderer based on the Three.js `webgl_effects_parallaxbarrier` behavior.

## Requirements

- Xcode 15 or newer
- iOS 17.0 or newer
- iPhone target, fixed portrait

The app has no network runtime dependency and does not use WebView, JavaScript, SceneKit, RealityKit, Unity, or other engines for the core rendering path.

## Build

```bash
xcodebuild \
  -project ParallaxBarrierIOS.xcodeproj \
  -scheme ParallaxBarrierIOS \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Before running simulator UI tests on a specific device, query available destinations:

```bash
xcodebuild -project ParallaxBarrierIOS.xcodeproj -scheme ParallaxBarrierIOS -showdestinations
```

## What The App Does

- Renders 500 animated reflective spheres with bundled Pisa cube-map faces, with a procedural fallback.
- Renders left and right stereo views into separate offscreen Metal textures.
- Composites output with mono, left eye, right eye, side-by-side, interlaced, and calibration modes.
- Uses physical fragment position in the final compositor for rows, columns, and slanted interlacing.
- Persists settings in `UserDefaults` under `app.settings.v1`.
- Supports drag input, recentering, optional Core Motion input, lifecycle pause/resume, and a throttled Debug HUD.

## Calibration

Open the calibration sheet from the overlay. The renderer switches to calibration output while the sheet is open. Adjust:

- Axis: rows, columns, or slanted
- Pitch: `0.50...16.00 px`
- Phase: `-16.00...16.00 px`
- Slope: `-2.000...2.000`
- Swap Eyes

Save commits the current interlace settings and restores the previous output mode. Cancel restores all settings captured when the sheet opened.

## Optical Limit

This project verifies the software layer: stereo cameras, offscreen eye textures, physical-pixel interlacing, and calibration controls. A normal iPhone display alone does not guarantee naked-eye 3D. Optical success must be tested with a matched parallax barrier, lenticular lens, custom screen, or external display.
