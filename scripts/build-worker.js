import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
const assets = {};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + '/' + entry.name;
    if (entry.isDirectory()) await collect(directory + '/' + entry.name, name);
    else {
      const type = types[entry.name.slice(entry.name.lastIndexOf('.'))];
      if (type) assets[name] = { type, body: await readFile(directory + '/' + entry.name, 'utf8') };
    }
  }
}
await collect('web');
await build({ entryPoints: ['worker/index.js'], outfile: 'build/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', define: { SITE_ASSETS: JSON.stringify(assets) } });
console.log('Worker and public site bundled in build/worker.js');
