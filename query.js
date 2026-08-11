/* 질의 — 지식그래프에게 묻다
   ① 유형별 질문 6개: 미리 만든 SPARQL 을 실제로 실행 (API 키 불필요)
   ② SPARQL 플레이그라운드: 빈칸 채우기 + 직접 편집
   ③ 자연어 질의: Claude 가 SPARQL 생성 → 엔진 실행 → 답변 (API 키 필요) */
import { q, rows, esc, $, G, REL_KO, CLS, clsColor, RICO } from './app.js';

const RIC = 'http://archives.nanet.go.kr/id/';
const short = u => String(u).startsWith(RIC) ? u.slice(RIC.length) : u;
const nameOf = u => G.byId.get(u)?.label || short(u);

/* ── 유형별 질문 6개 ── */
const QS = [
  {
    tag: '경로 · 다단계', t: '정세균은 어떤 직위를 거쳐 어디에 속했나?',
    sparql: `SELECT ?사람 ?직위 ?시작 ?종료 ?단체 WHERE {
  ?p rico:name "정세균" ; rico:name ?사람 ; rico:occupiesOrOccupied ?pos .
  ?pos rico:name ?직위 ; rico:existsOrExistedIn ?org .
  ?org rico:name ?단체 .
  OPTIONAL { ?pos rico:beginningDate ?시작 } OPTIONAL { ?pos rico:endDate ?종료 }
} ORDER BY ?시작`,
    why: '인물 → 직위 → 단체. 세 홉을 따라가야 나오는 답입니다. 표 한 장으로는 못 합니다.',
    ai: '정세균은 국회의원과 국회의장을 지냈습니다. 대한민국 국회 소속이었고 여러 정당에서 활동했습니다.',
  },
  {
    tag: '전수 · 빠짐없음', t: '구술에 등장하는 장소를 모두 말해줘.',
    sparql: `SELECT ?장소 ?유형 WHERE {
  ?p a rico:Place ; rico:name ?장소 .
  OPTIONAL { ?p rdfs:comment ?유형 }
} ORDER BY ?유형 ?장소`,
    why: '“모두”라는 요구에 그래프는 빠짐없이 답합니다. LLM은 기억나는 것만 말합니다.',
    ai: '진안, 전주, 서울, 뉴욕 정도가 언급된 것 같습니다. 정확한 목록은 원문을 확인해야 합니다.',
  },
  {
    tag: '이웃 · 연결', t: '‘국회미래연구원 설립’과 직접 연결된 개체는?',
    sparql: `SELECT ?관계 ?상대 WHERE {
  ?e rico:name "국회미래연구원 설립" .
  { ?e ?rel ?x . ?x rico:name|rico:title ?상대 . BIND(STRAFTER(STR(?rel),"#") AS ?관계) }
  UNION
  { ?x ?rel ?e . ?x rico:name|rico:title ?상대 . BIND(CONCAT("← ",STRAFTER(STR(?rel),"#")) AS ?관계) }
}`,
    why: '양방향 이웃을 한 번에. 참여자·근거법률·장소·결과까지 관계의 종류를 구분해 보여 줍니다.',
    ai: '국회미래연구원은 국회 산하 연구기관으로, 정세균 의장 재임 중 설립이 추진된 것으로 알려져 있습니다.',
  },
  {
    tag: '필터 · 조인', t: '1990년대에 일어난 사건과 그 장소는?',
    sparql: `SELECT ?사건 ?연도 ?장소 WHERE {
  ?e a rico:Event ; rico:name ?사건 ; rico:beginningDate ?연도 .
  FILTER(STRSTARTS(STR(?연도), "199"))
  OPTIONAL { ?e rico:isAssociatedWithPlace ?pl . ?pl rico:name ?장소 }
} ORDER BY ?연도`,
    why: '날짜 조건으로 거르고 장소를 조인합니다. 없으면 빈칸으로 두지, 지어내지 않습니다.',
    ai: '1990년대에는 한보사태, IMF 외환위기, 김대중 대통령 당선 등이 있었습니다.',
  },
  {
    tag: '집계 · 중심성', t: '가장 많은 관계로 연결된 개체 Top 5는?',
    sparql: `SELECT ?개체 (COUNT(*) AS ?관계수) WHERE {
  { ?s ?p ?o . ?s rico:name ?개체 . FILTER(isIRI(?o)) }
  UNION
  { ?s ?p ?o . ?o rico:name ?개체 . FILTER(isIRI(?o)) }
} GROUP BY ?개체 ORDER BY DESC(?관계수) LIMIT 5`,
    why: '집계는 그래프의 강점입니다. “누가 허브인가”를 세어서 답합니다.',
    ai: '아마 정세균이 가장 많이 등장할 것이고, 국회나 주요 정치인들도 자주 나올 것 같습니다.',
  },
  {
    tag: '부재 · 반환각', t: '정세균이 작곡한 곡은?',
    sparql: `SELECT ?작품 WHERE {
  ?p rico:name "정세균" ; rico:isCreatorOf ?w .
  ?w rico:title ?작품 .
}`,
    why: '★ 없는 것을 물었습니다. 그래프는 결과 0건 — “없습니다”라고 답합니다. LLM은 그럴듯한 문장을 만들어낼 수 있습니다.',
    ai: '정세균 의장은 정치 활동 중 여러 연설과 저술을 남겼으며, 음악적 소양도 있었던 것으로 알려져 있습니다. (← 근거 없음)',
  },
];

let cur = -1, tab = 'graph';

export function initQuery() {
  $('#qList').innerHTML = QS.map((x, i) =>
    `<button class="q-card" id="qc${i}" onclick="pickQ(${i})">
      <span class="tag">${esc(x.tag)}</span><span class="t">${esc(x.t)}</span></button>`).join('');
  buildSelects();
  loadExample(0);
  renderKey();
}

window.pickQ = i => {
  cur = i;
  document.querySelectorAll('.q-card').forEach((c, j) => c.classList.toggle('on', i === j));
  renderQ();
};
window.qTab = t => { tab = t; renderQ(); };

function renderQ() {
  if (cur < 0) return;
  const x = QS[cur];
  ['G', 'A', 'S'].forEach((k, i) =>
    $('#tab' + k).classList.toggle('on', ['graph', 'ai', 'sparql'][i] === tab));
  const body = $('#qBody');

  if (tab === 'sparql') {
    body.innerHTML = `<pre>${esc(x.sparql)}</pre>
      <button class="btn sm" onclick="toEditor(${cur})">편집창에 넣기 ↓</button>`;
    return;
  }
  if (tab === 'ai') {
    body.innerHTML = `<div class="warnbox"><b>원문만 읽은 AI의 자유 해석입니다.</b>
      그럴듯하지만 <b>출처가 없고</b>, 빠짐없지 않으며, 없는 것도 있다고 말할 수 있습니다.</div>
      <div class="ans">${esc(x.ai)}</div>
      <div class="ans-src">근거: 없음 — 이 답은 어느 쪽수에서 왔는지 말할 수 없습니다.</div>`;
    return;
  }
  // graph
  let res;
  try { res = rows(x.sparql); }
  catch (e) { body.innerHTML = `<div class="warnbox">질의 오류: ${esc(e.message)}</div><pre>${esc(x.sparql)}</pre>`; return; }
  const vars = res.length ? Object.keys(res[0]) : [];
  body.innerHTML = `
    <div class="okbox"><b>${res.length ? `그래프에서 ${res.length}건을 찾았습니다.` : '그래프에 해당 정보가 없습니다 — 지어내지 않습니다.'}</b>
      ${esc(x.why)}</div>
    ${res.length ? `<div style="overflow-x:auto"><table><tr>${vars.map(v => `<th>${esc(v)}</th>`).join('')}</tr>
      ${res.slice(0, 30).map(r => `<tr>${vars.map(v => `<td>${esc(short(r[v]))}</td>`).join('')}</tr>`).join('')}
      </table></div>` : ''}
    <div class="ans-src">근거: 『대한민국 국회를 말하다 08 정세균』(국회도서관, 2021)에서 추출한 트리플 ·
      질의는 브라우저 안의 Oxigraph 엔진이 실행</div>`;
}
window.toEditor = i => {
  $('#qEditor').value = QS[i].sparql;
  $('#qEditor').scrollIntoView({ block: 'center', behavior: 'smooth' });
};

/* ── 플레이그라운드 ── */
function buildSelects() {
  const named = G.nodes.filter(n => n.label).sort((a, b) =>
    a.cls.localeCompare(b.cls) || a.label.localeCompare(b.label));
  const opts = named.map(n =>
    `<option value="ric:${short(n.id)}">${esc(n.label)} (${CLS[n.cls]?.ko || n.cls})</option>`).join('');
  $('#bS').innerHTML = `<option value="?주어">?주어 (알고 싶은 것)</option>` + opts;
  $('#bO').innerHTML = `<option value="?목적어">?목적어 (알고 싶은 것)</option>`
    + Object.keys(CLS).map(c => `<option value="rico:${c}">${CLS[c].ko} 클래스 (rico:${c})</option>`).join('')
    + opts;
  const rels = [...new Set(G.edges.map(e => e.p))];
  $('#bP').innerHTML = `<option value="?관계">?관계 (아무 관계)</option>`
    + `<option value="a">a (종류/rdf:type)</option>`
    + rels.map(p => `<option value="rico:${p}">${esc(REL_KO[p] || p)} (${p})</option>`).join('')
    + `<option value="rico:name">이름 (rico:name)</option>`
    + `<option value="rico:beginningDate">시작일 (rico:beginningDate)</option>`;
  buildQ();
}
window.buildQ = () => {
  const s = $('#bS').value, p = $('#bP').value, o = $('#bO').value;
  const vars = [s, p, o].filter(v => v.startsWith('?'));
  const sel = vars.length ? vars.join(' ') : '*';
  $('#qEditor').value = `SELECT ${sel} WHERE {\n  ${s} ${p} ${o} .\n} LIMIT 50`;
};
const EXAMPLES = [
  `SELECT ?이름 WHERE {\n  ?p a rico:Person ; rico:name ?이름 .\n}`,
  `SELECT ?사건 ?연도 WHERE {\n  ?p rico:name "정세균" ; rico:isOrWasParticipantIn ?e .\n  ?e rico:name ?사건 .\n  OPTIONAL { ?e rico:beginningDate ?연도 }\n} ORDER BY ?연도`,
  `SELECT ?이름 ?직위 ?시작 WHERE {\n  ?p rico:occupiesOrOccupied ?pos ; rico:name ?이름 .\n  ?pos rico:name ?직위 ; rico:beginningDate ?시작 .\n} ORDER BY ?시작`,
  `SELECT ?관계 (COUNT(*) AS ?개수) WHERE {\n  ?s ?rel ?o . FILTER(isIRI(?o))\n  BIND(STRAFTER(STR(?rel),"#") AS ?관계)\n} GROUP BY ?관계 ORDER BY DESC(?개수)`,
  `SELECT DISTINCT ?둘째단계 WHERE {\n  ?p rico:name "정세균" .\n  ?p ?r1 ?mid . ?mid ?r2 ?x .\n  ?x rico:name ?둘째단계 .\n  FILTER(?x != ?p)\n} LIMIT 40`,
  /* ── 시소러스 전/후 ── 같은 질문을 두 번 던진다.
     ⑤ 시소러스가 없으면 찾을 것을 사람이 미리 다 알아야 한다. 빠뜨린 것은 영영 안 걸린다.
     ⑥ 있으면 상위 개념 하나로 아래를 전부 끌어온다. broader 는 추론이 없으므로
        `*`(속성 경로)로 **직접 타고 내려가야** 한다 — 이 별표 하나가 시소러스의 값어치다. */
  `# 시소러스가 없을 때 — 찾을 것을 미리 다 알아야 한다\nSELECT ?자료 WHERE {\n  VALUES ?s {\n    ric:org-nosajeong ric:event-hanbo\n    ric:event-cleaner ric:act-labor-reform\n  }\n  ?x rico:hasOrHadSubject ?s .\n  OPTIONAL { ?x rico:title ?자료 } OPTIONAL { ?x rico:name ?자료 }\n}`,
  `# 시소러스가 있을 때 — 상위 개념 하나로 아래를 전부 끌어온다\nSELECT ?자료 ?주제 WHERE {\n  ?c skos:broader* ric:concept-nodong ; skos:prefLabel ?주제 .\n  ?x rico:hasOrHadSubject ?c .\n  OPTIONAL { ?x rico:title ?자료 } OPTIONAL { ?x rico:name ?자료 }\n}`,
];
window.loadExample = i => { $('#qEditor').value = EXAMPLES[i]; };
window.runEditor = () => {
  const out = $('#qResult');
  let res;
  try { res = rows($('#qEditor').value); }
  catch (e) { out.innerHTML = `<div class="warnbox">SPARQL 오류: ${esc(e.message)}</div>`; return; }
  if (!res.length) { out.innerHTML = `<div class="warnbox">결과 0건 — 그래프에 해당 패턴이 없습니다.</div>`; return; }
  const vars = Object.keys(res[0]);
  out.innerHTML = `<p class="status" style="margin:.7rem 0 .3rem">${res.length}건</p>
    <div style="overflow-x:auto"><table><tr>${vars.map(v => `<th>${esc(v)}</th>`).join('')}</tr>
    ${res.slice(0, 60).map(r => `<tr>${vars.map(v => `<td>${esc(short(r[v]))}</td>`).join('')}</tr>`).join('')}
    </table></div>`;
};

/* ── API 키 ── */
const KEY = 'anthropic-key';
export const savedKey = () => localStorage.getItem(KEY) || '';
function renderKey() {
  const k = savedKey(), el = $('#keyState'), t = $('#keyStateTxt');
  if (k) {
    el.className = 'keystate on';
    t.textContent = `키 저장됨 · ${k.slice(0, 7)}…${k.slice(-4)}`;
    $('#keyHint').textContent = '이 브라우저에만 저장됩니다. 자연어 질의를 쓸 수 있습니다.';
    $('#apiKey').placeholder = '다른 키로 교체하려면 입력';
  } else {
    el.className = 'keystate off';
    t.textContent = 'API 키 없음';
    $('#keyHint').textContent = '키 없이도 위 6개 질문은 SPARQL로 동작합니다';
    $('#apiKey').placeholder = 'sk-ant-...';
  }
}
window.saveKey = () => {
  const v = $('#apiKey').value.trim();
  if (!v) { alert('키를 입력하세요.'); return; }
  if (!v.startsWith('sk-ant-')) {
    if (!confirm('sk-ant- 로 시작하지 않습니다. 그대로 저장할까요?')) return;
  }
  localStorage.setItem(KEY, v);
  $('#apiKey').value = '';
  renderKey();
};
window.clearKey = () => { localStorage.removeItem(KEY); renderKey(); };

/* ── 자연어 질의 ── */
const SCHEMA = () => `클래스: ${Object.keys(CLS).map(c => 'rico:' + c).join(', ')}
속성(도메인 → 레인지):
 rico:occupiesOrOccupied (Person→Position)   rico:isOrWasOccupiedBy (Position→Person)
 rico:existsOrExistedIn (Position→CorporateBody)  rico:hasOrHadPosition (CorporateBody→Position)
 rico:isOrWasMemberOf (Person→CorporateBody)      rico:hasOrHadMember (CorporateBody→Person)
 rico:isOrWasParticipantIn (Person/단체→Event/Activity)  rico:hasOrHadParticipant (역)
 rico:hasOrHadSubject (Record→무엇이든)      rico:isOrWasSubjectOf (역)
 rico:hasCreator / rico:hasAuthor / rico:hasPublisher (Record→Agent)
 rico:isOrWasIncludedIn (Record→RecordSet)   rico:isAssociatedWithPlace (→Place)
 rico:isOrWasRegulatedBy (→Rule)             rico:resultsOrResultedIn (Event→무엇이든)
데이터 속성: rico:name, rico:title, rico:beginningDate, rico:endDate,
 rico:birthDate, rico:generalDescription, rico:history, rico:scopeAndContent
 geo:lat, geo:long (Place), rdfs:comment (유형 태그)`;

async function claude(system, user, maxTokens, model) {
  const key = savedKey();
  if (!key) throw new Error('API 키가 없습니다. 위에서 저장해 주세요.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 180)}`);
  const j = await r.json();
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

window.askNL = async () => {
  const question = $('#nlq').value.trim();
  if (!question) return;
  const out = $('#nlOut'), btn = $('#nlBtn');
  btn.disabled = true;
  out.innerHTML = '<p class="status" style="margin-top:.7rem">SPARQL을 만드는 중…</p>';
  try {
    let sparql = await claude(
      `너는 SPARQL 1.1 생성기다. 아래 스키마만 써서 SELECT 질의 하나를 만들어라.
${SCHEMA()}
규칙:
- PREFIX 선언은 쓰지 마라(자동 주입됨).
- IRI를 추측하지 마라. 사람·단체·사건은 rico:name / rico:title 로 매칭하라.
  정확한 이름을 모르면 FILTER(CONTAINS(?이름, "키워드")) 를 써라.
- 결과에 사람이 읽을 이름 변수를 반드시 포함하라. 변수명은 한국어로 써도 된다.
- LIMIT 50 을 붙여라. 설명·마크다운 없이 질의문만 출력.`,
      question, 800, 'claude-haiku-4-5');
    sparql = sparql.replace(/```[a-z]*|```/g, '').trim();

    let res;
    try { res = rows(sparql); }
    catch (e) {
      out.innerHTML = `<div class="warnbox" style="margin-top:.7rem">생성된 SPARQL 실행 실패: ${esc(e.message)}</div><pre>${esc(sparql)}</pre>`;
      return;
    }
    out.innerHTML = '<p class="status" style="margin-top:.7rem">답을 정리하는 중…</p>';
    const answer = res.length
      ? await claude(
        `너는 기록연구사다. 주어진 질의 결과만 근거로 한국어로 간결히 답하라.
결과에 없는 내용은 절대 덧붙이지 마라.`,
        `질문: ${question}\n\n질의 결과(JSON):\n${JSON.stringify(res.slice(0, 40), null, 1)}`,
        800, 'claude-sonnet-5')
      : '그래프에 해당 정보가 없습니다.';
    const vars = res.length ? Object.keys(res[0]) : [];
    out.innerHTML = `
      <div class="${res.length ? 'okbox' : 'warnbox'}" style="margin-top:.8rem">
        <div class="ans">${esc(answer).replace(/\n/g, '<br>')}</div>
        <div class="ans-src">근거 트리플 ${res.length}건 · 『대한민국 국회를 말하다 08 정세균』(2021)</div>
      </div>
      <details><summary style="cursor:pointer;font-size:.84rem;color:var(--muted)">생성된 SPARQL과 원시 결과</summary>
        <pre>${esc(sparql)}</pre>
        ${res.length ? `<div style="overflow-x:auto"><table><tr>${vars.map(v => `<th>${esc(v)}</th>`).join('')}</tr>
          ${res.slice(0, 30).map(r => `<tr>${vars.map(v => `<td>${esc(short(r[v]))}</td>`).join('')}</tr>`).join('')}
        </table></div>` : '<p class="status">결과 0건</p>'}</details>`;
  } catch (e) {
    out.innerHTML = `<div class="warnbox" style="margin-top:.7rem">${esc(e.message)}</div>`;
  } finally { btn.disabled = false; }
};
