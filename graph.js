/* 관계망 — 6개 레이아웃
   네트워크(힘) · 아크 · 방사형 · 코드 · 하이브 · 보드
   캔버스 렌더. 클래스·관계 필터, 검색, 노드 클릭 시 이웃만 강조. */
import { CLS, REL_KO, clsColor, css, esc, $ } from './app.js';

const S = {
  G: null, layout: 'network', clsOn: new Set(), relOn: new Set(),
  nodes: [], edges: [], focus: null, search: '', raf: 0, hover: null,
};
const LAYOUTS = [
  ['network', '◍ 네트워크'], ['arc', '⌒ 아크'], ['radial', '✺ 방사형'],
  ['chord', '◠ 코드'], ['hive', '⋔ 하이브'], ['board', '▤ 보드'],
];

export function initGraph(G) {
  S.G = G;
  S.clsOn = new Set(Object.keys(CLS));
  S.relOn = new Set([...new Set(G.edges.map(e => e.p))]);
  $('#nNode').textContent = G.nodes.length;
  $('#nEdge').textContent = G.edges.length;

  $('#layoutSeg').innerHTML = LAYOUTS.map(([k, t]) =>
    `<button class="${k === S.layout ? 'on' : ''}" data-l="${k}" onclick="setLayout('${k}')">${t}</button>`).join('');

  const clsUsed = [...new Set(G.nodes.map(n => n.cls))];
  $('#clsChips').innerHTML = clsUsed.map(c =>
    `<button class="chip on c-${CLS[c].key}" data-c="${c}" onclick="toggleCls('${c}')">
      <i class="dot"></i>${CLS[c].ko}</button>`).join('');

  const relUsed = [...new Set(G.edges.map(e => e.p))]
    .sort((a, b) => G.edges.filter(e => e.p === b).length - G.edges.filter(e => e.p === a).length);
  $('#relChips').innerHTML =
    `<button class="chip on c-all" onclick="toggleRel('*')">모든 관계</button>` +
    relUsed.map(p => `<button class="chip on" data-p="${p}" onclick="toggleRel('${p}')"
      style="color:var(--muted)">${esc(REL_KO[p] || p)}</button>`).join('');

  $('#gLegend').innerHTML = clsUsed.map(c =>
    `<span><i style="background:${clsColor(c)};border-radius:${CLS[c].shape === 'circle' ? '50%' : '2px'}"></i>${CLS[c].ko}</span>`).join('')
    + '<span style="margin-left:auto">노드 클릭 = 이웃만 · 빈 곳 클릭 = 해제</span>';

  const cv = $('#graph');
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('click', onClick);
  cv.addEventListener('pointerleave', () => { S.hover = null; $('#gTip').style.display = 'none'; });
  addEventListener('resize', () => { sizeCanvas(); compute(); });
  sizeCanvas(); compute(); loop();
}

function sizeCanvas() {
  const cv = $('#graph'); if (!cv) return;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, r.width * devicePixelRatio);
  cv.height = Math.max(1, (r.height || 620) * devicePixelRatio);
}

window.setLayout = k => {
  S.layout = k;
  document.querySelectorAll('#layoutSeg button').forEach(b => b.classList.toggle('on', b.dataset.l === k));
  compute();
};
window.toggleCls = c => {
  S.clsOn.has(c) ? S.clsOn.delete(c) : S.clsOn.add(c);
  document.querySelectorAll('#clsChips .chip').forEach(b => b.classList.toggle('on', S.clsOn.has(b.dataset.c)));
  compute();
};
window.toggleRel = p => {
  const all = [...new Set(S.G.edges.map(e => e.p))];
  if (p === '*') S.relOn = S.relOn.size === all.length ? new Set() : new Set(all);
  else S.relOn.has(p) ? S.relOn.delete(p) : S.relOn.add(p);
  document.querySelectorAll('#relChips .chip').forEach(b => {
    const pp = b.dataset.p;
    b.classList.toggle('on', pp ? S.relOn.has(pp) : S.relOn.size === all.length);
  });
  compute();
};
window.graphSearch = v => { S.search = v.trim(); compute(); };
window.resetGraph = () => {
  S.focus = null; S.search = ''; $('#gSearch').value = '';
  S.clsOn = new Set(Object.keys(CLS));
  S.relOn = new Set([...new Set(S.G.edges.map(e => e.p))]);
  document.querySelectorAll('#clsChips .chip,#relChips .chip').forEach(b => b.classList.add('on'));
  compute();
};
export function redrawGraph() { if (S.G) compute(); }
/** 아이템 페이지에서 넘어올 때 — 그 개체의 이웃만 남기고 클래스·관계 필터는 모두 켠다 */
window.graphFocus = id => {
  if (!S.G) return;
  S.clsOn = new Set(Object.keys(CLS));
  S.relOn = new Set([...new Set(S.G.edges.map(e => e.p))]);
  document.querySelectorAll('#clsChips .chip,#relChips .chip').forEach(b => b.classList.add('on'));
  S.search = ''; const gs = $('#gSearch'); if (gs) gs.value = '';
  S.focus = id;
  compute();
};

/* ── 표시 대상 계산 + 레이아웃 ── */
function compute() {
  const G = S.G; if (!G) return;
  let ns = G.nodes.filter(n => S.clsOn.has(n.cls));
  let es = G.edges.filter(e => S.relOn.has(e.p));
  const ids = new Set(ns.map(n => n.id));
  es = es.filter(e => ids.has(e.s) && ids.has(e.o));

  if (S.focus) {                                  // 이웃만
    const keep = new Set([S.focus]);
    es.forEach(e => { if (e.s === S.focus) keep.add(e.o); if (e.o === S.focus) keep.add(e.s); });
    ns = ns.filter(n => keep.has(n.id));
    const k2 = new Set(ns.map(n => n.id));
    es = es.filter(e => k2.has(e.s) && k2.has(e.o));
  }
  const deg = new Map(ns.map(n => [n.id, 0]));
  es.forEach(e => { deg.set(e.s, deg.get(e.s) + 1); deg.set(e.o, deg.get(e.o) + 1); });

  S.nodes = ns.map(n => ({ ...n, d: deg.get(n.id) || 0, x: 0, y: 0, vx: 0, vy: 0 }));
  S.edges = es;
  const map = new Map(S.nodes.map(n => [n.id, n]));
  S.edges = es.map(e => ({ ...e, a: map.get(e.s), b: map.get(e.o) })).filter(e => e.a && e.b);
  $('#nNode').textContent = S.nodes.length;
  $('#nEdge').textContent = S.edges.length;
  ({ network: lNetwork, arc: lArc, radial: lRadial, chord: lChord, hive: lHive, board: lBoard })[S.layout]();
  if (S.layout !== 'network') markHub();
}

const dims = () => ({ W: $('#graph').width, H: $('#graph').height });
const order = ['Person', 'Position', 'CorporateBody', 'Event', 'Activity', 'Place', 'Rule', 'Record', 'RecordSet'];

function lNetwork() {
  const { W, H } = dims();
  const N = S.nodes.length;
  S.nodes.forEach((n, i) => {
    const a = i * 2.399, r = Math.sqrt(i / N) * Math.min(W, H) * .38;
    n.x = W / 2 + Math.cos(a) * r; n.y = H / 2 + Math.sin(a) * r;
  });
  // 모든 쌍을 밀어내면 O(n²)이라 노드가 수백 개만 돼도 몇 초씩 멈춘다.
  // 격자에 담아 '이웃 칸'끼리만 민다 — 멀리 있는 노드는 어차피 힘이 0에 가깝다.
  const REP = 26000 * devicePixelRatio;
  const CELL = Math.max(60, Math.sqrt(REP) * 1.6);
  const ITER = N > 400 ? 140 : N > 150 ? 220 : 320;
  const grid = new Map();
  const key = (x, y) => ((x / CELL) | 0) + ',' + ((y / CELL) | 0);
  // 주인공은 아예 가운데에 못을 박고 배치한다. 다 배치한 뒤 통째로 옮기면
  // 나머지가 화면 밖으로 나가 가장자리에 눌어붙는다.
  const hub = S.focus ? S.nodes.find(n => n.id === S.focus)
    : [...S.nodes].sort((a, b) => b.d - a.d)[0];
  S.hub = hub;

  for (let it = 0; it < ITER; it++) {
    for (const e of S.edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - 120 * devicePixelRatio) * .008;
      e.a.vx += dx / d * f; e.a.vy += dy / d * f; e.b.vx -= dx / d * f; e.b.vy -= dy / d * f;
    }
    grid.clear();
    for (const n of S.nodes) {
      const k = key(n.x, n.y);
      (grid.get(k) || grid.set(k, []).get(k)).push(n);
    }
    for (const [k, cell] of grid) {
      const [cx, cy] = k.split(',').map(Number);
      const near = [];
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const c = grid.get((cx + ox) + ',' + (cy + oy));
        if (c) near.push(c);
      }
      for (const a of cell) for (const bucket of near) for (const b of bucket) {
        if (a === b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 1;
        if (d2 > CELL * CELL) continue;
        const f = REP / d2, d = Math.sqrt(d2);
        a.vx -= dx / d * f; a.vy -= dy / d * f;
      }
    }
    for (const n of S.nodes) {
      n.vx += (W / 2 - n.x) * .0022; n.vy += (H / 2 - n.y) * .0022;
      n.x += n.vx *= .8; n.y += n.vy *= .8;
    }
    if (hub) { hub.x = W / 2; hub.y = H / 2; hub.vx = hub.vy = 0; }
  }
  clampAll();
}

/** 힘 배치가 아닌 레이아웃(아크·보드 등)에서 주인공을 기억해 둔다.
    후광을 그릴 때만 쓴다 — 좌표는 건드리지 않는다. */
function markHub() {
  S.hub = S.focus ? S.nodes.find(n => n.id === S.focus)
    : [...S.nodes].sort((a, b) => b.d - a.d)[0];
}
function lArc() {
  const { W, H } = dims();
  const sorted = [...S.nodes].sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || b.d - a.d);
  sorted.forEach((n, i) => {
    n.x = 70 * devicePixelRatio + (i / Math.max(sorted.length - 1, 1)) * (W - 140 * devicePixelRatio);
    n.y = H * .72;
  });
}
function lRadial() {
  const { W, H } = dims();
  const hub = S.focus ? S.nodes.find(n => n.id === S.focus)
    : [...S.nodes].sort((a, b) => b.d - a.d)[0];
  if (!hub) return;
  hub.x = W / 2; hub.y = H / 2;
  const others = S.nodes.filter(n => n !== hub);
  const ring1 = new Set(S.edges.filter(e => e.a === hub || e.b === hub)
    .map(e => (e.a === hub ? e.b : e.a).id));
  const r1 = others.filter(n => ring1.has(n.id)), r2 = others.filter(n => !ring1.has(n.id));
  const R = Math.min(W, H);
  r1.forEach((n, i) => { const a = (i / Math.max(r1.length, 1)) * Math.PI * 2; n.x = W / 2 + Math.cos(a) * R * .22; n.y = H / 2 + Math.sin(a) * R * .22; });
  r2.forEach((n, i) => { const a = (i / Math.max(r2.length, 1)) * Math.PI * 2; n.x = W / 2 + Math.cos(a) * R * .42; n.y = H / 2 + Math.sin(a) * R * .42; });
}
function lChord() {
  const { W, H } = dims();
  const sorted = [...S.nodes].sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls));
  const R = Math.min(W, H) * .40;
  sorted.forEach((n, i) => {
    const a = (i / sorted.length) * Math.PI * 2 - Math.PI / 2;
    n.x = W / 2 + Math.cos(a) * R; n.y = H / 2 + Math.sin(a) * R; n.ang = a;
  });
}
function lHive() {
  const { W, H } = dims();
  const groups = {};
  S.nodes.forEach(n => (groups[n.cls] ||= []).push(n));
  const keys = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const R = Math.min(W, H) * .42;
  keys.forEach((k, gi) => {
    const a = (gi / keys.length) * Math.PI * 2 - Math.PI / 2;
    groups[k].sort((x, y) => y.d - x.d).forEach((n, i) => {
      const t = .18 + (i / Math.max(groups[k].length - 1, 1)) * .82;
      n.x = W / 2 + Math.cos(a) * R * t; n.y = H / 2 + Math.sin(a) * R * t;
    });
  });
}
function lBoard() {
  const { W, H } = dims();
  const groups = {};
  S.nodes.forEach(n => (groups[n.cls] ||= []).push(n));
  const keys = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const colW = W / keys.length;
  keys.forEach((k, gi) => {
    groups[k].sort((x, y) => y.d - x.d).forEach((n, i) => {
      n.x = colW * gi + colW / 2 + ((i % 2) - .5) * colW * .32;
      n.y = 70 * devicePixelRatio + i * 34 * devicePixelRatio;
    });
  });
  clampAll();
}
function clampAll() {
  const { W, H } = dims(), m = 40 * devicePixelRatio;
  S.nodes.forEach(n => {
    n.x = Math.max(m, Math.min(W - m, n.x));
    n.y = Math.max(m, Math.min(H - m, n.y));
  });
}

/* ── 렌더 ── */
function nodeR(n) { return (5 + Math.min(n.d, 12) * 1.15) * devicePixelRatio; }
function matches(n) { return S.search && n.label.includes(S.search); }

/* 썸네일 — 도형 안에 사진을 넣는다.
   800개를 한꺼번에 받으면 안 되므로, 화면에서 충분히 큰 노드만 그때그때 받는다.
   받아 둔 것은 캐시에 남아 레이아웃을 바꿔도 다시 받지 않는다. */
const IMG = new Map();
let loading = 0;
function thumb(url) {
  if (!url) return null;
  const c = IMG.get(url);
  if (c === undefined) {
    if (loading > 6) return null;                  // 동시에 너무 많이 받지 않는다
    loading++;
    const im = new Image();
    im.onload = () => { IMG.set(url, im); loading--; };
    im.onerror = () => { IMG.set(url, 'x'); loading--; };
    IMG.set(url, '…'); im.src = url;
    return null;
  }
  return (c === '…' || c === 'x') ? null : c;
}

function path(ctx, n, r) {
  const s = CLS[n.cls]?.shape || 'circle';
  ctx.beginPath();
  if (s === 'circle') ctx.arc(n.x, n.y, r, 0, 7);
  else if (s === 'square') ctx.rect(n.x - r * .85, n.y - r * .85, r * 1.7, r * 1.7);
  else if (s === 'diamond') { ctx.moveTo(n.x, n.y - r); ctx.lineTo(n.x + r, n.y); ctx.lineTo(n.x, n.y + r); ctx.lineTo(n.x - r, n.y); ctx.closePath(); }
  else if (s === 'triangle') { ctx.moveTo(n.x, n.y - r); ctx.lineTo(n.x + r * .92, n.y + r * .72); ctx.lineTo(n.x - r * .92, n.y + r * .72); ctx.closePath(); }
  else if (s === 'pin') { ctx.arc(n.x, n.y - r * .2, r * .85, Math.PI, 0); ctx.lineTo(n.x, n.y + r); ctx.closePath(); }
  else if (s === 'doc') ctx.rect(n.x - r * .7, n.y - r * .9, r * 1.4, r * 1.8);
  else { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; const fn = i ? 'lineTo' : 'moveTo'; ctx[fn](n.x + Math.cos(a) * r, n.y + Math.sin(a) * r); } ctx.closePath(); }
}

function shape(ctx, n, r, col) {
  const im = r > 9 * devicePixelRatio ? thumb(n.img) : null;
  path(ctx, n, r);
  if (im) {
    // 도형으로 잘라 내고 그 안에 사진을 채운다. 테두리는 클래스 색으로 남겨
    // 사진이 들어가도 '무슨 종류인지'는 계속 읽히게 한다.
    ctx.save(); ctx.clip();
    const side = r * 2.2;
    const ar = im.width / im.height;
    const w = ar >= 1 ? side * ar : side, h = ar >= 1 ? side : side / ar;
    ctx.drawImage(im, n.x - w / 2, n.y - h / 2 - r * .12, w, h);
    ctx.restore();
    ctx.strokeStyle = col; ctx.lineWidth = 2 * devicePixelRatio;
    path(ctx, n, r); ctx.stroke();
  } else {
    ctx.fillStyle = col; ctx.fill();
  }
}

function loop() {
  const cv = $('#graph'); if (!cv) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const line = css('--line'), muted = css('--muted'), fg = css('--fg'), acc = css('--accent');
  const dim = S.search ? .12 : 1;

  /* 가만히 둬도 조금씩 숨 쉬게 한다. 완전히 멈춰 있으면 그림처럼 보이고,
     크게 움직이면 읽기 어렵다 — 노드 반지름의 절반 남짓만. */
  const T = (S.t = (S.t || 0) + 1) * .012;
  S.nodes.forEach((n, i) => {
    if (n.ph === undefined) n.ph = (i * 2.399) % 6.283;
    const amp = 1.6 * devicePixelRatio * (1 + (n === S.hub ? 0 : .4));
    n.ox = Math.sin(T + n.ph) * amp;
    n.oy = Math.cos(T * .84 + n.ph * 1.3) * amp;
  });

  // 엣지
  S.edges.forEach(e => {
    const hi = S.hover && (e.a === S.hover || e.b === S.hover);
    ctx.strokeStyle = hi ? acc : line;
    ctx.globalAlpha = hi ? .95 : (S.search ? .18 : .6);
    ctx.lineWidth = (hi ? 2 : 1) * devicePixelRatio;
    ctx.beginPath();
    const ax = e.a.x + (e.a.ox || 0), ay = e.a.y + (e.a.oy || 0);
    const bx = e.b.x + (e.b.ox || 0), by = e.b.y + (e.b.oy || 0);
    if (S.layout === 'arc') {
      const mx = (ax + bx) / 2, r = Math.abs(bx - ax) / 2;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, ay - r * .9, bx, by);
    } else if (S.layout === 'chord') {
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(W / 2, H / 2, bx, by);
    } else { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // 노드
  S.nodes.forEach(n => {
    const r = nodeR(n);
    const hi = n === S.hover || (S.search && matches(n));
    ctx.globalAlpha = S.search ? (matches(n) ? 1 : dim) : 1;
    if (hi) { ctx.globalAlpha = 1; ctx.shadowColor = clsColor(n.cls); ctx.shadowBlur = 14 * devicePixelRatio; }
    // 흔들림은 그릴 때만 더한다. 실제 좌표(n.x)는 그대로 둬야 클릭 판정이 안 흔들린다.
    const d = { ...n, x: n.x + (n.ox || 0), y: n.y + (n.oy || 0) };
    if (n === S.hub && !S.search) {                    // 주인공에겐 옅은 후광
      ctx.save(); ctx.globalAlpha = .1; ctx.fillStyle = clsColor(n.cls);
      ctx.beginPath(); ctx.arc(d.x, d.y, r + 9 * devicePixelRatio, 0, 7); ctx.fill(); ctx.restore();
    }
    shape(ctx, d, r, clsColor(n.cls));
    ctx.shadowBlur = 0;
    if (r > 7 * devicePixelRatio || hi || S.nodes.length < 46) {
      ctx.fillStyle = hi ? fg : muted;
      ctx.font = `${(hi ? 12.5 : 11) * devicePixelRatio}px "Nanum Myeongjo", serif`;
      ctx.textAlign = 'center';
      const label = n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label;
      ctx.fillText(label, d.x, d.y + r + 13 * devicePixelRatio);
    }
    ctx.globalAlpha = 1;
  });
  S.raf = requestAnimationFrame(loop);
}

function pick(ev) {
  const cv = $('#graph'), r = cv.getBoundingClientRect();
  const x = (ev.clientX - r.left) * devicePixelRatio, y = (ev.clientY - r.top) * devicePixelRatio;
  let best = null, bd = 1e9;
  S.nodes.forEach(n => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < nodeR(n) + 8 * devicePixelRatio && d < bd) { bd = d; best = n; }
  });
  return best;
}
function onMove(ev) {
  const n = pick(ev); S.hover = n;
  const tip = $('#gTip');
  if (!n) { tip.style.display = 'none'; $('#graph').style.cursor = 'default'; return; }
  $('#graph').style.cursor = 'pointer';
  const rel = S.G.edges.filter(e => e.s === n.id || e.o === n.id).length;
  tip.innerHTML = `<b>${esc(n.label)}</b>
    <span>${CLS[n.cls]?.ko || n.cls}${n.date ? ' · ' + esc(n.date) : ''} · 관계 ${rel}</span>
    ${n.desc ? `<span style="display:block;margin-top:.3rem">${esc(n.desc.slice(0, 70))}</span>` : ''}`;
  const box = $('#graph').getBoundingClientRect();
  tip.style.display = 'block';
  tip.style.left = Math.min(ev.clientX - box.left + 14, box.width - 270) + 'px';
  tip.style.top = (ev.clientY - box.top + 14) + 'px';
}
function onClick(ev) {
  const n = pick(ev);
  S.focus = n ? (S.focus === n.id ? null : n.id) : null;
  compute();
}
