// Command-line version of the attack, for checking a FastFlare server without a browser.
//   node scripts/simulate.mjs https://your-fastflare-host [sitekey] [lazy=100] [humanLike=15] [pace=burst]
import vm from 'node:vm';
import { createAttacker } from '../attack.js';

const [api = 'http://localhost:8787', sitekey = 'ff_demo_site', lazy = '100', humanLike = '15', pace = 'burst'] = process.argv.slice(2);

const src = await (await fetch(api.replace(/\/$/, '') + '/fastflare.js')).text();
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const pow = ctx.FastFlare._pow();

const tally = { 1: { blocked: 0, stepup: 0, passed: 0 }, 2: { blocked: 0, stepup: 0, passed: 0 } };
const reasons = {};
const bits = { 1: [], 2: [] };
const attacker = createAttacker({
  api, sitekey, pow,
  onEvent: (e) => {
    if (e.type === 'phase') return console.log(`\nPhase ${e.phase}: ${e.total} requests`);
    if (e.type === 'done') return;
    tally[e.phase][e.outcome]++;
    bits[e.phase].push(e.bits);
    const k = `${e.phase} ${e.kind} -> ${e.outcome} (${e.reason})`;
    reasons[k] = (reasons[k] || 0) + 1;
  },
});
const t0 = Date.now();
await attacker.run({ lazy: +lazy, humanLike: +humanLike, pace });
console.log(`\nFinished in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('Phase 1 (lazy bots):      ', tally[1]);
console.log('Phase 2 (human-like bots):', tally[2]);
console.log('Difficulty paid (bits), phase 1 last 5:', bits[1].slice(-5), ' phase 2:', bits[2].slice(0, 5));
console.log('\nBreakdown:');
for (const [k, n] of Object.entries(reasons).sort()) console.log(String(n).padStart(4), k);
