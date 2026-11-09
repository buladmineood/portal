// Добавя версия към адресите на скриптовете и стиловете, за да не смесва браузърът стари и нови файлове.
// GitHub Pages казва на браузъра да пази файловете 10 минути; без версия след качване страницата може
// да зареди нов account.js със стар core.js и да спре да работи.
//   node worker/scripts/stamp-assets.mjs   (пуска се преди всяко качване на страниците)
import { createHash } from 'node:crypto';
import { closeSync, ftruncateSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const strip = (text) => text.replace(/\?v=[0-9a-f]{10}/g, '');

const assets = [
  ...readdirSync(join(root, 'assets/js')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`),
  ...readdirSync(join(root, 'assets/css')).filter((f) => f.endsWith('.css')).map((f) => `assets/css/${f}`),
];
// Версията зависи само от съдържанието, без самите версии, затова повторно пускане не я сменя.
const hash = createHash('sha256');
for (const file of assets.sort()) hash.update(file).update(strip(read(file)));
const version = hash.digest('hex').slice(0, 10);

let changed = 0;
const write = (path, next) => {
  if (next !== read(path)) {
    // Пише в съществуващия файл: под Windows writeFileSync не може да презапише скрит файл (EPERM).
    const fd = openSync(join(root, path), 'r+');
    try {
      ftruncateSync(fd, 0);
      writeSync(fd, next, 0, 'utf8');
    } finally {
      closeSync(fd);
    }
    changed += 1;
  }
};
for (const file of assets.filter((f) => f.endsWith('.js'))) {
  write(file, strip(read(file)).replace(/(from\s+'\.\/[\w-]+\.js)'/g, `$1?v=${version}'`));
}
for (const page of readdirSync(root).filter((f) => f.endsWith('.html'))) {
  write(page, strip(read(page)).replace(/((?:src|href)="\/assets\/(?:js|css)\/[\w-]+\.(?:js|css))"/g, `$1?v=${version}"`));
}
console.log(`version ${version}; files updated: ${changed}`);
