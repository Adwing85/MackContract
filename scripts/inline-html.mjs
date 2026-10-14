// Fügt JavaScript, CSS und Favicon aus dist-html/ in eine einzige HTML-Datei ein.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist-html');
const outDir = path.join(root, 'standalone');
const outFile = path.join(outDir, 'MackContract.html');

let html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const used = new Set(['index.html']);

const read = (ref) => {
  const rel = ref.replace(/^\.\//, '');
  used.add(rel);
  return readFileSync(path.join(dist, rel), 'utf8');
};

// Skripte einbetten; „</script“ im Code würde das Tag vorzeitig beenden.
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href) => `<style>${read(href)}</style>`);
html = html.replace(/<link rel="icon" type="(image\/[a-z+]+)" href="([^"]+)" \/>/, (_m, type, href) => {
  const rel = href.replace(/^\.\/?|^\//, '');
  used.add(rel);
  const data = readFileSync(path.join(dist, rel)).toString('base64');
  return `<link rel="icon" type="${type}" href="data:${type};base64,${data}" />`;
});

if (/<script[^>]+src=|<link[^>]+stylesheet[^>]+href=/.test(html)) {
  throw new Error('Nicht alle Skripte/Styles konnten eingebettet werden');
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(dist, path.join(dir, e.name))]));
const leftovers = walk(dist).filter((f) => !used.has(f));
if (leftovers.length) throw new Error(`Nicht eingebettete Dateien: ${leftovers.join(', ')}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`✓ ${path.relative(root, outFile)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
