import { build } from 'esbuild';
import { copyFile, readFile } from 'node:fs/promises';

const threeLicense = await readFile(new URL('./node_modules/three/LICENSE', import.meta.url), 'utf8');

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
  footer: { js: `\n/*\n${threeLicense.trim()}\n*/` },
});

await Promise.all(
  ['manifest.json', 'styles.css'].map(file => copyFile(file, `dist/${file}`)),
);
