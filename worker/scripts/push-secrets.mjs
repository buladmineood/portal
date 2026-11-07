// Качва тайните от worker/.dev.vars в Cloudflare, без да се показват в терминала.
// Изисква предварително `npx wrangler@4 login`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NAMES = ['SESSION_SECRET', 'PASSWORD_PEPPER', 'GOOGLE_CLIENT_SECRET', 'MS_CERT_PRIVATE_KEY'];
const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

for (const name of NAMES) {
  if (!vars[name]) throw new Error(`Липсва ${name} в .dev.vars`);
  const result = spawnSync('npx', ['wrangler@4', 'secret', 'put', name], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    input: vars[name],
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
