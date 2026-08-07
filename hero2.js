/* 히어로 2안 — 전면 이미지 · 시네마틱 전환
   ─────────────────────────────────────────────────────────────
   1안(입자 몰핑)이 '데이터로 빚은 사람'이라면, 2안은 '사진 그 자체'다.
   화면 폭을 꽉 채우고, 전환은 세 겹으로 겹쳐 일어난다.

     ① 마스크 와이프  clip-path 가 한쪽에서 열리며 다음 장면을 드러낸다
     ② 켄 번스       들어온 장면은 계속 아주 느리게 밀고 확대된다
     ③ 슬라이스      전환 순간에만 세로 띠 6개가 시차를 두고 넘어간다

   캡션·연표는 누르는 것이다. 누르면 그 장면이 가리키는 개체로 간다
   (아이템 페이지가 있으면 그쪽, 없으면 관계망에서 강조).

   ※ 1안과 같은 규칙: 정지 이미지에 카메라 움직임만 준다.
     인물이 하지 않은 행동을 만들어내지 않는다. */
import { $, esc } from './app.js';

const HOLD = 5600, WIPE = 1500, SLICES = 6;
let H = null;

export async function initHero2() {
  const root = $('#hero2');
  if (!root || H) return;

  const meta = await fetch('assets/life/frames.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => []);
  if (!meta.length) { root.innerHTML = '<p class="status">장면을 찾지 못했습니다</p>'; return; }

  H = { meta, i: 0, timer: 0, busy: false, root };

  root.innerHTML = `
    <div class="h2-stage" id="h2Stage">
      ${meta.map((m, i) => `
        <div class="h2-shot${i === 0 ? ' on' : ''}" data-i="${i}">
          <img class="h2-bg" src="${esc(m.src)}" alt="" aria-hidden="true" draggable="false">
          <div class="h2-fg">
            ${Array.from({ length: SLICES }, (_, s) => `
              <div class="h2-slice" style="--s:${s};--n:${SLICES}">
                <img src="${esc(m.src)}" alt="${esc(m.year)} ${esc(m.label)}" draggable="false">
              </div>`).join('')}
          </div>
        </div>`).join('')}
      <div class="h2-scrim"></div>
      <div class="h2-grain"></div>
    </div>

    <div class="h2-copy">
      <div class="kicker">Oral History · Knowledge Graph</div>
      <h1>한 사람의 기억이<br><em>그래프</em>가 될 때</h1>
      <p>국회도서관 국회기록보존소가 2018년 채록한 정세균 전 국회의장의 구술기록을
         RiC-O 국제표준으로 구조화했습니다.</p>
      <div class="hero-cta">
        <a class="btn primary" href="#query">온톨로지에게 묻기 →</a>
        <a class="btn ghost" href="#record">기록 찾아보기</a>
      </div>
    </div>

    <button class="h2-cap" id="h2Cap" type="button">
      <b id="h2Year">–</b>
      <span id="h2Label"></span>
      <em id="h2Credit"></em>
      <i class="go">개체 보기 →</i>
    </button>

    <div class="h2-rail" id="h2Rail">
      ${meta.map((m, i) => `
        <button data-i="${i}" class="${i === 0 ? 'on' : ''}" title="${esc(m.label)}">
          <span>${esc(m.year)}</span><i></i>
        </button>`).join('')}
    </div>`;

  H.shots = [...root.querySelectorAll('.h2-shot')];
  root.querySelectorAll('#h2Rail button').forEach(b =>
    b.onclick = () => go(+b.dataset.i));
  $('#h2Cap').onclick = () => openFrame(H.meta[H.i]);
  root.addEventListener('pointermove', parallax);
  root.addEventListener('pointerleave', () => root.style.setProperty('--px', 0) || root.style.setProperty('--py', 0));

  paint(0);
  schedule();
}

function parallax(e) {
  const r = H.root.getBoundingClientRect();
  H.root.style.setProperty('--px', ((e.clientX - r.left) / r.width - .5).toFixed(3));
  H.root.style.setProperty('--py', ((e.clientY - r.top) / r.height - .5).toFixed(3));
}

function schedule() { clearTimeout(H.timer); H.timer = setTimeout(() => go(H.i + 1), HOLD); }

function go(n) {
  if (!H || H.busy) return;
  const to = ((n % H.meta.length) + H.meta.length) % H.meta.length;
  if (to === H.i) return;
  H.busy = true;
  const from = H.shots[H.i], into = H.shots[to];

  into.classList.add('in');                       // 슬라이스가 열리며 들어온다
  requestAnimationFrame(() => into.classList.add('open'));
  setTimeout(() => {
    from.classList.remove('on', 'in', 'open');
    into.classList.add('on');
    into.classList.remove('in', 'open');
    H.busy = false;
  }, WIPE);

  H.i = to;
  paint(to);
  schedule();
}
window.hero2Go = go;

function paint(i) {
  const m = H.meta[i];
  const cap = $('#h2Cap');
  cap.classList.add('fade');
  setTimeout(() => {
    $('#h2Year').textContent = m.year;
    $('#h2Label').textContent = m.label;
    $('#h2Credit').textContent = m.credit;
    cap.classList.remove('fade');
  }, 220);
  H.root.querySelectorAll('#h2Rail button')
    .forEach((b, j) => b.classList.toggle('on', j === i));
}

/** 캡션을 누르면 그 장면이 가리키는 개체로 — 아이템 페이지가 있으면 그쪽, 없으면 관계망 강조 */
function openFrame(m) {
  const id = m.entity;
  if (id && typeof window.openItem === 'function') { window.openItem(id); return; }
  if (id && typeof window.focusInGraph === 'function') { window.focusInGraph(id); return; }
  location.hash = '#graph-sec';
}

/* 1안 ↔ 2안 전환 */
window.setHeroVariant = v => {
  document.documentElement.setAttribute('data-hero', v);
  localStorage.setItem('kit-hero', v);
  document.querySelectorAll('#heroSwap button')
    .forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === '2') initHero2();
};
