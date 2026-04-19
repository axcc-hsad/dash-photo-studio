// ─────────────────────────────────────────────────────────────
//  DASH PHOTO STUDIO  |  app.js
//  Persona: DASH Photographer — professional, concise, warm
// ─────────────────────────────────────────────────────────────

// ══ i18n ═══════════════════════════════════════════════════════
const T = {
  ko: {
    idxMsg:     `안녕하세요. <span class="em">DASH Photographer</span> 입니다.<br>LG.COM 제품 라이프스타일을 만들어보세요.<br>원하는 이미지를 손쉽게 만들 수 있도록 도와드릴게요.`,
    btnStart:   '시작하기',
    placeholder:'Enter PDP URL ...',

    step1Msg:   'lg.com에서 라이프스타일 이미지 제작이 필요한 제품 PDP URL을 복사해서 입력해주세요.',
    analyzing:  '잠시만 기다려주세요. URL을 분석하고 있습니다.',
    invalidUrl: `올바른 lg.com 제품 URL을 입력해주세요.<br>예: <code style="font-size:11px">https://www.lg.com/us/refrigerators/lg-LRMVS3006S</code>`,

    imagesFound: (n, name) =>
      `제품 이미지 <strong>${n}장</strong>을 찾았습니다.<br><span style="font-size:11px;color:#999">${name}</span><br>합성 적합도 기준으로 <span class="em">1순위를 추천</span>드립니다.`,
    btnPickImg: '이 이미지로 진행',

    regionTitle: '게시할 인테리어 스타일을 선택해주세요.',
    ratioTitle:  '이미지 비율을 선택해주세요.',
    btnNext:     '다음',

    promptTitle: '생성 프롬프트를 확인하고 필요하면 수정해주세요.',
    btnGenerate: '이미지 생성하기',

    stepA: '제품 이미지 분석 중',
    stepB: '인테리어 스타일 적용 중',
    stepC: '라이프스타일 이미지 생성 중',
    stepD: '품질 검수 중',

    resultMsg:   (r) => `<span class="em">${r}</span> 스타일 이미지가 완성됐습니다. 확인해보세요.`,
    qcTitle:     'QC 체크',
    qcLabels:    ['제품 외형 보존', '비율 자연스러움', '배경 조화', '스타일 일치'],
    btnDownload: '다운로드',
    btnEdit:     '수정 요청',
    revLeft:     (n) => `수정 ${n}회 남음`,

    revTitle:  '수정 방향을 선택하거나 직접 입력해주세요.',
    revChips:  ['배경 더 밝게', '배경 더 따뜻하게', '소품 줄이기', '스타일 강화', '제품 더 크게', '공간 정돈'],
    revising:  (r) => `수정 요청을 반영합니다.<br><em style="color:#aaa">"${r}"</em>`,
    revisedMsg:'수정이 완료됐습니다.',

    noRevLeft: '수정 횟수를 모두 사용했습니다. 다운로드하거나 처음부터 시작해주세요.',
    btnReset:  '처음부터',

    regions: {
      na:   { label: '북미',   sub: 'Clean & Bright',    icon: '🇺🇸' },
      eu:   { label: '유럽',   sub: 'Minimal & Refined',  icon: '🇪🇺' },
      asia: { label: '아시아', sub: 'Modern & Elegant',   icon: '🌏' },
      la:   { label: '중남미', sub: 'Warm & Natural',     icon: '🌎' },
    },
    ratios: {
      square:    { label: '정사각형', sub: '1 : 1',   icon: '⬜' },
      landscape: { label: '가로형',  sub: '16 : 9',  icon: '▬' },
      portrait:  { label: '세로형',  sub: '4 : 5',   icon: '▮' },
    },
  },

  en: {
    idxMsg:     `Hello. I'm <span class="em">DASH Photographer</span>.<br>Create lifestyle images for LG.COM products.<br>I'll help you make the image you want, easily.`,
    btnStart:   'Get Started',
    placeholder:'Enter PDP URL ...',

    step1Msg:   'Please copy and paste the LG product PDP URL for the lifestyle image you want to create.',
    analyzing:  'Analyzing URL. Please wait a moment.',
    invalidUrl: `Please enter a valid lg.com product URL.<br>e.g. <code style="font-size:11px">https://www.lg.com/us/refrigerators/lg-LRMVS3006S</code>`,

    imagesFound: (n, name) =>
      `Found <strong>${n} product images</strong>.<br><span style="font-size:11px;color:#999">${name}</span><br>Recommending the <span class="em">top-ranked</span> for compositing.`,
    btnPickImg: 'Proceed with this image',

    regionTitle: 'Select the interior style for posting.',
    ratioTitle:  'Select the image ratio.',
    btnNext:     'Next',

    promptTitle: 'Review the prompt and edit if needed.',
    btnGenerate: 'Generate Image',

    stepA: 'Analyzing product image',
    stepB: 'Applying interior style',
    stepC: 'Generating lifestyle image',
    stepD: 'Quality check',

    resultMsg:   (r) => `<span class="em">${r}</span> style image is ready. Please review.`,
    qcTitle:     'QC Check',
    qcLabels:    ['Product integrity', 'Natural proportions', 'Background harmony', 'Style match'],
    btnDownload: 'Download',
    btnEdit:     'Request edit',
    revLeft:     (n) => `${n} revision${n===1?'':'s'} left`,

    revTitle:  'Select a revision direction or type below.',
    revChips:  ['Brighter background', 'Warmer tone', 'Fewer props', 'Stronger style', 'Larger product', 'Cleaner space'],
    revising:  (r) => `Applying revision.<br><em style="color:#aaa">"${r}"</em>`,
    revisedMsg:'Revision complete.',

    noRevLeft: 'No revisions left. Download the image or start over.',
    btnReset:  'Start Over',

    regions: {
      na:   { label: 'N. America', sub: 'Clean & Bright',   icon: '🇺🇸' },
      eu:   { label: 'Europe',     sub: 'Minimal & Refined', icon: '🇪🇺' },
      asia: { label: 'Asia',       sub: 'Modern & Elegant',  icon: '🌏' },
      la:   { label: 'Lat. Am.',   sub: 'Warm & Natural',    icon: '🌎' },
    },
    ratios: {
      square:    { label: 'Square',    sub: '1 : 1',  icon: '⬜' },
      landscape: { label: 'Landscape', sub: '16 : 9', icon: '▬' },
      portrait:  { label: 'Portrait',  sub: '4 : 5',  icon: '▮' },
    },
  },
};

// ══ Regional style rules ════════════════════════════════════════
const STYLES = {
  na:   { space:'spacious bright American kitchen or living room', mood:'clean, practical, family-friendly', palette:'white countertops, warm gray and beige, light wood', light:'bright natural daylight, neutral-warm', props:'small plant, coffee mug, minimal decor', avoid:'no luxury excess, no vintage, no strong contrast' },
  eu:   { space:'minimal European kitchen or living room', mood:'refined, calm, architectural', palette:'off-white, stone gray, taupe, deep wood accent', light:'soft diffused natural light, neutral', props:'low-saturation vase, thin books, minimal tray', avoid:'no bold patterns, no primary color props, no clutter' },
  asia: { space:'modern Asian living room or kitchen', mood:'clean, sophisticated, contemporary', palette:'white, light oak, subtle earth tones', light:'natural light with soft shadows, bright', props:'minimal ceramics, clean textiles, subtle greenery', avoid:'no kitsch, no excessive decoration, no dark tones' },
  la:   { space:'warm Latin American kitchen or living room', mood:'warm, lively, welcoming, natural', palette:'warm beige, terracotta accent, olive green, honey wood', light:'warm natural light, golden tone', props:'fruit bowl, fabric runner, plant, small ceramics', avoid:'no sterile space, no cold blue light, no crowded props' },
};

const PRODUCT_CTX = {
  fridge:    'large refrigerator as the hero, front-facing, door handles clearly visible',
  washer:    'washing machine centered, door porthole and control panel visible',
  tv:        'LG TV as hero, mounted or on stand, slim bezels visible',
  appliance: 'LG home appliance as hero, clearly visible and unobstructed',
};

const RATIO_DIMS = {
  square:    { w:1024, h:1024 },
  landscape: { w:1344, h:768  },
  portrait:  { w:832,  h:1040 },
};

// ══ State ═══════════════════════════════════════════════════════
const S = {
  lang:        'ko',
  step:        'IDLE',     // IDLE | URL | IMAGES | REGION | RATIO | PROMPT | GEN | RESULT | REVISE
  busy:        false,
  pdpUrl:      '',
  productName: '',
  productType: 'fridge',
  candidates:  [],
  pickedIdx:   0,
  region:      '',
  ratio:       '',
  genPrompt:   '',
  resultUrl:   '',
  revisions:   0,
  maxRev:      2,
  history:     [],
};

// ══ DOM ═════════════════════════════════════════════════════════
const $idx     = document.getElementById('idx');
const $chat    = document.getElementById('chat');
const $msgs    = document.getElementById('msgList');
const $inp     = document.getElementById('inp');
const $send    = document.getElementById('sendBtn');
const $hist    = document.getElementById('histStrip');

// ══ Boot ════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  applyLang();
  $inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !S.busy) handleSend();
  });
});

// ══ Screen nav ══════════════════════════════════════════════════
function goChat() {
  $idx.classList.remove('active');
  $chat.classList.add('active');
  if (S.step === 'IDLE') {
    S.step = 'URL';
    setTimeout(() => agentSay(t('step1Msg')), 300);
  }
}

// ══ Language ════════════════════════════════════════════════════
function setLang(lang) {
  S.lang = lang;
  applyLang();
}

function applyLang() {
  const l = S.lang;
  ['ko1','ko2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', l === 'ko');
  });
  ['en1','en2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', l === 'en');
  });
  document.getElementById('idx-msg').innerHTML  = T[l].idxMsg;
  document.getElementById('btn-start').textContent = T[l].btnStart;
  $inp.placeholder = T[l].placeholder;
}

function t(key, ...args) {
  const v = T[S.lang][key];
  return typeof v === 'function' ? v(...args) : v;
}

// ══ Send ════════════════════════════════════════════════════════
async function handleSend() {
  const val = $inp.value.trim();
  if (!val || S.busy) return;
  userSay(val);
  $inp.value = '';

  if (S.step === 'URL')    return onUrl(val);
  if (S.step === 'REVISE') return onRevision(val);
  if (S.step === 'RESULT') return onRevision(val);
}

// ══ Step: URL ════════════════════════════════════════════════════
async function onUrl(url) {
  if (!isUrl(url)) {
    await pause(600);
    agentSay(t('invalidUrl'));
    return;
  }
  S.pdpUrl = url;
  setBusy(true);
  const tid = typing();
  agentSay(t('analyzing'));
  await delay(1800);
  rmTyping(tid);

  const data = CONFIG.DEMO_MODE ? demoScrape(url) : await apiCall('scrape-pdp', { url });
  S.productName = data.productName;
  S.productType = data.productType;
  S.candidates  = data.candidateImages;
  S.pickedIdx   = 0;
  setBusy(false);
  showImageSelect();
}

// ══ Demo data ════════════════════════════════════════════════════
function demoScrape(url) {
  const u = url.toLowerCase();
  const type = u.includes('fridge')||u.includes('refrigerator')||u.includes('lrmv') ? 'fridge'
    : u.includes('washer')||u.includes('wm') ? 'washer'
    : u.includes('tv')||u.includes('oled') ? 'tv' : 'appliance';
  const names = { fridge:'LG LRMVS3006S French Door Refrigerator', washer:'LG WM4000HWA Front Load Washer', tv:'LG C3 OLED evo TV', appliance:'LG Appliance' };
  const clr   = { fridge:['e0edf5','d0e2ef','bfd6e8'], washer:['ece8fb','ddd8f8','cdc8ef'], tv:['e8e8e8','dedede','d2d2d2'], appliance:['eee','e5e5e5','ddd'] };
  const icon  = { fridge:'🧊', washer:'🫧', tv:'📺', appliance:'📦' }[type];
  const c = clr[type];
  return {
    productName: names[type], productType: type,
    candidateImages: [
      { url:`https://placehold.co/300x300/${c[0]}/555?text=${icon}+Front`, score:4.7, label: S.lang==='ko'?'정면 촬영':'Front View' },
      { url:`https://placehold.co/300x300/${c[1]}/555?text=${icon}+Side`,  score:4.0, label: S.lang==='ko'?'측면 촬영':'Side View' },
      { url:`https://placehold.co/300x300/${c[2]}/555?text=${icon}+3/4`,   score:3.6, label: S.lang==='ko'?'3/4 구도':'3/4 View' },
    ],
  };
}

// ══ Image select ═════════════════════════════════════════════════
function showImageSelect() {
  const row = agentRow();
  row.innerHTML = `
    <div class="msg-bub">
      ${t('imagesFound', S.candidates.length, S.productName)}
      <div class="opt-section">
        <div class="opt-label">${S.lang==='ko'?'제품 이미지':'Product Images'}</div>
        <div class="img-grid" id="igrid">
          ${S.candidates.map((c,i) => `
            <div class="img-card${i===0?' sel':''}" onclick="pickImg(${i},this)">
              <img src="${c.url}" alt="${c.label}" loading="lazy"/>
              ${i===0?`<span class="img-badge">★ Best</span>`:''}
              <div class="img-score">${c.label} · ${c.score}★</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="act-row">
        <button class="act-btn primary" onclick="confirmImg()">${t('btnPickImg')}</button>
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();
  S.step = 'IMAGES';
}

function pickImg(i) {
  S.pickedIdx = i;
  document.querySelectorAll('.img-card').forEach((el,j) => el.classList.toggle('sel', j===i));
}

function confirmImg() {
  userSay(S.candidates[S.pickedIdx].label);
  showRegionSelect();
}

// ══ Region select ════════════════════════════════════════════════
function showRegionSelect() {
  const regions = t('regions');
  const row = agentRow();
  row.innerHTML = `
    <div class="msg-bub">
      ${t('regionTitle')}
      <div class="opt-section">
        <div class="sel-grid cols-4" id="rgrid">
          ${Object.entries(regions).map(([k,v]) => `
            <div class="sel-card" onclick="pickRegion('${k}',this)">
              <div class="sc-icon">${v.icon}</div>
              <div class="sc-label">${v.label}</div>
              <div class="sc-sub">${v.sub}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();
  S.step = 'REGION';
}

function pickRegion(k, el) {
  S.region = k;
  document.querySelectorAll('#rgrid .sel-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  // Short delay then show ratio
  setTimeout(() => {
    userSay(t('regions')[k].label);
    showRatioSelect();
  }, 400);
}

// ══ Ratio select ═════════════════════════════════════════════════
function showRatioSelect() {
  const ratios = t('ratios');
  const row = agentRow();
  row.innerHTML = `
    <div class="msg-bub">
      ${t('ratioTitle')}
      <div class="opt-section">
        <div class="sel-grid cols-3" id="rtgrid">
          ${Object.entries(ratios).map(([k,v]) => `
            <div class="sel-card" onclick="pickRatio('${k}',this)">
              <div class="sc-icon">${v.icon}</div>
              <div class="sc-label">${v.label}</div>
              <div class="sc-sub">${v.sub}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();
  S.step = 'RATIO';
}

function pickRatio(k, el) {
  S.ratio = k;
  document.querySelectorAll('#rtgrid .sel-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  setTimeout(() => {
    userSay(t('ratios')[k].label);
    showPromptPreview();
  }, 400);
}

// ══ Prompt preview ═══════════════════════════════════════════════
function showPromptPreview() {
  S.genPrompt = buildPrompt();
  const row = agentRow();
  row.innerHTML = `
    <div class="msg-bub">
      ${t('promptTitle')}
      <div class="prompt-wrap">
        <div class="prompt-head">PROMPT</div>
        <textarea class="prompt-ta" id="ptarea" rows="5">${esc(S.genPrompt)}</textarea>
      </div>
      <div class="act-row">
        <button class="act-btn primary" onclick="startGen()">${t('btnGenerate')}</button>
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();
  S.step = 'PROMPT';
}

function buildPrompt() {
  const s  = STYLES[S.region];
  const pt = PRODUCT_CTX[S.productType] || PRODUCT_CTX.appliance;
  return `Professional lifestyle interior photography of an LG ${S.productType}.
Product: ${pt}.
Setting: ${s.space}.
Mood: ${s.mood}.
Color palette: ${s.palette}.
Lighting: ${s.light}.
Props: ${s.props}.
Avoid: ${s.avoid}.
The product is the clear hero. No people. Photorealistic, high quality, commercial photography style.`;
}

// ══ Generation ═══════════════════════════════════════════════════
async function startGen() {
  const ta = document.getElementById('ptarea');
  if (ta) S.genPrompt = ta.value.trim() || S.genPrompt;
  setBusy(true);
  S.step = 'GEN';

  const pid = 'p' + Date.now();
  const row = agentRow();
  row.id = pid;
  row.innerHTML = `
    <div class="msg-bub">
      <div class="progress">
        <div class="pstep on" id="${pid}s1"><div class="pspin"></div>${t('stepA')}</div>
        <div class="pstep"    id="${pid}s2"><div class="pstep-ico">🎨</div>${t('stepB')}</div>
        <div class="pstep"    id="${pid}s3"><div class="pstep-ico">🖼</div>${t('stepC')}</div>
        <div class="pstep"    id="${pid}s4"><div class="pstep-ico">🔍</div>${t('stepD')}</div>
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();

  await delay(1100); stepDone(pid,1); stepOn(pid,2);
  await delay(1000); stepDone(pid,2); stepOn(pid,3);

  let imgUrl, qc;
  if (CONFIG.DEMO_MODE) {
    await delay(2200);
    const dims = { square:'900x900', landscape:'1280x720', portrait:'800x1000' }[S.ratio]||'900x900';
    const col  = { fridge:'e4eef5/667', washer:'ece8fb/667', tv:'e8e8e8/555', appliance:'eeeeee/555' }[S.productType]||'e4eef5/667';
    imgUrl = `https://placehold.co/${dims}/${col}?text=DASH+${S.productType}+${S.region.toUpperCase()}`;
    qc     = { a:94, b:88, c:91, d:85 };
  } else {
    const res = await apiCall('generate-image', {
      productImageUrl: S.candidates[S.pickedIdx].url,
      productType: S.productType, region: S.region,
      ratio: S.ratio, prompt: S.genPrompt,
    });
    imgUrl = res.imageUrl;
    qc     = res.qcScores ? {
      a: res.qcScores.productIntegrity,
      b: res.qcScores.naturalProportions,
      c: res.qcScores.backgroundHarmony,
      d: res.qcScores.regionalStyleMatch,
    } : { a:90, b:87, c:89, d:84 };
  }

  stepDone(pid,3); stepOn(pid,4);
  await delay(700); stepDone(pid,4);
  await delay(300);
  document.getElementById(pid)?.remove();

  S.resultUrl = imgUrl;
  S.revisions = 0;
  addHistory(imgUrl);
  showResult(imgUrl, qc);
  setBusy(false);
}

// ══ Result ═══════════════════════════════════════════════════════
function showResult(imgUrl, qc) {
  const rl  = t('regions')[S.region]?.label || S.region;
  const rem = S.maxRev - S.revisions;
  const labels = t('qcLabels');

  const row = agentRow();
  row.innerHTML = `
    <div class="msg-bub">
      ${t('resultMsg', rl)}
      <img class="result-img" src="${imgUrl}" alt="result" loading="lazy"/>
      <div class="qc-wrap">
        <div class="qc-title">${t('qcTitle')}</div>
        ${[['a',labels[0]],['b',labels[1]],['c',labels[2]],['d',labels[3]]].map(([k,lbl]) => `
          <div class="qc-row">
            <span class="qc-name">${lbl}</span>
            <div class="qc-track"><div class="qc-fill" style="width:${qc[k]}%"></div></div>
            <span class="qc-val">${qc[k]}</span>
          </div>`).join('')}
      </div>
      <div class="act-row">
        <button class="act-btn primary" onclick="download()">${t('btnDownload')}</button>
        ${rem > 0
          ? `<button class="act-btn outline" onclick="showRevPanel()">${t('btnEdit')}</button>
             <span class="rev-remain">${t('revLeft', rem)}</span>`
          : `<button class="act-btn ghost" onclick="reset()">${t('btnReset')}</button>`}
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();
  S.step = 'RESULT';
}

// ══ Revision ═════════════════════════════════════════════════════
function showRevPanel() {
  if (S.revisions >= S.maxRev) { agentSay(t('noRevLeft')); return; }
  const row = agentRow();
  row.innerHTML = `
    <div class="msg-bub">
      ${t('revTitle')}
      <div class="rev-chips">
        ${t('revChips').map(c => `<button class="rev-chip" onclick="applyRev('${esc(c)}')">${c}</button>`).join('')}
      </div>
    </div>`;
  $msgs.appendChild(row);
  scroll();
  S.step = 'REVISE';
}

async function onRevision(text) { await applyRev(text); }

async function applyRev(req) {
  if (S.revisions >= S.maxRev) { agentSay(t('noRevLeft')); return; }
  userSay(req);
  S.revisions++;
  setBusy(true);
  const tid = typing();
  agentSay(t('revising', req));
  await delay(2400);
  rmTyping(tid);

  let newUrl, qc;
  if (CONFIG.DEMO_MODE) {
    const dims = { square:'900x900', landscape:'1280x720', portrait:'800x1000' }[S.ratio]||'900x900';
    newUrl = `https://placehold.co/${dims}/f0eaff/C8102E?text=Revised+v${S.revisions}`;
    qc = { a:93, b:89, c:92, d:87 };
  } else {
    const res = await apiCall('generate-image', {
      productImageUrl: S.candidates[S.pickedIdx].url,
      productType: S.productType, region: S.region,
      ratio: S.ratio, prompt: S.genPrompt + `\nRevision: ${req}`,
    });
    newUrl = res.imageUrl;
    qc = res.qcScores ? { a:res.qcScores.productIntegrity, b:res.qcScores.naturalProportions, c:res.qcScores.backgroundHarmony, d:res.qcScores.regionalStyleMatch } : { a:91, b:87, c:90, d:86 };
  }

  S.resultUrl = newUrl;
  addHistory(newUrl);
  agentSay(t('revisedMsg'));
  showResult(newUrl, qc);
  setBusy(false);
}

// ══ History ══════════════════════════════════════════════════════
function addHistory(url) {
  S.history.push(url);
  renderHistory();
}

function renderHistory() {
  $hist.innerHTML = '';
  S.history.forEach((url, i) => {
    const d = document.createElement('div');
    d.className = 'hist-thumb' + (i === S.history.length-1 ? ' on' : '');
    d.onclick   = () => {
      document.querySelectorAll('.hist-thumb').forEach((el,j) => el.classList.toggle('on', j===i));
      agentSay(`v${i+1} — <a href="${url}" target="_blank" style="color:var(--red)">원본 보기</a>`);
    };
    d.innerHTML = `<img src="${url}" alt="v${i+1}"><span class="hist-n">v${i+1}</span>`;
    $hist.appendChild(d);
  });
  $hist.classList.add('show');
}

// ══ Utilities ════════════════════════════════════════════════════
function download() {
  if (!S.resultUrl) return;
  const a = document.createElement('a');
  a.href     = S.resultUrl;
  a.download = `DASH-${S.productType}-${S.region}-${S.ratio}-${Date.now()}.png`;
  a.click();
}

function reset() {
  $msgs.innerHTML = '';
  $hist.innerHTML = '';
  $hist.classList.remove('show');
  Object.assign(S, {
    step:'IDLE', busy:false, pdpUrl:'', productName:'', productType:'fridge',
    candidates:[], pickedIdx:0, region:'', ratio:'', genPrompt:'',
    resultUrl:'', revisions:0, history:[],
  });
  // Back to index
  $chat.classList.remove('active');
  $idx.classList.add('active');
}

// ── UI builders ──────────────────────────────────────────────────
function agentRow() {
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  row.innerHTML = `<div class="avatar"><img src="assets/robot.png" alt="DASH"/></div>`;
  return row;
}

function agentSay(html) {
  const row = agentRow();
  const bub = document.createElement('div');
  bub.className = 'msg-bub';
  bub.innerHTML = html;
  row.appendChild(bub);
  $msgs.appendChild(row);
  scroll();
  return row;
}

function userSay(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML = `<div class="avatar ghost"></div><div class="msg-bub">${esc(text)}</div>`;
  $msgs.appendChild(row);
  scroll();
}

let _typId = 0;
function typing() {
  const id = 'ty' + (++_typId);
  const row = document.createElement('div');
  row.className = 'msg-row agent'; row.id = id;
  row.innerHTML = `<div class="avatar"><img src="assets/robot.png" alt="DASH"/></div>
    <div class="typing-bub"><div class="tdot"></div><div class="tdot"></div><div class="tdot"></div></div>`;
  $msgs.appendChild(row);
  scroll();
  return id;
}
function rmTyping(id) { document.getElementById(id)?.remove(); }

function stepDone(pid, n) {
  const el = document.getElementById(`${pid}s${n}`);
  if (!el) return;
  el.classList.remove('on'); el.classList.add('done');
  const sp = el.querySelector('.pspin');
  if (sp) { const s = document.createElement('span'); s.className = 'pstep-ico'; s.textContent = '✓'; sp.replaceWith(s); }
}
function stepOn(pid, n) { document.getElementById(`${pid}s${n}`)?.classList.add('on'); }

function setBusy(b) { S.busy = b; $send.disabled = b; }
function scroll()   { requestAnimationFrame(() => { $msgs.scrollTop = $msgs.scrollHeight; }); }
function delay(ms)  { return new Promise(r => setTimeout(r, ms)); }
async function pause(ms) { const id = typing(); await delay(ms); rmTyping(id); }
function esc(s)     { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function isUrl(s)   { try { const u = new URL(s); return u.protocol==='https:'||u.protocol==='http:'; } catch { return false; } }

async function apiCall(ep, body) {
  const r = await fetch(`${CONFIG.API_BASE}/${ep}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
