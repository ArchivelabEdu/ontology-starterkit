/* 정세균 구술기록 아카이브 — 코어
   graph.ttl → Oxigraph WASM(브라우저 내 SPARQL 1.1) → 히어로·지도·연표·언어 */
import init, { Store } from 'https://cdn.jsdelivr.net/npm/oxigraph@0.4.11/web.js';
import { initGraph, redrawGraph } from './graph.js';
import { initQuery } from './query.js';
import { initHero } from './hero.js';
import { initHero2 } from './hero2.js';
import { initRecord, rebuildRecord } from './record.js';

export const RICO = 'https://www.ica.org/standards/RiC/ontology#'
/* 시소러스는 RiC-O 밖에서 온다 — 개념의 이름도 계층도 전부 SKOS 술어에 있다. */
export const SKOS = 'http://www.w3.org/2004/02/skos/core#'
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
PREFIX skos: <${SKOS}>
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
  /* 개념은 실재하지 않는다 — 그래서 테두리를 점선으로 둔다. 다른 여덟은 전부 실선이다.
     색을 하나 더 쓰지만 이건 장식이 아니라 「이건 관념이다」라는 정보다. */
  Concept:       { v: '--concept',  shape: 'dcircle',  ko: '개념',   key: 'concept' },
  ConceptScheme: { v: '--concept',  shape: 'dcircle',  ko: '개념체계', key: 'concept' },
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
const PAGES = ['place', 'event', 'graph-sec', 'subject', 'query', 'lang', 'collection', 'about', 'pick'];
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
  /* 아이템 주소에는 컬렉션 접두가 없다(위 주석: 한 기록의 상세는 어디서 왔든 같은 화면이다).
     그런데 그 「없음」을 「아무것도 안 골랐다」로 읽으면, 컬렉션 안에서 개체 링크를 누르는
     순간 골라 둔 것이 통째로 풀린다 — 지도·연표·관계망·주제·컬렉션 화면의 링크가 다 이
     모양이라 거기서 개체로 들어가면 그래프가 비고 「그런 개체가 없습니다」가 떴다.
     접두 없는 아이템 주소에서는 컬렉션을 건드리지 않는다. */
  const bareItem = !col && rest.startsWith('item/');
  if (!bareItem && want.join(',') !== now.join(',')) applyCollection(want);
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
    if (id === 'place' && MAP.map) {
      MAP.map.invalidateSize();
      /* 사용자가 지도를 건드리기 전까지는 들어올 때마다 다시 맞춘다.
         「한 번만」으로 두면 그 한 번이 어긋났을 때(레이아웃이 덜 잡힌 순간) 그대로 굳는다 —
         실측으로 그랬다: 어떤 판에서는 줌 7, 어떤 판에서는 6 으로 갈렸다.
         옮기거나 확대한 뒤에는 손대지 않는다: 봐 두던 자리가 튕겨 나가면 안 된다. */
      if (!MAP.touched) fitMap();
    }
    if (id === 'event') renderTimeline();
    if (id === 'graph-sec') redrawGraph();
    if (id === 'lang') drawLang();
    if (id === 'subject') drawSubjects();
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
/* 초상 듀오톤 — 사진이 없어도 컬렉션마다 얼굴을 준다. 화강암 톤 네 벌을 돌려 쓴다. */
const FACE_DUO = ['#9aa09e,#3a3f3e', '#a3a8a5,#434846', '#929794,#333837', '#abb0ad,#4a4f4d'];

function pickerHtml(inPage) {
  const cls = c => {
    const cnt = new Map();
    ALL.nodes.forEach(n => { if (c.members.has(n.id)) cnt.set(n.cls, (cnt.get(n.cls) || 0) + 1); });
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, v]) => `${CLS[k]?.ko || k} ${v}`).join(' · ');
  };
  /* 고른 것의 개체 수는 **합이 아니라 합집합**이다. 두 구술자가 같은 인물을 말하면
     그 인물은 양쪽 컬렉션에 들어 있어, 더하면 실제보다 부풀어 보인다. */
  const picked = COLS.filter(c => PICK.has(short(c.id)));
  const self = new Set(COLS.map(c => c.id));   // members 에는 컬렉션 개체 자신도 들어 있다
  const uni = new Set();
  picked.forEach(c => c.members.forEach(m => { if (!self.has(m)) uni.add(m); }));
  return `
    <div class="picker" data-inpage="${inPage ? 1 : 0}">
    <div class="col-grid">
      ${COLS.map((c, fi) => `<button class="col-card${PICK.has(short(c.id)) ? ' on' : ''}"
        aria-pressed="${PICK.has(short(c.id))}" onclick="togglePick('${esc(short(c.id))}')">
        <span class="col-face" aria-hidden="true"
          style="background:linear-gradient(160deg,${FACE_DUO[fi % FACE_DUO.length]})">${esc((c.title || '?').trim()[0])}</span>
        <b>${esc(c.title)}</b><span>${esc(cls(c))}</span>
        <i>개체 ${c.n}</i></button>`).join('')}
    </div>
    <div class="pick-bar">
      <button class="btn primary" onclick="goPicked()" ${PICK.size ? '' : 'disabled'}>선택</button>
      <button class="btn sm" onclick="pickAll()">전체</button>
      <!-- 지금 뭐라도 켜져 있으면(체크됐거나 이미 적재됐거나) 해제할 게 있다.
           체크만 0이고 CUR.cols 는 아직 안 지워졌을 수 있다 — 카드를 손으로 눌러 마지막
           하나를 껐을 때가 그렇다. 그 경우에도 해제가 눌려야 실제로 내려간다. -->
      <button class="btn sm" onclick="pickNone()" ${(PICK.size || CUR.cols.length) ? '' : 'disabled'}>해제</button>
      <span class="status">${[
        inPage && CUR.cols.length
          ? `지금 보는 것 ${CUR.cols.map(c => esc(COLS.find(x => x.id === c)?.title ?? '')).join(', ')}`
          : '',
        PICK.size ? `${PICK.size}건 · 개체 ${uni.size}`
          : inPage ? '카드를 눌러 바꾸세요' : '카드를 눌러 컬렉션을 고르세요',
      ].filter(Boolean).join(' · ')}</span>
    </div></div>`;
}

/* 고르는 중인 것은 화면 상태고, CUR.cols 는 실제로 적재된 것이다. 둘을 나눠 두면
   여러 개를 눌러 놓고 마지막에 한 번만 그래프를 다시 만든다 — 누를 때마다 다시 만들면
   개체 수천 건에서 화면이 멈춘다. */
const PICK = new Set();
window.togglePick = id => { PICK.has(id) ? PICK.delete(id) : PICK.add(id); repaintPicker(); };
window.pickAll = () => { COLS.forEach(c => PICK.add(short(c.id))); repaintPicker(); };
/* 예전엔 여기서 체크만 지우고 끝났다 — 실제로 적재된 것(CUR.cols · G)은 그대로 남아,
   화면은 「다 해제됨」인데 그래프는 계속 떠 있는 어긋남이 났다(기록·지도·관계망 어디를 봐도
   그대로). 「해제」는 보류 없이 **그 자리에서 바로 반영**되어야 하는 동작이라, 체크만 지우지 않고
   빈 컬렉션으로 즉시 이동한다 — hasPick() 이 false 가 되어 route() 가 고르는 화면으로 돌려보낸다. */
window.pickNone = () => { PICK.clear(); location.hash = '#/'; };
window.goPicked = () => { location.hash = PICK.size ? `#/c/${[...PICK].map(encodeURIComponent).join(',')}` : '#/'; };
/* 같은 고르개가 두 자리에 있다 — 첫 화면(#pickBody)과 컬렉션 페이지(#colBody).
   예전에는 `$('#pickBody') || $('#colBody')` 로 한 곳만 골랐는데, #pickBody 는 숨어 있어도
   늘 DOM 에 남아 있어 **컬렉션 페이지에서는 안 보이는 쪽만 다시 그렸다** —
   화면에서는 「해제가 안 먹는다」로 나타났다. 있는 것을 전부 제자리에서 갈아끼운다. */
function repaintPicker() {
  document.querySelectorAll('.picker')
    .forEach(el => { el.outerHTML = pickerHtml(el.dataset.inpage === '1'); });
}

/** 첫 화면 — 안내와 고르기. 아직 아무것도 안 고른 상태에서 뜬다. */
function drawPicker() {
  PICK.clear();
  CUR.cols.forEach(c => PICK.add(short(c)));
  $('#pickBody').innerHTML = pickerHtml(false);
}

/** 컬렉션 페이지 — 지금 보는 조합을 바꾸는 자리. */
/** 숫자를 0→목표까지 세어 올린다. 그래프가 실제로 쌓이는 순서(트리플→개체→관계)를
 *  그대로 따라가게 세 스탯을 200ms 씩 밀려서 시작한다 — 동시에 뜨면 「값이 바뀌었다」로
 *  보이고, 순서대로 뜨면 「쌓이고 있다」로 보인다. */
function countUp(el, target, dur = 900, delay = 0) {
  if (!el) return;
  // 배경 탭에서는 rAF 가 안 돈다(기록·관계망 화면의 캔버스 문제와 같은 원인). 애니메이션을
  // 아예 못 켤 바엔 최종값을 바로 박아 둔다 — 「0」에서 안 움직이는 것보다 정직하다.
  if (document.hidden) { el.textContent = target.toLocaleString('ko-KR'); return; }
  const t0 = performance.now() + delay;
  const step = now => {
    const p = Math.min(1, Math.max(0, (now - t0) / dur));
    // ease-out-cubic — 끝에서 감속해야 「도착했다」는 느낌이 난다. 등속이면 그냥 멈춘 것처럼 보인다.
    const e = 1 - (1 - p) ** 3;
    el.textContent = Math.round(target * e).toLocaleString('ko-KR');
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString('ko-KR');
  };
  requestAnimationFrame(step);
}

/** 컬렉션을 고른 직후 본문에 크게 내는 적재 확인 — 상단의 작은 상태줄과 같은 수치를
 *  「본문에서, 세어 올라가며, 무엇으로 이루어졌는지 막대로」 보여준다.
 *  구성비는 지금 로드된 개체(G.nodes)를 직접 센다 — 손으로 적으면 컬렉션을 바꿀 때마다 어긋난다. */
function loadedBanner() {
  const cnt = new Map();
  G.nodes.forEach(n => cnt.set(n.cls, (cnt.get(n.cls) || 0) + 1));
  const seg = [...cnt.entries()].filter(([c]) => CLS[c]).sort((a, b) => b[1] - a[1]);
  const total = G.nodes.length || 1;
  const bars = seg.map(([c, n]) => `<span class="lb-seg" style="--w:${(n / total * 100).toFixed(2)}%;
      background:var(${CLS[c].v})" title="${esc(CLS[c].ko)} ${n}"></span>`).join('');
  const legend = seg.slice(0, 8).map(([c, n]) => `<span class="lb-leg">
      <i style="background:var(${CLS[c].v})"></i>${esc(CLS[c].ko)} <b>${n.toLocaleString('ko-KR')}</b></span>`).join('');
  return `
    <div class="lb" id="loadedBanner">
      <div class="lb-head">
        <span class="lb-dot"></span>
        <span class="lb-kick">Graph Loaded</span>
      </div>
      <div class="lb-stats">
        <div class="lb-stat"><b id="lbTriple">0</b><span>트리플</span></div>
        <div class="lb-op">→</div>
        <div class="lb-stat"><b id="lbNode">0</b><span>개체</span></div>
        <div class="lb-op">→</div>
        <div class="lb-stat"><b id="lbEdge">0</b><span>관계</span></div>
      </div>
      <div class="lb-bar" role="img" aria-label="개체 구성비">${bars}</div>
      <div class="lb-legend">${legend}</div>
    </div>`;
}
/** 배너가 그려진 뒤에 부른다 — innerHTML 로 넣은 직후엔 엘리먼트가 아직 없다. */
function animateLoadedBanner() {
  const b = $('#loadedBanner');
  if (!b) return;
  countUp($('#lbTriple'), TRIPLES, 900, 0);
  countUp($('#lbNode'), G.nodes.length, 900, 200);
  countUp($('#lbEdge'), G.edges.length, 900, 400);
  if (document.hidden) { b.classList.add('on'); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('on')));
}

function drawCollectionList() {
  PICK.clear();
  CUR.cols.forEach(c => PICK.add(short(c)));
  $('#colName').textContent = CUR.cols.length ? `${CUR.cols.length}건 선택` : `${COLS.length}건`;
  $('#colBody').innerHTML = `
    ${CUR.cols.length ? loadedBanner() : ''}
    <p class="note">이 사이트에는 발행본이 <b>${COLS.length}건</b> 실려 있습니다.
      고른 것만 지도·연표·관계망·기록에 들어갑니다. 여럿을 고르면 <b>합쳐서</b> 봅니다 —
      두 구술자를 나란히 놓고 볼 때 씁니다.</p>
    ${pickerHtml(true)}
    <p class="note">컬렉션은 관리 시스템이 발행할 때 <code>rico:RecordSet</code> 개체로 그래프에 함께 실립니다.
      기록은 <code>rico:isOrWasIncludedIn</code> 으로 컬렉션에 <b>들어 있고</b>, 인물·사건·장소는
      <code>rico:isOrWasSubjectOf</code> 로 컬렉션의 <b>주제</b>가 됩니다 —
      <code>isOrWasIncludedIn</code> 의 domain 이 <code>Record</code> 라 인물을 그리로 이으면 도메인 위반이기 때문입니다.</p>`;
  if (CUR.cols.length) animateLoadedBanner();
}

/* 컬렉션 페이지 — 이 사이트에 실린 발행본이 무엇을 담고 있는지.
   수는 전부 적재된 그래프에서 직접 센다(손으로 적으면 데이터를 갈아끼울 때 어긋난다).

   트리플 수는 적재할 때만 알 수 있어 모듈에 담아 둔다. 예전에는 인자로 받았는데,
   페이지 라우팅이 들어오면서 라우터가 인자 없이 부르게 되어 화면에 undefined 가 찍혔다. */
let TRIPLES = 0;
/* 스토어 전체의 트리플 수 — 부팅 때 한 번만 잰다. 컬렉션을 하나도 안 갈랐던 그래프(예전 발행본)를
   그대로 보여줄 때만 쓴다. 컬렉션이 있는 그래프에서는 TRIPLES 가 **고른 것만** 세도록 바뀌므로
   전체 값은 따로 들고 있어야 한다. */
let ALL_TRIPLES = 0;
/** 고른 개체들이 주어로 나오는 트리플만 센다 — VALUES 로 주어를 한정한다.
 *  개체 0개면 쿼리를 돌릴 것도 없이 0이다(해제 직후가 이 경로다). */
function countTriplesFor(ids) {
  if (!ids.length) return 0;
  const values = ids.map(id => `<${id}>`).join(' ');
  return Number(q(`SELECT (COUNT(*) AS ?n) WHERE { VALUES ?s { ${values} } ?s ?p ?o }`)[0]?.get('n')?.value ?? 0);
}
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
    ${loadedBanner()}
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
    <p class="note" style="margin-top:1rem">유형별 목록은 <a href="#/records">검색</a> 페이지에서
      걸러 볼 수 있습니다.</p>`;
  animateLoadedBanner();
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
    ALL_TRIPLES = TRIPLES = nT;        // 화면 여러 곳이 읽으므로 바로 담아 둔다. 고른 것에 맞춘 값은 applyCollection 이 뒤이어 다시 잰다

    await loadCollection();
    buildModel();
    // 인물 하이라이트(핵심 인용문·키워드)가 /lang 을 열어 본 적 없어도 바로 떠야 한다 —
    // 여기서 한 번 미리 읽어 둔다. 14단락짜리 텍스트라 부팅 부담은 무시할 만하다.
    await loadCorpus();
    paintTodayVoice();
    // 생애 장면 메타 — 실패해도 화면은 성립한다(그 절이 조용히 빠질 뿐).
    try { LIFE.push(...await fetch('assets/life/frames.json', { cache: 'no-cache' }).then(r => r.json())); } catch (e) { }
    writeStatus();
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
    // 개념 수는 그래프에서 직접 센다 — 시소러스가 안 실린 발행본이면 0으로 정직하게 뜬다.
    const nc = G.nodes.filter(n => n.cls === 'Concept').length;
    $('#ixSubject').textContent = nc ? `${nc}개념` : '없음';
    route();
    /* 콘솔에서 들여다볼 수 있게 열어 둔다. 팀이 Claude Code 로 이 사이트를 고칠 때
       `KIT.G.nodes` · `KIT.COLS` 를 직접 찍어 보는 편이 훨씬 빠르다. */
    window.KIT = { G, ALL, COLS, CUR, MAP, short, applyCollection, q, rows };
  } catch (e) {
    $('#loadStatus').textContent = '적재 실패: ' + e.message;
    console.error(e);
  }
}

/* 그래프를 화면용 모델로 */
function buildModel() {
  const nr = rows(`SELECT ?s ?c ?n ?d ?g ?lat ?lon ?k ?img ?imgsrc WHERE {
    ?s a ?c . OPTIONAL{?s rico:name ?n} OPTIONAL{?s rico:title ?n} OPTIONAL{?s skos:prefLabel ?n}
    OPTIONAL{?s rico:beginningDate ?d}
    OPTIONAL{?s rico:generalDescription ?g} OPTIONAL{?s rico:history ?g}
    OPTIONAL{?s rico:scopeAndContent ?g}
    OPTIONAL{?s geo:lat ?lat} OPTIONAL{?s geo:long ?lon}
    OPTIONAL{?s rdfs:comment ?k} OPTIONAL{?s skos:scopeNote ?k}
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
    ?s ?p ?o . FILTER(isIRI(?o) && (STRSTARTS(STR(?p), "${RICO}") || STRSTARTS(STR(?p), "${SKOS}"))) }`);
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
    TRIPLES = ALL_TRIPLES;
  } else if (!picked.length) {               // 아직 안 골랐다 — 비워 둔다
    G.nodes = [];
    TRIPLES = 0;                             // 개체·관계와 같은 기준: 하나도 안 골랐으면 트리플도 0
  } else {
    const keep = new Set();
    picked.forEach(c => c.members.forEach(m => keep.add(m)));
    G.nodes = ALL.nodes.filter(n => keep.has(n.id));
    TRIPLES = countTriplesFor([...keep]);
  }
  G.byId = new Map(G.nodes.map(n => [n.id, n]));
  G.edges = ALL.edges.filter(e => G.byId.has(e.s) && G.byId.has(e.o));
  recount();
  writeStatus();
  if (redraw) { drawMap(); drawTimeline(); initGraph(G); drawLang(); rebuildRecord(); }
}

/* 상태줄·히어로 수치는 **지금 고른 것**을 센다. 예전에는 적재 직후 한 번만 썼는데,
   고르기 전에는 개체가 0이라 컬렉션을 골라 들어가도 「개체 0 · 관계 0」이 그대로 남았다. */
function writeStatus() {
  const el = $('#loadStatus');
  /* 「적재 완료」와 「0개」를 한 줄에 같이 쓰면 모순으로 읽힌다 — 다 됐다면서 0개라니.
     사실은 둘이 다른 이야기다. Oxigraph 스토어는 트리플 전체(ALL_TRIPLES)를 이미 다 물고
     있고, 그건 컬렉션을 고르든 안 고르든 안 변한다. 화면에 뜨는 건 **그중 고른 만큼**이라
     아직 안 골랐으면 0인 게 정상이다 — 「덜 실렸다」가 아니라 「실려는 있는데 안 보여준다」.
     그래서 안 골랐을 때는 문장 자체를 바꾼다. */
  const line = hasPick()
    ? `그래프 적재 완료 — 트리플 ${TRIPLES}개 · 개체 ${G.nodes.length} · 관계 ${G.edges.length} · SPARQL 1.1 (Oxigraph WASM)`
    : `그래프 준비 완료(트리플 ${ALL_TRIPLES}개) — 컬렉션을 골라야 표시됩니다 · SPARQL 1.1 (Oxigraph WASM)`;
  if (el) el.textContent = line;
  /* 같은 문장을 검색 페이지 머리에도 쓴다 — 검색이 도는 그래프가 지금 몇 개짜리인지
     그 자리에서 보이도록. 원천이 한 곳이라 두 표시가 어긋날 일이 없다. */
  const rs = $('#recStatus'); if (rs) rs.textContent = line;
  const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
  set('#hsNode', G.nodes.length); set('#hsEdge', G.edges.length); set('#hsTriple', TRIPLES);
}

/** 고른 것이 있는가. 컬렉션이 아예 없는 그래프는 「고를 것이 없으니 열려 있다」로 본다. */
export const hasPick = () => !COLS.length || CUR.cols.length > 0;


/* ══════════ 주제 — 시소러스 ══════════
   개념은 실재하는 것을 **대체하지 않는다.** 한보사태는 여전히 사건이고, 그것과 별개로
   「노동정책」이라는 주제로도 걸린다. 이 화면이 보여 주려는 것은 그 한 겹이다.

   핵심은 상위 개념을 누를 때다. skos:broader 는 추론이 일어나지 않으므로(rdfs:subClassOf 가
   아니다) 계층을 **질의가 직접 타고 내려가야** 결과가 늘어난다. 아래 kidsOf/closure 가 그 일이다. */
const SKOS_REL = new Set(['broader', 'related', 'inScheme', 'topConceptOf', 'exactMatch']);

/** 개념 → 그 바로 아래 개념들. broader 의 역방향이다(narrower 는 그래프에 없다). */
function kidsOf() {
  const m = new Map();
  G.edges.filter(e => e.p === 'broader').forEach(e => {
    if (!m.has(e.o)) m.set(e.o, []);
    m.get(e.o).push(e.s);
  });
  return m;
}
/** 자기 자신 + 아래로 전부. SPARQL 의 skos:broader* 를 화면 쪽에서 한 것이다. */
function closure(id, kids) {
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!out.has(k)) { out.add(k); stack.push(k); }
  return out;
}
/** 이 개념들을 **쓰는** 것. 주제(hasOrHadSubject)만이 아니다 —
    기록집합 유형(hasRecordSetType)처럼 개념을 값으로 받는 속성이 더 있다.
    술어를 하나로 고정하면 그 개념들이 화면에서 0으로 뜬다(실측: ric-rst 4개가 그랬다).
    SKOS 구조 관계(broader·inScheme…)는 개념끼리의 뼈대라 여기서 뺀다. */
function subjectsOf(ids) {
  return [...new Set(G.edges.filter(e => ids.has(e.o) && !SKOS_REL.has(e.p) && !ids.has(e.s)).map(e => e.s))]
    .map(id => G.byId.get(id)).filter(Boolean)
    .sort((a, b) => (a.cls === b.cls ? a.label.localeCompare(b.label) : a.cls.localeCompare(b.cls)));
}

/** 칩·목록에 쓸 대표 이미지. 자기 사진(foaf:depiction)이 있으면 그것, 없으면
 *  **연결된 개체 중 사진 있는 것**(연결 많은 순)을 빌려 온다 — 기록·규범은 대개 사진이 없어
 *  전부 점으로 두면 화면이 메마르고, 그렇다고 없는 사진을 지어낼 수는 없다.
 *  빌려 온 경우 from 에 그 개체 이름을 담아 title 로 출처를 밝힌다. */
export function repImgOf(o, excludeId) {
  if (o.img) return { src: o.img, from: null };
  let best = null;
  G.edges.forEach(e => {
    const other = e.s === o.id ? G.byId.get(e.o) : (e.o === o.id ? G.byId.get(e.s) : null);
    /* excludeId: 개체 상세 페이지에서 그 개체 자신을 후보에서 뺀다 — 정세균 페이지의 사건
       칩 298개가 전부 정세균 얼굴이 되는 순환을 막는다. 자기 얼굴은 정보가 아니다. */
    if (other && other.id === excludeId) return;
    if (other && other.img && (!best || (other.deg || 0) > (best.deg || 0))) best = other;
  });
  return best ? { src: best.img, from: best.label } : null;
}

let SUBJ_PICK = null;
/* 열려 있는 전시. 시소러스(체계)와 전시(이야기)는 다른 구역이다 — 개념을 고르는 일과
   전시를 관람하는 일이 한 상태를 공유하면, 개념을 바꿀 때마다 전시가 닫히는 어긋남이 생긴다. */
let SUBJ_EXPO = null;
/* 주제 화면의 검색어. 개념 이름·비우선어(UF)뿐 아니라 **개체 이름**까지 훑는다 —
   직원들이 "탄핵"으로도 찾지만 "노무현"으로도 찾기 때문이다. 개체로 맞으면 그 개체가
   어느 주제에 달려 있는지를 알려 주는 것이 답이 된다. */
let SUBJ_Q = '';

function drawSubjects() {
  // 개념이 많은 체계를 먼저. 인용만 하는 외부 어휘(4개)가 우리 시소러스(13개)보다
  // 위에 오면 이 화면이 무엇을 보여 주는 것인지 흐려진다.
  const schemes = G.nodes.filter(n => n.cls === 'ConceptScheme');
  const concepts = G.nodes.filter(n => n.cls === 'Concept');
  const host = $('#subjBody');
  if (!host) return;
  if (!concepts.length) {
    host.innerHTML = `<p class="note">이 발행본에는 개념이 실려 있지 않습니다 —
      관리 시스템에서 시소러스를 함께 발행하면 여기 나타납니다.</p>`;
    return;
  }
  const kids = kidsOf();
  const inScheme = new Map();
  G.edges.filter(e => e.p === 'inScheme').forEach(e => inScheme.set(e.s, e.o));
  const alt = new Map();
  rows(`SELECT ?s ?l WHERE { ?s skos:altLabel ?l }`).forEach(r => {
    if (!alt.has(r.s)) alt.set(r.s, []);
    alt.get(r.s).push(r.l);
  });

  // 요약 한 줄 — 수는 전부 그래프에서 직접 센다.
  const conceptIds = new Set(concepts.map(c => c.id));
  const linkTotal = G.edges.filter(e =>
    !SKOS_REL.has(e.p) && conceptIds.has(e.o) && !conceptIds.has(e.s)).length;

  /* ── 검색 ──
     개념(이름·UF)과 개체(이름)를 함께 훑는다. 개체가 걸리면 **그 개체가 달린 주제**를 되짚어
     보여 준다 — "노무현"으로 찾은 사람이 알고 싶은 건 그가 어느 주제에 걸려 있는가이기 때문이다. */
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const q = norm(SUBJ_Q);
  let hits = null;
  if (q) {
    const conceptHit = new Set();
    concepts.forEach(c => {
      const names = [c.label, ...(alt.get(c.id) || [])];
      if (names.some(x => norm(x).includes(q))) conceptHit.add(c.id);
    });
    const entHit = [];
    G.nodes.forEach(n2 => {
      if (n2.cls === 'Concept' || n2.cls === 'ConceptScheme') return;
      if (!norm(n2.label).includes(q)) return;
      const via = G.edges.filter(e => e.s === n2.id && !SKOS_REL.has(e.p) && G.byId.get(e.o)?.cls === 'Concept')
        .map(e => e.o);
      entHit.push({ n: n2, via });
      via.forEach(id => conceptHit.add(id));
    });
    hits = { conceptHit, entHit };
  }

  /* 개체 칩 — 참고 사이트(수원학 아카이브)의 문법: 원형 썸네일 + 이름.
     사진이 없는 개체는 클래스 색 점으로 — 빈 사진 틀을 두면 「못 불러왔다」로 읽힌다. */
  const chip = o => {
    const r = repImgOf(o);
    const tip = r && r.from ? `${o.label} — 대표 이미지: 연결된 개체 「${r.from}」` : o.label;
    return `<a class="th-chip" href="#/item/${encodeURIComponent(short(o.id))}" title="${esc(tip)}">
      ${r ? `<img src="${esc(r.src)}" alt="" loading="lazy">`
          : `<i style="background:var(${CLS[o.cls]?.v || '--muted'})"></i>`}
      <span>${esc(o.label)}</span></a>`;
  };

  /* 주제 한 항목. 이름·수만 내지 않는다 — 그 주제에 **직접 달린 자료**를 썸네일 칩으로
     바로 보여준다(6개까지, 나머지는 +N 이 상세로 잇는다). flat=true 면 검색 결과라 자식 생략. */
  const CHIP_CAP = 6;
  const conceptRow = (id, depth, flat) => {
    const n = G.byId.get(id);
    if (!n) return '';
    const deep = subjectsOf(closure(id, kids)).length;
    const direct = subjectsOf(new Set([id]));
    const on = SUBJ_PICK === id;
    const uf = (alt.get(id) || []).join(' · ');
    const hasStory = !!SUBJ_STORY[short(id)];
    const children = flat ? '' : (kids.get(id) || [])
      .sort((a, b) => G.byId.get(a).label.localeCompare(G.byId.get(b).label))
      .map(k => conceptRow(k, depth + 1)).join('');
    return `<div class="th-c${on ? ' on' : ''}${depth ? '' : ' top'}">
      <button class="th-head" onclick="pickSubject('${esc(id)}')" aria-pressed="${on}">
        <b>${esc(n.label)}</b>
        ${uf ? `<em>UF ${esc(uf)}</em>` : ''}
        ${hasStory ? '<span class="story-tag">전시</span>' : ''}
        <i class="th-n">${deep}</i>
      </button>
      ${direct.length ? `<div class="th-items">${direct.slice(0, CHIP_CAP).map(chip).join('')}
        ${direct.length > CHIP_CAP ? `<button class="th-more"
          onclick="pickSubject('${esc(id)}')">+${direct.length - CHIP_CAP} 전체 보기</button>` : ''}
      </div>` : ''}
      ${children ? `<div class="th-kids">${children}</div>` : ''}
    </div>`;
  };

  const summary = `<p class="subj-sum">통제 주제 <b>${concepts.length}</b>개 ·
    개념체계 ${schemes.length} · 자료 연결 <b>${linkTotal}</b>건 · 표준 SKOS</p>`;

  const searchBox = `<div class="subj-search">
    <input id="subjQ" type="search" placeholder="주제나 개체를 검색 — 예: 탄핵, 노무현, 노동"
      value="${esc(SUBJ_Q)}" oninput="subjSearch(this.value)" autocomplete="off">
    ${SUBJ_Q ? `<button class="btn sm" onclick="subjSearch('')">지우기</button>` : ''}
  </div>`;

  const sizeOf = s => concepts.filter(c => inScheme.get(c.id) === s.id).length;
  const schemeHtml = [...schemes].sort((a, b) => sizeOf(b) - sizeOf(a)).map(s => {
    const mine = concepts.filter(c => inScheme.get(c.id) === s.id);
    if (hits) {
      const found = mine.filter(c => hits.conceptHit.has(c.id));
      if (!found.length) return '';
      return `<section class="th-scheme">
        <header><b>${esc(s.label)}</b><span>맞은 개념 ${found.length}</span></header>
        ${found.map(c => conceptRow(c.id, 0, true)).join('')}
      </section>`;
    }
    const tops = mine.filter(c => !G.edges.some(e => e.p === 'broader' && e.s === c.id));
    return `<section class="th-scheme">
      <header><b>${esc(s.label)}</b><span>개념 ${mine.length}</span></header>
      ${s.kind ? `<p class="note">${esc(s.kind)}</p>` : ''}
      ${tops.map(c => conceptRow(c.id, 0)).join('')}
    </section>`;
  }).join('');

  const entHtml = hits && hits.entHit.length ? `<section class="th-scheme">
    <header><b>이름이 맞은 개체</b><span>${hits.entHit.length}</span></header>
    <div class="th-items">${hits.entHit.slice(0, 24).map(({ n: e }) => chip(e)).join('')}</div>
    ${hits.entHit.length > 24 ? `<p class="note">앞의 24건만 보입니다.</p>` : ''}
  </section>` : '';

  const empty = hits && !schemeHtml && !entHtml
    ? `<p class="note">"${esc(SUBJ_Q)}"와 맞는 주제나 개체가 없습니다.</p>` : '';

  /* ── 전시 구역 — 시소러스와 구분해 아래에 따로 둔다 ──
     시소러스가 주제의 **체계**라면 전시는 주제를 읽는 **이야기**다. 갤러리 카드로 늘어놓고
     관람하기를 누르면 그 자리에서 펼쳐진다. 개념이 이 발행본에 없는 전시는 내지 않는다. */
  const expoKeys = Object.keys(SUBJ_STORY).filter(k => G.byId.get(RIC + k));
  const expoZone = expoKeys.length ? `
    <div class="zone-head" id="subjExpo">
      <div class="kicker">Curated Stories</div>
      <h3>주제 전시</h3>
      <p>위 시소러스가 주제의 <b>체계</b>라면, 전시는 주제를 읽는 <b>이야기</b>입니다 —
        순서와 해석을 아키비스트가 정해 엮었습니다.</p>
    </div>
    <div class="expo-gallery">${expoKeys.map(k => {
      const s = SUBJ_STORY[k];
      const hero = storyImg(s.hero);
      const on = SUBJ_EXPO === k;
      const cName = G.byId.get(RIC + k)?.label || '';
      return `<article class="expo-card${on ? ' on' : ''}" onclick="openExpo('${esc(k)}')"
          role="button" tabindex="0" onkeydown="if(event.key==='Enter')openExpo('${esc(k)}')">
        ${hero ? `<img src="${esc(hero.src)}" alt="" loading="lazy">`
               : s.tint ? `<div class="expo-tint" style="background:${esc(s.tint)}" aria-hidden="true"></div>` : ''}
        <div class="expo-card-body">
          <div class="expo-kicker">큐레이션 전시 · 주제 「${esc(cName)}」</div>
          <h4>${esc(s.title).replace(/\n/g, ' ')}</h4>
          <p>${esc(s.lead)}</p>
          <span class="expo-open">${on ? '전시 닫기' : '관람하기 →'}</span>
        </div>
      </article>`;
    }).join('')}</div>
    ${SUBJ_EXPO ? `<div id="expoFull">${renderStory(SUBJ_EXPO)}</div>` : ''}` : '';

  host.innerHTML = summary + searchBox + schemeHtml + entHtml + empty
    + `<div id="subjPane"></div>` + expoZone;
  paintSubjectPane();
  // 다시 그리면 입력칸이 새로 만들어져 포커스가 풀린다 — 커서를 끝으로 되돌린다.
  if (SUBJ_Q) { const el = $('#subjQ'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
}

/** 검색어가 바뀌면 목록만 다시 그린다. 고른 개념(SUBJ_PICK)은 건드리지 않는다 —
 *  검색은 찾는 행위지 선택을 바꾸는 행위가 아니다. */
window.subjSearch = v => { SUBJ_Q = v; drawSubjects(); };

window.pickSubject = id => {
  const was = SUBJ_PICK;
  SUBJ_PICK = SUBJ_PICK === id ? null : id;
  drawSubjects();
  // 상세는 목록 아래에 그려진다 — 스크롤해 주지 않으면 눌렀는데 아무 일도 없는 것처럼 보인다.
  if (SUBJ_PICK && SUBJ_PICK !== was) $('#subjPane')?.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
};

/** 전시 열고 닫기 — 갤러리 카드가 부른다. */
window.openExpo = key => {
  SUBJ_EXPO = SUBJ_EXPO === key ? null : key;
  drawSubjects();
  if (SUBJ_EXPO) $('#expoFull')?.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
};

/* ══════════ 큐레이션 전시 — 주제 하나를 아키비스트가 엮은 것 ══════════
   Omeka S 의 디지털 전시(참고: 양화진기록관)에 해당하는 자리다. 지도의 '생애 따라가기'(STORY)와
   같은 방식으로 **사람이 고르고 사람이 쓴 내러티브**를 그래프 위에 얹는다. 기계는 「탄핵 주제에
   8건이 달렸다」까지만 말할 수 있고, 「왜 이 순서로 읽어야 하는가」는 못 말한다. 그게 큐레이터의
   몫이고, 이 화면이 보여 주려는 것이다.

   규칙은 그래프와 같다: **지어내지 않는다.**
     · narr 의 사실 서술은 개체의 desc/date 에 있는 것만 쓴다. 데이터에 없는 날짜는 적지 않는다.
     · quote 는 corpus.txt 에 실제로 있는 문장만 — 렌더 시점에 원문에서 다시 찾는다(sentencesWith).
       문자열로 박아 두면 코퍼스를 갈아끼울 때 거짓이 된다.
     · 이미지는 두 곳에서만 온다. imgOf(개체 id) — 그래프 개체의 foaf:depiction 과 출처(rdfs:label),
       life(파일명) — frames.json 의 연도·설명·크레딧. 둘 다 출처 표기가 딸려 온다.
     · refs 는 그래프에 실재하는 id 여야 한다 — 없으면 화면에서 조용히 빠진다.

   지금은 「탄핵」 하나만 있다. 다른 주제로 늘리려면 이 객체에 키를 더하면 된다. */
const SUBJ_STORY = {
  'concept-tanhaek': {
    kicker: '큐레이션 전시',
    title: '두 번의 탄핵소추,\n그리고 그 사이의 국회',
    lead: '대한민국 국회는 대통령 탄핵소추를 두 번 의결했습니다. 2004년, 그리고 2016년 — '
        + '두 번째 의사봉은 구술자 자신이 들었습니다. 구술과 기록이 남긴 것을 시간 순으로 놓아 봅니다.',
    by: '아카이브랩 큐레이션 · 국회기록원 실습교육용 샘플',
    hero: { life: '2016-gavel.webp' },
    acts: [
      { year: '1972', title: '헌정이 멈춘 기억에서 시작한다',
        narr: '탄핵을 이야기하려면 그전에, 헌정이 멈춰 본 기억을 지나야 합니다. '
            + '1972년 10월 17일 유신이 선포되고 유신헌법이 들어섰습니다. '
            + '대학 재학 중이던 정세균은 반대 시위에 참여했다고 구술했습니다.',
        quoteX: { pi: 0, from: 1, to: 1 },
        img: { entity: 'person-park-chung-hee' },
        refs: ['event-yushin', 'rule-yushin-constitution'] },
      { year: '2004', title: '첫 번째 — 가결, 그리고 기각',
        narr: '2004년 3월 12일, 국회는 현직 대통령에 대한 탄핵소추안을 처음으로 가결했습니다. '
            + '헌법재판소는 이를 기각했습니다. 구술 3차는 이 시기를 열린우리당 창당과 나란히 이야기합니다.',
        quoteX: { pi: 5, from: 0, to: 0 },
        img: { entity: 'agent-rmh' },
        refs: ['event-impeach-roh', 'rec-impeachment-motion-roh'] },
      { year: '2016', title: '두 번째 — 광장, 그리고 본회의장',
        narr: '12년 뒤인 2016년 12월 9일, 국회는 다시 탄핵소추안을 가결했습니다. '
            + '이번에 의사봉을 쥔 사람은 구술자 자신 — 제20대 전반기 국회의장 정세균이었습니다. '
            + '같은 시기의 광장을 그래프는 촛불집회로 기록하고 있습니다.',
        img: { entity: 'event-candlelight' },
        refs: ['event-impeach-park', 'rec-park-impeachment-uigyeolseo', 'event-candlelight'] },
      { year: '2017', title: '헌법재판소의 대답',
        narr: '헌법재판소는 이번에는 소추를 인용했습니다. '
            + '2004년의 기각과 2016년의 인용 — 같은 제도가 두 번, 다르게 답했습니다.',
        img: { entity: 'org-constitutional-court' },
        refs: ['event-cc-impeachment-ruling', 'org-constitutional-court'] },
      { year: '이후', title: '남은 질문 — 개헌',
        narr: '두 번의 탄핵은 대통령제와 헌법 자체에 대한 물음을 남겼습니다. '
            + '제18대 국회에서는 의장 자문위원회가 헌법개정안을 만들기도 했습니다. '
            + '기록은 질문이 아직 끝나지 않았음을 보여 줍니다.',
        refs: ['record-constitutional-amendment-bill-18'] },
    ],
  },

  'concept-nodong': {
    kicker: '큐레이션 전시',
    title: '명함에서 대타협까지 —\n한 기업인이 겪은 노동',
    lead: '쌍용그룹에서 17년을 보낸 회사원이 국회에서 노동을 말하게 되기까지 — '
        + '한보사태와 외환위기, 노사정위원회의 밤을 구술과 기록으로 따라갑니다.',
    by: '아카이브랩 큐레이션 · 국회기록원 실습교육용 샘플',
    /* 노동 서사에 맞는 사진이 수집분에 없다 — 억지로 붙이는 대신 색으로 문을 연다.
       tint 는 카드 썸네일 자리에만 쓰이는 큐레이션 색이고, 전시 본문 머리는 무이미지로 성립한다. */
    tint: 'linear-gradient(150deg,#7b2f61,#451b37)',
    acts: [
      { year: '1978', title: '회사원 정세균',
        narr: '1978년 쌍용그룹에 입사해 1995년 상무이사로 퇴사할 때까지 17년 — '
            + '노동을 말하기 전에, 그는 먼저 회사원이었습니다.',
        quoteX: { pi: 1, from: 4, to: 5 },
        img: { entity: 'org-ssangyong' },
        refs: ['org-ssangyong'] },
      { year: '1997', title: '한보, 그리고 외환위기',
        narr: '1997년 1월 한보사태가 터졌습니다. 구술은 이를 재벌 문어발식 확장의 상징이자 '
            + '외환위기의 한 원인으로 회고합니다. 그해 11월 21일, 정부는 국제통화기금에 '
            + '구제금융을 신청했습니다.',
        quoteX: { pi: 2, from: 5, to: 7 },
        refs: ['event-hanbo', 'event-imf'] },
      { year: '1998', title: '노사정위원회의 밤',
        narr: '1998년 2월 6일, 경제위기 극복을 위한 사회협약 — 노사정위원회 1기 대타협이 '
            + '이루어졌습니다. 그 자리에 있던 사람의 목소리로 듣습니다.',
        quoteX: { pi: 3, from: 0, to: 4 },
        refs: ['event-nosajeong', 'org-nosajeong'] },
      { year: '이후', title: '고용의 질이라는 숙제',
        narr: '2017년 1월, 국회 청소노동자 정규직 전환이 있었습니다. 활동 기록은 이를 '
            + '1998년 노사정위원회부터 이어진 고민의 연장으로 적고 있습니다.',
        quotes: [{ pi: 7, from: 0, to: 4 }, { pi: 7, from: 5, to: 8 }],
        refs: ['act-labor-reform', 'event-cleaner'] },
    ],
  },
};

/** 이미지 명세 하나를 {src, cap, credit, href} 로 푼다. 없으면 null —
 *  개체가 이 발행본에 없거나 사진이 없으면 그 절은 이미지 없이 성립한다. */
function storyImg(spec) {
  if (!spec) return null;
  if (spec.life) {
    const f = LIFE.find(x => x.src.endsWith(spec.life));
    if (!f) return null;
    const ent = f.entity && G.byId.get(RIC + f.entity);
    return { src: f.src, cap: `${f.year} · ${f.label}`, credit: f.credit,
      href: ent ? `#/item/${encodeURIComponent(f.entity)}` : null };
  }
  if (spec.entity) {
    const n = G.byId.get(RIC + spec.entity);
    if (!n || !n.img) return null;
    return { src: n.img, cap: n.label, credit: n.imgSrc || '',
      href: `#/item/${encodeURIComponent(spec.entity)}` };
  }
  return null;
}

/** 전시 한 편을 그린다. refs 중 그래프에 없는 id 는 조용히 뺀다 —
 *  발행본마다 실린 개체가 다르므로, 없는 걸 링크로 만들면 죽은 링크가 된다. */
function renderStory(key) {
  const s = SUBJ_STORY[key];
  if (!s) return '';
  const hero = storyImg(s.hero);
  const acts = s.acts.map(a => ({
    ...a,
    refs: (a.refs || []).map(id => G.byId.get(RIC + id)).filter(Boolean),
    /* 인용은 렌더 시점에 원문에서 다시 추출한다 — 문자열로 박아 두면 코퍼스를 갈아끼울 때
       거짓이 된다. quoteX/quotes 는 큐레이터가 화자를 확인해 지정한 연속 구간,
       quoteWord 는 단어로 첫 문장을 찾는 예전 방식(팀이 쓰기 쉬운 쪽을 고르면 된다). */
    quotes: [
      ...((a.quotes || (a.quoteX ? [a.quoteX] : []))
        .map(x => excerptAt(x.pi, x.from, x.to)).filter(Boolean)),
      ...(a.quoteWord ? [sentencesWith(a.quoteWord, null)[0]].filter(Boolean) : []),
    ],
    media: storyImg(a.img),
  }));
  const chip = o => `<a class="ent" href="#/item/${encodeURIComponent(short(o.id))}">
      <i class="dot" style="background:var(${CLS[o.cls]?.v || '--muted'})"></i>${esc(o.label)}
      <span>${esc(CLS[o.cls]?.ko || o.cls)}</span></a>`;
  const media = m => m ? `<figure class="act-media">
      ${m.href ? `<a href="${m.href}"><img src="${esc(m.src)}" alt="${esc(m.cap)}" loading="lazy"></a>`
               : `<img src="${esc(m.src)}" alt="${esc(m.cap)}" loading="lazy">`}
      <figcaption>${esc(m.cap)}${m.credit ? `<em>${esc(m.credit)}</em>` : ''}</figcaption>
    </figure>` : '';

  return `<article class="story">
    <header class="story-hero${hero ? '' : ' no-img'}">
      ${hero ? `<img src="${esc(hero.src)}" alt="">` : ''}
      <div class="story-hero-text">
        <div class="story-kicker">${esc(s.kicker)}</div>
        <h3>${esc(s.title).replace(/\n/g, '<br>')}</h3>
        <p class="story-lead">${esc(s.lead)}</p>
        <p class="story-by">${esc(s.by)}</p>
      </div>
      ${hero ? `<div class="story-hero-cap">${esc(hero.cap)} — ${esc(hero.credit)}</div>` : ''}
    </header>
    ${acts.map((a, i) => `<section class="act${a.media ? (i % 2 ? ' alt' : '') : ' noimg'}">
      <div class="act-rail"><span class="act-year">${esc(a.year)}</span><i></i></div>
      <div class="act-main">
        ${a.media && !(i % 2) ? media(a.media) : ''}
        <div class="act-body">
          <h4>${esc(a.title)}</h4>
          <p>${esc(a.narr)}</p>
          ${a.quotes.map(q => `<blockquote class="act-quote">${spTag()}${esc(q.sent)}
            <cite>구술 원문 · ${q.i + 1}단락</cite></blockquote>`).join('')}
          ${a.refs.length ? `<div class="chips-l">${a.refs.map(chip).join('')}</div>` : ''}
        </div>
        ${a.media && (i % 2) ? media(a.media) : ''}
      </div>
    </section>`).join('')}
    <footer class="story-end">
      <p>이 전시는 <b>사람이 엮은 것</b>입니다. 개체와 기록은 그래프가 모아 주었고,
      순서와 해석은 큐레이터가 정했습니다 — 디지털 전시가 목록과 다른 지점이 여기입니다.</p>
      <p class="note">사실 서술은 각 개체의 기술 내용에서, 인용문은 구술 원문에서, 이미지 출처는
      각 자료의 크레딧에서 그대로 가져왔습니다. 데이터에 없는 날짜는 적지 않았습니다.</p>
    </footer>
  </article>`;
}

function paintSubjectPane() {
  const pane = $('#subjPane');
  if (!pane) return;
  if (!SUBJ_PICK) {
    pane.innerHTML = `<p class="note">개념을 누르면 그 주제의 자료가 모입니다.
      오른쪽 숫자는 <b>그 개념과 아래 개념 전부</b>에 달린 자료 수입니다 — 상위로 갈수록 커집니다.</p>`;
    return;
  }
  const kids = kidsOf();
  const cl = closure(SUBJ_PICK, kids);
  const n = G.byId.get(SUBJ_PICK);
  const items = subjectsOf(cl);
  const direct = subjectsOf(new Set([SUBJ_PICK]));
  const rt = G.edges.filter(e => e.p === 'related' && (e.s === SUBJ_PICK || e.o === SUBJ_PICK))
    .map(e => G.byId.get(e.s === SUBJ_PICK ? e.o : e.s)).filter(Boolean);
  const xm = rows(`SELECT ?u WHERE { <${SUBJ_PICK}> skos:exactMatch ?u }`).map(r => r.u);
  pane.innerHTML = `
    <div class="spane">
      <h3>${esc(n.label)}</h3>
      ${n.kind ? `<p class="note">${esc(n.kind)}</p>` : ''}
      <p class="note">이 개념만으로 <b>${direct.length}건</b> ·
        아래 개념 ${cl.size - 1}개까지 타고 내려가면 <b>${items.length}건</b>.
        ${rt.length ? `관련어(RT) ${rt.map(r => esc(r.label)).join(' · ')}. ` : ''}
        ${xm.length ? `타 어휘 일치 <code>${esc(xm[0])}</code>.` : ''}</p>
      <div class="slist">${items.map(i => { const r = repImgOf(i);
        return `<a class="sitem" href="#/item/${encodeURIComponent(short(i.id))}"
          title="${esc(r && r.from ? `${i.label} — 대표 이미지: 연결된 개체 「${r.from}」` : i.label)}">
        ${r ? `<img class="sthumb" src="${esc(r.src)}" alt="" loading="lazy">`
            : `<span class="dot" style="background:var(${CLS[i.cls]?.v || '--muted'})"></span>`}
        <b>${esc(i.label)}</b><em>${esc(CLS[i.cls]?.ko || i.cls)}</em></a>`; }).join('')
      || '<p class="note">달린 자료가 없습니다.</p>'}</div>
      ${SUBJ_STORY[short(SUBJ_PICK)] ? `<p class="note" style="margin-top:.9rem">이 주제로 엮은 전시가 있습니다 —
        <button class="btn sm" onclick="openExpo('${esc(short(SUBJ_PICK))}')">전시 관람하기 →</button></p>` : ''}
    </div>`;
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
      <i class="dot"></i>${esc(k)}</button>`).join('') +
    `<span class="map-scope">
      <button class="chip${MAP.world ? '' : ' on'}" onclick="mapScope(false)">국내 중심</button>
      <button class="chip${MAP.world ? ' on' : ''}" onclick="mapScope(true)">세계 전체</button></span>`;

  /* 지도는 한 번만 만든다. 컬렉션을 바꾸면 drawMap 이 다시 불리는데, 그때마다 L.map 을 부르면
     Leaflet 이 "Map container is already initialized" 를 던진다. 그 예외가 라우터까지 타고 올라가면
     화면 전환이 통째로 멈춘다 — 실제로 그렇게 됐었다. 두 번째부터는 마커만 갈아 끼운다. */
  if (MAP.map) {
    MAP.markers.forEach(m => MAP.map.removeLayer(m));
    MAP.markers.clear();
    drawMarkers(ps);
    return;
  }
  /* 첫 화면을 **데이터에서** 정한다. 예전에는 [36.5,127.8] 줌 6 을 박아 두고 나중에 fitBounds 로
     고쳤는데, fitBounds 는 컨테이너 크기가 있어야 한다 — 장소 화면은 열리기 전까지 display:none 이라
     그 순간 0×0 이고, 그러면 맞춤이 통째로 헛돈다. 상수 대신 분포의 중심에서 시작하면
     크기를 기다릴 필요가 없다. 세밀한 맞춤은 화면이 열린 뒤 fitMap 이 이어서 한다. */
  const seed = placeNodes().filter(isKR);
  const box = seed.length ? L.latLngBounds(seed.map(p => [p.lat, p.lon])) : null;
  // minZoom 2 — 서울~워싱턴·LA 를 한 화면에 담으려면 경도 247° 가 들어가야 한다(줌 3 은 153° 가 한계).
  MAP.map = L.map('map', { scrollWheelZoom: false, minZoom: 2, worldCopyJump: true })
    .setView(box ? box.getCenter() : [36.5, 127.8], 7);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
    { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }).addTo(MAP.map);
  MAP.map.on('click', () => MAP.map.scrollWheelZoom.enable());
  const touched = () => { MAP.touched = true; };
  MAP.map.getContainer().addEventListener('pointerdown', touched);
  MAP.map.getContainer().addEventListener('wheel', touched, { passive: true });
  /* 첫 배율은 「컨테이너가 크기를 갖는 순간」에 맞춰야 한다 — route 의 60ms 한 번으로는
     레이아웃이 아직 0 인 판을 놓치고, fitMap 의 크기 가드에 걸려 조용히 빠진 채 재시도가 없다
     (증상: 첫 진입이 씨앗 뷰 줌 7 그대로). 크기 변화마다 다시 재고, 만진 뒤에는 자동 맞춤만 멈춘다. */
  new ResizeObserver(() => {
    if (!MAP.map) return;
    MAP.map.invalidateSize();
    if (!MAP.touched) fitMap();
  }).observe(MAP.map.getContainer());

  drawMarkers(ps);
}

/** 마커·목록·화면맞춤. 컬렉션이 바뀌면 지도는 두고 이것만 다시 한다. */
/* 마커는 핀으로 두고, **호버할 때만** 그 장소의 사진을 띄운다.
   사진을 마커 자리에 그대로 겹쳐 봤더니 두 가지가 걸렸다 —
     ① 43곳 중 17쌍이 겹쳐 지도가 사진 더미가 된다.
     ② 호버로 사진을 키우면 커서가 원래 마커 밖으로 나가 hover 가 풀리고, 그러면
        사진이 사라지며 다시 hover 가 잡히는 깜빡임이 생긴다.
   Leaflet 툴팁은 자기 영역까지 hover 로 쳐 주므로 ②가 없다. */
function markerIcon() {
  const col = css('--place');
  return L.divIcon({
    className: '', iconSize: [26, 34], iconAnchor: [13, 34],
    html: `<div class="mk"><svg width="26" height="34" viewBox="0 0 26 34">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z"
        fill="${col}" opacity=".9"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg></div>`,
  });
}

function drawMarkers(ps) {
  ps.forEach(p => {
    const m = L.marker([p.lat, p.lon], { icon: markerIcon() }).addTo(MAP.map);
    // 사진이 있는 곳만. 없는 곳(실측 43곳 중 16곳)은 툴팁을 달지 않는다 — 빈 상자가 뜨느니 없는 편이 낫다.
    if (p.img) m.bindTooltip(
      `<img src="${esc(p.img)}" alt=""><b>${esc(p.label)}</b>`,
      { direction: 'top', offset: [0, -32], opacity: 1, className: 'mk-tt' });
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
  /* 컨테이너가 아직 0 이면 맞추지 않는다. 장소 화면은 열리기 전까지 display:none 이라
     이 함수가 그때 돌면 Leaflet 이 0×0 을 기준으로 잡아 **세계 축척**으로 물러난다 —
     실제로 그랬다: 국내 36곳 중 서울 14곳만 보이고 진안·전주는 화면 밖이었다.
     크기가 생긴 뒤 route() 가 다시 부른다. */
  const el = MAP.map.getContainer();
  if (!el.clientWidth || !el.clientHeight) return;

  // 국내와 해외가 섞이면 세계 축척으로 물러나 한반도가 점이 된다.
  // 기본은 국내에 맞추고, 「세계 전체」를 고르면 해외(워싱턴·LA·런던…)까지 다 넣는다.
  const kr = vis.filter(isKR);
  if (!MAP.world && kr.length) vis = kr;
  /* 여백은 **픽셀로** 준다. .pad(.25) 는 위경도 범위를 사방 25% 씩 늘리는 것이라
     분포가 좁을수록 여백이 과하게 커진다 — 실측: 마커가 지도 가로의 25% 만 쓰고 나머지는 빈 바다였다.
     한반도는 세로로 길고 지도 상자는 가로로 넓어 가로 여백은 어차피 남는다. 세로를 채우는 쪽으로 맞춘다. */
  /* animate:false — 두 가지 이유. ① 배경 탭에서는 rAF 가 멈춰 애니메이션 fitBounds 가
     끝까지 못 가고 이전 화면에 걸린다(실측: 세계 전환이 줌 7에 멈춤). ② 범위 전환은
     이동이 아니라 갈아끼우기라, 태평양을 가로지르는 비행 애니메이션이 오히려 어지럽다. */
  MAP.map.fitBounds(L.latLngBounds(vis.map(p => [p.lat, p.lon])), { maxZoom: 11, padding: [30, 24], animate: false });
}
/** 지도 범위 전환 — 명시적 선택이므로 자동 맞춤을 다시 켠다(touched 해제). */
window.mapScope = w => {
  MAP.world = w;
  MAP.touched = false;
  document.querySelectorAll('.map-scope .chip').forEach((b, i) => b.classList.toggle('on', (i === 1) === w));
  fitMap();
};

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
  MAP.touched = true;   // 한 곳을 고른 것도 사용자가 정한 자리다 — 다시 전체로 되돌리지 않는다.
  MAP.map.flyTo([p.lat, p.lon], 12, { duration: .8 });
  MAP.markers.get(id)?.openPopup();
  // 목록만 강조하고 지도는 그대로면, 눌러 놓고도 지도에서 그 자리를 다시 찾아야 한다.
  MAP.markers.forEach((mk, mid) => mk.getElement()?.querySelector('.mk')?.classList.toggle('on', mid === id));
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
export const LANG = { mode: 'network', words: [], byChapter: [], paras: [] };
/* 생애 장면 — assets/life/frames.json. 연도·설명·크레딧이 딸린 큐레이션 이미지 8컷.
   hero.js(첫 화면 몰핑 초상)가 읽는 것과 같은 파일을 여기서도 읽어 인물 하이라이트와
   전시가 함께 쓴다 — 이미지 출처 표기를 한 곳에서 관리하기 위해서다. */
export const LIFE = [];
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

export async function loadCorpus() {
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

/** 전체를 통틀어 가장 그 대목에만 몰린 말 상위 n개 — langTfidf()(아래)와 같은 식이지만
 *  단락별 순위가 아니라 코퍼스 전체에서 하나의 순위를 낸다. 인물 하이라이트의 핵심 인용문·
 *  핵심 키워드가 이걸 쓴다. 같은 말이 여러 단락에 걸치면 점수가 가장 높은 단락 것만 남긴다
 *  (중복 방지 — "국회"가 3단락에도 7단락에도 오르는 식으로 두 번 뽑히지 않게). */
export function topTfidf(n = 12) {
  const ch = LANG.byChapter, N = ch.length, df = {};
  ch.forEach(c => Object.keys(c.freq).forEach(w => df[w] = (df[w] || 0) + 1));
  const best = new Map();
  ch.forEach(c => Object.entries(c.freq).filter(([, k]) => k >= 2).forEach(([w, k]) => {
    const s = (k / Math.max(c.total, 1)) * Math.log((N + 1) / (df[w] || 1));
    if (!best.has(w) || best.get(w).s < s) best.set(w, { w, pi: c.i, s });
  }));
  return [...best.values()].sort((a, b) => b.s - a.s).slice(0, n);
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
/** 어휘 w 가 나오는 문장들 — 단락을 지정하면 그 단락만 본다. showWordSource(언어 화면)와
 *  인물 하이라이트(핵심 인용문)가 이 하나를 함께 쓴다. 순수 함수라 DOM을 안 건드린다. */
export function sentencesWith(w, pi) {
  const paras = LANG.paras || [];
  const src = pi == null ? paras.map((p, i) => ({ i, p })) : [{ i: pi, p: paras[pi] || '' }];
  const out = [];
  src.forEach(({ i, p }) => String(p).split(/(?<=[.!?])\s+|\n+/).forEach(sent => {
    if (sent.includes(w) && out.length < 6) out.push({ i, sent: sent.trim() });
  }));
  if (!out.length) src.forEach(({ i, p }) => {
    if (String(p).includes(w) && out.length < 3) out.push({ i, sent: String(p).slice(0, 160) + '…' });
  });
  return out;
}

/** 한 단락의 연속 문장 [from..to] 를 그대로 이어 온다. 전시 인용이 쓴다.
 *  단어 검색(sentencesWith)과 달리 여러 문장을 내지만, **이어 붙이지는 않는다** —
 *  원문에 그 순서로 있는 문장들만이다. 구간은 큐레이터가 단락을 눈으로 읽고
 *  화자(구술자/면담자)를 확인해 지정한다. 문장 분할 규칙은 sentencesWith 와 같아야
 *  구간 번호가 어긋나지 않는다. */
export function excerptAt(pi, from, to) {
  const para = String(LANG.paras[pi] || '');
  const ss = para.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 6);
  const seg = ss.slice(from, to + 1);
  return seg.length ? { i: pi, sent: seg.join(' ') } : null;
}

/* 구술자(화자) — 기록의 hasCreator 목적어. 속기록 문법(◯화자명)의 화자는 지어내지 않고
   그래프에서 꺼낸다 — 없으면 인용에 화자를 달지 않는다. */
export function narratorLabel() {
  const e = (G.edges.length ? G.edges : ALL.edges).find(x => x.p === 'hasCreator');
  const n = e && (G.byId.get(e.o) || ALL.nodes.find(m => m.id === e.o));
  return n?.label || '';
}
export const spTag = () => {
  const w = narratorLabel();
  return w ? `<b class="sp">◯${esc(w)}</b>` : '';
};

/* 오늘의 목소리 — 히어로에 상시 노출되는 한 문장. 큐레이터가 화자를 검증해 둔 전시 인용
   구간(quoteX/quotes)에서 날짜로 돌려 고른다. 렌더 시점에 원문에서 다시 꺼내므로
   코퍼스를 갈아끼우면 자동으로 사라지거나 새 문장이 된다 — 문자열로 박아 두지 않는다. */
function paintTodayVoice() {
  const el = document.getElementById('todayVoice');
  if (!el) return;
  const qs = Object.values(SUBJ_STORY)
    .flatMap(s => s.acts.flatMap(a => a.quotes || (a.quoteX ? [a.quoteX] : [])));
  if (!qs.length || !LANG.paras.length) { el.hidden = true; return; }
  const q = qs[new Date().getDate() % qs.length];
  const x = excerptAt(q.pi, q.from, q.to);
  if (!x) { el.hidden = true; return; }
  el.innerHTML = `<blockquote>${spTag()}${esc(x.sent)}
    <cite>오늘의 목소리 — 구술 ${x.i + 1}단락 · 원문에서 그대로</cite></blockquote>`;
  el.hidden = false;
}

function showWordSource(w, pi) {
  const out = sentencesWith(w, pi);
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
