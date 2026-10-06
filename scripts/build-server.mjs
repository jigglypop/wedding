import { build } from 'esbuild';
import { mkdir, copyFile, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm('dist-server', { recursive:true, force:true });
await mkdir('dist-server/data', { recursive:true });
const sources = (await readdir('server')).filter(name => name.endsWith('.ts')).sort().map(name => `server/${name}`);
const hash = createHash('sha256');
for (const file of [...sources, 'data/initial-state.json', 'data/materials.json', 'dist/index.html']) hash.update(await readFile(file));
const release = hash.digest('hex').slice(0, 12);
await build({ entryPoints:['server/index.ts'], outfile:'dist-server/index.mjs', bundle:true, platform:'node', target:'node22', format:'esm', minify:true, legalComments:'none', define:{ 'process.env.RELEASE_ID':JSON.stringify(release) }, banner:{ js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, sourcemap:false });
for (const file of ['initial-state.json', 'materials.json']) { JSON.parse(await readFile(`data/${file}`, 'utf8')); await copyFile(`data/${file}`, `dist-server/data/${file}`); }
// The API serves this shell for /invite/* so link previews can name the inviter.
await copyFile('dist/index.html', 'dist-server/index.html');
console.log(`Lambda bundle ${release} + private data ready`);
