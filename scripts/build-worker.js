import { build } from 'esbuild';
await build({ entryPoints: ['worker/index.js'], outfile: 'build/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
console.log('Worker bundled in build/worker.js');
