import { createAttacker } from './attack.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_API = 'https://129-225-87-247.sslip.io';
const params = new URLSearchParams(location.search);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let api = (params.get('api') || store.get('fftest-api') || DEFAULT_API).replace(/\/$/, '');
const DEFAULT_SITEKEY = 'ff_site_main';
// Browsers that saved the old demo key fall back to the new default.
const savedKey = store.get('fftest-sitekey');
const sitekey = params.get('sitekey') || (savedKey && savedKey !== 'ff_demo_site' ? savedKey : null) || DEFAULT_SITEKEY;
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
  store.set('fftest-sitekey', $('sitekey').value.trim() || DEFAULT_SITEKEY);
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
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const caught1 = a.blocked + a.stepup;
  const caught2 = b.blocked + b.stepup;
  v.hidden = false;
  v.className = 'card verdict ' + (pct(caught2, b.sent) >= 90 && a.passed === 0 ? 'hold' : 'fail');
  v.innerHTML = `<h2>FastFlare stopped ${pct(caught1 + caught2, a.sent + b.sent)}% of the attack.</h2>
    <p>Sloppy bots: <b>${caught1} of ${a.sent}</b> stopped (${a.passed} let through). Human-like bot: <b>${caught2} of ${b.sent}</b> stopped (${b.passed} let through).</p>
    <ul>
      <li><b>How:</b> cheap tricks are blocked outright. Anything FastFlare is unsure about gets a picture puzzle, and the hole's position is only in the picture, so a script calling the API has to guess. Three wrong answers block the network for 10 minutes.</li>
      <li><b>What still got through:</b> the human-like bot fakes a curved, accelerating mouse path that looks real, so its first request can pass without a puzzle (one per network per 10 minutes). After that it occasionally guesses a puzzle right by luck (about 1 in 25 guesses).</li>
      <li><b>Not tested here:</b> bots that read the picture with computer vision, and puzzle farms where paid people solve it remotely. Both can pass the puzzle; per-network limits and rate limits on what the token protects are what slow them down.</li>
      <li><b>Note:</b> the attack runs from your own network, so the real widget on this page may say "too many attempts" for about 10 minutes afterwards.</li>
    </ul>`;
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
