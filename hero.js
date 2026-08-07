/* 히어로 — 생애 몰핑 입자 초상
   ─────────────────────────────────────────────────────────────
   프레임 9장(1996 선거벽보 → 2021 틱톡)을 '같은 격자'로 표본한다.
   입자 하나가 모든 프레임에서 같은 칸을 맡으므로, 프레임 전환은
   좌표 재계산이 아니라 색이 바뀌는 일이 된다. 여기에 대각선으로
   훑고 지나가는 변위를 얹어 흩어졌다 다시 모이게 만든다.

   사진과 데이터는 따로 보여주지 않는다. 느린 파동이 화면을 가로지르며
   지나가는 자리의 입자만 RiC-O 클래스 색으로 물들었다가 사진 색으로
   돌아온다 — 기록과 사람이 계속 겹쳐 보이도록.

   ※ 정지 이미지에 깊이·시차·입자 효과만 준다. 표정·발화 등 인물이
     하지 않은 행동을 만들어내지 않는다. */
import { CLS, clsColor, css } from './app.js';

const GW = 72, GH = 96;              // 격자 — 입자 6,912개
const HOLD = 5200;                   // 한 프레임을 보여 주는 시간(ms)
const MORPH = 1500;                  // 전환에 쓰는 시간(ms)

let P = null;

export async function initHero(G) {
  const cv = document.getElementById('portrait');
  if (!cv) return;
  P = {
    cv, ctx: cv.getContext('2d'), G, parts: [], frames: [], cur: 0, next: 0,
    t: 0, morph: 1, last: 0, timer: 0, raf: 0,
    mouse: { x: -9e9, y: -9e9, tx: 0, ty: 0, in: false },
  };
  resize();
  // 캡션·점이 채워지고 웹폰트가 뜨면 캔버스 높이가 몇 px 씩 바뀐다.
  // 백킹스토어가 옛 크기로 남으면 그림이 늘어나 뭉개지므로, 매 프레임 대신
  // 15프레임마다 실제 크기와 대조해 스스로 맞춘다.
  new ResizeObserver(() => { resize(); layout(); }).observe(cv);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerleave', () => {
    P.mouse.x = P.mouse.y = -9e9; P.mouse.tx = P.mouse.ty = 0; P.mouse.in = false;
  });
  cv.addEventListener('click', () => go(P.cur + 1));

  buildParticles();
  layout();
  loop(performance.now());

  const meta = await fetch('assets/life/frames.json').then(r => r.json()).catch(() => []);
  if (!meta.length) { hint('초상 이미지를 찾지 못했습니다'); return; }
  P.meta = meta;
  renderDots();

  // 첫 장은 먼저 띄우고, 나머지는 뒤에서 조용히 채운다
  await addFrame(meta[0], 0);
  show(0, true);
  hint('클릭하면 다음 장면 · 마우스로 밀어 보세요');
  for (let i = 1; i < meta.length; i++) await addFrame(meta[i], i);
  schedule();

  // 캡션·점이 들어가고 웹폰트가 뜨면 캔버스가 몇 px 줄어든다. 두 시점 모두 다시 잰다.
  resize(); layout();
  document.fonts?.ready.then(() => { resize(); layout(); });
  setInterval(fit, 700);                      // 탭이 숨겨져 rAF 가 멈춰도 도는 안전장치
}

/* ── 입자 ── */
function buildParticles() {
  P.parts = [];
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx;
    P.parts.push({
      gx, gy, i,
      nx: (gx + .5) / GW, ny: (gy + .5) / GH,
      edge: 1,
      x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0,
      z: .5, phase: (i * 2.399) % (Math.PI * 2),
      // 대각선으로 훑는 전환 순서 — 왼쪽 위에서 오른쪽 아래로 번진다
      delay: ((gx / GW) * .55 + (gy / GH) * .35) * .45,
      dir: 0, cls: null, ccol: [0, 0, 0],
      r: 200, g: 200, b: 200, a: .5, w: 1,
    });
  }
  // 클래스 색은 그래프의 실제 분포를 따른다(인물이 많으면 인물 색이 많다).
  // 칸마다 따로 주면 색종이 뿌린 것처럼 보이므로, 6×8 구역이 같은 색을 쓴다.
  // 그래야 파동이 지나갈 때 '리본'으로 흐른다.
  const nodes = P.G.nodes.length ? P.G.nodes : [{ cls: 'Person' }];
  const zone = new Map();
  P.parts.forEach(p => {
    const k = (p.gy / 8 | 0) * 99 + (p.gx / 6 | 0);
    if (!zone.has(k)) {
      const nd = nodes[(k * 7919) % nodes.length];
      zone.set(k, CLS[nd.cls] ? nd.cls : 'Person');
    }
    p.cls = zone.get(k);
    p.ccol = hex2rgb(clsColor(p.cls));
    p.dir = Math.sin(p.gx * .37) * Math.cos(p.gy * .29);   // 흩어지는 방향
  });
}

/** 이미지 한 장 → 격자 색 배열 */
function addFrame(m, idx) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = GW; c.height = GH;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, GW, GH);
      const d = x.getImageData(0, 0, GW, GH).data;
      const buf = new Uint8ClampedArray(GW * GH * 3);
      const lum = new Float32Array(GW * GH);
      for (let i = 0; i < GW * GH; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b;
        lum[i] = (r * .299 + g * .587 + b * .114) / 255;
      }
      P.frames[idx] = { ...m, buf, lum };
      res();
    };
    img.onerror = () => { P.frames[idx] = null; res(); };
    img.src = m.src;
  });
}

function hex2rgb(h) {
  const s = String(h).trim();
  if (s.startsWith('#')) {
    const n = s.length === 4
      ? s.slice(1).split('').map(c => parseInt(c + c, 16))
      : [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    return n;
  }
  const m = s.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [140, 90, 60];
}

/* ── 배치 ── */
function resize() {
  const r = P.cv.getBoundingClientRect();
  P.cv.width = Math.max(1, r.width * devicePixelRatio);
  P.cv.height = Math.max(1, r.height * devicePixelRatio);
  P.w = P.cv.width; P.h = P.cv.height;
}
/** 백킹스토어가 실제 표시 크기와 어긋나면 그림이 늘어난다. 어긋났을 때만 다시 잡는다. */
function fit() {
  if (!P) return;
  const r = P.cv.getBoundingClientRect();
  if (Math.abs(P.cv.width - r.width * devicePixelRatio) > 2 ||
      Math.abs(P.cv.height - r.height * devicePixelRatio) > 2) { resize(); layout(); }
}
function layout() {
  const W = P.w, H = P.h;
  const boxH = H * .94, boxW = boxH * .75;           // 원본 3:4
  const ox = (W - boxW) / 2, oy = (H - boxH) / 2;
  P.gap = boxW / GW;
  const soft = v => Math.min(1, Math.max(0, v) / .10);   // 바깥 10% 를 서서히 지운다
  P.parts.forEach(p => {
    p.px = ox + p.nx * boxW;
    p.py = oy + p.ny * boxH;
    p.edge = soft(p.nx) * soft(1 - p.nx) * soft(p.ny) * soft(1 - p.ny);
    if (!p.x) { p.x = p.px + (Math.random() - .5) * W * .5; p.y = p.py + (Math.random() - .5) * H * .5; }
  });
}

/* ── 전환 ── */
function show(i, instant) {
  const n = P.frames.filter(Boolean).length || 1;
  P.next = ((i % n) + n) % n;
  if (instant) { P.cur = P.next; P.morph = 1; P.morphAt = 0; }
  else { P.morph = 0; P.morphAt = performance.now(); }
  paintCaption(P.frames[P.next]);
  document.querySelectorAll('#heroDots button')
    .forEach((b, j) => b.classList.toggle('on', j === P.next));
}
function go(i) { clearTimeout(P.timer); show(i); schedule(); }
window.heroGo = go;

function schedule() {
  clearTimeout(P.timer);
  P.timer = setTimeout(() => go(P.next + 1), HOLD + MORPH);
}

function paintCaption(f) {
  if (!f) return;
  const cap = document.querySelector('.hero-cap');
  cap?.classList.add('fade');
  setTimeout(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('heroYear', f.year); set('heroLabel', f.label); set('heroCredit', f.credit);
    cap?.classList.remove('fade');
  }, 260);
}
function renderDots() {
  const el = document.getElementById('heroDots');
  if (!el) return;
  el.innerHTML = P.meta.map((m, i) =>
    `<button class="${i === 0 ? 'on' : ''}" onclick="heroGo(${i})" title="${m.year} ${m.label}"></button>`).join('');
}
function hint(t) { const e = document.getElementById('heroHint'); if (e) e.textContent = t; }

/** 캡션을 누르면 그 장면이 가리키는 개체로 */
window.heroOpen = () => {
  const id = P?.meta?.[P.next]?.entity;
  if (id && typeof window.openItem === 'function') window.openItem(id);
  else location.hash = '#record';
};

function onMove(e) {
  const r = P.cv.getBoundingClientRect();
  P.mouse.x = (e.clientX - r.left) * devicePixelRatio;
  P.mouse.y = (e.clientY - r.top) * devicePixelRatio;
  P.mouse.tx = ((e.clientX - r.left) / r.width - .5) * 2;
  P.mouse.ty = ((e.clientY - r.top) / r.height - .5) * 2;
  P.mouse.in = true;
}

/* ── 루프 ── */
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function loop(now) {
  if (!P) return;
  const raw = now - (P.last || now); P.last = now;
  const slow = raw > 180;                    // 탭이 가려졌다 돌아온 경우
  P.t += Math.min(50, raw) / 1000;
  const T = P.t;

  if ((P.tick = (P.tick || 0) + 1) % 15 === 0) fit();

  if (P.morph < 1) {
    P.morph = clamp((now - P.morphAt) / MORPH, 0, 1);   // 누적이 아니라 경과 시간으로
    if (P.morph >= 1) P.cur = P.next;
  }

  const A = P.frames[P.cur], B = P.frames[P.next];
  const ctx = P.ctx, W = P.w, H = P.h;
  ctx.clearRect(0, 0, W, H);

  const breathe = 1 + Math.sin(T * .55) * .005;
  const par = 16 * devicePixelRatio;
  const gap = P.gap || 4;
  // 사진↔데이터를 오가는 파동. 대각선으로 천천히 흐른다.
  const waveT = T * .11;

  for (const p of P.parts) {
    /* 색 — 프레임 A와 B를 섞고, 그 위에 클래스 색을 파동만큼 덧입힌다 */
    let r = 210, g = 205, b = 198, lum = .8;
    if (A) {
      const j = p.i * 3;
      r = A.buf[j]; g = A.buf[j + 1]; b = A.buf[j + 2]; lum = A.lum[p.i];
      if (B && B !== A && P.morph < 1) {
        // 대각선 지연으로 칸마다 다른 시점에 넘어간다
        const lt = clamp((P.morph - p.delay) / (1 - p.delay), 0, 1);
        const e = easeInOut(lt);
        r += (B.buf[j] - r) * e;
        g += (B.buf[j + 1] - g) * e;
        b += (B.buf[j + 2] - b) * e;
        lum += (B.lum[p.i] - lum) * e;
      }
    }
    const wave = Math.sin((p.nx * 2.4 + p.ny * 1.6) * Math.PI - waveT * Math.PI * 2);
    const mix = Math.max(0, wave) ** 3 * .55;          // 마루 부근에서만 물든다
    r += (p.ccol[0] - r) * mix;
    g += (p.ccol[1] - g) * mix;
    b += (p.ccol[2] - b) * mix;

    p.z = .35 + (1 - lum) * .95;

    /* 목표 위치 — 시차 + 호흡 + 잔물결 */
    let tx = p.px + P.mouse.tx * par * p.z + (W / 2 - p.px) * (1 - breathe);
    let ty = p.py + P.mouse.ty * par * p.z + (H / 2 - p.py) * (1 - breathe);
    tx += Math.sin(T * .8 + p.phase) * gap * .13;      // 가만히 둬도 미세하게 일렁인다
    ty += Math.cos(T * .62 + p.phase * 1.3) * gap * .13;

    /* 전환 중에는 한 번 흩어졌다 모인다 */
    if (P.morph < 1) {
      const lt = clamp((P.morph - p.delay) / (1 - p.delay), 0, 1);
      const burst = Math.sin(lt * Math.PI);            // 0 → 1 → 0
      const ang = p.phase + p.dir * 2.6;
      const amp = burst * gap * 3.2 * (.5 + p.z);
      tx += Math.cos(ang) * amp;
      ty += Math.sin(ang) * amp * .8;
    }

    /* 커서 반발 */
    if (P.mouse.in) {
      const mx = p.x - P.mouse.x, my = p.y - P.mouse.y, d2 = mx * mx + my * my;
      const R2 = (110 * devicePixelRatio) ** 2;
      if (d2 < R2) {
        const f = (1 - d2 / R2) * 26 * devicePixelRatio;
        const d = Math.sqrt(d2) || 1;
        tx += mx / d * f; ty += my / d * f;
      }
    }

    if (slow) { p.x = tx; p.y = ty; p.vx = p.vy = 0; }   // 프레임이 뜸하면 바로 제자리로
    else {
      p.vx += (tx - p.x) * .085; p.vy += (ty - p.y) * .085;
      p.x += p.vx *= .80; p.y += p.vy *= .80;
    }

    /* 그리기 — 어두운 화소는 크고 진하게, 밝은 화소는 작고 옅게 */
    const wgt = .98 + (1 - lum) * .42;               // 항상 격자 이상 → 사이에 흰 틈이 안 생긴다
    const s = gap * wgt;
    const al = (.62 + (1 - lum) * .38) * p.edge;
    if (al < .02) continue;
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${al.toFixed(3)})`;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }

  P.raf = requestAnimationFrame(loop);
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
