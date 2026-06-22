English | [中文](README.zh-CN.md)

# Fusheng Paoying

Fusheng Paoying is a local-first Three.js memory bubble space for browsing personal photos and videos in the browser. It turns selected media files into floating bubbles, lets you open a random memory, and keeps the files on the current device instead of uploading them.

## Features

- Local-first photo and video import through the browser file picker.
- Floating Three.js bubble scene with focus, hover, and random-memory interactions.
- Flat, panorama, and cube background upload modes with dimension validation.
- Optional ambient music with attribution stored in the repository.
- Deterministic layout and media helpers covered by Node tests.

## Quick Start

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the local Vite URL, choose **Add memories**, and select image or video files from your device.

## Usage

- Click **Add memories** to import photos or videos.
- Click a bubble to focus it, then close the focused view to return to the space.
- Use **Random encounter** after adding media to open a memory without browsing manually.
- Open settings to change motion strength, bubble size, audio, and background mode.

The app processes selected files in the current browser session. It does not include a server upload path or remote storage.

## Development

```bash
npm test
npm run build
npm run preview
```

Source files live in `src/`, static assets live in `public/`, and tests live in `tests/`. Generated output in `dist/`, local scratch work, and personal process notes are ignored.

## Assets And Attribution

- `public/audio/Dreamy Flashback.mp3`: "Dreamy Flashback" by Kevin MacLeod, licensed under Creative Commons Attribution 4.0. See [public/audio/CREDITS.md](public/audio/CREDITS.md).
- `public/textures/panorama/pond-bridge-night.jpg`: "Pond Bridge Night" by Greg Zaal / Poly Haven, licensed as CC0. See [public/textures/CREDITS.md](public/textures/CREDITS.md).
- User-selected photos and videos remain user-provided content and are not committed to this repository.

## Contributing

Before opening a pull request, run:

```bash
npm test
npm run build
```

Visible UI changes should include screenshots or screen recordings in the pull request description.

## License

Released under the [MIT License](LICENSE).
