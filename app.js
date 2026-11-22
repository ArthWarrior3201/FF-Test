import { createAttacker } from './attack.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_API = 'https://129-225-87-247.sslip.io';
const params = new URLSearchParams(location.search);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let api = (params.get('api') || store.get('fftest-api') || DEFAULT_API).replace(/\/$/, '');
const sitekey = params.get('sitekey') || store.get('fftest-sitekey') || 'ff_demo_site';
$('api').value = api;
$('sitekey').value = sitekey;

const LAZY = 100;
const stats = { 1: blank(), 2: blank() };
function blank() { return { sent: 0, blocked: 0, stepup: 0, passed: 0, bits: [] }; }

let ctrl = null;
let chartPoints = [];

function status(msg, err = false) {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status' + (err ? ' err' : '');
}

// ---- Setup: save target, load the FastFlare widget from that server -----------------------------
$('apply').onclick = () => {
  const v = $('api').value.trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(v)) return status('Enter the server address starting with https://', true);
  store.set('fftest-api', v);
  store.set('fftest-sitekey', $('sitekey').value.trim() || 'ff_demo_site');
  location.href = location.pathname;
};

if (location.protocol === 'https:' && api.startsWith('http:')) {
  const b = $('banner');
  b.hidden = false;
  b.textContent = 'This page is served over HTTPS, so browsers will block calls to a plain http:// server. Put HTTPS in front of FastFlare (deploy/enable-https.sh) and use the https:// address.';
}

function loadFastFlare() {
  return new Promise((resolve, reject) => {
    const w = $('widget');
    w.dataset.sitekey = $('sitekey').value.trim() || sitekey;
    w.dataset.api = api;
    w.dataset.theme = 'dark';
    const s = document.createElement('script');
    s.src = api + '/fastflare.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${api}/fastflare.js`));
    document.head.appendChild(s);
  });
}

$('widget').addEventListener('ff-verified', (e) => {
  const t = $('token');
  t.hidden = false;
  t.textContent = 'Verified as human. Token: ' + e.detail.token.slice(0, 48) + '…';
});

// ---- Scoreboard -----------------------------------------------------------------------------------------
function makeDots(phase, n) {
  const box = $('dots' + phase);
  box.innerHTML = '';
  for (let i = 0; i < n; i++) box.appendChild(Object.assign(document.createElement('i'), { className: 'dot' }));
}

function resetBoard(humanCount) {
  stats[1] = blank(); stats[2] = blank();
  chartPoints = [];
  for (const p of [1, 2]) for (const k of ['sent', 'blocked', 'stepup', 'passed']) $(`p${p}-${k}`).textContent = '0';
  makeDots(1, LAZY);
  makeDots(2, humanCount);
  $('log').innerHTML = '';
  $('verdict').hidden = true;
  drawChart();
}

function onEvent(e) {
  if (e.type === 'phase') {
    $('ph1').classList.toggle('active', e.phase === 1);
    $('ph2').classList.toggle('active', e.phase === 2);
    status(e.phase === 1 ? 'Phase 1: 100 sloppy bots attacking…' : 'Phase 2: a patient bot is imitating a real visitor…');
    return;
  }
  if (e.type === 'done') return;

  const s = stats[e.phase];
  s.sent++;
  s[e.outcome]++;
  s.bits.push(e.bits || 0);
  for (const k of ['sent', 'blocked', 'stepup', 'passed']) $(`p${e.phase}-${k}`).textContent = s[k];
  const dot = $('dots' + e.phase).children[s.sent - 1];
  if (dot) dot.classList.add(e.outcome);

  if (e.bits) chartPoints.push({ phase: e.phase, bits: e.bits });
  drawChart();

  const tr = document.createElement('tr');
  const label = e.outcome === 'passed' ? 'LET THROUGH' : e.outcome === 'stepup' ? 'challenged' : 'blocked';
  tr.innerHTML = `<td>${e.phase}.${s.sent}</td><td></td><td class="r-${e.outcome}"></td>`;
  tr.children[1].textContent = e.kind + (e.stepped ? ' (after extra challenge)' : '');
  tr.children[2].textContent = `${label} · ${e.reason}`;
  $('log').prepend(tr);
  while ($('log').children.length > 14) $('log').lastChild.remove();
}

// ---- Difficulty chart ----------------------------------------------------------------------------------------
function drawChart() {
  const c = $('chart');
  const r = c.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  c.width = Math.max(1, r.width * d);
  c.height = Math.max(1, r.height * d);
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  const W = r.width, H = r.height, pad = { l: 34, r: 8, t: 8, b: 20 };
  g.clearRect(0, 0, W, H);
  g.font = '11px system-ui'; g.fillStyle = '#8f97bd'; g.strokeStyle = '#242a55'; g.lineWidth = 1;
  const lo = 12, hi = 24;
  for (let b = lo; b <= hi; b += 4) {
    const y = pad.t + (H - pad.t - pad.b) * (1 - (b - lo) / (hi - lo));
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke();
    g.textAlign = 'right'; g.fillText(b + ' bits', pad.l - 4, y + 4);
  }
  if (!chartPoints.length) return;
  const n = chartPoints.length;
  const X = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, n - 1);
  const Y = (b) => pad.t + (H - pad.t - pad.b) * (1 - (Math.min(hi, Math.max(lo, b)) - lo) / (hi - lo));
  let prev = null;
  chartPoints.forEach((p, i) => {
    g.strokeStyle = p.phase === 1 ? '#7c5cff' : '#ff8a3d';
    g.lineWidth = 2;
    if (prev) { g.beginPath(); g.moveTo(X(i - 1), Y(prev.bits)); g.lineTo(X(i), Y(p.bits)); g.stroke(); }
    g.fillStyle = g.strokeStyle;
    g.beginPath(); g.arc(X(i), Y(p.bits), 2.5, 0, 6.3); g.fill();
    prev = p;
  });
}
window.addEventListener('resize', drawChart);

// ---- Verdict ----------------------------------------------------------------------------------------------------
function verdict() {
  const a = stats[1], b = stats[2];
  const v = $('verdict');
  const caught1 = a.blocked + a.stepup;
  const passRate = b.sent ? b.passed / b.sent : 0;
  const avgBits = (arr) => (arr.length ? (arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(1) : '–');
  v.hidden = false;

  if (b.sent && passRate >= 0.5) {
    v.className = 'card verdict fail';
    v.innerHTML = `<h2>The patient bot got through.</h2>
      <p>FastFlare stopped <b>${caught1} of ${a.sent}</b> sloppy requests (${a.passed} got through), but treated <b>${b.passed} of ${b.sent}</b> human-like requests as people.</p>
      <ul>
        <li><b>Why:</b> that bot did the proof-of-work and reported believable behaviour (mouse movement, key presses, a sensible time on the page). FastFlare cannot see inside a browser, so behaviour it is told about is evidence, not proof.</li>
        <li><b>What it cost the bot:</b> about ${avgBits(b.bits)} bits of proof-of-work per token, plus a human-paced delay each time. That caps how many tokens one machine can mint, but it does not stop a single patient one.</li>
        <li><b>What helps:</b> lower <code>FF_QUOTA_SOFT</code> and <code>FF_QUOTA_HARD</code> (tokens one network may get in 10 minutes), raise <code>FF_CAPTCHA_BITS</code>, and rate-limit the action the token protects (sign-up, login, posting). A CAPTCHA should be one layer, not the only one.</li>
      </ul>`;
  } else if (b.sent && passRate <= 0.1) {
    v.className = 'card verdict hold';
    v.innerHTML = `<h2>FastFlare held.</h2>
      <p>It stopped <b>${caught1} of ${a.sent}</b> sloppy requests and only <b>${b.passed} of ${b.sent}</b> of the human-like ones got through.</p>
      <ul><li>Average proof-of-work paid by the patient bot: ${avgBits(b.bits)} bits per request.</li></ul>`;
  } else {
    v.className = 'card verdict';
    v.innerHTML = `<h2>Mixed result.</h2>
      <p>FastFlare stopped <b>${caught1} of ${a.sent}</b> sloppy requests. Of the human-like ones, <b>${b.passed}</b> got through, <b>${b.stepup}</b> were challenged and <b>${b.blocked}</b> were blocked out of ${b.sent}.</p>
      <ul><li>The first few look like a person and pass. After that FastFlare notices one network collecting too many tokens, makes each harder, then stops issuing them (<code>too_many_tokens</code> in the log).</li>
      <li>A bot that waits long enough between requests, or rotates addresses, slips under this limit. Tune <code>FF_QUOTA_SOFT</code> / <code>FF_QUOTA_HARD</code> on your server.</li></ul>`;
  }
  v.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---- Run ------------------------------------------------------------------------------------------------------------
$('launch').onclick = async () => {
  const humanCount = Math.max(5, Math.min(100, parseInt($('count').value, 10) || 25));
  resetBoard(humanCount);
  ctrl = new AbortController();
  $('launch').disabled = true;
  $('stop').hidden = false;
  const attacker = createAttacker({
    api,
    sitekey: $('sitekey').value.trim() || sitekey,
    pow: window.FastFlare._pow(),
    signal: ctrl.signal,
    onEvent,
  });
  try {
    await attacker.run({ lazy: LAZY, humanLike: humanCount, pace: $('pace').value, concurrency: 4 });
    status('Attack finished.');
    verdict();
  } catch (e) {
    status(e.name === 'AbortError' ? 'Stopped.' : `Attack failed: ${e.message}`, e.name !== 'AbortError');
    if (e.name === 'AbortError' && (stats[1].sent || stats[2].sent)) verdict();
  } finally {
    $('ph1').classList.remove('active');
    $('ph2').classList.remove('active');
    $('launch').disabled = false;
    $('stop').hidden = true;
  }
};
$('stop').onclick = () => ctrl && ctrl.abort();

resetBoard(25);
loadFastFlare().then(
  () => { status('Ready. Press Attack.'); $('launch').disabled = false; },
  (e) => status(`${e.message}. Check the server address, then press Save server.`, true),
);
