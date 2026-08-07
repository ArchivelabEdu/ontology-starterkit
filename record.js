/* 기록 — 찾아보기 · 아이템 페이지
   ─────────────────────────────────────────────────────────────
   BakedSearch 와 같은 생각으로 만들었다. 검색 서버를 두지 않고, 이미 브라우저에
   올라와 있는 그래프(G)를 그대로 색인 삼아 훑는다. 수천 건 규모까지는 이걸로 충분하다.

   아이템 페이지의 핵심은 '연결된 개체'다. 무엇과 이어져 있는지가 아니라
   **어떤 관계로** 이어져 있는지를 보여야 한다. 그게 표와 그래프의 차이다. */
import { G, CLS, REL_KO, RICO, esc, $, clsColor } from './app.js';

const SRC = '『대한민국 국회를 말하다 08 정세균』(국회도서관, 2021)';
const ORDER = ['Record', 'RecordSet', 'Person', 'CorporateBody', 'Position', 'Event', 'Activity', 'Place', 'Rule'];
const PAGE = 24;                       // 유형마다 먼저 보여 주는 개수
const R = { q: '', cls: new Set(), more: new Set(), built: false };

/* RiC-O 가 owl:inverseOf 로 짝지어 둔 속성들. 프로파일 §4 에서 검증한 9쌍. */
const PAIRS = [
  ['hasCreator', 'isCreatorOf'], ['hasAuthor', 'isAuthorOf'],
  ['hasOrHadSubject', 'isOrWasSubjectOf'], ['occupiesOrOccupied', 'isOrWasOccupiedBy'],
  ['hasOrHadPosition', 'existsOrExistedIn'], ['isOrWasMemberOf', 'hasOrHadMember'],
  ['includesOrIncluded', 'isOrWasIncludedIn'],
  ['hasOrHadInstantiation', 'isOrWasInstantiationOf'],
  ['isOrWasParticipantIn', 'hasOrHadParticipant'],
];
const INVERSE = Object.fromEntries(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));

/* ── 색인 ── */
function index() {
  return G.nodes.map(n => {
    const rel = G.edges.filter(e => e.s === n.id || e.o === n.id);
    return {
      ...n, deg: rel.length,
      hay: [n.label, n.desc, n.kind, n.date,
        ...rel.map(e => G.byId.get(e.s === n.id ? e.o : e.s)?.label || '')].join(' ').toLowerCase(),
    };
  });
}

export function initRecord() {
  if (R.built) return;
  R.built = true;
  R.items = index();

  const used = ORDER.filter(c => R.items.some(n => n.cls === c));
  $('#recFacets').innerHTML = `<button class="chip on c-all" onclick="recFacet('*')">전체</button>` +
    used.map(c => `<button class="chip on c-${CLS[c].key}" data-c="${c}" onclick="recFacet('${c}')">
      <i class="dot"></i>${CLS[c].ko} <b>${R.items.filter(n => n.cls === c).length}</b></button>`).join('');
  R.cls = new Set(used);
  draw();

  addEventListener('hashchange', route);
  route();
}

window.recSearch = v => { R.q = v.trim().toLowerCase(); R.more.clear(); draw(); };
window.recFacet = c => {
  const used = ORDER.filter(x => R.items.some(n => n.cls === x));
  if (c === '*') R.cls = R.cls.size === used.length ? new Set() : new Set(used);
  else R.cls.has(c) ? R.cls.delete(c) : R.cls.add(c);
  document.querySelectorAll('#recFacets .chip').forEach(b => {
    const k = b.dataset.c;
    b.classList.toggle('on', k ? R.cls.has(k) : R.cls.size === used.length);
  });
  draw();
};

function hit(n) {
  return R.cls.has(n.cls) && (!R.q || n.hay.includes(R.q));
}
function mark(s) {
  if (!R.q) return esc(s);
  const i = String(s).toLowerCase().indexOf(R.q);
  if (i < 0) return esc(s);
  return esc(String(s).slice(0, i)) + '<mark>' + esc(String(s).slice(i, i + R.q.length))
    + '</mark>' + esc(String(s).slice(i + R.q.length));
}

function draw() {
  const found = R.items.filter(hit);
  $('#recCount').textContent = found.length;
  if (!found.length) {
    $('#recBody').innerHTML = `<div class="warnbox">찾은 것이 없습니다.
      검색어를 줄이거나 위의 유형 필터를 더 켜 보세요.</div>`;
    return;
  }
  const groups = ORDER.filter(c => found.some(n => n.cls === c));
  $('#recBody').innerHTML = groups.map(c => {
    const ns = found.filter(n => n.cls === c).sort((a, b) => b.deg - a.deg || a.label.localeCompare(b.label));
    // 800건을 한꺼번에 그리면 문서가 3만 픽셀이 된다. 유형마다 끊어서 보여 준다.
    const lim = R.more.has(c) ? ns.length : PAGE;
    return `<div class="rec-group">
      <h4><i class="dot" style="background:${clsColor(c)}"></i>${CLS[c].ko}
        <span>${ns.length}</span></h4>
      <div class="rec-grid">${ns.slice(0, lim).map(card).join('')}</div>
      ${ns.length > lim ? `<button class="btn sm rec-more" onclick="recMore('${c}')">
        ${CLS[c].ko} ${ns.length - lim}건 더 보기</button>` : ''}
    </div>`;
  }).join('');
}
window.recMore = c => { R.more.add(c); draw(); };

function card(n) {
  return `<a class="rec-card${n.img ? ' has-img' : ''}" href="#/item/${encodeURIComponent(short(n.id))}">
    ${n.img ? `<img class="thumb" src="${esc(n.img)}" alt="" loading="lazy">` : ''}
    <span class="c" style="color:${clsColor(n.cls)}">${CLS[n.cls].ko}</span>
    <b>${mark(n.label)}</b>
    ${n.date ? `<time>${esc(n.date)}</time>` : ''}
    ${n.desc ? `<p>${mark(String(n.desc).slice(0, 70))}</p>` : ''}
    <i class="deg">연결 ${n.deg}${n.same?.length ? ` · 외부 ${n.same.length}` : ''}</i>
  </a>`;
}

/* ── 라우팅 ── */
const RIC = 'http://archives.nanet.go.kr/id/';
/* 외부 URI 를 사람이 읽는 이름으로. 어디로 가는 링크인지 보이지 않으면 소용이 없다. */
const EXT = [
  [/wikidata\.org\/entity\/(Q\d+)/, '위키데이터', m => m[1]],
  [/viaf\.org\/viaf\/(\d+)/, 'VIAF', m => m[1]],
  [/ko\.wikipedia\.org\/wiki\/(.+)/, '한국어 위키백과', m => decodeURIComponent(m[1]).replace(/_/g, ' ')],
];
const extName = u => {
  for (const [re, ko, f] of EXT) { const m = String(u).match(re); if (m) return [ko, f(m)]; }
  return ['외부 링크', String(u).replace(/^https?:\/\//, '').slice(0, 40)];
};
const short = u => String(u).startsWith(RIC) ? u.slice(RIC.length) : u;
const long = s => s.startsWith('http') ? s : RIC + s;

function route() {
  const m = location.hash.match(/^#\/item\/(.+)$/);
  if (m) item(decodeURIComponent(m[1]));
  else close();
}
window.openItem = id => { location.hash = '#/item/' + encodeURIComponent(short(id)); };
window.closeItem = () => { history.pushState('', '', location.pathname + location.search + '#record'); close(); };

function close() {
  const el = $('#itemView');
  el.classList.remove('on');
  document.body.classList.remove('item-open');
  el.innerHTML = '';
}

function item(sid) {
  const n = G.byId.get(long(sid));
  const el = $('#itemView');
  if (!n) {
    el.innerHTML = `<div class="item-wrap"><a class="back" href="#record" onclick="closeItem();return false">← 기록 찾아보기</a>
      <div class="warnbox">그런 개체가 없습니다: <code>${esc(sid)}</code></div></div>`;
    el.classList.add('on'); document.body.classList.add('item-open');
    return;
  }

  /* 연결 — 나가는 관계와 들어오는 관계를 나눠 모은다. 방향이 곧 뜻이기 때문이다. */
  const out = {}, inn = {};
  G.edges.forEach(e => {
    if (e.s === n.id) (out[e.p] ||= []).push(G.byId.get(e.o));
    if (e.o === n.id) (inn[e.p] ||= []).push(G.byId.get(e.s));
  });
  const rows = [];
  for (const [p, list] of Object.entries(out))
    rows.push({ dir: '→', p, ko: REL_KO[p] || p, list: list.filter(Boolean) });
  for (const [p, list] of Object.entries(inn)) {
    // 들어오는 관계는 RiC-O 가 정의한 '역속성'의 이름으로 부른다.
    // "소속 단체인 것" 같은 말을 만들어 쓰지 않는다 — 표준에 이미 이름이 있다.
    const inv = INVERSE[p];
    rows.push({ dir: '←', p: inv || p, ko: inv ? REL_KO[inv] : `${REL_KO[p] || p} — 이 개체를 가리킴`,
      list: list.filter(Boolean), rev: !inv });
  }
  const total = rows.reduce((s, r) => s + r.list.length, 0);

  const facts = [
    ['유형', CLS[n.cls].ko + ` <code>rico:${n.cls}</code>`],
    n.date && ['날짜', esc(n.date)],
    n.kind && ['분류', esc(n.kind)],
    (n.lat != null) && ['좌표', `${n.lat}, ${n.lon}`],
    ['식별자', `<code>ric:${esc(short(n.id))}</code>`],
    n.uuid && ['UUID', `<code>${esc(n.uuid)}</code>`],
    n.same?.length && ['동일 개체', n.same.map(u => {
      const [ko, id] = extName(u);
      return `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">
        ${esc(ko)} <span>${esc(id)}</span> ↗</a>`;
    }).join(' ') + `<div class="note">owl:sameAs — 다른 데이터셋의 같은 개체. 대칭·이행 관계이므로
      확인한 것만 붙입니다.</div>`],
  ].filter(Boolean);

  el.innerHTML = `<div class="item-wrap">
    <a class="back" href="#record" onclick="closeItem();return false">← 기록 찾아보기</a>

    <div class="item-head${n.img ? ' with-img' : ''}">
      ${n.img ? `<figure class="portrait"><img src="${esc(n.img)}" alt="${esc(n.label)}">
        ${n.imgSrc ? `<figcaption>${esc(n.imgSrc)}</figcaption>` : ''}</figure>` : ''}
      <div>
        <span class="badge" style="background:${clsColor(n.cls)}">${CLS[n.cls].ko}</span>
        <h2>${esc(n.label)}</h2>
        ${n.desc ? `<p class="lead">${esc(n.desc)}</p>` : ''}
      </div>
    </div>

    <table class="item-facts">${facts.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>

    <h3>연결된 개체 <span>${total}</span></h3>
    ${total ? rows.map(r => `
      <div class="link-row">
        <div class="rel">${r.dir} ${esc(r.ko)}
          <code>rico:${esc(r.p)}</code></div>
        <div class="chips-l">${r.list.map(o => `
          <a class="ent" href="#/item/${encodeURIComponent(short(o.id))}">
            <i class="dot" style="background:${clsColor(o.cls)}"></i>${esc(o.label)}
            <span>${CLS[o.cls].ko}</span></a>`).join('')}</div>
      </div>`).join('')
      : `<div class="warnbox">이 개체에는 아직 연결이 없습니다.
           관계를 더 넣으면 여기에 쌓입니다 — 그게 이 실습의 목표입니다.</div>`}

    <div class="item-foot">
      <button class="btn sm" onclick="focusInGraph('${esc(n.id)}')">관계망에서 보기 →</button>
      ${n.lat != null ? `<button class="btn sm" onclick="closeItem();selectPlace('${esc(n.id)}')">지도에서 보기 →</button>` : ''}
      <span class="status">출처 · ${SRC}</span>
    </div>
  </div>`;
  el.classList.add('on');
  document.body.classList.add('item-open');
  el.scrollTop = 0;
}

/** 관계망 섹션으로 가서 그 개체의 이웃만 남긴다 */
window.focusInGraph = id => {
  close();
  location.hash = '#graph-sec';
  const full = long(short(id));
  setTimeout(() => {
    if (typeof window.graphFocus === 'function') window.graphFocus(full);
    document.getElementById('graph-sec')?.scrollIntoView({ behavior: 'smooth' });
  }, 60);
};
