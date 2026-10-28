import { readFileSync } from 'node:fs';
import { loadBank } from '../lib/runtime.mjs';
import { selftest } from '../lib/selftest.mjs';
export default { async fetch(request) { const bank = loadBank(readFileSync(new URL('../bank.js', import.meta.url), 'utf8')); return selftest(request, bank); } };
