/* 관계망 — 6개 레이아웃
   네트워크(힘) · 아크 · 방사형 · 코드 · 하이브 · 보드
   캔버스 렌더. 클래스·관계 필터, 검색, 노드 클릭 시 이웃만 강조. */
import { CLS, REL_KO, clsColor, css, esc, $, SUBJ_STORY } from './app.js';

const S = {
  G: null, layout: 'network', clsOn: new Set(), relOn: new Set(),
  nodes: [], edges: [], focus: null, search: '', raf: 0, hover: null,
  /* 성좌 모드 — 첫 화면은 연결 상위 ~60의 성좌. 스키마 칩·이야기 탭이 이 캔버스를 조종한다.
     lab=true 면 옛 실험실(레이아웃 6종·칩 전체)로 돌아간다. */
  lab: false, story: null, relKey: null, glow: null, deg: null, settle0: 0,
};
const RIC = 'http://archives.nanet.go.kr/id/';
const long = s => String(s).startsWith('http') ? s : RIC + s;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* 이야기 관계망 — 전시(SUBJ_STORY)의 refs 를 그대로 재활용하고, 성장 경로 하나를 큐레이션.
   그래프에 없는 id 는 조용히 빠진다(지어내지 않는 규칙 그대로). */
const STORIES = () => {
  const out = [];
  for (const [k, s] of Object.entries(SUBJ_STORY || {})) {
    const ids = [...new Set(s.acts.flatMap(a => a.refs || []))];
    out.push({ key: k, title: s.title.split('\n')[0].replace(/[,\u2014\s]+$/, ''), ids: ['agent-jsk', ...ids] });
  }
  out.push({ key: 'growth', title: '진안에서 여의도까지', ids: ['agent-jsk', 'place-jinan',
    'org-sinheung-high-school', 'place-jeonju', 'place-korea-univ', 'org-korea-university-student-council',
    'org-ssangyong', 'org-ssangyong-usa', 'place-los-angeles', 'place-yeouido', 'org-assembly'] });
  return out;
};

export function initGraph(G) {
  S.G = G;

  const cv = $('#graph');
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('click', onClick);
  cv.addEventListener('pointerleave', () => { S.hover = null; $('#gTip').style.display = 'none'; });
  document.addEventListener('click', e => {
    if (!e.target.closest('.gq-wrap')) $('#gSug')?.setAttribute('hidden', '');
  });
  const ins = $('#gInsight');
  ins?.addEventListener('mouseenter', () => { S.scenePaused = true; clearTimeout(S.sceneT); ins.querySelector('.bar')?.remove(); });
  ins?.addEventListener('mouseleave', () => { S.scenePaused = false; paintScene(); });
  /* 리사이즈마다 전체 레이아웃을 다시 계산하면 창 크기를 끄는 동안 이벤트가 초당 수십 번
     쏟아져 화면 전체가 버벅인다(개체 페이지가 덮여 있어도 창 리사이즈는 여기까지 온다).
     끝나고 한 번만 계산한다. */
  let rsT = null;
  addEventListener('resize', () => {
    sizeCanvas();                  // 캔버스 크기는 즉시 — 늦추면 그리기가 늘어나 붙어 한쪽으로 치우쳐 보인다
    clearTimeout(rsT);
    rsT = setTimeout(compute, 150);   // 전체 재배치만 드래그가 끝난 뒤 한 번
  });
  buildStarUI();
  sizeCanvas(); compute(); loop();
}

/* ── 성좌 UI — 탭 · 스키마 칩 · 관계 카드 · 무게중심 ── */
function buildStarUI() {
  const G = S.G;
  S.deg = new Map(G.nodes.map(n => [n.id, 0]));
  G.edges.forEach(e => { S.deg.set(e.s, (S.deg.get(e.s) || 0) + 1); S.deg.set(e.o, (S.deg.get(e.o) || 0) + 1); });

  const tabs = $('#gTabsIn');
  if (tabs) tabs.innerHTML =
    `<button class="gtab on" data-k="" onclick="gStory('')">전체 성좌</button>` +
    STORIES().map(s => `<button class="gtab" data-k="${s.key}" onclick="gStory('${s.key}')">${esc(s.title)}</button>`).join('');

  const cnt = new Map();
  G.nodes.forEach(n => cnt.set(n.cls, (cnt.get(n.cls) || 0) + 1));
  const sch = $('#gSchema');
  if (sch) sch.innerHTML = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) =>
    `<button class="gchip" data-c="${c}" onmouseenter="gGlow('${c}')" onmouseleave="gGlow(null)"
       onclick="gPin('${c}')"><i style="background:${clsColor(c)}"></i>${CLS[c]?.ko || c} <em>${n}</em></button>`).join('');

  const byP = new Map();
  G.edges.forEach(e => byP.set(e.p, (byP.get(e.p) || 0) + 1));
  const rels = $('#gRels');
  if (rels) rels.innerHTML = [...byP.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) =>
    `<button class="grel${S.relKey === p ? ' on' : ''}" onclick="gRel('${p}')">${esc(REL_KO[p] || p)}
       <code>${esc(p)}</code><em>${n}</em></button>`).join('');

  const rank = $('#gRank');
  if (rank) {
    const top = [...G.nodes].sort((a, b) => (S.deg.get(b.id) || 0) - (S.deg.get(a.id) || 0)).slice(0, 5);
    rank.innerHTML = `<div class="grank-h">무게중심 — 연결 수</div>` + top.map((n, i) =>
      `<button onclick="graphFocus('${esc(n.id)}')"><i>${i + 1}</i><b>${esc(n.label)}</b><em>${S.deg.get(n.id)}</em></button>`).join('');
  }
}

/* ── 검색 — 이름으로 찾아 에고로 점프 ── */
window.gSearch = v => {
  const sug = $('#gSug'); if (!sug || !S.G || !S.deg) return;
  const q = v.trim();
  if (!q) { sug.hidden = true; return; }
  const hits = S.G.nodes.filter(n => n.label && n.label.includes(q))
    .sort((a, b) => (S.deg.get(b.id) || 0) - (S.deg.get(a.id) || 0)).slice(0, 8);
  if (!hits.length) { sug.innerHTML = '<button disabled>일치 없음</button>'; sug.hidden = false; return; }
  sug.innerHTML = hits.map(n => `<button onclick="gGo('${esc(n.id)}')">
    <i style="background:${clsColor(n.cls)}"></i>${esc(n.label)}<em>${S.deg.get(n.id) || 0}</em></button>`).join('');
  sug.hidden = false;
};
window.gGo = id => {
  $('#gSug').hidden = true;
  const n = S.G.byId?.get(id) || S.G.nodes.find(x => x.id === id);
  const gq = $('#gq'); if (gq && n) gq.value = n.label;
  graphFocus(id);
  if (n) showPanel(n);
};
function showPanel(n) {
  const p = $('#gPanel'); if (!p) return;
  const sid = encodeURIComponent(String(n.id).replace(RIC, ''));
  p.innerHTML = `<b>${esc(n.label)}</b><span>${CLS[n.cls]?.ko || n.cls}${n.date ? ' · ' + esc(n.date) : ''}
    · 연결 ${S.deg.get(n.id) || 0}</span><a href="#/item/${sid}" onclick="event.stopPropagation()">개체 페이지 →</a>`;
  p.removeAttribute('hidden');
}

/* ── 장면 — 뷰마다 인사이트 문장과 하이라이트를 넘겨 가며 읽는다.
   전체 성좌의 장면은 데이터(무게중심)에서 자동으로 짓고, 이야기 3종은 전시 서사의
   사실만 문장으로 옮겼다. 하이라이트 id 는 화면에 없으면 조용히 빠진다. */
const STORY_INTRO = {
  'concept-tanhaek': '헌정이 두 번 멈칫한 자리 — 국회가 대통령 탄핵소추를 의결한 두 순간을 잇는다.',
  'concept-nodong': '일하는 사람의 편에서 — 상사원에서 노사정위원까지, 노동을 관통한 길.',
  growth: '진안의 산골에서 여의도까지 — 한 사람이 걸어온 지리의 서사.',
};
const STORY_SCENES = {
  'concept-tanhaek': [
    { t: '12년을 사이에 둔 두 번의 탄핵소추 — 2004년은 기각으로, 2016년은 인용으로 끝났다.', ids: ['event-impeach-roh', 'event-impeach-park'] },
    { t: '두 번째 의사봉은 구술자 자신이 들었다 — 제20대 전반기 국회의장 정세균.', ids: ['agent-jsk', 'event-impeach-park'] },
    { t: '같은 계절, 본회의장 밖 광장에는 촛불이 있었다.', ids: ['event-candlelight', 'event-impeach-park'] }],
  'concept-nodong': [
    { t: '노동의 이야기는 명함에서 시작한다 — 쌍용에서의 열일곱 해.', ids: ['agent-jsk', 'org-ssangyong'] },
    { t: '한보가 무너지고 외환위기가 왔다 — 위기가 대타협을 불렀다.', ids: ['event-hanbo', 'event-imf', 'event-nosajeong'] },
    { t: '1998년 노사정위원회의 밤 — 그 자리에 있던 사람의 목소리다.', ids: ['agent-jsk', 'event-nosajeong', 'org-nosajeong'] }],
  growth: [
    { t: '진안의 소년은 왕복 8km를 걸어 학교에 다녔다.', ids: ['place-jinan', 'org-sinheung-high-school'] },
    { t: '전주에서 눈이 트였고, 고려대 총학생회장으로 단련됐다.', ids: ['place-jeonju', 'place-korea-univ', 'org-korea-university-student-council'] },
    { t: '쌍용의 주재원이 태평양을 건넜다 — 돌아와 닿은 곳이 여의도였다.', ids: ['org-ssangyong-usa', 'place-los-angeles', 'place-yeouido', 'org-assembly'] }],
};
function viewScenes() {
  if (S.relKey || S.focus) return [];
  if (S.story) {
    const sc = (STORY_SCENES[S.story.key] || []).map(s => ({ t: s.t, ids: s.ids.map(long) }));
    const intro = STORY_INTRO[S.story.key];
    return intro ? [{ t: intro, ids: [] }, ...sc] : sc;
  }
  // 전체 성좌 — 무게중심에서 장면을 짓는다(팀이 데이터를 갈아끼워도 성립)
  const top = [...S.G.nodes].sort((a, b) => (S.deg.get(b.id) || 0) - (S.deg.get(a.id) || 0));
  if (top.length < 3) return [];
  const [a, b] = top;
  const ppl = top.filter(n => n.cls === 'Person').slice(1, 4);
  const out = [
    { t: `전체 ${S.G.nodes.length}개 개체 · ${S.G.edges.length}개 관계에서 연결이 많은 ${S.nodes.length}개를 별로 올렸다 — 별이 클수록 이야기의 무게가 크다.`, ids: [] },
    { t: `이 성좌의 정점은 ${a.label} — 연결 ${S.deg.get(a.id)}개. 기록의 세계가 한 사람을 중심으로 돈다.`, ids: [a.id] },
    { t: `${a.label} 곁의 또 하나의 기둥, ${b.label}(연결 ${S.deg.get(b.id)}개) — 이 그물은 두 무게중심으로 지탱된다.`, ids: [a.id, b.id] }];
  if (ppl.length) out.push({
    t: `정점 곁의 사람들 — ${ppl.map(p => p.label).join(' · ')}. 구술이 지나온 시간의 증인들이다.`,
    ids: [a.id, ...ppl.map(p => p.id)] });
  return out;
}
function renderInsight() {
  const el = $('#gInsight'); if (!el) return;
  S.scenes = viewScenes(); S.si = 0;
  paintScene();
}
function paintScene() {
  const el = $('#gInsight');
  if (!el) return;
  clearTimeout(S.sceneT);
  if (!S.scenes || !S.scenes.length) { el.hidden = true; S.hiIds = null; return; }
  const sc = S.scenes[S.si];
  const shown = new Set(S.nodes.map(n => n.id));
  S.hiIds = new Set(sc.ids.filter(id => shown.has(id)));
  el.innerHTML = `<p>${esc(sc.t)}</p>
    <div class="row"><span class="no">장면 ${S.si + 1} / ${S.scenes.length}</span>
      <button onclick="gScene(-1)" aria-label="이전 장면">‹</button>
      <button onclick="gScene(1)" aria-label="다음 장면">›</button>
      <button class="gpp" onclick="gPlay()" aria-label="${S.sceneStop ? '자동 재생' : '자동 재생 멈춤'}">${S.sceneStop ? '▶' : '❚❚'}</button></div><i class="bar"></i>`;
  el.hidden = false;
  /* 자동 플레이 — 문장 길이만큼 머문 뒤 다음 장면으로.
     오버레이에 마우스가 올라와 있으면 쉬고, 멈춤 버튼(S.sceneStop)은 다시 누를 때까지 잠근다. */
  const ms = Math.max(5500, 3200 + sc.t.length * 60);
  if (!S.scenePaused && !S.sceneStop && S.scenes.length > 1) {
    S.sceneT = setTimeout(() => { S.si = (S.si + 1) % S.scenes.length; paintScene(); }, ms);
    if (!REDUCED) {
      const bar = el.querySelector('.bar');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bar.style.transition = `width ${ms}ms linear`; bar.style.width = '100%';
      }));
    }
  }
}
window.gPlay = () => { S.sceneStop = !S.sceneStop; clearTimeout(S.sceneT); paintScene(); };
window.gScene = d => {
  if (!S.scenes?.length) return;
  S.si = (S.si + d + S.scenes.length) % S.scenes.length;
  paintScene();
};

window.gStory = k => {
  S.story = k ? STORIES().find(s => s.key === k) : null;
  S.relKey = null; S.focus = null; S.glow = null;
  $('#gPanel')?.setAttribute('hidden', '');
  document.querySelectorAll('#gTabs .gtab').forEach(b => b.classList.toggle('on', b.dataset.k === (k || '')));
  document.querySelectorAll('#gRels .grel').forEach(b => b.classList.remove('on'));
  compute();
};
window.gRel = p => {
  S.relKey = S.relKey === p ? null : p;
  S.story = null; S.focus = null;
  $('#gPanel')?.setAttribute('hidden', '');
  document.querySelectorAll('#gTabs .gtab').forEach(b => b.classList.toggle('on', !S.relKey && b.dataset.k === ''));
  document.querySelectorAll('#gRels .grel').forEach(b => b.classList.toggle('on', b.textContent.includes(REL_KO[S.relKey] || '§')));
  compute();
};
window.gGlow = c => { S.glow = c; };
window.gPin = c => { S.glow = S.glow === c && S.glowPin ? null : c; S.glowPin = !!c; };

function sizeCanvas() {
  const cv = $('#graph'); if (!cv) return;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, r.width * devicePixelRatio);
  cv.height = Math.max(1, (r.height || 620) * devicePixelRatio);
}

/* 다시 그리라는 말은 곧 크기가 달라졌다는 말이다 — 테마 전환·전체화면·페이지 전환 모두 그렇다.
   캔버스를 다시 재지 않으면 숨어 있던 동안의 0px 를 그대로 쓴다. */
export function redrawGraph() { if (S.G) { sizeCanvas(); compute(); } }
/** 아이템 페이지에서 넘어올 때 — 그 개체의 이웃만 남기고 클래스·관계 필터는 모두 켠다 */
window.graphFocus = id => {
  if (!S.G) return;
  S.story = null; S.relKey = null;
  S.focus = id;
  compute();
};

/* ── 표시 대상 계산 + 레이아웃 ── */
/* 성좌 선정 — 무엇을 그릴지가 이 화면의 절제다.
   전체: 연결 상위 60 · 이야기: 큐레이션 refs · 관계: 그 술어의 대표 20쌍 · 에고: 이웃 상위 40. */
function starCompute() {
  const G = S.G;
  let ns, es;
  if (S.story) {
    const keep = new Set(S.story.ids.map(long));
    ns = G.nodes.filter(n => keep.has(n.id));
    const ids = new Set(ns.map(n => n.id));
    es = G.edges.filter(e => ids.has(e.s) && ids.has(e.o));
  } else if (S.relKey) {
    const pairs = G.edges.filter(e => e.p === S.relKey)
      .sort((a, b) => ((S.deg.get(b.s) || 0) + (S.deg.get(b.o) || 0)) - ((S.deg.get(a.s) || 0) + (S.deg.get(a.o) || 0)))
      .slice(0, 20);
    const ids = new Set(pairs.flatMap(e => [e.s, e.o]));
    ns = G.nodes.filter(n => ids.has(n.id));
    es = pairs;
  } else if (S.focus) {
    const nb = new Map();
    G.edges.forEach(e => {
      if (e.s === S.focus) nb.set(e.o, true);
      if (e.o === S.focus) nb.set(e.s, true);
    });
    const ids = new Set([S.focus,
      ...[...nb.keys()].sort((a, b) => (S.deg.get(b) || 0) - (S.deg.get(a) || 0)).slice(0, 40)]);
    ns = G.nodes.filter(n => ids.has(n.id));
    es = G.edges.filter(e => ids.has(e.s) && ids.has(e.o));
  } else {
    ns = [...G.nodes].sort((a, b) => (S.deg.get(b.id) || 0) - (S.deg.get(a.id) || 0)).slice(0, 60);
    const ids = new Set(ns.map(n => n.id));
    es = G.edges.filter(e => ids.has(e.s) && ids.has(e.o));
  }
  S.nodes = ns.map(n => ({ ...n, d: S.deg.get(n.id) || 0, x: 0, y: 0, vx: 0, vy: 0 }));
  const map = new Map(S.nodes.map(n => [n.id, n]));
  S.edges = es.map(e => ({ ...e, a: map.get(e.s), b: map.get(e.o) })).filter(e => e.a && e.b);
  $('#nNode').textContent = S.nodes.length;
  $('#nEdge').textContent = S.edges.length;
  S.layout = 'network';
  lNetwork();
  /* 라벨 — 작은 그래프(이야기·관계·에고)는 전부, 성좌는 상위 10만. 소리를 하나로 줄인다. */
  const all = S.nodes.length <= 42;
  const top = new Set([...S.nodes].sort((a, b) => b.d - a.d).slice(0, 10));
  S.nodes.forEach(n => n.lb = all || top.has(n));
  /* 정착 — 중심 근처에서 제자리로 1.2초 한 번. 그 뒤로는 움직이지 않는다. */
  if (!REDUCED) {
    const { W, H } = { W: $('#graph').width, H: $('#graph').height };
    S.nodes.forEach((n, i) => {
      const a = i * 2.399;
      n.sx = W / 2 + Math.cos(a) * W * .04;
      n.sy = H / 2 + Math.sin(a) * H * .04;
    });
    S.settle0 = performance.now();
  } else S.settle0 = 0;
  renderInsight();
}

function compute() {
  if (!S.G) return;
  starCompute();
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
  // 개념은 실재하지 않는다. 채우지 않고 점선으로 둘러 「이건 관념이다」를 형태로 말한다.
  else if (s === 'dcircle') ctx.arc(n.x, n.y, r * .92, 0, 7);
  else { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; const fn = i ? 'lineTo' : 'moveTo'; ctx[fn](n.x + Math.cos(a) * r, n.y + Math.sin(a) * r); } ctx.closePath(); }
}

function shape(ctx, n, r, col) {
  // 개념은 속을 비우고 테두리를 끊는다 — 다른 여덟 클래스는 전부 채워진 도형이다.
  if (CLS[n.cls]?.shape === 'dcircle') {
    ctx.save();
    ctx.setLineDash([3 * devicePixelRatio, 2.5 * devicePixelRatio]);
    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * devicePixelRatio;
    path(ctx, n, r); ctx.stroke();
    ctx.restore();
    return;
  }
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

const SKOS_EDGE = new Set(['broader', 'narrower', 'related', 'inScheme', 'topConceptOf', 'exactMatch']);

function loop() {
  const cv = $('#graph'); if (!cv) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const line = css('--line'), muted = css('--muted'), fg = css('--fg'), acc = css('--accent');
  const dim = S.search ? .12 : 1;

  /* 가만히 둬도 조금씩 숨 쉬게 한다. 완전히 멈춰 있으면 그림처럼 보이고,
     크게 움직이면 읽기 어렵다 — 노드 반지름의 절반 남짓만. */
  const star = true;
  /* 정착 보간 — 성좌는 1.2초에 한 번 자리 잡고, 그 뒤로는 완전히 멈춘다(호흡 없음). */
  const st = star && S.settle0 ? Math.min(1, (performance.now() - S.settle0) / 1200) : 1;
  const ease = 1 - Math.pow(1 - st, 3);
  const T = (S.t = (S.t || 0) + 1) * .012;
  S.nodes.forEach((n, i) => {
    if (n.ph === undefined) n.ph = (i * 2.399) % 6.283;
    const amp = star ? 0 : 1.6 * devicePixelRatio * (1 + (n === S.hub ? 0 : .4));
    n.ox = Math.sin(T + n.ph) * amp;
    n.oy = Math.cos(T * .84 + n.ph * 1.3) * amp;
    if (star && st < 1 && n.sx !== undefined) {
      n.dx = n.sx + (n.x - n.sx) * ease;
      n.dy = n.sy + (n.y - n.sy) * ease;
    } else { n.dx = n.x; n.dy = n.y; }
  });

  // 엣지
  const shi = S.hiIds && S.hiIds.size;   // 장면 하이라이트 — 문장이 가리키는 별과 그 사이 선만 남긴다
  const panel = css('--panel');
  S.edges.forEach(e => {
    const hi = S.hover && (e.a === S.hover || e.b === S.hover);
    const eh = shi && S.hiIds.has(e.a.id) && S.hiIds.has(e.b.id);
    ctx.strokeStyle = hi || eh ? acc : line;
    const gdim = star && S.glow && !(e.a.cls === S.glow || e.b.cls === S.glow);
    ctx.globalAlpha = hi ? .95 : eh ? .9 : shi ? .07 : gdim ? .1 : (S.search ? .18 : star ? .5 : .6);
    ctx.lineWidth = (hi ? 2 : eh ? 1.8 : 1) * devicePixelRatio;
    /* SKOS 관계는 점선이다. skos:broader 는 rdfs:subClassOf 가 아니라 추론이 일어나지 않는
       느슨한 계층이라, RiC-O 관계와 같은 실선으로 그리면 화면이 거짓말을 한다. */
    ctx.setLineDash(SKOS_EDGE.has(e.p) ? [4 * devicePixelRatio, 3 * devicePixelRatio] : []);
    ctx.beginPath();
    const ax = (e.a.dx ?? e.a.x) + (e.a.ox || 0), ay = (e.a.dy ?? e.a.y) + (e.a.oy || 0);
    const bx = (e.b.dx ?? e.b.x) + (e.b.ox || 0), by = (e.b.dy ?? e.b.y) + (e.b.oy || 0);
    if (S.layout === 'arc') {
      const mx = (ax + bx) / 2, r = Math.abs(bx - ax) / 2;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, ay - r * .9, bx, by);
    } else if (S.layout === 'chord') {
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(W / 2, H / 2, bx, by);
    } else { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    ctx.stroke();
    if (hi) {
      /* 호버한 별에 닿은 선에는 관계유형을 얹는다 — 매개 구조(직위·사건)가 눈에 보이게. */
      const lb = REL_KO[e.p] || String(e.p).split(/[#/]/).pop();
      ctx.save();
      ctx.setLineDash([]);
      ctx.font = `${9.5 * devicePixelRatio}px ui-monospace,"SF Mono",Menlo,monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3.5 * devicePixelRatio; ctx.strokeStyle = panel;
      ctx.strokeText(lb, (ax + bx) / 2, (ay + by) / 2);
      ctx.fillStyle = acc;
      ctx.fillText(lb, (ax + bx) / 2, (ay + by) / 2);
      ctx.restore();
    }
  });
  ctx.globalAlpha = 1;

  // 노드
  S.nodes.forEach(n => {
    const r = nodeR(n);
    const hi = n === S.hover || (S.search && matches(n));
    const nh = shi && S.hiIds.has(n.id);
    const gdim = star && S.glow && n.cls !== S.glow;
    ctx.globalAlpha = shi ? (nh ? 1 : .18) : S.search ? (matches(n) ? 1 : dim) : gdim ? .18 : 1;
    if (hi) { ctx.globalAlpha = 1; ctx.shadowColor = star ? acc : clsColor(n.cls); ctx.shadowBlur = 14 * devicePixelRatio; }
    // 흔들림·정착은 그릴 때만 더한다. 실제 좌표(n.x)는 그대로 둬야 클릭 판정이 안 흔들린다.
    const d = { ...n, x: (n.dx ?? n.x) + (n.ox || 0), y: (n.dy ?? n.y) + (n.oy || 0) };
    if (n === S.hub && !S.search) {                    // 주인공에겐 옅은 후광
      ctx.save(); ctx.globalAlpha = .08; ctx.fillStyle = star ? acc : clsColor(n.cls);
      ctx.beginPath(); ctx.arc(d.x, d.y, r + 9 * devicePixelRatio, 0, 7); ctx.fill(); ctx.restore();
    }
    if (star) {
      /* 성좌 문법 — 채움은 명패색, 테두리는 무채 1px. 색은 딱 두 곳:
         허브(자주)와 발광 중인 클래스(그 클래스색). */
      ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 7);
      ctx.fillStyle = panel; ctx.fill();
      ctx.strokeStyle = nh ? acc : n === S.hub ? acc : (S.glow && n.cls === S.glow) ? clsColor(n.cls) : muted;
      ctx.lineWidth = (nh || n === S.hub || (S.glow && n.cls === S.glow) ? 1.8 : 1) * devicePixelRatio;
      ctx.stroke();
    } else {
      shape(ctx, d, r, clsColor(n.cls));
    }
    ctx.shadowBlur = 0;
    const showLb = star ? (n.lb || hi || nh) : (r > 7 * devicePixelRatio || hi || S.nodes.length < 46);
    if (showLb) {
      ctx.fillStyle = hi || nh ? fg : muted;
      ctx.font = `${star ? 600 : ''} ${(hi ? 12.5 : 11) * devicePixelRatio}px "Nanum Myeongjo", serif`.trim();
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
  {
    /* 성좌: 노드 = 에고 + 미니 패널, 빈 곳 = 언제나 전체 성좌로 복귀. */
    if (n) { S.focus = S.focus === n.id ? null : n.id; }
    else { S.focus = null; S.relKey = null; S.story = null; }
    if (!S.focus) $('#gPanel')?.setAttribute('hidden', '');
    else showPanel(n);
    document.querySelectorAll('#gTabs .gtab').forEach(b =>
      b.classList.toggle('on', !S.story && !S.relKey && b.dataset.k === ''));
    if (!S.relKey) document.querySelectorAll('#gRels .grel').forEach(b => b.classList.remove('on'));
    compute();
  }
}
