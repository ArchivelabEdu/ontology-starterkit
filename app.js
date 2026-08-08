/* 정세균 구술기록 아카이브 — 코어
   graph.ttl → Oxigraph WASM(브라우저 내 SPARQL 1.1) → 히어로·지도·연표·언어 */
import init, { Store } from 'https://cdn.jsdelivr.net/npm/oxigraph@0.4.11/web.js';
import { initGraph, redrawGraph } from './graph.js';
import { initQuery } from './query.js';
import { initHero } from './hero.js';
import { initHero2 } from './hero2.js';
import { initRecord } from './record.js';

export const RICO = 'https://www.ica.org/standards/RiC/ontology#';
export const PFX = `PREFIX rico: <${RICO}>
PREFIX ric:  <http://archives.nanet.go.kr/id/>
PREFIX geo:  <http://www.w3.org/2003/01/geo/wgs84_pos#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl:  <http://www.w3.org/2002/07/owl#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
`;
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export let store = null;
export const G = { nodes: [], edges: [], byId: new Map() };

/* 클래스 표시 규칙 — 색 변수 · 도형 · 한글명 */
export const CLS = {
  Person:        { v: '--person',   shape: 'circle',   ko: '인물',   key: 'person' },
  CorporateBody: { v: '--org',      shape: 'square',   ko: '단체',   key: 'org' },
  Position:      { v: '--position', shape: 'diamond',  ko: '직위',   key: 'position' },
  Event:         { v: '--event',    shape: 'triangle', ko: '사건',   key: 'event' },
  Activity:      { v: '--activity', shape: 'triangle', ko: '활동',   key: 'activity' },
  Place:         { v: '--place',    shape: 'pin',      ko: '장소',   key: 'place' },
  Record:        { v: '--record',   shape: 'doc',      ko: '기록',   key: 'record' },
  RecordSet:     { v: '--record',   shape: 'doc',      ko: '기록집합', key: 'record' },
  Rule:          { v: '--rule',     shape: 'hex',      ko: '규칙',   key: 'rule' },
};
export const REL_KO = {
  occupiesOrOccupied: '재임 직위', isOrWasOccupiedBy: '재임자',
  existsOrExistedIn: '소속 단체', hasOrHadPosition: '소속 직위',
  isOrWasMemberOf: '소속', hasOrHadMember: '구성원',
  isOrWasParticipantIn: '참여', hasOrHadParticipant: '참여자',
  hasOrHadSubject: '주제', isOrWasSubjectOf: '주제인 기록',
  hasCreator: '생산자', hasAuthor: '면담자', hasPublisher: '발행처',
  isOrWasIncludedIn: '상위 기록집합', includesOrIncluded: '하위 기록',
  isAssociatedWithPlace: '관련 장소', isOrWasRegulatedBy: '적용 규칙',
  resultsOrResultedIn: '결과', isRelatedTo: '관련',
  hasOrHadInstantiation: '구현체', isOrWasInstantiationOf: '원기록',
};
export const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';
export const clsColor = c => css((CLS[c] || { v: '--muted' }).v);

/* ── SPARQL ── */
export function q(sparql) { return store.query(PFX + sparql); }
/** SELECT → [{var:값}]  (Oxigraph 바인딩 키는 '문자열'이다) */
export function rows(sparql) {
  const r = q(sparql);
  if (!r.length) return [];
  // OPTIONAL 때문에 행마다 바인딩된 변수가 다르다.
  // 첫 행의 키만 쓰면 첫 행에 없는 변수가 전부 사라진다 → 전 행의 합집합을 쓴다.
  const vars = new Set();
  r.forEach(b => { for (const k of b.keys()) vars.add(k); });
  return r.map(b => {
    const o = {};
    for (const v of vars) { const t = b.get(v); o[v] = t ? t.value : ''; }
    return o;
  });
}

/* ── 테마 ── */
window.toggleTheme = () => {
  const c = document.documentElement.getAttribute('data-theme');
  const n = c === 'dark' ? 'light' : c === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme:dark)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', n);
  localStorage.setItem('kit-theme', n);
  redrawGraph(); drawLang();
};
{ const t = localStorage.getItem('kit-theme'); if (t) document.documentElement.setAttribute('data-theme', t); }

/* ── 스크롤 스파이 ── */
function spy() {
  const ids = ['record', 'place', 'event', 'graph-sec', 'query', 'lang', 'about'];
  let cur = '';
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top < 140) cur = id;
  }
  document.querySelectorAll('#nav a').forEach(a =>
    a.classList.toggle('on', a.getAttribute('href') === '#' + cur));
  // 히어로를 지나면 1안/2안 토글을 숨긴다
  const hz = document.getElementById('heroZone');
  if (hz) document.body.classList.toggle('past-hero', hz.getBoundingClientRect().bottom < 80);
}

/* ── 전체화면 보기 ──
   섹션 하나를 화면 가득 띄운다. 지도·관계망은 캔버스라 크기가 바뀌면
   다시 재야 하므로 전환 뒤에 각자에게 알려 준다. */
window.fullscreen = id => {
  const el = document.getElementById(id);
  if (!el) return;
  const on = !el.classList.contains('fs');
  document.querySelectorAll('section.fs').forEach(s => s.classList.remove('fs'));
  el.classList.toggle('fs', on);
  document.body.classList.toggle('fs-on', on);
  el.querySelectorAll('.fs-btn').forEach(b => b.textContent = on ? '⤡ 닫기' : '⤢ 전체화면');
  setTimeout(() => {
    if (id === 'place' && MAP.map) MAP.map.invalidateSize();
    if (id === 'graph-sec') redrawGraph();
    if (id === 'lang') drawLang();
    if (id === 'event') renderTimeline();
  }, 60);
};
/** 사이트명을 누르면 어디에 있든 아카이브 첫 화면으로.
    기록 페이지·아이템 뷰·전체화면이 열려 있으면 먼저 닫는다. */
window.goHome = () => {
  document.querySelectorAll('section.fs').forEach(x => window.fullscreen(x.id));
  // 해시만 지우면 hashchange 가 안 뜨는 경우가 있어 상태도 직접 되돌린다
  history.replaceState('', '', location.pathname + location.search);
  document.documentElement.classList.remove('records-on');
  document.body.classList.remove('records-open', 'item-open');
  document.getElementById('itemView')?.classList.remove('on');
  scrollTo({ top: 0, behavior: 'smooth' });
};

addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('section.fs');
  if (open) window.fullscreen(open.id);
});
addEventListener('scroll', spy, { passive: true });

/* ══════════ 부팅 ══════════ */
async function boot() {
  try {
    await init();
    store = new Store();
    // 팀이 graph.ttl 을 고치고 새로고침해도 옛것이 뜨지 않게 매번 서버에 확인한다.
    // (ETag 로 검증만 하므로 안 바뀌었으면 304 — 실제 전송은 없다)
    store.load(await (await fetch('data/graph.ttl', { cache: 'no-cache' })).text(),
      { format: 'text/turtle', base_iri: 'http://archives.nanet.go.kr/id/' });
    const nT = store.size ?? [...store.match()].length;

    buildModel();
    $('#loadStatus').textContent =
      `그래프 적재 완료 — 트리플 ${nT}개 · 개체 ${G.nodes.length} · 관계 ${G.edges.length} · SPARQL 1.1 (Oxigraph WASM)`;
    $('#hsNode').textContent = G.nodes.length;
    $('#hsEdge').textContent = G.edges.length;
    $('#hsTriple').textContent = nT;
    // 구술이 다루는 범위는 '사건'의 연도다. 인물 생년(위키데이터에서 받아 온)까지
    // 세면 1913 같은 값이 끼어 수록 범위가 아닌 게 된다.
    const yrs = G.nodes.filter(n => n.cls === 'Event' || n.cls === 'Activity')
      .map(n => +String(n.date || '').slice(0, 4)).filter(y => y > 1900);
    $('#hsSpan').textContent = yrs.length ? `${Math.min(...yrs)}–${Math.max(...yrs)}` : '–';

    initHero(G);
    // 히어로 안(1: 입자 몰핑 / 2: 전면 이미지)은 저장된 선택을 따른다
    const hv = localStorage.getItem('kit-hero') || '1';
    document.documentElement.setAttribute('data-hero', hv);
    document.querySelectorAll('#heroSwap button')
      .forEach(b => b.classList.toggle('on', b.dataset.v === hv));
    if (hv === '2') initHero2();
    drawMap(); drawTimeline(); initGraph(G); initRecord(); initQuery(); drawLang();
    spy();
  } catch (e) {
    $('#loadStatus').textContent = '적재 실패: ' + e.message;
    console.error(e);
  }
}

/* 그래프를 화면용 모델로 */
function buildModel() {
  const nr = rows(`SELECT ?s ?c ?n ?d ?g ?lat ?lon ?k ?img ?imgsrc WHERE {
    ?s a ?c . OPTIONAL{?s rico:name ?n} OPTIONAL{?s rico:title ?n}
    OPTIONAL{?s rico:beginningDate ?d}
    OPTIONAL{?s rico:generalDescription ?g} OPTIONAL{?s rico:history ?g}
    OPTIONAL{?s rico:scopeAndContent ?g}
    OPTIONAL{?s geo:lat ?lat} OPTIONAL{?s geo:long ?lon}
    OPTIONAL{?s rdfs:comment ?k}
    OPTIONAL{?s foaf:depiction ?img} OPTIONAL{?s rdfs:label ?imgsrc} }`);
  // owl:sameAs 와 UUID 는 한 개체에 여럿 붙으므로 따로 모은다
  const same = new Map(), uu = new Map();
  rows(`SELECT ?s ?u WHERE { ?s owl:sameAs ?u }`).forEach(r => {
    if (!same.has(r.s)) same.set(r.s, []);
    same.get(r.s).push(r.u);
  });
  rows(`SELECT ?s ?i WHERE { ?s rico:identifier ?i . FILTER(STRSTARTS(?i,"urn:uuid:")) }`)
    .forEach(r => uu.set(r.s, r.i.slice(9)));
  const seen = new Map();
  nr.forEach(r => {
    const cls = r.c.split('#')[1];
    if (!CLS[cls]) return;
    const cur = seen.get(r.s);
    if (cur) {                       // 여러 OPTIONAL 로 중복 행이 나오므로 병합
      for (const f of ['n', 'd', 'g', 'lat', 'lon', 'k', 'img', 'imgsrc']) if (!cur[f] && r[f]) cur[f] = r[f];
      return;
    }
    seen.set(r.s, { ...r, cls });
  });
  G.nodes = [...seen.values()].map(r => ({
    id: r.s, cls: r.cls, label: r.n || r.s.split('/').pop(),
    date: r.d || '', desc: r.g || '', kind: r.k || '', img: r.img || '', imgSrc: r.imgsrc || '',
    lat: r.lat ? +r.lat : null, lon: r.lon ? +r.lon : null,
    same: same.get(r.s) || [], uuid: uu.get(r.s) || '',
  }));
  G.byId = new Map(G.nodes.map(n => [n.id, n]));
  const er = rows(`SELECT ?s ?p ?o WHERE {
    ?s ?p ?o . FILTER(isIRI(?o) && STRSTARTS(STR(?p), "${RICO}")) }`);
  G.edges = er.filter(e => G.byId.has(e.s) && G.byId.has(e.o))
    .map(e => ({ s: e.s, o: e.o, p: e.p.split('#')[1] }));
  G.nodes.forEach(n => n.deg = 0);
  G.edges.forEach(e => { G.byId.get(e.s).deg++; G.byId.get(e.o).deg++; });
}

/* ══════════ 지도 ══════════ */
const MAP = { map: null, markers: new Map(), filter: new Set(), tour: null, tourIdx: 0 };
/* 생애 따라가기 — 지도 위에서 읽는 여섯 장면.
   서술은 구술총서에서 그대로 가져온 사실만 쓴다. 각 막의 refs 는 그 장면이
   기대고 있는 개체이고, 눌러서 상세로 갈 수 있다. */
const STORY = {
  title: '진안에서 여의도까지',
  sub: '지도 위에서 따라가는 정세균의 여섯 장면',
  desc: '1950년 전북 진안의 산골에서 시작해 여의도 국회의사당까지 — '
      + '구술총서가 말한 자리들을 순서대로 밟아 갑니다.',
  acts: [
    { place: 'place-jinan', year: '1950', title: '산골에서 시작하다',
      narr: '전라북도 진안에서 태어났습니다. 아버지는 시골에서 약종상을 하며 면의원을 지냈고, '
          + '5대조 할아버지는 문과에 급제해 참판을 지냈다고 구술했습니다.',
      refs: ['agent-jsk'] },
    { place: 'place-jeonju', year: '1969', title: '전주로 나오다',
      narr: '가정 형편 때문에 전주공업고등학교에 들어갔다가, 대학 진학을 권한 한기창 선생님을 만나 '
          + '인문계인 신흥고등학교로 옮겨 졸업했습니다.',
      refs: [] },
    { place: 'place-korea-univ', year: '1973', title: '총학생회장이 되다',
      narr: '고려대학교 법과대학에 진학해 고대신문 기자를 거쳐 1973년 총학생회장에 당선되었습니다. '
          + '유신 체제에 반대하는 시위를 주도하다 성북서에 며칠 유치되기도 했습니다.',
      refs: ['event-student-pres', 'event-yushin'] },
    { place: 'place-newyork', year: '1978–1995', title: '기업인 정세균',
      narr: '제대 후 쌍용그룹 공채로 입사해 뉴욕지점 주재원으로 나갔고, '
          + '미국 페퍼다인대학교에서 경영학 석사를 마쳤습니다. 1995년 상무이사로 퇴사할 때까지 17년.',
      refs: ['org-ssangyong', 'event-pepperdine'] },
    { place: 'place-ssangyong', year: '1996', title: '정치를 시작하다',
      narr: '김대중 총재의 권유로 새정치국민회의에 입당해, 무주·진안·장수 선거구에서 '
          + '제15대 국회의원에 당선되었습니다. “새 시대, 새 정치, 새 인물”을 내걸었습니다.',
      refs: ['event-elected-15', 'org-nca', 'agent-kdj'] },
    { place: 'place-assembly', year: '2016–2018', title: '의사봉을 들다',
      narr: '제20대 국회 전반기 국회의장에 선출되었습니다. 재임 중 박근혜 대통령 탄핵소추안 '
          + '가결을 선포했고, 국회의원 특권 내려놓기와 국회 청소노동자 정규직 전환을 추진했습니다.',
      refs: ['pos-speaker-20-1', 'event-impeach-park', 'event-cleaner'] },
  ],
};
const TOUR = STORY.acts.map(a => a.place);

function placeNodes() {
  return G.nodes.filter(n => n.cls === 'Place' && n.lat != null);
}
function drawMap() {
  const ps = placeNodes();
  $('#nPlace').textContent = ps.length;
  const kinds = [...new Set(ps.map(p => p.kind).filter(Boolean))];
  MAP.filter = new Set(kinds);
  $('#mapChips').innerHTML =
    `<button class="chip on c-all" onclick="mapFilter('*')">전체</button>` +
    kinds.map(k => `<button class="chip on c-place" data-k="${esc(k)}" onclick="mapFilter('${esc(k)}')">
      <i class="dot"></i>${esc(k)}</button>`).join('');

  MAP.map = L.map('map', { scrollWheelZoom: false, minZoom: 3, worldCopyJump: true })
    .setView([36.5, 127.8], 6);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
    { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }).addTo(MAP.map);
  MAP.map.on('click', () => MAP.map.scrollWheelZoom.enable());

  ps.forEach(p => {
    const col = css('--place');
    const m = L.marker([p.lat, p.lon], {
      icon: L.divIcon({
        className: '', iconSize: [26, 34], iconAnchor: [13, 34],
        html: `<svg width="26" height="34" viewBox="0 0 26 34">
          <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z"
            fill="${col}" opacity=".9"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>`
      })
    }).addTo(MAP.map);
    const linked = G.edges.filter(e => e.o === p.id).length;
    m.bindPopup(`<b style="font-size:.95rem">${esc(p.label)}</b><br>
      <span style="color:#777;font-size:.8rem">${esc(p.kind)}${p.desc ? ' · ' + esc(p.desc) : ''}</span>
      ${linked ? `<br><span style="font-size:.78rem">연결된 기록·사건 ${linked}건</span>` : ''}`);
    m.on('click', () => selectPlace(p.id));
    MAP.markers.set(p.id, m);
  });
  renderMapList();
  fitMap();
}
const isKR = p => p.lat > 33 && p.lat < 39.5 && p.lon > 124 && p.lon < 132;
function fitMap() {
  let vis = placeNodes().filter(p => MAP.filter.has(p.kind));
  if (!vis.length) return;
  // 국내와 해외가 섞이면 세계 축척으로 물러나 한반도가 점이 된다.
  // 국내가 하나라도 있으면 국내에 맞추고, 해외는 목록·투어로 찾아간다.
  const kr = vis.filter(isKR);
  if (kr.length) vis = kr;
  MAP.map.fitBounds(L.latLngBounds(vis.map(p => [p.lat, p.lon])).pad(.25), { maxZoom: 11 });
}
window.mapFilter = k => {
  const ps = placeNodes();
  const kinds = [...new Set(ps.map(p => p.kind).filter(Boolean))];
  if (k === '*') MAP.filter = MAP.filter.size === kinds.length ? new Set() : new Set(kinds);
  else MAP.filter.has(k) ? MAP.filter.delete(k) : MAP.filter.add(k);
  document.querySelectorAll('#mapChips .chip').forEach(c => {
    const kk = c.dataset.k;
    c.classList.toggle('on', kk ? MAP.filter.has(kk) : MAP.filter.size === kinds.length);
  });
  ps.forEach(p => {
    const m = MAP.markers.get(p.id);
    if (!m) return;
    MAP.filter.has(p.kind) ? m.addTo(MAP.map) : MAP.map.removeLayer(m);
  });
  renderMapList(); fitMap();
};
const sid = u => String(u).replace('http://archives.nanet.go.kr/id/', '');

/** 이 장소에 걸린 개체들. 무엇이 걸렸는지가 장소의 뜻이다. */
function placeLinks(id) {
  const out = [];
  G.edges.forEach(e => {
    if (e.o === id) { const o = G.byId.get(e.s); if (o) out.push({ o, p: e.p }); }
    if (e.s === id) { const o = G.byId.get(e.o); if (o) out.push({ o, p: e.p }); }
  });
  return out.sort((a, b) => (b.o.deg || 0) - (a.o.deg || 0));
}
const entChip = (o, rel) => `<a class="chip ent-chip${o.img ? ' has-img' : ''}"
  href="#/item/${encodeURIComponent(sid(o.id))}" onclick="event.stopPropagation()"
  title="${esc(o.label)} 상세 보기">
  ${o.img ? `<img src="${esc(o.img)}" alt="" loading="lazy">`
          : `<i class="dot" style="background:${clsColor(o.cls)}"></i>`}
  ${esc(o.label)}${rel ? `<span class="rel">${esc(REL_KO[rel] || rel)}</span>` : ''}</a>`;

function renderMapList() {
  const vis = placeNodes().filter(p => MAP.filter.has(p.kind));
  $('#mapCount').textContent = vis.length;
  $('#mapItems').innerHTML = vis.map(p => {
    const links = placeLinks(p.id);
    return `<div class="mi${p.img ? ' has-img' : ''}" data-id="${esc(p.id)}"
        onclick="selectPlace('${esc(p.id)}')">
      ${p.img ? `<img class="mi-thumb" src="${esc(p.img)}" alt="" loading="lazy">`
              : `<i class="dot" style="background:var(--place)"></i>`}
      <div class="mi-body">
        <b>${esc(p.label)}</b>
        <span>${esc(p.kind)}${links.length ? ` · 연결 ${links.length}` : ''}</span>
        ${links.length ? `<div class="mi-chips">
          ${links.slice(0, 4).map(l => entChip(l.o, l.p)).join('')}
          ${links.length > 4 ? `<a class="chip more" href="#/item/${encodeURIComponent(sid(p.id))}"
             onclick="event.stopPropagation()">+${links.length - 4}</a>` : ''}
        </div>` : ''}
      </div></div>`;
  }).join('');
}
window.selectPlace = id => {
  const p = G.byId.get(id); if (!p) return;
  MAP.map.flyTo([p.lat, p.lon], 12, { duration: .8 });
  MAP.markers.get(id)?.openPopup();
  document.querySelectorAll('.mi').forEach(e => e.classList.toggle('on', e.dataset.id === id));
  document.querySelector(`.mi[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
};
/* ── 생애 따라가기 ──
   자동으로 넘어가던 것을 읽는 것으로 바꿨다. 2.6초마다 지도가 튀면 글을 읽을 수가 없다.
   인트로 → 막 카드 → 좌우 버튼(또는 ←/→ 키)으로 다음 자리. */
window.toggleTour = () => {
  const on = !document.body.classList.contains('story-on');
  document.body.classList.toggle('story-on', on);
  $('#tourBtn').textContent = on ? '■ 이야기 닫기' : '▶ 생애 따라가기';
  if (!on) { $('#storyLayer').innerHTML = ''; return; }
  MAP.act = -1;
  $('#storyLayer').innerHTML = `
    <div class="story-intro">
      <div class="si-inner">
        <div class="kicker">생애 따라가기 · ${STORY.acts.length}막</div>
        <h3>${esc(STORY.title)}</h3>
        <p class="sub">${esc(STORY.sub)}</p>
        <p class="desc">${esc(STORY.desc)}</p>
        <button class="btn primary" onclick="storyGo(0)">지도 위에서 시작 →</button>
        <button class="btn sm ghost" onclick="toggleTour()">닫기</button>
      </div>
    </div>`;
};

window.storyGo = i => {
  const n = STORY.acts.length;
  if (i < 0 || i >= n) { window.toggleTour(); return; }
  MAP.act = i;
  const a = STORY.acts[i];
  const pid = 'http://archives.nanet.go.kr/id/' + a.place;
  if (G.byId.has(pid)) selectPlace(pid);
  const refs = a.refs.map(r => G.byId.get('http://archives.nanet.go.kr/id/' + r))
    .filter(Boolean).map(o => entChip(o)).join('');
  $('#storyLayer').innerHTML = `
    <button class="story-arrow prev" ${i === 0 ? 'disabled' : ''}
      onclick="storyGo(${i - 1})" aria-label="이전">‹</button>
    <div class="story-card">
      <div class="act">제${i + 1}막 · ${n}막 중<em>${esc(a.year)}</em></div>
      <h4>${esc(a.title)}</h4>
      <p>${esc(a.narr)}</p>
      ${refs ? `<div class="chips refs">${refs}</div>` : ''}
      <div class="foot">
        <div class="prog"><i style="width:${(i + 1) / n * 100}%"></i></div>
        <button class="btn sm" onclick="toggleTour()">닫기</button>
      </div>
    </div>
    <button class="story-arrow next" onclick="storyGo(${i + 1})"
      aria-label="${i === n - 1 ? '끝내기' : '다음'}">${i === n - 1 ? '✓' : '›'}</button>`;
};

addEventListener('keydown', e => {
  if (!document.body.classList.contains('story-on') || MAP.act === undefined || MAP.act < 0) return;
  if (e.key === 'ArrowRight') window.storyGo(MAP.act + 1);
  if (e.key === 'ArrowLeft') window.storyGo(MAP.act - 1);
});

/* ══════════ 연표 ══════════ */
const TL = { filter: new Set() };
function eventNodes() {
  // 본문에서 추출한 사건에는 유형(rdfs:comment)이 없다. 빈 유형을 그대로 두면
  // 유형 필터에서 통째로 빠져 화면에 하나도 안 나온다. 제 이름을 붙여 준다.
  return G.nodes.filter(n => (n.cls === 'Event' || n.cls === 'Activity') && n.date)
    .map(n => ({ ...n, kind: n.kind || '구술 본문', year: +String(n.date).slice(0, 4) }))
    .filter(n => n.year > 1900).sort((a, b) => a.year - b.year);
}
function drawTimeline() {
  const evs = eventNodes();
  $('#nEvent').textContent = evs.length;
  const kinds = [...new Set(evs.map(e => e.kind).filter(Boolean))];
  TL.filter = new Set(kinds);
  $('#tlChips').innerHTML =
    `<button class="chip on c-all" onclick="tlFilter('*')">전체</button>` +
    kinds.map(k => `<button class="chip on c-event" data-k="${esc(k)}" onclick="tlFilter('${esc(k)}')">
      <i class="dot"></i>${esc(k)}</button>`).join('');
  renderTimeline();
}
const KIND_COLOR = {
  정치: '--event', 경제: '--person', 노동: '--place', 의정: '--rule',
  언론: '--record', 정당: '--org', 학창: '--activity', 학업: '--activity',
  직장: '--position', 기록: '--record',
};
function renderTimeline() {
  const evs = eventNodes().filter(e => TL.filter.has(e.kind));
  const track = $('#tlTrack'), axis = $('#tlAxis');
  if (!evs.length) { track.innerHTML = '<p class="status">표시할 사건이 없습니다.</p>'; return; }
  const y0 = Math.min(...evs.map(e => e.year)) - 2, y1 = Math.max(...evs.map(e => e.year)) + 2;

  /* 연도축을 그대로 쓰면 2016~18 세 해에 84건이 겹쳐 세로로 70줄씩 쌓인다.
     시간 순서는 지키되, 앞 사건과 너무 가까우면 오른쪽으로 밀어낸다.
     레인 4줄을 돌려 쓰므로 같은 줄의 이웃은 항상 MIN 만큼 떨어진다.
     대신 축이 등간격이 아니게 되므로, 연도 눈금도 밀린 좌표에서 다시 읽는다. */
  const LANES = 4, MIN = 132, BASE = Math.max(900, (y1 - y0) * 22);
  let prev = -1e9;
  const placed = evs.map((e, i) => {
    const x = Math.max(((e.year - y0) / (y1 - y0)) * BASE, prev + MIN / LANES);
    prev = x;
    return { ...e, x, lane: i % LANES };
  });
  const W = Math.ceil(prev + 160);
  axis.style.width = track.style.width = W + 'px';

  // 눈금은 밀린 좌표에서 다시 읽는다. 사건이 없는 구간에서는 여러 눈금이 한 점에
  // 겹치므로, 너무 가까우면 뒤엣것을 버린다.
  const ticks = [];
  for (let y = Math.ceil(y0 / 5) * 5; y <= y1; y += 5) {
    const at = placed.find(e => e.year >= y);
    const x = at ? at.x : W;
    if (ticks.length && x - ticks[ticks.length - 1].x < 46) continue;
    ticks.push({ y, x });
  }
  axis.innerHTML = '<div class="tl-line"></div>' +
    ticks.map(t => `<div class="yr" style="left:${t.x}px">${t.y}</div>`).join('');

  const H = 40;
  track.style.height = (LANES * H + 30) + 'px';
  track.innerHTML = placed.map(e => {
    const col = css(KIND_COLOR[e.kind] || '--muted');
    return `<div class="tl-ev" data-id="${esc(e.id)}" style="left:${e.x}px;top:0;color:${col}"
        onclick="tlDetail('${esc(e.id)}')">
      <div class="stem" style="height:${e.lane * H + 6}px"></div>
      <div class="bub${e.img ? ' has-img' : ''}" title="${esc(e.label)}">
        ${e.img ? `<img src="${esc(e.img)}" alt="" loading="lazy">` : ''}${esc(e.label)}</div>
      <div class="yr">${e.date}</div></div>`;
  }).join('');
}
window.tlFilter = k => {
  const kinds = [...new Set(eventNodes().map(e => e.kind).filter(Boolean))];
  if (k === '*') TL.filter = TL.filter.size === kinds.length ? new Set() : new Set(kinds);
  else TL.filter.has(k) ? TL.filter.delete(k) : TL.filter.add(k);
  document.querySelectorAll('#tlChips .chip').forEach(c => {
    const kk = c.dataset.k;
    c.classList.toggle('on', kk ? TL.filter.has(kk) : TL.filter.size === kinds.length);
  });
  renderTimeline();
};
/** 사건 하나를 눌렀을 때 아래에 펼치는 카드.
    칩은 장식이 아니라 **누르는 것**이다 — 그 개체의 상세로 간다. */
window.tlDetail = id => {
  const n = G.byId.get(id); if (!n) return;
  const sid = u => String(u).replace('http://archives.nanet.go.kr/id/', '');
  const rel = G.edges.filter(e => e.s === id || e.o === id).map(e => {
    const o = G.byId.get(e.s === id ? e.o : e.s);
    if (!o) return '';
    return `<a class="chip ent-chip${o.img ? ' has-img' : ''}"
        href="#/item/${encodeURIComponent(sid(o.id))}" title="${esc(o.label)} 상세 보기">
      ${o.img ? `<img src="${esc(o.img)}" alt="" loading="lazy">`
              : `<i class="dot" style="background:${clsColor(o.cls)}"></i>`}
      ${esc(o.label)}
      <span class="rel">${esc(REL_KO[e.p] || e.p)}</span></a>`;
  }).join('');
  $('#tlDetail').innerHTML = `<div class="panel tl-card">
    ${n.img ? `<figure class="cover"><img src="${esc(n.img)}" alt="">
        ${n.imgSrc ? `<figcaption>${esc(n.imgSrc)}</figcaption>` : ''}</figure>` : ''}
    <div class="body">
      <div class="head">
        <b>${esc(n.label)}</b>
        <span class="status">${esc(n.date)}${n.kind ? ' · ' + esc(n.kind) : ''}</span>
        <a class="btn sm" href="#/item/${encodeURIComponent(sid(n.id))}">상세 보기 →</a>
      </div>
      ${n.desc ? `<p>${esc(n.desc)}</p>` : ''}
      <div class="chips">${rel || '<span class="status">연결된 개체 없음</span>'}</div>
    </div>
  </div>`;
  $('#tlDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

/* ══════════ 언어 ══════════ */
const LANG = { mode: 'network', words: [], byChapter: [] };
const STOP = new Set(['그리고', '하지만', '그런데', '있는', '없는', '하는', '이런', '저런', '그런', '그래서',
  '것이', '것을', '것도', '거예요', '그때', '해서', '때문에', '우리', '저는', '제가', '많이', '아주',
  '이렇게', '그렇게', '어떻게', '무슨', '그러니까', '이제', '정말', '조금', '하나', '이런저런',
  '있었', '했어요', '하고', '그거', '뭐가', '이라고', '이라는', '라고', '한다는', '거는', '것은',
  // 형태소 분석기를 쓰지 않으므로 자주 남는 기능어를 직접 걷어낸다
  '밖에', '않고', '않은', '않았', '그건', '그게', '이게', '저게', '내가', '너무', '그냥', '가는', '오는',
  '되는', '되고', '됐다', '했다', '한다', '한테', '에게', '에서', '으로', '이나', '라도', '까지', '부터',
  '보다', '같은', '같이', '자기', '자꾸', '다시', '먼저', '나중', '당시', '그것', '이것', '저것', '무엇',
  '거기', '여기', '저기', '어디', '언제', '얼마', '동안', '가지', '정도', '경우', '이야기', '얘기',
  '생각', '사람', '이제는', '그때는', '인가', '있다', '없다', '싶은', '싶다', '주는', '주고',
  '전혀', '중에', '년에', '술을', '잔도', '말할', '먹어', '때는', '일이', '받는', '있고', '없고']);
/* 활용형 꼬리. 명사에는 거의 붙지 않는 것만 골랐다(제도·태도 같은 말을 지우지 않기 위해). */
const VERB_TAIL = /(면서|았는데|었는데|는데|해서|했고|했지|했다|하고|하면|하는|한다|어요|아요|겠다|었다|았다|잖아|거예|거야|보면|보니|으면|했으면|하랴|이랴)$/;
/* 조사를 떼어 낸다. 형태소 분석기가 없으므로 '뒤에서 한 번만, 남는 글자가 2자 이상일 때만'.
   '종이 → 종'(1자) 같은 오작동은 이 길이 조건이 막는다. */
const JOSA = ['으로써', '으로서', '에서는', '에게는', '이라는', '이라고', '까지도', '부터는',
  '에서', '에게', '으로', '까지', '부터', '이나', '라도', '한테', '보다', '처럼', '마다', '조차',
  '이란', '이든', '만큼', '이라', '에는', '에도', '와의', '과의', '의는',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '만', '요'];
function stem(w) {
  for (const j of JOSA) {
    if (w.length - j.length >= 2 && w.endsWith(j)) return w.slice(0, -j.length);
  }
  return w;
}

async function loadCorpus() {
  let text = '';
  try { text = await (await fetch('data/corpus.txt', { cache: 'no-cache' })).text(); } catch (e) { }
  const paras = text.split(/\n\s*\n/).filter(p => p.trim());
  const tok = t => (t.match(/[가-힣]{2,}/g) || [])
    .map(stem).filter(w => w.length >= 2 && !STOP.has(w) && !VERB_TAIL.test(w));
  const freq = {};
  paras.forEach(p => tok(p).forEach(w => freq[w] = (freq[w] || 0) + 1));
  LANG.words = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 70)
    .map(([w, n]) => ({ w, n }));
  // 단락(≈회차) × 어휘
  LANG.byChapter = paras.map((p, i) => {
    const f = {}; tok(p).forEach(w => f[w] = (f[w] || 0) + 1);
    return { i, label: `${i + 1}단락`, freq: f, total: tok(p).length };
  });
  // 동시출현 (같은 문장)
  const co = new Map();
  paras.forEach(p => p.split(/[.!?]\s/).forEach(sent => {
    const ws = [...new Set(tok(sent))].filter(w => LANG.words.some(x => x.w === w));
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const k = [ws[i], ws[j]].sort().join(' ');
      co.set(k, (co.get(k) || 0) + 1);
    }
  }));
  LANG.co = [...co.entries()].map(([k, n]) => { const [a, b] = k.split(' '); return { a, b, n }; })
    .filter(e => e.n >= 1).sort((x, y) => y.n - x.n).slice(0, 120);
}

const LANG_MODES = [
  { k: 'network', t: '어휘 관계망', note: '같은 문장에 함께 나온 어휘를 선으로 이었습니다. 원 크기는 빈도, 색은 군집. 단어를 누르면 그 단어가 들어간 원문이 뜹니다.' },
  { k: 'flow', t: '시간대별 흐름', note: '단락 순서를 가로축으로, 어휘 비중을 쌓아 흐르는 띠로 그렸습니다. 관심사가 어떻게 이동하는지 보입니다.' },
  { k: 'print', t: '문서 지문', note: '단락 × 어휘 히트맵. 어느 대목에 무슨 말이 집중됐는지 한눈에 보입니다.' },
];
async function drawLang() {
  if (!LANG.words.length) await loadCorpus();
  $('#langSeg').innerHTML = LANG_MODES.map(m =>
    `<button class="${m.k === LANG.mode ? 'on' : ''}" onclick="setLang('${m.k}')">${m.t}</button>`).join('');
  $('#langNote').textContent = LANG_MODES.find(m => m.k === LANG.mode).note;
  const stage = $('#lang-stage');
  stage.innerHTML = '';
  if (!LANG.words.length) { stage.innerHTML = '<p class="status" style="padding:1rem">코퍼스 없음</p>'; return; }
  ({ network: langNetwork, flow: langFlow, print: langPrint })[LANG.mode](stage);
}
window.setLang = k => { LANG.mode = k; drawLang(); };

function svgEl(stage, w, h) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  stage.appendChild(s); return s;
}
const PAL = ['--person', '--org', '--place', '--event', '--position', '--rule'];

function langNetwork(stage) {
  const W = 1000, H = 460, s = svgEl(stage, W, H);
  const idx = new Map(LANG.words.map((w, i) => [w.w, i]));
  const N = LANG.words.map((w, i) => ({
    ...w, x: W / 2 + Math.cos(i * 2.4) * (120 + (i % 9) * 32),
    y: H / 2 + Math.sin(i * 2.4) * (90 + (i % 7) * 26), vx: 0, vy: 0,
  }));
  const E = LANG.co.filter(e => idx.has(e.a) && idx.has(e.b))
    .map(e => ({ a: N[idx.get(e.a)], b: N[idx.get(e.b)], n: e.n }));
  const max = LANG.words[0].n;
  for (let it = 0; it < 220; it++) {          // 간단한 힘 배치
    E.forEach(e => {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - 70) * 0.006 * Math.min(e.n, 3);
      e.a.vx += dx / d * f; e.a.vy += dy / d * f; e.b.vx -= dx / d * f; e.b.vy -= dy / d * f;
    });
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const dx = N[j].x - N[i].x, dy = N[j].y - N[i].y, d2 = dx * dx + dy * dy || 1;
      const f = 900 / d2;
      const d = Math.sqrt(d2);
      N[i].vx -= dx / d * f; N[i].vy -= dy / d * f; N[j].vx += dx / d * f; N[j].vy += dy / d * f;
    }
    N.forEach(n => {
      n.vx += (W / 2 - n.x) * 0.0016; n.vy += (H / 2 - n.y) * 0.0016;
      n.x += n.vx *= .82; n.y += n.vy *= .82;
      n.x = Math.max(40, Math.min(W - 40, n.x)); n.y = Math.max(24, Math.min(H - 24, n.y));
    });
  }
  s.innerHTML = E.map(e => `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}"
      stroke="${css('--line')}" stroke-width="${Math.min(e.n, 3)}" opacity=".55"/>`).join('')
    + N.map((n, i) => {
      const r = 5 + (n.n / max) * 20, col = css(PAL[i % PAL.length]);
      return `<g class="lw" style="cursor:pointer" data-w="${esc(n.w)}">
        <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${col}" opacity=".22"/>
        <circle cx="${n.x}" cy="${n.y}" r="${r * .45}" fill="${col}"/>
        <text x="${n.x}" y="${n.y - r - 4}" text-anchor="middle" font-size="${11 + (n.n / max) * 9}"
          font-family="var(--serif)" fill="${css('--fg')}">${esc(n.w)}</text></g>`;
    }).join('');
  s.querySelectorAll('.lw').forEach(g => g.onclick = () => showWordSource(g.dataset.w));
}

function langFlow(stage) {
  const W = 1000, H = 460, s = svgEl(stage, W, H);
  const top = LANG.words.slice(0, 12);
  const ch = LANG.byChapter;
  const series = top.map(w => ch.map(c => (c.freq[w.w] || 0) / Math.max(c.total, 1)));
  const nx = i => 60 + (i / Math.max(ch.length - 1, 1)) * (W - 110);
  const stackTop = ch.map((_, ci) => series.reduce((a, s2) => a + s2[ci], 0));
  const maxStack = Math.max(...stackTop, .001);
  let acc = ch.map(() => 0);
  const paths = series.map((sv, si) => {
    const up = [], dn = [];
    sv.forEach((v, ci) => {
      const y0 = H - 40 - (acc[ci] / maxStack) * (H - 90);
      const y1 = H - 40 - ((acc[ci] + v) / maxStack) * (H - 90);
      up.push([nx(ci), y1]); dn.unshift([nx(ci), y0]); acc[ci] += v;
    });
    const curve = pts => pts.map((p, i) => i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`).join('');
    const col = css(PAL[si % PAL.length]);
    const mid = up[Math.floor(up.length / 2)];
    return { d: curve(up) + curve(dn).replace('M', 'L') + 'Z', col, label: top[si].w, mid };
  });
  s.innerHTML = paths.map(p => `<path d="${p.d}" fill="${p.col}" opacity=".55"/>`).join('')
    + ch.map((c, i) => `<text x="${nx(i)}" y="${H - 18}" text-anchor="middle" font-size="11"
        fill="${css('--muted')}">${esc(c.label)}</text>`).join('')
    + paths.map(p => `<text x="${p.mid[0]}" y="${p.mid[1] + 12}" text-anchor="middle" font-size="12"
        font-family="var(--serif)" fill="${css('--fg')}" style="cursor:pointer"
        class="lw" data-w="${esc(p.label)}">${esc(p.label)}</text>`).join('');
  s.querySelectorAll('.lw').forEach(g => g.onclick = () => showWordSource(g.dataset.w));
}

function langPrint(stage) {
  const top = LANG.words.slice(0, 22), ch = LANG.byChapter;
  const W = 1000, H = 460, s = svgEl(stage, W, H);
  const cw = (W - 150) / ch.length, rh = Math.min(16, (H - 70) / top.length);
  const max = Math.max(...top.map(w => Math.max(...ch.map(c => c.freq[w.w] || 0))), 1);
  s.innerHTML = top.map((w, ri) => ch.map((c, ci) => {
    const v = (c.freq[w.w] || 0) / max;
    return `<rect x="${140 + ci * cw}" y="${30 + ri * rh}" width="${cw - 2}" height="${rh - 2}"
      rx="2" fill="${css('--accent')}" opacity="${.06 + v * .9}"><title>${esc(w.w)} · ${esc(c.label)} · ${c.freq[w.w] || 0}회</title></rect>`;
  }).join('')).join('')
    + top.map((w, ri) => `<text x="132" y="${30 + ri * rh + rh * .72}" text-anchor="end" font-size="11"
        fill="${css('--fg')}" class="lw" style="cursor:pointer" data-w="${esc(w.w)}">${esc(w.w)}</text>`).join('')
    + ch.map((c, ci) => `<text x="${140 + ci * cw + cw / 2}" y="22" text-anchor="middle" font-size="10.5"
        fill="${css('--muted')}">${esc(c.label)}</text>`).join('');
  s.querySelectorAll('.lw').forEach(g => g.onclick = () => showWordSource(g.dataset.w));
}

async function showWordSource(w) {
  let text = '';
  try { text = await (await fetch('data/corpus.txt', { cache: 'no-cache' })).text(); } catch (e) { }
  const hits = text.split(/\n\s*\n/).map((p, i) => ({ i, p }))
    .filter(x => x.p.includes(w)).slice(0, 3);
  $('#langNote').innerHTML = hits.length
    ? `<b>“${esc(w)}”가 나온 대목</b><br>` + hits.map(h =>
      `<span style="display:block;margin:.35rem 0">${h.i + 1}단락 — ${esc(h.p.slice(0, 150))
        .replace(new RegExp(esc(w), 'g'), `<mark>${esc(w)}</mark>`)}…</span>`).join('')
    : `“${esc(w)}” 원문을 찾지 못했습니다.`;
}

boot();
