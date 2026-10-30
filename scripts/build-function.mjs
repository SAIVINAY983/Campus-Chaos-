import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let esbuild;
try { esbuild=require('esbuild'); } catch { esbuild=createRequire(new URL('../node_modules/vite/package.json',import.meta.url))('esbuild'); }
const {build}=esbuild;

await build({
  entryPoints:['server/game.ts'],
  outfile:'netlify/functions/game.mjs',
  bundle:true,
  platform:'node',
  format:'esm',
  target:'node20',
  packages:'external',
  sourcemap:false,
});
