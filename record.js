/* 기록 — 찾아보기 · 아이템 페이지
   ─────────────────────────────────────────────────────────────
   BakedSearch 와 같은 생각으로 만들었다. 검색 서버를 두지 않고, 이미 브라우저에
   올라와 있는 그래프(G)를 그대로 색인 삼아 훑는다. 수천 건 규모까지는 이걸로 충분하다.

   아이템 페이지의 핵심은 '연결된 개체'다. 무엇과 이어져 있는지가 아니라
   **어떤 관계로** 이어져 있는지를 보여야 한다. 그게 표와 그래프의 차이다. */
import { G, CLS, REL_KO, RICO, esc, $, clsColor, parseHash, colHref, LANG, LIFE, topTfidf, sentencesWith, repImgOf } from './app.js';

const SRC = '『대한민국 국회를 말하다 08 정세균』(국회도서관, 2021)';
// 개념·개념체계도 개체다. 빼 두면 「전체」 수가 그래프와 어긋난다(실측 791 vs 810).
const ORDER = ['Record', 'RecordSet', 'Person', 'CorporateBody', 'Position', 'Event', 'Activity', 'Place', 'Rule',
  'Concept', 'ConceptScheme'];
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

/** 컬렉션이 바뀌면 색인을 다시 만든다 — G 가 갈렸는데 색인이 옛것이면
    박희태 컬렉션 안에서 정세균 기록이 나온다(실제로 그랬다). */
export function rebuildRecord() {
  R.items = index();
  R.more.clear();
  const used = ORDER.filter(c => R.items.some(n => n.cls === c));
  R.cls = new Set(used);
  facets(used);
  draw();
  /* 목록만 고치고 끝내면, 열려 있던 아이템 화면이 옛 G 로 그려진 채 남는다.
     부팅 때 그 차이가 그대로 드러났다 — initRecord 가 route 를 부르는 시점에는
     주소의 컬렉션이 아직 적재되기 전이라 G.byId 가 비어 있어서,
     #/c/<col>/item/<id> 로 바로 들어오면 「그런 개체가 없습니다」가 떴다.
     G 를 갈아끼운 쪽에서 다시 그려 준다. */
  route();
}
function facets(used) {
  $('#recFacets').innerHTML = `<button class="chip on c-all" onclick="recFacet('*')">전체</button>` +
    used.map(c => `<button class="chip on c-${CLS[c].key}" data-c="${c}" onclick="recFacet('${c}')">
      <i class="dot"></i>${CLS[c].ko} <b>${R.items.filter(n => n.cls === c).length}</b></button>`).join('');
}

export function initRecord() {
  if (R.built) return;
  R.built = true;
  R.items = index();

  const used = ORDER.filter(c => R.items.some(n => n.cls === c));
  facets(used);
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
  return `<a class="rec-card${n.img ? ' has-img' : ''}" href="${colHref('item/' + encodeURIComponent(short(n.id)))}">
    ${n.img ? `<img class="thumb" src="${esc(n.img)}" alt="" loading="lazy">` : ''}
    <span class="c" style="color:${clsColor(n.cls)}">${CLS[n.cls].ko}</span>
    <b>${mark(n.label)}</b>
    ${n.date ? `<time>${esc(n.date)}</time>` : ''}
    ${n.desc ? `<p>${mark(String(n.desc).slice(0, 70))}</p>` : ''}
    <i class="deg">연결 ${n.deg}${n.same?.length ? ` · 외부 ${n.same.length}` : ''}</i>
    <code class="uu" title="UUID">${esc(n.uuid || '—')}</code>
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
  // 주소 해석은 app.js 한 곳에서 한다 — 여기서 또 해석하면 컬렉션 접두를 놓친다
  const { rest } = parseHash();
  if (rest.startsWith('item/')) { item(decodeURIComponent(rest.slice(5))); return; }
  close();
  // 기록은 스크롤 중간의 한 토막이 아니라 **따로 선 페이지**다.
  // 800건을 훑는 일과 한 장면을 보는 일은 성격이 다르기 때문이다.
  const rec = rest === 'records';
  document.documentElement.classList.toggle('records-on', rec);
  document.body.classList.toggle('records-open', rec);
  if (rec) { $('#recQ')?.focus({ preventScroll: true }); scrollTo({ top: 0 }); }
}
window.openItem = id => { location.hash = colHref('item/' + encodeURIComponent(short(id))); };
window.closeItem = () => { location.hash = colHref('records'); };
window.openRecords = () => { location.hash = colHref('records'); };
window.closeRecords = () => { location.hash = colHref(''); scrollTo({ top: 0 }); };

function close() {
  const el = $('#itemView');
  el.classList.remove('on');
  document.body.classList.remove('item-open');
  el.innerHTML = '';
}

/** 인물 전용 하이라이트 — 초상 아래, 사실표 위.
 *
 *  구성(위에서 아래로): 재임 배지 → 핵심 인용문 → 수치 띠 → 생애 장면(사진 스트립) → 카드 4장.
 *  카드는 전부 **이미 있는 화면**(연표·관계망·주제)의 요약이다. 미니 지도·미니 관계망 캔버스를
 *  여기 또 띄우지 않는다 — Leaflet 인스턴스를 두 개 만들면 예전에 겪은
 *  "Map container is already initialized" 가 재발할 위험이 있기 때문이다.
 *
 *  지어내지 않는다:
 *    · 인용문·키워드는 corpus.txt 원문에서 tf-idf 로 고른 말이 실제로 나오는 문장(sentencesWith).
 *      코퍼스에 화자 구분이 없으므로 **hasCreator(구술자)로 걸린 인물에게만** 붙인다 —
 *      면담자나 그저 언급된 인물에게 붙이면 안 한 말을 한 것처럼 보인다.
 *    · 생애 장면은 frames.json 의 큐레이션 8컷 — 연도·설명·출처가 다 딸려 있고, 같은 이유로
 *      구술자 본인에게만 보인다.
 *    · 수치는 전부 지금 그래프에서 직접 센다. */
function personHighlight(n, out, inn) {
  const isNarrator = (inn['hasCreator'] || []).some(Boolean);
  const top = (isNarrator && LANG.paras.length) ? topTfidf(12) : [];
  const quote = top[0] ? sentencesWith(top[0].w, top[0].pi)[0] : null;

  const positionsAll = (out['occupiesOrOccupied'] || []).filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // 실측 154건 — 다 늘어놓으면 하이라이트가 아니라 그 자체로 페이지가 된다.
  // 최근 것 위주로 자르고, 나머지는 숨기지 않고 "+N건"으로 있다는 사실만 알린다.
  const POS_CAP = 6;
  const positions = positionsAll.slice(-POS_CAP).reverse();
  const posMore = positionsAll.length - positions.length;

  const events = (out['isOrWasParticipantIn'] || []).filter(Boolean);
  // 연표는 흐름을 보는 자리 — 자르기 전 전체에서 만든다.
  const timeline = [
    ...positionsAll.map(p => ({ date: p.date, label: p.label, cls: p.cls, id: p.id })),
    ...events.map(e => ({ date: e.date, label: e.label, cls: e.cls, id: e.id })),
  ].filter(x => x.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const places = (out['isAssociatedWithPlace'] || []).filter(Boolean);

  // 다룬 주제 — 이 인물이 구술자·면담자인 기록들의 주제 가운데 **개념만**(시소러스 층).
  // 고유명사 개체까지 섞으면 "주제" 라는 말이 흐려진다 — 그건 아래 연결 목록에 다 있다.
  const myRecords = [...(inn['hasCreator'] || []), ...(inn['hasAuthor'] || [])].filter(Boolean);
  const recIds = new Set(myRecords.map(r => r.id));
  const subjectIds = new Set();
  G.edges.forEach(e => {
    if (recIds.has(e.s) && e.p === 'hasOrHadSubject' && G.byId.get(e.o)?.cls === 'Concept') subjectIds.add(e.o);
  });
  const subjects = [...subjectIds].map(id => G.byId.get(id)).filter(Boolean);

  const totalLinks = Object.values(out).reduce((s, l) => s + l.length, 0)
    + Object.values(inn).reduce((s, l) => s + l.length, 0);

  if (!quote && !positionsAll.length && !timeline.length && !places.length && !subjects.length) return '';

  const lnk = o => colHref('item/' + encodeURIComponent(short(o.id)));
  /* 주제 화면과 같은 톤 — 원형 썸네일 칩. 자기 사진이 없으면 연결된 개체의 대표 이미지를
     빌려 오고(repImgOf), 그 사실을 title 로 밝힌다. */
  const entChip = o => {
    const r = repImgOf(o, n.id);
    const tip = r && r.from ? `${o.label} — 대표 이미지: 연결된 개체 「${r.from}」` : o.label;
    return `<a class="th-chip" href="${lnk(o)}" title="${esc(tip)}">
      ${r ? `<img src="${esc(r.src)}" alt="" loading="lazy">`
          : `<i style="background:${clsColor(o.cls)}"></i>`}
      <span>${esc(o.label)}</span></a>`;
  };
  const maxS = top.length ? Math.max(...top.map(x => x.s)) : 1;

  // 생애 장면 — 사진마다 연도·설명·출처. 개체가 그래프에 있으면 그 개체로 링크된다.
  const film = (isNarrator && LIFE.length) ? `<div class="p-film">
      <div class="p-film-head"><h4>생애 장면</h4><span>${LIFE.length}컷 · 출처는 각 장면에</span></div>
      <div class="p-film-track">${LIFE.map(f => {
        const ent = f.entity && G.byId.get(long(f.entity));
        const inner = `<img src="${esc(f.src)}" alt="${esc(f.label)}" loading="lazy">
          <figcaption><b>${esc(f.year)}</b><span>${esc(f.label)}</span><em>${esc(f.credit)}</em></figcaption>`;
        return ent
          ? `<a class="p-frame" href="${colHref('item/' + encodeURIComponent(f.entity))}">${inner}</a>`
          : `<figure class="p-frame">${inner}</figure>`;
      }).join('')}</div>
    </div>` : '';

  return `<div class="p-hl">
    ${positions.length ? `<div class="p-badges">${positions.map(p =>
      `<a class="p-badge" href="${lnk(p)}">${esc(p.label)}${p.date ? ` <em>${esc(p.date)}~</em>` : ''}</a>`).join('')}
      ${posMore > 0 ? `<span class="p-badge more">+${posMore}건 — 아래 연결된 개체에 전체</span>` : ''}</div>` : ''}

    ${quote ? `<blockquote class="p-quote"><p><b class="sp">◯${esc(n.label)}</b>${esc(quote.sent)}</p>
      <cite>구술 원문 · ${quote.i + 1}단락 — 원문에서 가장 특징적인 대목(tf-idf)에서 그대로 가져왔습니다</cite></blockquote>` : ''}

    <div class="p-stats">
      <div><b>${totalLinks.toLocaleString('ko-KR')}</b><span>연결</span></div>
      <div><b>${positionsAll.length.toLocaleString('ko-KR')}</b><span>재임·직위</span></div>
      <div><b>${events.length.toLocaleString('ko-KR')}</b><span>참여 사건</span></div>
      <div><b>${subjects.length.toLocaleString('ko-KR')}</b><span>다룬 주제</span></div>
    </div>

    ${film}

    <div class="p-cards">
      ${top.length ? `<div class="p-card">
        <h4>핵심 키워드</h4>
        <div class="p-kw">${top.map(x => `<button class="p-kwc" style="--k:${(x.s / maxS).toFixed(3)}"
          onclick="personKeyword(this,'${esc(x.w)}')">${esc(x.w)}</button>`).join('')}</div>
        <div class="p-kw-out" hidden></div>
        <p class="p-cardnote">글자가 클수록 원문 한 대목에 유난히 몰린 말입니다(tf-idf). 눌러 보세요 —
          그 말이 나온 문장이 그대로 열립니다.</p>
      </div>` : ''}

      ${timeline.length ? `<div class="p-card">
        <h4>연표 <span>${timeline.length}</span></h4>
        <ul class="p-tl">${timeline.slice(0, 7).map(x => `<li>
          <span class="p-tl-date">${esc(x.date)}</span>
          <a href="${lnk(x)}"><i class="dot" style="background:${clsColor(x.cls)}"></i>${esc(x.label)}</a></li>`).join('')}</ul>
        ${timeline.length > 7 ? `<span class="p-cardnote">…외 ${timeline.length - 7}건</span>` : ''}
        <a class="btn sm" href="${colHref('event')}">연표에서 보기 →</a>
      </div>` : ''}

      ${places.length ? `<div class="p-card">
        <h4>관련 장소 <span>${places.length}</span></h4>
        <div class="chips-l">${places.slice(0, 14).map(entChip).join('')}</div>
        ${places.length > 14 ? `<span class="p-cardnote">…외 ${places.length - 14}곳</span>` : ''}
      </div>` : ''}

      ${subjects.length ? `<div class="p-card">
        <h4>다룬 주제 <span>${subjects.length}</span></h4>
        <div class="chips-l">${subjects.map(entChip).join('')}</div>
        <a class="btn sm" href="${colHref('subject')}">주제에서 보기 →</a>
      </div>` : ''}
    </div>
  </div>`;
}

/** 핵심 키워드 칩을 누르면 그 말이 나온 문장을 카드 안에 바로 편다 — 언어 화면(showWordSource)과
 *  같은 재료(sentencesWith)를 쓰지만, 여기는 #langNote 가 없는 화면이라 카드 안에 직접 그린다. */
window.personKeyword = (btn, w) => {
  const card = btn.closest('.p-card');
  const out = card.querySelector('.p-kw-out');
  const sents = sentencesWith(w, null).slice(0, 3);
  out.hidden = false;
  out.innerHTML = sents.length
    ? sents.map(s => `<p>${s.i + 1}단락 — ${esc(s.sent)}</p>`).join('')
    : `<p>원문에서 이 말이 나온 문장을 못 찾았습니다.</p>`;
  card.querySelectorAll('.p-kwc').forEach(b => b.classList.toggle('on', b === btn));
};

function item(sid) {
  const n = G.byId.get(long(sid));
  const el = $('#itemView');
  if (!n) {
    el.innerHTML = `<div class="item-wrap"><a class="back" href="${colHref('records')}">← 검색으로</a>
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
    <a class="back" href="${colHref('records')}">← 검색으로</a>

    <div class="item-head${n.img ? ' with-img' : ''}">
      ${n.img ? `<figure class="portrait"><img src="${esc(n.img)}" alt="${esc(n.label)}">
        ${n.imgSrc ? `<figcaption>${esc(n.imgSrc)}</figcaption>` : ''}</figure>` : ''}
      <div>
        <span class="badge" style="background:${clsColor(n.cls)}">${CLS[n.cls].ko}</span>
        <h2>${esc(n.label)}</h2>
        ${n.desc ? `<p class="lead">${esc(n.desc)}</p>` : ''}
      </div>
    </div>

    ${n.cls === 'Person' ? personHighlight(n, out, inn) : ''}

    <table class="item-facts">${facts.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>

    <h3>연결된 개체 <span>${total}</span></h3>
    ${total ? rows.map(r => `
      <div class="link-row">
        <div class="rel">${r.dir} ${esc(r.ko)}
          <code>rico:${esc(r.p)}</code></div>
        <div class="chips-l">${r.list.map(o => { const ri = repImgOf(o, n.id);
          const tip = ri && ri.from ? `${o.label} — 대표 이미지: 연결된 개체 「${ri.from}」` : o.label;
          return `
          <a class="th-chip" href="${colHref('item/' + encodeURIComponent(short(o.id)))}" title="${esc(tip)}">
            ${ri ? `<img src="${esc(ri.src)}" alt="" loading="lazy">`
                 : `<i style="background:${clsColor(o.cls)}"></i>`}
            <span>${esc(o.label)}</span><em>${CLS[o.cls].ko}</em></a>`; }).join('')}</div>
      </div>`).join('')
      : `<div class="warnbox">이 개체에는 아직 연결이 없습니다.
           관계를 더 넣으면 여기에 쌓입니다 — 그게 이 실습의 목표입니다.</div>`}

    <div class="item-foot">
      <button class="btn sm" onclick="focusInGraph('${esc(n.id)}')">관계망에서 보기 →</button>
      ${n.lat != null ? `<button class="btn sm" onclick="showOnMap('${esc(n.id)}')">지도에서 보기 →</button>` : ''}
      <span class="status">출처 · ${SRC}</span>
    </div>
  </div>`;
  el.classList.add('on');
  document.body.classList.add('item-open');
  el.scrollTop = 0;
}

/** 지도 페이지로 가서 그 장소를 고른다.
    예전에는 closeItem() 이 기록 페이지로 되돌려 놓아 지도가 안 보였다. */
window.showOnMap = id => {
  close();
  location.hash = colHref('place');
  setTimeout(() => window.selectPlace?.(id), 80);
};

/** 관계망 섹션으로 가서 그 개체의 이웃만 남긴다 */
window.focusInGraph = id => {
  close();
  location.hash = colHref('graph-sec');
  const full = long(short(id));
  setTimeout(() => {
    if (typeof window.graphFocus === 'function') window.graphFocus(full);
    document.getElementById('graph-sec')?.scrollIntoView({ behavior: 'smooth' });
  }, 60);
};
