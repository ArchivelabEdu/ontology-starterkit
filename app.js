/* 정세균 구술기록 아카이브 — 코어
   graph.ttl → Oxigraph WASM(브라우저 내 SPARQL 1.1) → 히어로·지도·연표·언어 */
import init, { Store } from 'https://cdn.jsdelivr.net/npm/oxigraph@0.4.11/web.js';
import { initGraph, redrawGraph } from './graph.js';
import { initQuery } from './query.js';
import { initHero } from './hero.js';
import { initHero2 } from './hero2.js';
import { initRecord, rebuildRecord } from './record.js';

export const RICO = 'https://www.ica.org/standards/RiC/ontology#'
/* 전체 IRI 에서 우리 네임스페이스를 떼어 읽기 좋은 지역명으로. record.js 도 같은 일을 하지만
   거기 것은 모듈 안에 갇혀 있어 여기서 다시 둔다(순환 import 를 만들지 않기 위해). */
const RIC = 'http://archives.nanet.go.kr/id/'
export const short = u => (String(u).startsWith(RIC) ? String(u).slice(RIC.length) : String(u));
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

/* ── 페이지 라우팅 ──
   메뉴 한 항목이 곧 한 페이지다. 예전에는 전부 한 장에 쌓아 스크롤로 오갔는데,
   개체가 792개가 되면서 한 장이 너무 길어졌다. 이제 해시가 페이지를 고른다.
   기록(#/records)과 아이템(#/item/…)은 record.js 가 이미 제 페이지를 갖고 있으므로
   여기서는 손대지 않고 자리만 비켜 준다. */
const PAGES = ['place', 'event', 'graph-sec', 'query', 'lang', 'collection', 'about', 'pick'];
/* ── 주소 한 곳에서 읽기 ──
   주소가 두 겹이다. 앞은 어느 컬렉션 안인가, 뒤는 어느 화면인가.
     전체:      #place            #/records         #/item/<id>
     컬렉션 안:  #/c/<col>/place   #/c/<col>/records  #/item/<id>
   아이템은 컬렉션을 타지 않는다 — 한 기록의 상세는 어디서 왔든 같은 화면이다.
   파싱을 한 군데로 모아 둔 이유는, 예전에 화면마다 따로 해석하다가 「컬렉션 안에서 기록으로
   가면 컬렉션이 풀리는」 어긋남이 났기 때문이다. record.js 도 이걸 쓴다. */
export function parseHash() {
  let h = location.hash.replace(/^#/, '');
  let col = '';
  const m = h.match(/^\/c\/([^/]+)(.*)$/);
  if (m) { col = decodeURIComponent(m[1]); h = m[2].replace(/^\//, ''); }
  return { col, rest: h.replace(/^\//, '') };          // rest: '' | 'place' | 'records' | 'item/<id>'
}

/** 지금 컬렉션에 맞는 주소를 만든다. page 는 'place' · 'records' · '' 같은 알맹이만 준다. */
export function colHref(page) {
  const p = String(page).replace(/^[#/]+/, '');
  if (CUR.cols.length) {
    // 고른 것을 쉼표로 잇는다 — 주소만 건네면 상대도 같은 조합을 본다
    const key = CUR.cols.map(c => encodeURIComponent(short(c))).join(',');
    return `#/c/${key}` + (p ? '/' + p : '');
  }
  if (!p) return '';
  return (p === 'records' || p.startsWith('item/')) ? '#/' + p : '#' + p;
}
/** 메뉴·홈 색인 링크를 지금 컬렉션에 맞춰 다시 쓴다 — 컬렉션 안에서 메뉴를 눌러도 그 안에 머문다. */
function navHrefs() {
  document.querySelectorAll('#nav a[data-page], #homeIndex a[data-page]')
    .forEach(a => { a.href = colHref(a.dataset.page); });
}
const navMark = href => document.querySelectorAll('#nav a')
  .forEach(a => a.classList.toggle('on', a.getAttribute('href') === href));

function route() {
  const { col, rest } = parseHash();
  const want = col ? col.split(',').filter(Boolean) : [];
  const now = CUR.cols.map(c => short(c));
  if (want.join(',') !== now.join(',')) applyCollection(want);
  navHrefs();

  /* 아직 안 골랐으면 어느 화면으로 가든 고르는 자리로 돌린다.
     빈 지도·빈 연표를 보여 주면 「데이터가 없나」로 읽히지, 「아직 안 골랐다」로 읽히지 않는다. */
  if (!hasPick()) {
    document.documentElement.dataset.page = 'pick';
    document.body.classList.add('past-hero');
    navMark('');
    drawPicker();
    return;
  }

  // 기록·아이템은 record.js 가 자기 페이지를 갖고 있다 — 자리만 비켜 준다
  if (rest === 'records' || rest.startsWith('item/')) {
    document.documentElement.dataset.page = 'records';
    document.body.classList.add('past-hero');
    navMark(colHref('records'));
    return;
  }
  // 컬렉션 안에서 화면을 안 고르면 그 컬렉션의 컬렉션 페이지, 밖이면 홈
  const id = PAGES.includes(rest) ? rest : (CUR.cols.length ? 'collection' : 'home');
  document.documentElement.dataset.page = id;
  document.body.classList.toggle('past-hero', id !== 'home');
  navMark(id === 'home' ? '' : colHref(id));
  scrollTo({ top: 0 });
  /* 숨어 있는 동안 컨테이너 크기가 0이라 지도·캔버스·연표가 제대로 안 그려진다.
     보이게 된 뒤 다시 재라고 알려 준다 — 전체화면 전환 때와 같은 이유다.
     rAF 가 아니라 setTimeout 을 쓴다: 배경 탭에서는 rAF 가 아예 돌지 않아
     링크를 새 탭으로 연 사람은 그 탭을 볼 때까지 캔버스가 1px 인 채로 남는다. */
  setTimeout(() => {
    if (id === 'place' && MAP.map) MAP.map.invalidateSize();
    if (id === 'event') renderTimeline();
    if (id === 'graph-sec') redrawGraph();
    if (id === 'lang') drawLang();
    if (id === 'collection') drawCollection();
  }, 60);
}
addEventListener('hashchange', route);

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
  route();
};

addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('section.fs');
  if (open) window.fullscreen(open.id);
});
addEventListener('scroll', () => {
  if (document.documentElement.dataset.page !== 'home') return;
  const hz = document.getElementById('heroZone');
  if (hz) document.body.classList.toggle('past-hero', hz.getBoundingClientRect().bottom < 80);
}, { passive: true });

/* ══════════ 이번 발행본의 이름 ══════════
   collection.json 은 **이번에 받은 발행본 한 건의 이름표**다. 컬렉션 자체는 이제 그래프 안에
   개체로 들어와 있고(위 buildCollections), 이 파일은 「방금 누가 무엇을 언제 내보냈는가」만 말한다.

   예전에는 컬렉션이 이 파일 한 줄이 전부였다 — 그때는 개체가 누구 것인지 알 길이 없어
   한 팀만 걷어낼 수 없었다. 지금은 소속이 개체마다 찍혀 나오므로 이 파일은 보조 표시로 남았다.

   **파일이 없는 것은 오류가 아니다.** 컬렉션 개념이 들어오기 전에 발행된 데이터라는 뜻이므로
   기본 컬렉션으로 읽고 그 사실을 화면에 적는다. 이 규칙 덕분에 옛 발행본도 그대로 뜬다.
   기본값은 관리 시스템 쪽 DEFAULT_COLLECTION 과 같은 '미분류' 로 맞춘다 — 특정 구술자 이름을
   기본값에 두면 이름을 안 적은 발행이 남의 컬렉션에 섞여 들어간다. */
export const DEFAULT_COLLECTION = '미분류';
export const COL = { name: DEFAULT_COLLECTION, publishedAt: '', publishedByName: '', declared: false };

async function loadCollection() {
  try {
    const r = await fetch('data/collection.json', { cache: 'no-cache' });
    if (!r.ok) return;                    // 404 — 도입 이전 발행본. 기본값을 그대로 쓴다.
    const j = await r.json();
    const name = String(j.collection ?? '').trim();
    if (!name) return;                    // 이름이 비어 있으면 지어내지 않고 기본값을 둔다
    COL.name = name;
    COL.declared = true;
    COL.publishedAt = String(j.publishedAt ?? '');
    COL.publishedByName = String(j.publishedByName ?? j.publishedBy ?? '');
  } catch { /* 파일이 깨져 있어도 사이트는 기본 컬렉션으로 계속 뜬다 */ }
}

/* 컬렉션 목록 — 발행본이 여럿 쌓인 사이트의 첫 화면.
   한 화면에 다 펼치지 않고 **하나를 골라 들어가게** 한다. 열 팀이 쌓이면 전체 보기는
   개체가 수천이 되어 관계망이 뭉개지고, 무엇을 보고 있는지도 흐려진다. */
/* ── 컬렉션 고르기 ──
   여러 팀이 한 사이트에 발행하면 전부 합친 그래프는 개체가 수천이라 관계망이 뭉개지고
   무엇을 보는지도 흐려진다. 그래서 **고르고 나서 들어간다.**
   고른 조합은 주소에 실리므로(#/c/a,b) 「우리 팀 것 보세요」로 링크를 건넬 수 있다. */
function pickerHtml(inPage) {
  const cls = c => {
    const cnt = new Map();
    ALL.nodes.forEach(n => { if (c.members.has(n.id)) cnt.set(n.cls, (cnt.get(n.cls) || 0) + 1); });
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, v]) => `${CLS[k]?.ko || k} ${v}`).join(' · ');
  };
  const on = new Set(CUR.cols);
  return `
    <div class="col-grid">
      ${COLS.map(c => `<button class="col-card${on.has(c.id) ? ' on' : ''}" onclick="togglePick('${esc(short(c.id))}')">
        <b>${esc(c.title)}</b><span>${esc(cls(c))}</span>
        <i>개체 ${c.n}${on.has(c.id) ? ' · 고름' : ''}</i></button>`).join('')}
    </div>
    <div class="pick-bar">
      <button class="btn primary" id="pickGo" onclick="goPicked()" ${PICK.size ? '' : 'disabled'}>
        ${PICK.size ? `고른 ${PICK.size}건으로 보기 →` : '컬렉션을 고르세요'}</button>
      <button class="btn sm" onclick="pickAll()">전부 고르기</button>
      ${PICK.size ? `<button class="btn sm" onclick="pickNone()">지우기</button>` : ''}
      ${inPage && CUR.cols.length ? `<span class="status">지금 보는 것 — ${CUR.cols.map(c =>
        esc(COLS.find(x => x.id === c)?.title ?? '')).join(' · ')}</span>` : ''}
    </div>`;
}

/* 고르는 중인 것은 화면 상태고, CUR.cols 는 실제로 적재된 것이다. 둘을 나눠 두면
   여러 개를 눌러 놓고 마지막에 한 번만 그래프를 다시 만든다 — 누를 때마다 다시 만들면
   개체 수천 건에서 화면이 멈춘다. */
const PICK = new Set();
window.togglePick = id => { PICK.has(id) ? PICK.delete(id) : PICK.add(id); repaintPicker(); };
window.pickAll = () => { COLS.forEach(c => PICK.add(short(c.id))); repaintPicker(); };
window.pickNone = () => { PICK.clear(); repaintPicker(); };
window.goPicked = () => { if (PICK.size) location.hash = `#/c/${[...PICK].map(encodeURIComponent).join(',')}`; };
function repaintPicker() {
  const host = $('#pickBody') || $('#colBody');
  if (host) host.innerHTML = pickerHtml(host.id === 'colBody');
}

/** 첫 화면 — 안내와 고르기. 아직 아무것도 안 고른 상태에서 뜬다. */
function drawPicker() {
  PICK.clear();
  CUR.cols.forEach(c => PICK.add(short(c)));
  $('#pickBody').innerHTML = pickerHtml(false);
}

/** 컬렉션 페이지 — 지금 보는 조합을 바꾸는 자리. */
function drawCollectionList() {
  PICK.clear();
  CUR.cols.forEach(c => PICK.add(short(c)));
  $('#colName').textContent = CUR.cols.length ? `${CUR.cols.length}건 고름` : `${COLS.length}건`;
  $('#colBody').innerHTML = `
    <p class="note">이 사이트에는 발행본이 <b>${COLS.length}건</b> 실려 있습니다.
      고른 것만 지도·연표·관계망·기록에 들어갑니다. 여럿을 고르면 <b>합쳐서</b> 봅니다 —
      두 구술자를 나란히 놓고 볼 때 씁니다.</p>
    ${pickerHtml(true)}
    <p class="note">컬렉션은 관리 시스템이 발행할 때 <code>rico:RecordSet</code> 개체로 그래프에 함께 실립니다.
      기록은 <code>rico:isOrWasIncludedIn</code> 으로 컬렉션에 <b>들어 있고</b>, 인물·사건·장소는
      <code>rico:isOrWasSubjectOf</code> 로 컬렉션의 <b>주제</b>가 됩니다 —
      <code>isOrWasIncludedIn</code> 의 domain 이 <code>Record</code> 라 인물을 그리로 이으면 도메인 위반이기 때문입니다.</p>`;
}

/* 컬렉션 페이지 — 이 사이트에 실린 발행본이 무엇을 담고 있는지.
   수는 전부 적재된 그래프에서 직접 센다(손으로 적으면 데이터를 갈아끼울 때 어긋난다).

   트리플 수는 적재할 때만 알 수 있어 모듈에 담아 둔다. 예전에는 인자로 받았는데,
   페이지 라우팅이 들어오면서 라우터가 인자 없이 부르게 되어 화면에 undefined 가 찍혔다. */
let TRIPLES = 0;
function drawCollection() {
  // 컬렉션이 여럿이면 목록을 낸다 — 여기서 하나를 골라 들어간다.
  if (COLS.length) { drawCollectionList(); return; }
  $('#colName').textContent = COL.name;
  const cnt = new Map();
  G.nodes.forEach(n => cnt.set(n.cls, (cnt.get(n.cls) || 0) + 1));
  const rowsHtml = [...cnt.entries()].sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<tr><td>${esc(CLS[c]?.ko || c)}</td>
      <td><code>rico:${esc(c)}</code></td><td style="text-align:right">${n}</td></tr>`).join('');
  $('#colBody').innerHTML = `
    <div class="panel" style="padding:1rem 1.2rem">
      ${COL.declared
      ? `<p>이 사이트에 실린 발행본은 컬렉션 <b>「${esc(COL.name)}」</b> 한 건입니다.
           ${COL.publishedAt ? `발행 시각 <code>${esc(COL.publishedAt)}</code>` : '발행 시각 기록 없음'}
           ${COL.publishedByName ? ` · 발행 주체 <b>${esc(COL.publishedByName)}</b>` : ' · 발행 주체 기록 없음'}.</p>
         <p class="note">발행 주체는 관리 시스템에 <b>로그인해 발행을 실행한 계정</b>입니다.
           검수를 승인한 사람은 여기에 적히지 않습니다 — 검수 화면에는 로그인이 없어 그 신원을 아무도 보증하지 않기 때문입니다.</p>`
      : `<p>이 발행본에는 컬렉션 표시 파일(<code>data/collection.json</code>)이 <b>없습니다</b>.
           오류가 아니라 컬렉션 개념이 들어오기 전에 발행된 데이터라는 뜻이라, 기본 컬렉션
           <b>「${esc(DEFAULT_COLLECTION)}」</b>으로 읽었습니다.</p>`}
      <p>개체 <b>${G.nodes.length}</b> · 관계 <b>${G.edges.length}</b> · 트리플 <b>${TRIPLES}</b></p>
    </div>
    <div class="panel" style="padding:.4rem 1.2rem 1rem;margin-top:1rem"><table>
      <tr><th>유형</th><th>RiC-O 클래스</th><th style="text-align:right">개체 수</th></tr>
      ${rowsHtml}
    </table></div>
    <p class="note" style="margin-top:1rem">유형별 목록은 <a href="#/records">기록</a> 페이지에서
      걸러 볼 수 있습니다.</p>`;
}

/* ══════════ 부팅 ══════════ */
async function boot() {
  try {
    await init();
    store = new Store();
    // 팀이 graph.ttl 을 고치고 새로고침해도 옛것이 뜨지 않게 매번 서버에 확인한다.
    // (ETag 로 검증만 하므로 안 바뀌었으면 304 — 실제 전송은 없다)
    store.load(await (await fetch('data/graph.ttl', { cache: 'no-cache' })).text(),
      { format: 'text/turtle', base_iri: 'http://archives.nanet.go.kr/id/' });
    /* 트리플 수는 SPARQL 로 센다. store.size 는 판에 따라 없거나 0 을 돌려주고(실측: 관리
       시스템이 발행한 그래프에서 0), `?? ` 는 0 을 갈아끼우지 못해 화면에 「트리플 0개」가 떴다.
       COUNT 는 어느 판에서나 같은 답을 준다. */
    const nT = Number(q(`SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }`)[0]?.get('n')?.value ?? 0);
    TRIPLES = nT;                      // 화면 여러 곳이 읽으므로 바로 담아 둔다

    await loadCollection();
    buildModel();
    $('#loadStatus').textContent =
      `그래프 적재 완료 — 트리플 ${TRIPLES}개 · 개체 ${G.nodes.length} · 관계 ${G.edges.length} · SPARQL 1.1 (Oxigraph WASM)`;
    $('#hsNode').textContent = G.nodes.length;
    $('#hsEdge').textContent = G.edges.length;
    $('#hsTriple').textContent = nT;
    // 구술이 다루는 범위는 '사건'의 연도다. 인물 생년(위키데이터에서 받아 온)까지
    // 세면 1913 같은 값이 끼어 수록 범위가 아닌 게 된다.
    const yrs = G.nodes.filter(n => n.cls === 'Event' || n.cls === 'Activity')
      .map(n => +String(n.date || '').slice(0, 4)).filter(y => y > 1900);
    $('#hsSpan').textContent = yrs.length ? `${Math.min(...yrs)}–${Math.max(...yrs)}` : '–';

    // 홈 색인의 숫자는 그래프에서 직접 센다 — 손으로 적으면 데이터를 갈아끼울 때 어긋난다
    $('#ixRec').textContent = `${G.nodes.length}건`;
    $('#ixGraph').textContent = `관계 ${G.edges.length}`;
    $('#ixCollection').textContent = COL.name;
    drawCollection();

    initHero(G);
    // 히어로 안(1: 입자 몰핑 / 2: 전면 이미지)은 저장된 선택을 따른다
    const hv = localStorage.getItem('kit-hero') || '1';
    document.documentElement.setAttribute('data-hero', hv);
    document.querySelectorAll('#heroSwap button')
      .forEach(b => b.classList.toggle('on', b.dataset.v === hv));
    if (hv === '2') initHero2();
    drawMap(); drawTimeline(); initGraph(G); initRecord(); initQuery(); drawLang();
    // 카드의 수는 그 페이지가 실제로 보여 주는 수를 그대로 따른다.
    // Place 클래스는 84개지만 지도에 뜨는 것은 좌표가 있는 44곳이다 — 84라고 적으면 거짓말이 된다.
    $('#ixPlace').textContent = `${$('#nPlace').textContent}곳`;
    $('#ixEvent').textContent = `${$('#nEvent').textContent}건`;
    route();
    /* 콘솔에서 들여다볼 수 있게 열어 둔다. 팀이 Claude Code 로 이 사이트를 고칠 때
       `KIT.G.nodes` · `KIT.COLS` 를 직접 찍어 보는 편이 훨씬 빠르다. */
    window.KIT = { G, ALL, COLS, CUR, short, applyCollection, q, rows };
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
  buildCollections();
  recount();
}

/* ══════════ 컬렉션 ══════════
   발행 시스템은 컬렉션을 rico:RecordSet 개체로 내고, 소속을 트리플로 잇는다.
     · 기록  → rico:isOrWasIncludedIn → 컬렉션   (domain=Record 라 기록만 들어갈 수 있다)
     · 그 외 → rico:isOrWasSubjectOf  → 컬렉션   (domain=Thing · RecordSet ⊑ RecordResource)
   인물을 isOrWasIncludedIn 으로 이으면 도메인 위반이라 속성이 둘로 갈렸다. 읽는 쪽에서는
   **목적어가 컬렉션인 것만** 소속으로 친다 — isOrWasSubjectOf 는 보통 개체→기록 관계로도 쓰인다.

   컬렉션 개체와 소속 트리플은 화면에서 걷어낸다. 컬렉션은 개체들과 나란한 이웃이 아니라
   담는 그릇이라, 관계망에 두면 모든 점이 달라붙은 거대한 허브가 하나 생길 뿐이다.

   **컬렉션이 하나도 없으면 지금까지와 똑같이 동작한다** — 관리 시스템에서 발행하기 전의
   손으로 만든 graph.ttl 이 그대로 뜬다. 컬렉션은 발행이 시작되면 켜진다. */
const COL_PRED = new Set(['isOrWasIncludedIn', 'isOrWasSubjectOf']);
export const ALL = { nodes: [], edges: [] };
export const COLS = [];              // [{ id, title, members:Set, n }]
/* 고른 컬렉션들. **빈 배열은 「아직 안 골랐다」는 뜻이지 「전체」가 아니다.**
   여러 팀이 한 사이트에 발행하면 전부 합친 그래프는 개체가 수천이라 아무것도 안 보인다.
   그래서 첫 화면에서 고르게 하고, 고르기 전에는 화면을 열지 않는다. */
export const CUR = { cols: [] };

function recount() {
  G.nodes.forEach(n => n.deg = 0);
  G.edges.forEach(e => { G.byId.get(e.s).deg++; G.byId.get(e.o).deg++; });
}

function buildCollections() {
  COLS.length = 0;
  const isCol = new Map();           // 컬렉션 id → 제목
  G.nodes.forEach(n => { if (n.cls === 'RecordSet' && short(n.id).startsWith('col-')) isCol.set(n.id, n.label); });
  if (isCol.size) {
    for (const [id, title] of isCol) COLS.push({ id, title, members: new Set([id]) });
    const by = new Map(COLS.map(c => [c.id, c]));
    G.edges.forEach(e => { if (COL_PRED.has(e.p) && by.has(e.o)) by.get(e.o).members.add(e.s); });
    COLS.forEach(c => { c.n = c.members.size - 1; });
    COLS.sort((a, b) => b.n - a.n || a.title.localeCompare(b.title));
  }
  // 컬렉션 개체와 소속 트리플은 화면 밖으로. 걷어낸 뒤를 전체(ALL)로 삼는다.
  ALL.nodes = G.nodes.filter(n => !isCol.has(n.id));
  ALL.edges = G.edges.filter(e => !(COL_PRED.has(e.p) && isCol.has(e.o)) && !isCol.has(e.s));
  applyCollection(CUR.cols, false);
}

/** 지금 볼 컬렉션들을 정한다. G 를 갈아끼우므로 이걸 읽는 모든 화면이 따라온다.
    여럿을 고르면 합집합이다 — 두 구술자를 나란히 보고 싶을 때 쓴다. */
export function applyCollection(ids, redraw = true) {
  const want = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
  const picked = COLS.filter(c => want.includes(c.id) || want.includes(short(c.id)));
  CUR.cols = picked.map(c => c.id);

  if (!COLS.length) {                       // 컬렉션이 없는 그래프 — 예전처럼 전부 보인다
    G.nodes = ALL.nodes.slice();
  } else if (!picked.length) {               // 아직 안 골랐다 — 비워 둔다
    G.nodes = [];
  } else {
    const keep = new Set();
    picked.forEach(c => c.members.forEach(m => keep.add(m)));
    G.nodes = ALL.nodes.filter(n => keep.has(n.id));
  }
  G.byId = new Map(G.nodes.map(n => [n.id, n]));
  G.edges = ALL.edges.filter(e => G.byId.has(e.s) && G.byId.has(e.o));
  recount();
  if (redraw) { drawMap(); drawTimeline(); initGraph(G); drawLang(); rebuildRecord(); }
}

/** 고른 것이 있는가. 컬렉션이 아예 없는 그래프는 「고를 것이 없으니 열려 있다」로 본다. */
export const hasPick = () => !COLS.length || CUR.cols.length > 0;


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

  /* 지도는 한 번만 만든다. 컬렉션을 바꾸면 drawMap 이 다시 불리는데, 그때마다 L.map 을 부르면
     Leaflet 이 "Map container is already initialized" 를 던진다. 그 예외가 라우터까지 타고 올라가면
     화면 전환이 통째로 멈춘다 — 실제로 그렇게 됐었다. 두 번째부터는 마커만 갈아 끼운다. */
  if (MAP.map) {
    MAP.markers.forEach(m => MAP.map.removeLayer(m));
    MAP.markers.clear();
    drawMarkers(ps);
    return;
  }
  MAP.map = L.map('map', { scrollWheelZoom: false, minZoom: 3, worldCopyJump: true })
    .setView([36.5, 127.8], 6);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
    { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }).addTo(MAP.map);
  MAP.map.on('click', () => MAP.map.scrollWheelZoom.enable());

  drawMarkers(ps);
}

/** 마커·목록·화면맞춤. 컬렉션이 바뀌면 지도는 두고 이것만 다시 한다. */
function drawMarkers(ps) {
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
const LANG = { mode: 'network', words: [], byChapter: [], paras: [] };
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
const VERB_TAIL = /(면서|았는데|었는데|는데|해서|했고|했지|했다|하고|하면|하는|한다|어요|아요|겠다|었다|았다|잖아|거예|거야|보면|보니|으면|했으면|하랴|이랴|니다|습니|더라)$/;
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
  LANG.paras = paras;
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
  { k: 'print', t: '문서 지문', note: '단락 × 어휘 히트맵. 칸을 누르면 그 단락에서 그 말이 나온 문장을 그대로 보여 줍니다.' },
  { k: 'tfidf', t: '단락별 특징어', note: '빈도가 아니라 그 단락에만 유난히 몰린 말을 뽑습니다(tf-idf). 무엇에 대한 대목인지가 드러납니다.' },
];
async function drawLang() {
  if (!LANG.words.length) await loadCorpus();
  $('#langSeg').innerHTML = LANG_MODES.map(m =>
    `<button class="${m.k === LANG.mode ? 'on' : ''}" onclick="setLang('${m.k}')">${m.t}</button>`).join('');
  $('#langNote').textContent = LANG_MODES.find(m => m.k === LANG.mode).note;
  const stage = $('#lang-stage');
  stage.innerHTML = '';
  if (!LANG.words.length) { stage.innerHTML = '<p class="status" style="padding:1rem">코퍼스 없음</p>'; return; }
  ({ network: langNetwork, flow: langFlow, print: langPrint, tfidf: langTfidf })[LANG.mode](stage);
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

/* 띠 이름이 서로 겹치던 문제를 고쳤다.
   ① 이름을 가운데 칸이 아니라 그 띠가 가장 두꺼운 칸에 놓는다
   ② 글자가 들어갈 만큼 두껍지 않은 띠는 안 적고 아래 범례로 보낸다
   ③ 그래도 가까이 붙은 것끼리는 세로로 밀어 떼어 놓는다 */
function langFlow(stage) {
  const W = 1000, H = 460, s = svgEl(stage, W, H);
  const top = LANG.words.slice(0, 12);
  const ch = LANG.byChapter;
  const series = top.map(w => ch.map(c => (c.freq[w.w] || 0) / Math.max(c.total, 1)));
  const nx = i => 60 + (i / Math.max(ch.length - 1, 1)) * (W - 110);
  const stackTop = ch.map((_, ci) => series.reduce((a, s2) => a + s2[ci], 0));
  const maxStack = Math.max(...stackTop, .001);
  const HH = H - 90;
  let acc = ch.map(() => 0);
  const bands = series.map((sv, si) => {
    const up = [], dn = [], thick = [];
    sv.forEach((v, ci) => {
      const y0 = H - 40 - (acc[ci] / maxStack) * HH;
      const y1 = H - 40 - ((acc[ci] + v) / maxStack) * HH;
      up.push([nx(ci), y1]); dn.unshift([nx(ci), y0]);
      thick.push({ ci, t: y0 - y1, mid: (y0 + y1) / 2 });
      acc[ci] += v;
    });
    const curve = pts => pts.map((p, i) => i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`).join('');
    const best = thick.reduce((a, b) => b.t > a.t ? b : a, thick[0]);
    return { d: curve(up) + curve(dn).replace('M', 'L') + 'Z', col: css(PAL[si % PAL.length]),
      label: top[si].w, x: nx(best.ci), y: best.mid, t: best.t };
  });
  const shown = bands.filter(b => b.t >= 12).sort((a, b) => a.y - b.y);
  const hidden = bands.filter(b => b.t < 12);
  for (let i = 1; i < shown.length; i++) {
    const a = shown[i - 1], b = shown[i];
    if (Math.abs(b.x - a.x) < 100 && b.y - a.y < 16) b.y = a.y + 16;
  }
  s.innerHTML = bands.map(p => `<path d="${p.d}" fill="${p.col}" opacity=".55"/>`).join('')
    + ch.map((c, i) => `<text x="${nx(i)}" y="${H - 18}" text-anchor="middle" font-size="11"
        fill="${css('--muted')}">${esc(c.label)}</text>`).join('')
    + shown.map(p => `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="12.5"
        font-family="var(--serif)" fill="${css('--fg')}" stroke="${css('--bg')}" stroke-width="3.2"
        paint-order="stroke" style="cursor:pointer" class="lw" data-w="${esc(p.label)}">${esc(p.label)}</text>`).join('');
  s.querySelectorAll('.lw').forEach(g => g.onclick = () => showWordSource(g.dataset.w));
  if (hidden.length) {
    const box = document.createElement('div');
    box.className = 'lang-legend';
    box.innerHTML = `<span class="status">띠가 얇아 이름을 못 적은 어휘</span> ` + hidden.map(b =>
      `<button class="lw" data-w="${esc(b.label)}"><i style="background:${b.col}"></i>${esc(b.label)}</button>`).join('');
    stage.appendChild(box);
    box.querySelectorAll('.lw').forEach(g => g.onclick = () => showWordSource(g.dataset.w));
  }
}

/* 칸을 누르면 그 단락에서 그 말이 나온 문장을 그대로 보여 준다.
   예전에는 왼쪽 어휘 이름만 눌렸고 칸에는 툴팁뿐이었다 — 정작 궁금한 것은 '이 칸이 왜 진한가'다. */
function langPrint(stage) {
  const top = LANG.words.slice(0, 22), ch = LANG.byChapter;
  const W = 1000, H = 460, s = svgEl(stage, W, H);
  const cw = (W - 150) / ch.length, rh = Math.min(16, (H - 70) / top.length);
  const max = Math.max(...top.map(w => Math.max(...ch.map(c => c.freq[w.w] || 0))), 1);
  s.innerHTML = top.map((w, ri) => ch.map((c, ci) => {
    const n = c.freq[w.w] || 0;
    return `<rect x="${140 + ci * cw}" y="${30 + ri * rh}" width="${cw - 2}" height="${rh - 2}"
      rx="2" fill="${css('--accent')}" opacity="${.06 + (n / max) * .9}" style="cursor:pointer"
      class="lw" data-w="${esc(w.w)}" data-p="${ci}"><title>${esc(w.w)} · ${esc(c.label)} · ${n}회 (눌러 보기)</title></rect>`;
  }).join('')).join('')
    + top.map((w, ri) => `<text x="132" y="${30 + ri * rh + rh * .72}" text-anchor="end" font-size="11"
        fill="${css('--fg')}" class="lw" style="cursor:pointer" data-w="${esc(w.w)}">${esc(w.w)}</text>`).join('')
    + ch.map((c, ci) => `<text x="${140 + ci * cw + cw / 2}" y="22" text-anchor="middle" font-size="10.5"
        fill="${css('--muted')}">${esc(c.label)}</text>`).join('');
  s.querySelectorAll('.lw').forEach(g => g.onclick = () =>
    showWordSource(g.dataset.w, g.dataset.p ? +g.dataset.p : null));
}

/* 단락별 특징어 — 빈도가 아니라 tf-idf. 빈도만 보면 어느 단락이든 '국회'가 1등이라
   단락끼리 구별이 안 된다. 그 단락에만 몰린 말을 뽑아야 무엇에 대한 대목인지 드러난다. */
function langTfidf(stage) {
  const ch = LANG.byChapter, N = ch.length, df = {};
  ch.forEach(c => Object.keys(c.freq).forEach(w => df[w] = (df[w] || 0) + 1));
  const cols = ch.map(c => ({
    c, sc: Object.entries(c.freq).filter(([, n]) => n >= 2)
      .map(([w, n]) => ({ w, n, s: (n / Math.max(c.total, 1)) * Math.log((N + 1) / (df[w] || 1)) }))
      .sort((a, b) => b.s - a.s).slice(0, 7),
  }));
  const maxS = Math.max(...cols.flatMap(x => x.sc.map(y => y.s)), 1e-9);
  stage.innerHTML = `<div class="lang-tfidf">${cols.map(({ c, sc }) => `<div>
    <h5>${esc(c.label)}</h5>
    ${sc.length ? sc.map(x => `<button class="lw" data-w="${esc(x.w)}" data-p="${c.i}"
      style="--v:${(x.s / maxS).toFixed(3)}">${esc(x.w)}<i>${x.n}</i></button>`).join('')
      : `<span class="status">두 번 이상 나온 말이 없습니다</span>`}
  </div>`).join('')}</div>`;
  stage.querySelectorAll('.lw').forEach(g => g.onclick = () =>
    showWordSource(g.dataset.w, g.dataset.p ? +g.dataset.p : null));
}

/* 어휘 하나를 누르면 그 문장을 그대로 보여 준다. 단락을 지정하면 그 단락만 본다.
   그리고 그 말이 그래프에 개체로 들어와 있는지까지 알려 준다 — 원문에 자주 나오는데
   그래프에 없다면, 그게 다음에 넣을 것이다. */
function showWordSource(w, pi) {
  const paras = LANG.paras || [];
  const src = pi == null ? paras.map((p, i) => ({ i, p })) : [{ i: pi, p: paras[pi] || '' }];
  const out = [];
  src.forEach(({ i, p }) => String(p).split(/(?<=[.!?])\s+|\n+/).forEach(sent => {
    if (sent.includes(w) && out.length < 6) out.push({ i, sent: sent.trim() });
  }));
  if (!out.length) src.forEach(({ i, p }) => {
    if (String(p).includes(w) && out.length < 3) out.push({ i, sent: String(p).slice(0, 160) + '…' });
  });
  const hl = s => esc(s).replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `<mark>${esc(w)}</mark>`);
  const inG = G.nodes.filter(n => n.label && n.label.includes(w)).slice(0, 4);
  $('#langNote').innerHTML = out.length
    ? `<b>“${esc(w)}”가 나온 대목</b>${pi == null ? '' : ` · ${pi + 1}단락`}<br>`
      + out.map(o => `<span style="display:block;margin:.35rem 0">${o.i + 1}단락 — ${hl(o.sent.slice(0, 220))}</span>`).join('')
      + (inG.length
        ? `<span style="display:block;margin-top:.5rem;color:var(--ok)">그래프에 있습니다 — `
          + inG.map(n => `<a href="#/item/${encodeURIComponent(String(n.id).replace('http://archives.nanet.go.kr/id/',''))}">${esc(n.label)}</a>`).join(', ')
          + `</span>`
        : `<span style="display:block;margin-top:.5rem;color:var(--bad)">이 말은 그래프에 개체로 없습니다.
             원문에 이만큼 나오는데 안 뽑았다면, 빠뜨린 것인지 뽑지 않기로 한 것인지 판단할 자리입니다.</span>`)
    : `“${esc(w)}” 원문을 찾지 못했습니다.`;
}

boot();
