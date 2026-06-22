# Repository Guidelines

## Project Structure & Module Organization

This is a small browser app built with Vite and ES modules. Source files live in `src/`: `main.js` wires the DOM and app state, `scene.js` owns the Three.js memory-bubble scene, `domain.js` contains pure classification/layout helpers, and `audio.js`, `media.js`, and `bubbleLayout.js` handle focused feature logic. Global styling is in `src/styles.css`. Static assets, icons, textures, and bundled audio are under `public/`. Tests live in `tests/`; generated build output belongs in `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

- `npm install` installs the locked dependencies from `package-lock.json`.
- `npm run dev` starts the Vite dev server on `127.0.0.1`.
- `npm test` runs Node's built-in test runner against `tests/*.test.js`.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the built bundle locally for final checks.

## Coding Style & Naming Conventions

Use modern JavaScript ES modules with 2-space indentation, semicolons, and single quotes, matching the existing files. Prefer named exports for reusable helpers. Keep browser/DOM side effects in `main.js`; put deterministic logic in `domain.js` or focused modules so it can be tested without a browser. Use descriptive camelCase names for functions and variables, PascalCase for classes such as `MemoryBubbleScene`, and uppercase constants for shared configuration.

## Testing Guidelines

Add unit tests beside the existing suites in `tests/` using `node:test` and `node:assert/strict`. Name test files `*.test.js` so `npm test` picks them up. Favor pure-function tests for layout, media classification, background handling, and state transitions. When changing rendering, uploads, or audio behavior, run `npm test` plus a manual pass through `npm run dev` or `npm run preview`.

## Commit & Pull Request Guidelines

This repository has no committed history yet, so use a simple Conventional Commits style going forward, such as `feat: add cube background validation` or `fix: release media object URLs`. Pull requests should include a short summary, testing performed, linked issue or task when available, and screenshots or screen recordings for visible UI changes. Keep PRs focused; separate asset updates, UI behavior changes, and refactors when practical.

## Security & Configuration Tips

Do not commit personal media, large temporary exports, or local environment files. Keep third-party asset credits in `public/audio/CREDITS.md` or a nearby credits file when adding licensed resources. Validate uploaded file types and sizes in the domain layer before passing data into rendering or playback code.
