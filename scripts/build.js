import { cp, mkdir, rm, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../web/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
// Fresh HTML must not reuse an older cached script or stylesheet after deployment.
const directory = new URL('../dist/', import.meta.url);
const appPath = new URL('app.js', directory);
let app = await readFile(appPath, 'utf8');
for (const module of ['earn-apr', 'bitget', 'account-amounts', 'positions']) {
  const moduleContent = await readFile(new URL(`${module}.js`, directory));
  const hash = createHash('sha256').update(moduleContent).digest('hex').slice(0, 12);
  const moduleName = `${module}.${hash}.js`;
  await rename(new URL(`${module}.js`, directory), new URL(moduleName, directory));
  app = app.replace(`./${module}.js`, `./${moduleName}`);
}
await writeFile(appPath, app);
let html = await readFile(new URL('index.html', directory), 'utf8');
for (const name of ['app.js', 'style.css']) {
  const content = await readFile(new URL(name, directory));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const versioned = name.replace('.', `.${hash}.`);
  await rename(new URL(name, directory), new URL(versioned, directory));
  html = html.replace(`./${name}`, `./${versioned}`);
}
await writeFile(new URL('index.html', directory), html);
console.log('Static site built in dist/');

// GitHub Pages remains the original entry point. The application itself is same-origin
// with Access, avoiding cross-site authentication cookies and cross-origin account data.
await writeFile(new URL('index.html', directory), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=https://rate-monitor-api.smallyu.workers.dev/"><title>Rate Monitor</title><link rel="canonical" href="https://rate-monitor-api.smallyu.workers.dev/"></head><body><a href="https://rate-monitor-api.smallyu.workers.dev/">Open Rate Monitor</a></body></html>`);
