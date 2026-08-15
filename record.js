/* 기록 — 찾아보기 · 아이템 페이지
   ─────────────────────────────────────────────────────────────
   BakedSearch 와 같은 생각으로 만들었다. 검색 서버를 두지 않고, 이미 브라우저에
   올라와 있는 그래프(G)를 그대로 색인 삼아 훑는다. 수천 건 규모까지는 이걸로 충분하다.

   아이템 페이지의 핵심은 '연결된 개체'다. 무엇과 이어져 있는지가 아니라
   **어떤 관계로** 이어져 있는지를 보여야 한다. 그게 표와 그래프의 차이다. */
import { G, CLS, REL_KO, RICO, esc, $, clsColor, parseHash, colHref, colLabel, LANG, LIFE, topTfidf, sentencesWith, repImgOf } from './app.js';

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
  /* 검색은 이제 다른 여덟 화면과 같은 층위의 <section>이다(app.js 의 route 가 data-page 로 켠다).
     예전에는 main·footer 를 통째로 감추고 그 자리를 차지하는 별도 블록이라, 상태줄이 두 벌로
     갈리고 검색 화면에만 출처 표기가 없었다. 여기서는 검색으로 들어올 때의 채비만 한다. */
  const rec = rest === 'records';
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
  /* 명함 스캔(-card-)은 생애 「장면」이 아니라 실물 기록이라 사진 갤러리의 결을 깬다 — 뺀다.
     해당 개체 페이지(쌍용그룹·새정치국민회의)의 뷰어에는 그대로 남는다. */
  const cuts = LIFE.filter(f => !f.src.includes('-card-'));
  /* 갤러리 확장 — 이 인물에 **연결된** 개체의 사진을 곁들인다. 선별 규칙(전부 결정적):
     사건·활동·장소·인물만(단체는 로고 위험), 장소의 png 는 지도 조각이라 제외,
     극소형·저품질로 확인된 파일은 데니리스트. 순서는 유형 라운드로빈 —
     세로 초상과 가로 풍경이 번갈아 나와 모자이크 리듬이 생긴다. */
  const GAL_DENY = ['person-kim-jong-in', 'person-woo-byeong-u', 'place-daegu-airport',
    'place-cheongwadae', 'place-new-york'];
  const seenImg = new Set([n.img]);
  const galOk = o => o && o.img && !seenImg.has(o.img) && !o.img.includes('-card-')
    && ['Event', 'Activity', 'Place', 'Person'].includes(o.cls)
    && !(o.cls === 'Place' && /\.png$/i.test(o.img))
    && !GAL_DENY.some(d => o.img.includes(d));
  const pool = {};
  [...Object.values(out), ...Object.values(inn)].flat().forEach(o => {
    if (galOk(o)) { seenImg.add(o.img); (pool[o.cls] ||= []).push(o); }
  });
  Object.values(pool).forEach(l => l.sort((a, b) => a.label.localeCompare(b.label)));
  /* 연결 사진은 6컷까지만 — 갤러리의 주인공은 구술총서의 생애 컷들이고,
     연결 개체 사진은 곁들임이다(수십 장 이어 붙이면 정치인 얼굴 벽이 된다). */
  const rel = [];
  for (let i = 0; rel.length < 6; i++) {
    let got = false;
    for (const c of ['Event', 'Activity', 'Place', 'Person']) {
      const x = pool[c]?.[i];
      if (x && rel.length < 6) { rel.push(x); got = true; }
    }
    if (!got) break;
  }
  /* 연도 — 사진마다 언제인지. 생애 컷은 frames.json 의 year, 연결 개체는 그 개체의 날짜다.
     날짜가 없으면 세기만 적는다(19XX·20XX). 세기도 지어내지 않고 **이웃에게 묻는다** —
     그 개체와 이어진 개체들의 날짜 가운데 **가장 늦은 것**이 어느 세기인지를 본다.
     사진은 대개 그 개체가 마지막으로 등장한 무렵의 것이기 때문이다(김근태·국회의사당·
     제20대 총선 → 20XX). 이웃도 말이 없으면 19XX — 구술총서의 옛 컷들이 그렇다. */
  const yr4 = v => (String(v || '').match(/\d{4}/) || [])[0];
  const nbrs = id => G.edges.filter(e => e.s === id || e.o === id)
    .map(e => G.byId.get(e.s === id ? e.o : e.s)).filter(Boolean);
  const centuryOf = id => {
    // 인물의 date 는 생년이라 사진의 때를 말해 주지 않는다 — 이웃을 셀 때도 뺀다
    // (제20대 총선이 19XX 였던 까닭: 이웃 정세균의 생년 1950 이 유일한 날짜였다)
    const years = ns => ns.filter(x => x.cls !== 'Person').map(x => +yr4(x.date)).filter(y => y > 1800);
    const one = nbrs(id);
    let ys = years(one);
    // 이웃이 말이 없으면 그 이웃의 이웃까지 — 제20대 총선처럼 자기도 이웃도 날짜가 없는 개체가 있다
    if (!ys.length) ys = years(one.flatMap(x => nbrs(x.id)));
    if (!ys.length) return '19XX';
    return Math.max(...ys) >= 2000 ? '20XX' : '19XX';
  };
  const yrTag = (v, id) => { const y = yr4(v);
    return `<b class="p-yr${y ? '' : ' unk'}">${y || (id ? centuryOf(id) : '19XX')}</b>`; };
  /* 사진의 때는 세 곳에 물어 순서대로 쓴다.
     ① 이미지 출처 표기의 연도 — 「Wikimedia Commons · … · 2008 촬영」처럼 사진 자체의 근거다.
     ② 개체의 날짜 — 사건·활동은 그 날이 곧 사진의 때다.
     ③ 인물의 date 는 생년(rico:beginningDate)이라 쓰지 않는다(강재섭 사진에 1948 이 붙어 있었다). */
  const photoYear = o => yr4(o.imgSrc) || (o.cls === 'Person' ? '' : o.date);
  const relFrames = rel.map(o => `<a class="p-frame" href="${colHref('item/' + encodeURIComponent(short(o.id)))}"
      title="${esc(o.label)}${o.imgSrc ? ` — ${esc(o.imgSrc)}` : ''}">
      <img src="${esc(o.img)}" alt="${esc(o.label)}">${yrTag(photoYear(o), o.id)}</a>`).join('');
  /* 갤러리는 무괘 — 라벨도 선도 없이 어록 다음에 흐른다. 출처는 각 컷의 호버와
     개체 페이지 뷰어가 진다(규율 유지). */
  /* 이미지가 하나 실릴 때마다 비율이 확정되므로 masonry 를 다시 잰다(디바운스). */
  setTimeout(() => document.querySelectorAll('.p-film-track img').forEach(img => {
    if (img.complete) { masonrySoon(); tintYear(img); }
    else { img.addEventListener('load', () => { masonrySoon(); tintYear(img); }, { once: true });
           img.addEventListener('error', masonrySoon, { once: true }); }
  }), 0);
  const film = (isNarrator && cuts.length) ? `<div class="p-film">
      <div class="p-film-track">${cuts.map(f => {
        const ent = f.entity && G.byId.get(long(f.entity));
        /* 이미지만 — 글자는 없다. 연도·설명·크레딧(출처 규율)은 호버 제목이 지고,
           눌러 들어간 개체 페이지의 뷰어가 같은 정보를 캡션으로 제대로 보여 준다.
           비율도 원본 그대로 — 자르지 않는다. */
        const inner = `<img src="${esc(f.src)}" alt="${esc(f.label)}">${yrTag(f.year)}`;
        const tip = `${f.year} · ${f.label} — ${f.credit}`;
        if (ent && ent.id === n.id)
          return `<button class="p-frame" onclick="mvJump('${esc(f.src)}')" title="${esc(tip)} — 뷰어로 보기">${inner}</button>`;
        return ent
          ? `<a class="p-frame" href="${colHref('item/' + encodeURIComponent(f.entity))}" title="${esc(tip)}">${inner}</a>`
          : `<figure class="p-frame" title="${esc(tip)}">${inner}</figure>`;
      }).join('')}${relFrames}</div>
    </div>` : '';

  /* A-1 전기(傳記) 한 줄 — 배지 알약을 걷고, 대표 직함(재임 시작 최신 — 데이터가 정한다)만
     먹글로 서고 나머지는 배음으로 눕는다. 수치 극장(p-stats)은 서지 정의목록의 「연결」 행이 흡수했다. */
  const bio = (() => {
    if (!positionsAll.length) return '';
    const dated = positionsAll.filter(p => p.date);
    const lead = dated.length ? dated[dated.length - 1] : positionsAll[positionsAll.length - 1];
    /* 실데이터는 재임이 수십 건 — 전기 한 줄은 최근 5건까지만 이름을 부르고
       나머지는 수로만 남긴다(전체는 아래 연결된 개체·서지의 연결 행에 있다). */
    const rest = positionsAll.filter(p => p !== lead).reverse().slice(0, 5);
    const more = positionsAll.length - 1 - rest.length;
    return `<div class="p-bio">
      <a class="lead" href="${lnk(lead)}">${esc(lead.label)}</a>${lead.date ? `<em>${esc(lead.date)}~</em>` : ''}
      ${rest.length ? `<span class="dash">—</span><span class="rest">${rest.map(p =>
        `<a href="${lnk(p)}">${esc(p.label)}</a>`).join(' · ')}${more > 0 ? ` · 외 ${more}건` : ''}</span>` : ''}
    </div>`;
  })();

  return `<div class="p-hl">
    ${bio}

    ${quote ? `<blockquote class="p-quote"><p>${esc(quote.sent)}</p>
      <cite>${esc(n.label)} 구술 · ${quote.i + 1}단락 — 원문에서 가장 특징적인 대목(tf-idf)에서 그대로 가져왔습니다</cite></blockquote>` : ''}

    ${film}

    ${top.length ? `<div class="p-card">
        <h4>핵심 키워드</h4>
        <div class="p-kw">${top.map(x => {
          /* 단락 지문 — 이 말이 구술 몇 단락에 몰려 있는지를 단락 수만큼의 칸으로 눕힌다.
             칸의 진하기는 그 단락에서의 빈도. 크기(칩)만 있던 정보에 「어디의 말인가」가 붙는다. */
          const cells = LANG.byChapter.map(c => c.freq[x.w] || 0);
          const mx = Math.max(...cells, 1);
          const strip = cells.map(v =>
            `<i style="opacity:${v ? (0.25 + 0.75 * v / mx).toFixed(2) : 0}"></i>`).join('');
          return `<button class="p-kwc" style="--k:${(x.s / maxS).toFixed(3)}"
            onclick="personKeyword(this,'${esc(x.w)}')">
            <b>${esc(x.w)}</b>
            <span class="kw-strip" aria-hidden="true">${strip}</span>
            <em>${x.pi + 1}단락</em></button>`; }).join('')}</div>
        <div class="p-kw-out" hidden></div>
        <p class="p-cardnote">글자가 굵을수록 원문 한 대목에 유난히 몰린 말(tf-idf), 오른쪽 띠는 그 말이
          구술 ${LANG.byChapter.length}단락 중 어디에 몰려 있는지입니다. 눌러 보세요 —
          그 말이 나온 문장이 그대로 열립니다.</p>
      </div>` : ''}

    <div class="p-cards">
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

/* ── 개체 미디어 뷰어 ──
   이 개체에 붙은 미디어를 전부 모은다. 원천은 두 곳뿐이다(지어내지 않는다):
   ① 개체 자신의 foaf:depiction — 출처는 n.imgSrc
   ② 생애 장면(frames.json)에서 이 개체를 가리키는 컷 — 연도·설명·크레딧이 딸려 온다.
   ①의 캡션은 개체를, ②의 캡션은 그 장면을 말하므로 둘이 다른 것이 정상이다.
   그 정보를 이미지 카드에 그대로 붙여 다니게 해야 「필름에서 본 설명과 페이지 제목이
   다르다」는 혼동이 사라진다 — 설명은 개체가 아니라 장면의 것이었다. */
function mediaOf(n) {
  const list = [];
  if (n.img) list.push({ src: n.img, cap: n.label, credit: n.imgSrc || '' });
  LIFE.filter(f => f.entity && long(f.entity) === n.id)
    .forEach(f => list.push({ src: f.src, cap: `${f.year} · ${f.label}`, credit: f.credit || '' }));
  return list;
}
let MV = [];
let MV_I = 0;
window.mvShow = i => {
  const m = MV[i]; if (!m) return;
  MV_I = i;
  const img = $('#mvImg'), cap = $('#mvCap'), pg = $('#mvPg');
  if (img) { img.src = m.src; img.alt = m.cap; }
  if (cap) { cap.querySelector('b').textContent = m.cap; cap.querySelector('em').textContent = m.credit; }
  if (pg) pg.textContent = `${i + 1} / ${MV.length}`;
};
window.mvStep = d => mvShow((MV_I + d + MV.length) % MV.length);
/* 갤러리에서 「본인」 컷을 누르면 — 같은 페이지로 가는 링크는 죽은 클릭처럼 느껴진다 —
   상단 뷰어를 그 사진으로 넘기고 화면을 뷰어로 올린다. */
window.mvJump = src => {
  const i = MV.findIndex(m => m.src === src);
  if (i < 0) return;
  mvShow(i);
  document.querySelector('.m-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
/* 캡션은 접어 둔다 — 사진이 먼저 말하고, 출처·설명은 원할 때 편다. */
window.mvCapToggle = btn => {
  const cap = $('#mvCap');
  if (!cap) return;
  cap.hidden = !cap.hidden;
  btn.setAttribute('aria-expanded', String(!cap.hidden));
  btn.textContent = cap.hidden ? '캡션' : '캡션 닫기';
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

  /* 서지의 「연결」 행 — 사람이면 재임·사건·주제 요약을 곁들인다(옛 통계 띠의 자리). */
  const linkRow = (() => {
    if (n.cls !== 'Person') return String(total);
    const R = (out['occupiesOrOccupied'] || []).length;
    const E = (out['isOrWasParticipantIn'] || []).length;
    const recIds = new Set([...(inn['hasCreator'] || []), ...(inn['hasAuthor'] || [])].filter(Boolean).map(x => x.id));
    const S = new Set();
    G.edges.forEach(e => {
      if (recIds.has(e.s) && e.p === 'hasOrHadSubject' && G.byId.get(e.o)?.cls === 'Concept') S.add(e.o);
    });
    return `${total} — 재임 ${R} · 사건 ${E} · 주제 ${S.size}`;
  })();
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
    ['연결', linkRow],
  ].filter(Boolean);

  /* 미디어가 있으면 상단 뷰어가 머리의 작은 초상을 대신한다 — 같은 사진을 두 번 걸지 않는다. */
  const media = mediaOf(n);
  MV = media; MV_I = 0;

  el.innerHTML = `<div class="item-wrap">

    ${media.length ? `<figure class="m-view">
      <div class="m-stage"><img id="mvImg" src="${esc(media[0].src)}" alt="${esc(media[0].cap)}"></div>
      <div class="m-bar">
        ${media.length > 1 ? `<button class="m-nav" onclick="mvStep(-1)" aria-label="이전 이미지">‹</button>
          <span class="m-pg" id="mvPg">1 / ${media.length}</span>
          <button class="m-nav" onclick="mvStep(1)" aria-label="다음 이미지">›</button>` : ''}
        <button class="m-cap-btn" onclick="mvCapToggle(this)" aria-expanded="false">캡션</button>
      </div>
      <figcaption id="mvCap" hidden><b>${esc(media[0].cap)}</b><em>${esc(media[0].credit)}</em></figcaption>
    </figure>` : ''}

    <div class="item-head">
      <div>
        <h2>${esc(n.label)}</h2>
        ${n.desc ? `<p class="lead">${esc(n.desc)}</p>` : ''}
      </div>
    </div>

    ${n.cls === 'Person' ? personHighlight(n, out, inn) : ''}

    <h3 class="zsec">서지</h3>
    <dl class="facts-dl">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>

    <h3 class="zsec">연결된 개체 <span>${total}</span></h3>
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
  buildMasonry();
}

/** 갤러리 masonry — 바닥까지 일자.
 *  ① 열 폭(≈168px)으로 열 수를 정하고, 각 컷의 표시 높이(열폭÷원본비율)를 잰다.
 *  ② 가장 짧은 기둥에 차례로 쌓는다(greedy) — 기둥 높이가 서로 엇비슷해진다.
 *  ③ 남은 몇 % 차이는 기둥별 비례 스케일로 흡수한다 — 열 폭은 그대로,
 *     세로만 살짝 늘거나 줄어 cover 크롭 1~5% 안에서 바닥이 정확히 맞는다. */
function buildMasonry() {
  const track = document.querySelector('.p-film-track');
  if (!track) return;
  const W = track.clientWidth;
  if (!W) return;
  const GAP = 10, IDEAL = 168;
  const frames = [...track.querySelectorAll('.p-frame')];
  if (!frames.length) return;
  const K = Math.max(2, Math.round((W + GAP) / (IDEAL + GAP)));
  /* 기둥 폭은 왼쪽이 넓고 오른쪽으로 갈수록 좁아진다(유로피아나 갤러리 문법) —
     첫 컷에 눈이 먼저 가고, 뒤로 갈수록 물러나며 리듬이 생긴다.
     폭은 1.0 → 0.62 로 고르게 줄고, 합이 늘 가용 폭과 같도록 정규화한다. */
  const FALL = 0.62;
  const wts = Array.from({ length: K }, (_, i) => K < 2 ? 1 : 1 - (1 - FALL) * (i / (K - 1)));
  const sumW = wts.reduce((a, b) => a + b, 0);
  const avail = W - GAP * (K - 1);
  const colWs = wts.map(w => avail * w / sumW);
  /* 옛것부터 왼쪽으로 — 갤러리가 왼쪽에서 오른쪽으로 시간을 따라 흐른다.
     세기만 아는 컷(19XX·20XX)은 그 세기의 첫 해로 놓는다. 연도는 화면에 이미 적혀 있는 것을
     그대로 읽는다 — 정렬 기준과 표기가 어긋나면 보는 사람이 먼저 안다. */
  const yrKey = f => {
    const t = f.querySelector('.p-yr')?.textContent || '';
    return t.startsWith('20X') ? 2000 : t.startsWith('19X') ? 1900 : (+t || 9999);
  };
  frames.sort((a, b) => yrKey(a) - yrKey(b));
  const ar = f => {
    const img = f.querySelector('img');
    return (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : .75;
  };
  const cols = colWs.map(w => ({ w, h: 0, items: [] }));
  const total = c => c.h + GAP * Math.max(0, c.items.length - 1);   // 간격까지 넣은 기둥 총높이
  /* 기둥은 왼쪽부터 차례로 채운다 — 균형만 보고 짧은 기둥에 던지면 시간 순서가 흩어진다.
     기둥 하나가 목표 높이에 이르면 다음 기둥으로 넘어간다(목표는 평균 기둥 높이의 어림값).
     기둥마다 폭이 다르므로 컷 높이는 넣을 기둥을 정한 뒤에 잰다. */
  const avgW = avail / K;
  const H = (frames.reduce((s, f) => s + avgW / ar(f), 0) + GAP * (frames.length - K)) / K;
  let k = 0;
  frames.forEach(f => {
    while (k < K - 1 && total(cols[k]) >= H) k++;
    const c = cols[k];
    const it = { f, h: c.w / ar(f) };
    c.items.push(it); c.h += it.h;
  });
  const used = cols.filter(c => c.items.length);
  const target = used.reduce((s, c) => s + total(c), 0) / used.length;
  track.textContent = '';
  used.forEach(c => {
    const d = document.createElement('div');
    d.className = 'p-col';
    d.style.width = c.w.toFixed(2) + 'px';
    /* 간격은 스케일되지 않으므로 빼고 나눈다 — 이걸 빼먹으면 기둥별 컷 수 차이만큼
       (6px × 개수차) 바닥이 어긋난다(실측 12px). */
    const s = (target - GAP * Math.max(0, c.items.length - 1)) / c.h;
    c.items.forEach(it => {
      it.f.style.height = (it.h * s).toFixed(2) + 'px';
      d.appendChild(it.f);
    });
    track.appendChild(d);
  });
}
/* 연도 글자색을 사진에 맞춘다 — 평소엔 흑백 위에 자주로 서지만, 호버로 원본 색이
   돌아오면 그 자리가 밝은지 어두운지에 따라 글자가 읽히지 않는다. 글자가 놓이는
   글자가 앉는 한복판만 실제로 재서(캔버스 16×16) 밝으면 먹, 어두우면 흰 글자를 준다.
   사진은 같은 출처(로컬)라 캔버스가 오염되지 않는다. */
function tintYear(img) {
  const frame = img.closest('.p-frame');
  if (!frame || !frame.querySelector('.p-yr')) return;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    // 가운데 절반 — 글자가 앉는 자리(연도는 컷 한복판에 선다)
    g.drawImage(img, w * 0.25, h * 0.25, w * 0.5, h * 0.5, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
    lum /= (d.length / 4) * 255;
    const light = lum > 0.55;
    frame.dataset.tone = light ? 'light' : 'dark';
    frame.style.setProperty('--yr-hover', light ? '#17151a' : '#ffffff');
    // 획 둘레에 두르는 반대색 — 밝은 사진 위 먹글자에는 흰 테, 어두운 사진 위 흰글자에는 먹 테
    frame.style.setProperty('--yr-halo', light ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)');
  } catch (e) { /* 캔버스가 막힌 환경 — 기본 흰 글자로 둔다 */ }
}
let msT = null;
const masonrySoon = () => { clearTimeout(msT); msT = setTimeout(buildMasonry, 60); };
addEventListener('load', masonrySoon);

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
