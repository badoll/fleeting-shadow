import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const LOCAL_ONLY_PUBLIC_ASSETS = [
  '.DS_Store',
];

function omitLocalOnlyPublicAssets() {
  let outputRoot = resolve('dist');

  return {
    name: 'omit-local-only-public-assets',
    apply: 'build',
    configResolved(config) {
      outputRoot = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await Promise.all(
        LOCAL_ONLY_PUBLIC_ASSETS.map((assetPath) =>
          rm(resolve(outputRoot, assetPath), { force: true }),
        ),
      );
    },
  };
}

export default defineConfig({
  plugins: [omitLocalOnlyPublicAssets()],
});
