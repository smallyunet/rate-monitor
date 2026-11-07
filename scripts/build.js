import { cp, mkdir, rm, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../web/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
// Fresh HTML must not reuse an older cached script or stylesheet after deployment.
const directory = new URL('../dist/', import.meta.url);
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
