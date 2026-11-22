// FF-Test speed test tab. Uses the FastFlare speed test client served by the chosen FastFlare server.
const $ = (id) => document.getElementById(id);
const DEFAULT_API = 'https://129-225-87-247.sslip.io';
const params = new URLSearchParams(location.search);
let stored = null;
try { stored = localStorage.getItem('fftest-api'); } catch { /* private mode */ }
const api = (params.get('api') || stored || DEFAULT_API).replace(/\/$/, '');

// ---- Tabs ------------------------------------------------------------------------------------------------
function showTab(name) {
  for (const t of ['attack', 'speed']) {
    $('tab-' + t).hidden = t !== name;
    $('tb-' + t).setAttribute('aria-selected', String(t === name));
  }
  if (name === 'speed') {
    history.replaceState(null, '', '#speed');
    drawAll();
  } else history.replaceState(null, '', location.pathname + location.search);
}
$('tb-attack').onclick = () => showTab('attack');
$('tb-speed').onclick = () => showTab('speed');

// ---- Charts --------------------------------------------------------------------------------------------
const C = { flare: '#ff8a3d', pink: '#ff4d8d', violet: '#7c5cff', grid: '#242a55', text: '#8f97bd' };
const pad = { l: 44, r: 10, t: 10, b: 22 };
const data = { dl: [], ul: [], pings: [], idle: null, ldl: [], lul: [] };

function setup(id) {
  const c = $(id);
  const r = c.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  c.width = Math.max(1, r.width * d);
  c.height = Math.max(1, r.height * d);
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
}
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
function axes(c, xmax, ymax, xs = '') {
  const { g, w, h } = c;
  g.clearRect(0, 0, w, h);
  g.font = '11px system-ui';
  g.strokeStyle = C.grid;
  g.fillStyle = C.text;
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h - pad.t - pad.b) * (1 - i / 4);
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    g.textAlign = 'right';
    const v = (ymax * i) / 4;
    g.fillText(v < 10 ? v.toFixed(1) : v.toFixed(0), pad.l - 6, y + 4);
  }
  g.textAlign = 'center';
  for (let j = 0; j <= 4; j++) g.fillText(((xmax * j) / 4).toFixed(xmax >= 20 ? 0 : 1) + xs, pad.l + ((w - pad.l - pad.r) * j) / 4, h - 6);
}
function area(id, pts, color) {
  const c = setup(id);
  const xmax = Math.max(10, ...pts.map((p) => p.t));
  const ymax = niceMax(Math.max(1, ...pts.map((p) => p.mbps)) * 1.1);
  axes(c, xmax, ymax, 's');
  if (pts.length < 2) return;
  const { g, w, h } = c;
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const X = (t) => pad.l + (W * t) / xmax, Y = (v) => pad.t + H * (1 - v / ymax);
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.mbps)) : g.moveTo(X(p.t), Y(p.mbps))));
  g.lineTo(X(pts[pts.length - 1].t), pad.t + H); g.lineTo(X(pts[0].t), pad.t + H); g.closePath();
  const grad = g.createLinearGradient(0, pad.t, 0, pad.t + H);
  grad.addColorStop(0, color + '66'); grad.addColorStop(1, color + '00');
  g.fillStyle = grad; g.fill();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.mbps)) : g.moveTo(X(p.t), Y(p.mbps))));
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
}
function pingChart() {
  const c = setup('c-ping');
  const s = data.pings;
  const n = Math.max(s.length, 20);
  const ymax = niceMax(Math.max(1, ...s) * 1.2);
  axes(c, n, ymax);
  if (!s.length) return;
  const { g, w, h } = c;
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const X = (i) => pad.l + (W * (i + 0.5)) / n, Y = (v) => pad.t + H * (1 - v / ymax);
  g.beginPath(); s.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.strokeStyle = C.flare; g.lineWidth = 2; g.stroke();
  g.fillStyle = C.pink;
  s.forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(v), 3, 0, 6.3); g.fill(); });
}
function loadChart() {
  const c = setup('c-load');
  const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const bars = [
    ['Idle', data.idle ?? 0, C.violet],
    ['Downloading', med(data.ldl), C.flare],
    ['Uploading', med(data.lul), C.pink],
  ];
  const ymax = niceMax(Math.max(1, ...bars.map((b) => b[1])) * 1.2);
  const { g, w, h } = c;
  g.clearRect(0, 0, w, h);
  g.font = '11px system-ui'; g.strokeStyle = C.grid; g.fillStyle = C.text; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h - pad.t - pad.b) * (1 - i / 4);
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    g.textAlign = 'right'; g.fillText(((ymax * i) / 4).toFixed(0), pad.l - 6, y + 4);
  }
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const bw = W / bars.length;
  bars.forEach(([label, v, col], i) => {
    const bh = (H * v) / ymax;
    g.fillStyle = col;
    g.fillRect(pad.l + i * bw + bw * 0.22, pad.t + H - bh, bw * 0.56, bh);
    g.fillStyle = C.text; g.textAlign = 'center';
    g.fillText(label, pad.l + i * bw + bw / 2, h - 6);
    if (v) { g.fillStyle = '#e8ebf7'; g.fillText(v.toFixed(0) + ' ms', pad.l + i * bw + bw / 2, pad.t + H - bh - 5); }
  });
}
function drawAll() {
  if ($('tab-speed').hidden) return;
  area('c-dl', data.dl, C.flare);
  area('c-ul', data.ul, C.pink);
  pingChart();
  loadChart();
}
window.addEventListener('resize', drawAll);

// ---- Provider -> city -> start -----------------------------------------------------------------------
let st = null;
let ctrl = null;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function status(msg, err) { const s = $('sp-status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }

function fillProviders() {
  const ps = st.providers();
  $('sp-provider').innerHTML = ps.map((p) => `<option>${esc(p)}</option>`).join('');
  $('sp-provider').disabled = !ps.length;
  fillCities();
}
function fillCities() {
  const cs = st.cities($('sp-provider').value);
  $('sp-city').innerHTML = cs.map((s) => `<option value="${esc(s.id)}">${esc(s.city + (s.country ? ', ' + s.country : ''))}</option>`).join('');
  $('sp-city').disabled = !cs.length;
  $('sp-start').disabled = !cs.length;
}
$('sp-provider').onchange = fillCities;

function loadClient() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = api + '/fastflare-speedtest.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${api}/fastflare-speedtest.js`));
    document.head.appendChild(s);
  });
}

function reset() {
  Object.assign(data, { dl: [], ul: [], pings: [], idle: null, ldl: [], lul: [] });
  for (const id of ['r-dl', 'r-ul', 'r-lat', 'r-jit', 'r-ldl', 'r-lul', 'r-loss']) $(id).textContent = '–';
  $('sp-live').textContent = '–';
  $('sp-bar').style.width = '0';
  drawAll();
}

const PHASES = { latency: 'Measuring latency', download: 'Download', upload: 'Upload', done: 'Done' };

$('sp-start').onclick = async () => {
  reset();
  ctrl = new AbortController();
  $('sp-start').disabled = true;
  $('sp-stop').hidden = false;
  $('sp-provider').disabled = $('sp-city').disabled = true;
  let phase = 'latency';
  try {
    const r = await st.run({
      serverId: $('sp-city').value,
      signal: ctrl.signal,
      onPhase: (p) => {
        phase = p;
        $('sp-phase').textContent = PHASES[p] || p;
        $('sp-unit').textContent = p === 'latency' ? 'ms' : 'Mbps';
        $('sp-bar').style.width = '0';
        status(p === 'latency' ? 'Measuring latency and jitter…' : p === 'download' ? 'Testing download for 10 seconds…' : p === 'upload' ? 'Testing upload for 10 seconds…' : 'Done.');
      },
      onPing: (ms, i, samples) => {
        data.pings = samples.slice();
        $('sp-live').textContent = ms.toFixed(0);
        $('sp-bar').style.width = ((i + 1) / st.pings) * 100 + '%';
        pingChart();
      },
      onProgress: (p) => {
        $('sp-live').textContent = p.mbps >= 100 ? p.mbps.toFixed(0) : p.mbps.toFixed(1);
        $('sp-bar').style.width = p.progress * 100 + '%';
        if (p.phase === 'download') { data.dl = p.series.slice(); area('c-dl', data.dl, C.flare); }
        else { data.ul = p.series.slice(); area('c-ul', data.ul, C.pink); }
      },
    });
    const f = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    $('r-dl').textContent = f(r.download.mbps);
    $('r-ul').textContent = f(r.upload.mbps);
    $('r-lat').textContent = r.latency.median.toFixed(0);
    $('r-jit').textContent = r.latency.jitter.toFixed(1);
    $('r-ldl').textContent = r.download.loadedLatency.median ? r.download.loadedLatency.median.toFixed(0) : '–';
    $('r-lul').textContent = r.upload.loadedLatency.median ? r.upload.loadedLatency.median.toFixed(0) : '–';
    $('r-loss').textContent = (r.latency.loss * 100).toFixed(0);
    data.idle = r.latency.median;
    data.ldl = r.download.loadedLatency.samples;
    data.lul = r.upload.loadedLatency.samples;
    $('sp-live').textContent = f(r.download.mbps);
    $('sp-unit').textContent = 'Mbps down';
    $('sp-phase').textContent = `${r.server.provider} · ${r.server.city}`;
    $('sp-bar').style.width = '100%';
    status(`Finished in ${(r.durationMs / 1000).toFixed(0)} s.`);
    drawAll();
  } catch (e) {
    status(e.name === 'AbortError' ? 'Stopped.' : `Test failed during ${phase}: ${e.message}`, e.name !== 'AbortError');
  } finally {
    $('sp-start').disabled = false;
    $('sp-stop').hidden = true;
    $('sp-provider').disabled = $('sp-city').disabled = false;
  }
};
$('sp-stop').onclick = () => ctrl && ctrl.abort();

reset();
if (location.hash === '#speed') showTab('speed');
loadClient()
  .then(() => {
    st = new window.FastFlareSpeedTest({ api });
    return st.loadServers();
  })
  .then(() => {
    fillProviders();
    status(st.servers.length ? 'Ready. Choose a provider and city, then start.' : 'This server lists no speed test locations.', !st.servers.length);
  })
  .catch((e) => status(`Could not reach ${api}: ${e.message}. Set the server on the Attack lab tab.`, true));
