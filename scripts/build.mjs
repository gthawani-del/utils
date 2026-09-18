import { access, readFile } from 'node:fs/promises';

const required = [
  'index.html', 'image/index.html', 'assets/app.css', 'assets/home.js', 'assets/image.js',
  'workers/image.worker.js', 'lib/security/index.js', 'vercel.json'
];
for (const file of required) await access(new URL(`../${file}`, import.meta.url));
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = vercel.headers?.[0]?.headers?.find((item) => item.key === 'Content-Security-Policy')?.value || '';
for (const directive of ["default-src 'self'", "connect-src 'none'", "object-src 'none'", "frame-ancestors 'none'"]) {
  if (!csp.includes(directive)) throw new Error(`Missing required CSP directive: ${directive}`);
}
console.log('Static production structure and security-header checks passed. No build transform is required.');
