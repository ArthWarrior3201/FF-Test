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

const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const bez = (a, b, c, d, s) => (1 - s) ** 3 * a + 3 * (1 - s) ** 2 * s * b + 3 * (1 - s) * s * s * c + s ** 3 * d;
const ease = (s) => (s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2);

/**
 * A believable fake mouse recording, the way bot toolkits make one: several curved strokes with
 * acceleration, braking, jitter and pauses, sampled at display rate with timer noise.
 */
export function synthTrace(ms) {
  const pts = [];
  let x = rand(150, 900), y = rand(150, 600), t = 0;
  while (t < ms) {
    const tx = x + rand(-380, 380), ty = y + rand(-240, 240);
    const c1 = [x + rand(-160, 160), y + rand(-160, 160)];
    const c2 = [tx + rand(-160, 160), ty + rand(-160, 160)];
    const steps = Math.max(8, Math.round(rand(260, 900) / 16.7));
    for (let i = 1; i <= steps && t < ms; i++) {
      const k = ease(i / steps);
      t += 16.7 + (Math.random() - 0.5) * 1.2;
      pts.push([Math.round(bez(x, c1[0], c2[0], tx, k) + gauss() * 0.8), Math.round(bez(y, c1[1], c2[1], ty, k) + gauss() * 0.8), Math.round(t * 10) / 10]);
    }
    x = tx;
    y = ty;
    t += rand(60, 500);
  }
  return pts.slice(-200);
}

/** A believable drag of the puzzle handle to `dx` pixels. */
export function synthDrag(dx) {
  const pts = [];
  const steps = rand(18, 45);
  const x0 = rand(400, 700), y0 = rand(380, 520);
  let t = 0;
  for (let i = 0; i <= steps; i++) {
    t += 14 + Math.random() * 8;
    pts.push([Math.round(x0 + ease(i / steps) * dx + gauss()), Math.round(y0 + gauss() * 1.5), Math.round(t)]);
  }
  return pts;
}

// What cheap scripts send: a perfectly straight line at constant speed on a fixed timer.
const linearTrace = () => Array.from({ length: 40 }, (_, i) => [200 + i * 9, 300 + i * 2, i * 16]);

const BOT_PRESETS = {
  headless: () => ({ wd: true, lg: 0, sw: 0, sh: 0, hc: 0, pm: 0, kd: 0, tc: 0, sc: 0, fc: 0, pv: 0, dt: 40 }),
  empty: () => ({}),
  straightMouse: () => ({ wd: false, lg: 2, sw: 1920, sh: 1080, hc: 8, pm: 40, kd: 0, tc: 0, sc: 0, fc: 0, pv: 0, dt: 300 }),
  fabricated: () => humanSignals(rand(15000, 90000)), // claims a long visit that never happened
};

export function createAttacker({ api, sitekey, pow, signal, onEvent = () => {}, maxSolveBits = 23, headers = {} }) {
  api = api.replace(/\/$/, '');

  async function post(path, body) {
    const t0 = now();
    try {
      const r = await fetch(api + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
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
    if (res.status === 200 && res.json.ok) return { outcome: 'passed', reason: `token (${res.json.method || 'invisible'})` };
    if (res.status === 200 && res.json.puzzle) return { outcome: 'stepup', reason: `puzzle demanded (${res.json.reason || 'not sure'})` };
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
      return { res: await verify(ch, nonce, BOT_PRESETS.straightMouse(), { trace: linearTrace() }), bits: ch.difficulty };
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
  // Solves the proof-of-work, waits like a reader, sends believable signals and a synthesised curved
  // mouse path. If asked for the puzzle it drags convincingly, but it cannot see the picture, so it
  // has to guess where the hole is.
  async function humanLikeBot(i) {
    const t0 = now();
    const { ch, res } = await getChallenge();
    if (!ch) return onEvent({ phase: 2, i, kind: 'Human-like bot', bits: 0, status: res.status, ms: res.ms, ...classify(res) });
    const nonce = (await solve(ch)) ?? '0';
    await sleep(rand(1200, 3400), signal);
    const dwell = now() - t0;
    let r = await verify(ch, nonce, humanSignals(dwell), { trace: synthTrace(Math.max(400, Math.min(dwell - 300, 2500))) });
    let puzzles = 0;
    while (r.status === 200 && r.json.puzzle && puzzles < 3) {
      puzzles++;
      const pz = r.json.puzzle;
      const guess = rand(0, pz.width - pz.size);
      await sleep(rand(1500, 3200), signal);
      r = await post('/captcha/puzzle', { sitekey, id: pz.id, x: guess, trace: synthDrag(guess) });
    }
    let c = classify(r);
    if (puzzles && c.outcome !== 'passed') c = { outcome: 'stepup', reason: `got a puzzle, could not solve it (${r.json.error || 'failed'})` };
    if (c.outcome === 'blocked' && (r.json.error === 'too_many_failures' || r.json.error === 'too_many_tokens')) c.reason = `network blocked (${r.json.error})`;
    onEvent({ phase: 2, i, kind: 'Human-like bot', bits: ch.difficulty, stepped: puzzles > 0, ms: now() - t0, status: r.status, ...c });
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
