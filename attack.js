// FF-Test attack engine. Runs in the browser (app.js) and in Node (scripts/simulate.mjs).
// It only speaks to a FastFlare server's public CAPTCHA endpoints, so point it at a server you own.

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

/** Signals a convincing human browser would report. `dt` is how long the "visitor" has been on the page. */
export function humanSignals(dt) {
  const screens = [[1920, 1080], [1536, 864], [1440, 900], [1366, 768], [2560, 1440], [390, 844]];
  const [sw, sh] = pick(screens);
  return {
    wd: false,
    lg: rand(1, 3),
    sw, sh,
    hc: pick([4, 8, 8, 12, 16]),
    pm: rand(30, 260),
    kd: rand(0, 14),
    tc: 0,
    sc: rand(0, 9),
    fc: rand(1, 4),
    pv: +(rand(5, 80) + Math.random()).toFixed(1),
    dt: Math.round(dt),
  };
}

const BOT_PRESETS = {
  headless: () => ({ wd: true, lg: 0, sw: 0, sh: 0, hc: 0, pm: 0, kd: 0, tc: 0, sc: 0, fc: 0, pv: 0, dt: 40 }),
  empty: () => ({}),
  straightMouse: () => ({ wd: false, lg: 2, sw: 1920, sh: 1080, hc: 8, pm: 40, kd: 0, tc: 0, sc: 0, fc: 0, pv: 0, dt: 300 }),
  fabricated: () => humanSignals(rand(15000, 90000)), // claims a long visit that never happened
};

export function createAttacker({ api, sitekey, pow, signal, onEvent = () => {}, maxSolveBits = 23 }) {
  api = api.replace(/\/$/, '');

  async function post(path, body) {
    const t0 = now();
    try {
      const r = await fetch(api + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      let json = {};
      try { json = await r.json(); } catch { /* not JSON */ }
      return { status: r.status, json, ms: now() - t0 };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return { status: 0, json: { error: 'network_error' }, ms: now() - t0 };
    }
  }

  const getChallenge = async (key = sitekey) => {
    const r = await post('/captcha/challenge', { sitekey: key });
    return { ch: r.json.challenge || null, res: r };
  };

  async function solve(ch) {
    if (ch.difficulty > maxSolveBits) return null; // a real attacker would give up or pay for more CPU
    const prefix = `${ch.id}.${ch.salt}.`;
    let n = 0;
    for (;;) {
      const r = pow.solve(prefix, ch.difficulty, n, 20000);
      if (r >= 0) return String(r);
      n += 20000;
      await sleep(0, signal);
    }
  }

  const verify = (ch, nonce, signals, extra = {}) =>
    post('/captcha/verify', { sitekey, challenge: ch, nonce, signals, hp: '', ...extra });

  function classify(res) {
    if (res.status === 200 && res.json.ok) return { outcome: 'passed', reason: `token (score ${res.json.score})` };
    if (res.status === 200 && res.json.retry) return { outcome: 'stepup', reason: 'harder proof-of-work demanded' };
    return { outcome: 'blocked', reason: res.json.error || `HTTP ${res.status}` };
  }

  // ---- Phase 1: lazy and sloppy bots, in random order -----------------------------------------
  const lazyBots = [
    ['No proof-of-work', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      return { res: await verify(ch, String(rand(0, 1e6)), humanSignals(rand(500, 3000))), bits: ch.difficulty };
    }],
    ['Forged challenge', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      return { res: await verify({ ...ch, difficulty: 1 }, '1', humanSignals(1500)), bits: ch.difficulty };
    }],
    ['Made-up challenge', async () => ({
      res: await verify({ id: 'x'.repeat(24), salt: 'y'.repeat(16), difficulty: 1, exp: Date.now() + 60000, attempt: 0, sig: 'z'.repeat(43) }, '1', humanSignals(1500)),
      bits: 0,
    })],
    ['Wrong site key', async () => {
      const { res } = await getChallenge('ff_' + Math.random().toString(36).slice(2, 10));
      return { res, bits: 0 };
    }],
    ['Garbage request', async () => ({
      res: await post('/captcha/verify', { sitekey, challenge: { junk: rand(0, 9999) }, nonce: 'abc', signals: 'bot' }),
      bits: 0,
    })],
    ['Solved PoW, headless signals', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      const nonce = (await solve(ch)) ?? '0';
      return { res: await verify(ch, nonce, BOT_PRESETS.headless()), bits: ch.difficulty };
    }],
    ['Solved PoW, no signals', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      const nonce = (await solve(ch)) ?? '0';
      return { res: await verify(ch, nonce, BOT_PRESETS.empty()), bits: ch.difficulty };
    }],
    ['Solved PoW, filled the honeypot', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      const nonce = (await solve(ch)) ?? '0';
      return { res: await verify(ch, nonce, humanSignals(1500), { hp: 'https://spam.example' }), bits: ch.difficulty };
    }],
    ['Solved PoW, scripted straight-line mouse', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      const nonce = (await solve(ch)) ?? '0';
      return { res: await verify(ch, nonce, BOT_PRESETS.straightMouse()), bits: ch.difficulty };
    }],
    ['Solved PoW, invented time on page', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      const nonce = (await solve(ch)) ?? '0';
      return { res: await verify(ch, nonce, BOT_PRESETS.fabricated()), bits: ch.difficulty };
    }],
    ['Replayed a used challenge', async () => {
      const { ch, res } = await getChallenge();
      if (!ch) return { res, bits: 0 };
      const nonce = (await solve(ch)) ?? '0';
      await verify(ch, nonce, BOT_PRESETS.headless()); // burns the challenge
      return { res: await verify(ch, nonce, humanSignals(2000)), bits: ch.difficulty };
    }],
  ];

  async function runLazyBots(total, concurrency, state) {
    let next = 0;
    async function worker() {
      while (next < total) {
        const i = ++next;
        const [kind, fn] = pick(lazyBots);
        const { res, bits } = await fn();
        const c = classify(res);
        state.sent++;
        onEvent({ phase: 1, i, kind, bits, ms: res.ms, status: res.status, ...c });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  // ---- Phase 2: a bot that does everything a person's browser does --------------------------------
  async function humanLikeBot(i) {
    const t0 = now();
    const { ch, res } = await getChallenge();
    if (!ch) return onEvent({ phase: 2, i, kind: 'Human-like bot', bits: 0, status: res.status, ms: res.ms, ...classify(res) });
    const nonce = (await solve(ch)) ?? '0';
    await sleep(rand(1200, 3400), signal); // "reads the page", moves the mouse
    let r = await verify(ch, nonce, humanSignals(now() - t0));
    let bits = ch.difficulty;
    let stepped = false;
    if (r.status === 200 && r.json.retry) {
      stepped = true;
      const ch2 = r.json.challenge;
      bits = ch2.difficulty;
      const nonce2 = (await solve(ch2)) ?? '0';
      await sleep(rand(300, 900), signal);
      r = await verify(ch2, nonce2, humanSignals(now() - t0));
    }
    onEvent({ phase: 2, i, kind: 'Human-like bot', bits, stepped, ms: now() - t0, status: r.status, ...classify(r) });
  }

  const PACE = { slow: [3000, 7000], normal: [1000, 2500], burst: [0, 0] };

  async function run({ lazy = 100, humanLike = 25, pace = 'slow', concurrency = 4 }) {
    const state = { sent: 0 };
    onEvent({ type: 'phase', phase: 1, total: lazy });
    await runLazyBots(lazy, concurrency, state);
    onEvent({ type: 'phase', phase: 2, total: humanLike });
    const [lo, hi] = PACE[pace] || PACE.slow;
    for (let i = 1; i <= humanLike; i++) {
      await humanLikeBot(i);
      if (i < humanLike && hi > 0) await sleep(rand(lo, hi), signal);
    }
    onEvent({ type: 'done' });
  }

  return { run, humanLikeBot };
}
