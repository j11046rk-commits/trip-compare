// ---- 設定 ----
const S = { trip: 'roundtrip', seat: 'ord', book: 'normal', air: 'fsc', priority: 'balanced' };
const P = { mode: null, timeType: 'depart' };
let G = { o: null, d: null, rd: 0, ld: 0 };
let _scheds = [];

// ---- ユーティリティ ----
function hav(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((la2 - la1) * r / 2), y = Math.sin((lo2 - lo1) * r / 2);
  return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(la1 * r) * Math.cos(la2 * r) * y * y));
}
const fmt  = n => Math.round(n).toLocaleString('ja-JP');
const fmtM = m => { if (!m && m !== 0) return '—'; const h = Math.floor(m / 60), mn = m % 60; return h > 0 ? `${h}時間${mn > 0 ? mn + '分' : ''}` : `${mn}分`; };
const opp  = (min, rate, h, pax) => h > 0 ? (min / 60) * h * rate * pax : 0;

// ---- 時刻ユーティリティ ----
function parseMin(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function toHHMM(m) { m = ((m % 1440) + 1440) % 1440; return `${String(~~(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function toJP(m) { m = ((m % 1440) + 1440) % 1440; const h = ~~(m / 60), mn = m % 60; return `${h}時${mn ? mn + '分' : '00分'}`; }

// ---- 料金テーブル ----
function shinkFare(km) {
  const t = [50,100,200,300,400,500,600,700,800,900,1000];
  const v = [2500,4500,7000,9500,11500,14500,16500,18000,20000,21000,22500];
  for (let i = 0; i < t.length; i++) if (km < t[i]) return v[i];
  return 24000;
}
function airFare(km, type) {
  const t = [200,400,600,800,1000,1300];
  const v = [12000,16000,22000,27000,32000,38000];
  let base = 45000;
  for (let i = 0; i < t.length; i++) if (km < t[i]) { base = v[i]; break; }
  return type === 'lcc' ? Math.round(base * 0.55) : base;
}

// ---- 都市オブジェクト取得 ----
function getCity(side) {
  const pref = document.getElementById(side === 'o' ? 'op' : 'dp').value;
  const idx  = document.getElementById(side === 'o' ? 'oc' : 'dc').value;
  if (!pref || idx === '') return null;
  const d = DB[pref][parseInt(idx, 10)];
  return { l: d[0], lat: d[1], lng: d[2], stt: d[3], hasAir: d[4], sam: d[5], hubStt: d[6], pref };
}

// ---- 新幹線ハブ駅名 (hubStt → 駅名) ----
const HUB_NAME = { 0:'東京', 36:'上野', 99:'名古屋', 138:'新大阪', 170:'新神戸', 202:'岡山', 231:'広島', 256:'新山口', 280:'小倉', 295:'博多', 34:'大宮', 84:'仙台', 161:'新青森', 208:'新函館北斗', 110:'新潟', 75:'長野', 65:'高崎', 200:'鹿児島中央' };

// ---- 新幹線駅名取得 ----
function shinkStn(c) {
  if (c.stt !== null && HUB_NAME[c.stt]) return HUB_NAME[c.stt] + '駅';
  if (c.stt !== null) return c.l + '駅';
  if (HUB_NAME[c.hubStt]) return HUB_NAME[c.hubStt] + '駅';
  const hubs = Object.keys(HUB_NAME).map(Number);
  const closest = hubs.reduce((p, cur) => Math.abs(cur - c.hubStt) < Math.abs(p - c.hubStt) ? cur : p);
  return HUB_NAME[closest] + '駅';
}

// ---- 空港情報 ----
const AP = {
  '北海道': { name: '新千歳空港', access: 40 },
  '青森県': { name: '青森空港', access: 35 },
  '岩手県': { name: '花巻空港', access: 40 },
  '宮城県': { name: '仙台空港', access: 30 },
  '秋田県': { name: '秋田空港', access: 30 },
  '山形県': { name: '山形空港', access: 25 },
  '福島県': { name: '福島空港', access: 40 },
  '茨城県': { name: '茨城空港', access: 30 },
  '栃木県': { name: '羽田空港', access: 100 },
  '群馬県': { name: '羽田空港', access: 110 },
  '埼玉県': { name: '羽田空港', access: 70 },
  '千葉県': { name: '成田空港', access: 45 },
  '東京都': { name: '羽田空港', access: 40 },
  '神奈川県': { name: '羽田空港', access: 45 },
  '新潟県': { name: '新潟空港', access: 25 },
  '富山県': { name: '富山きときと空港', access: 20 },
  '石川県': { name: '小松空港', access: 35 },
  '福井県': { name: '小松空港', access: 60 },
  '山梨県': { name: '羽田空港', access: 120 },
  '長野県': { name: '信州まつもと空港', access: 25 },
  '岐阜県': { name: '中部国際空港', access: 60 },
  '静岡県': { name: '富士山静岡空港', access: 35 },
  '愛知県': { name: '中部国際空港', access: 40 },
  '三重県': { name: '中部国際空港', access: 70 },
  '滋賀県': { name: '関西国際空港', access: 70 },
  '京都府': { name: '伊丹空港', access: 45 },
  '大阪府': { name: '伊丹空港', access: 30 },
  '兵庫県': { name: '伊丹空港', access: 35 },
  '奈良県': { name: '関西国際空港', access: 75 },
  '和歌山県': { name: '関西国際空港', access: 70 },
  '鳥取県': { name: '鳥取砂丘コナン空港', access: 25 },
  '島根県': { name: '出雲縁結び空港', access: 25 },
  '岡山県': { name: '岡山桃太郎空港', access: 30 },
  '広島県': { name: '広島空港', access: 45 },
  '山口県': { name: '山口宇部空港', access: 35 },
  '徳島県': { name: '徳島阿波おどり空港', access: 30 },
  '香川県': { name: '高松空港', access: 30 },
  '愛媛県': { name: '松山空港', access: 20 },
  '高知県': { name: '高知龍馬空港', access: 25 },
  '福岡県': { name: '福岡空港', access: 15 },
  '佐賀県': { name: '佐賀空港', access: 40 },
  '長崎県': { name: '長崎空港', access: 40 },
  '熊本県': { name: '阿蘇くまもと空港', access: 50 },
  '大分県': { name: '大分空港', access: 50 },
  '宮崎県': { name: '宮崎ブーゲンビリア空港', access: 20 },
  '鹿児島県': { name: '鹿児島空港', access: 40 },
  '沖縄県': { name: '那覇空港', access: 20 },
};
function apName(pref) { return (AP[pref] || { name: '最寄り空港' }).name; }
function apAccess(pref) { return (AP[pref] || { access: 60 }).access; }

// ---- 交通手段判定 ----
const canShink = (o, d) => o.hubStt !== null && d.hubStt !== null;
const canFly   = (o, d, rd) => (o.hasAir || d.hasAir) && rd > 80;
const canCar   = (o, d) => o.pref !== '沖縄県' && d.pref !== '沖縄県';

function shinkMin1(o, d) {
  const oH = o.stt !== null ? o.stt : o.hubStt;
  const dH = d.stt !== null ? d.stt : d.hubStt;
  return (o.sam || 0) + Math.max(Math.abs(oH - dH), 15) + (d.sam || 0) + 10;
}

// ---- セレクト構築 ----
const PREFS = Object.keys(DB);

function buildPrefSel(id) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">-- 都道府県を選択 --</option>';
  PREFS.forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    sel.appendChild(o);
  });
}

function buildCitySel(id, pref, defIdx = null) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">-- 市・区を選択 --</option>';
  if (!pref) { sel.disabled = true; return; }
  DB[pref].forEach((d, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = d[0];
    sel.appendChild(o);
  });
  sel.disabled = false;
  if (defIdx !== null) sel.value = String(defIdx);
}

// ---- イベント ----
function onPref(side) {
  const pref = document.getElementById(side === 'o' ? 'op' : 'dp').value;
  buildCitySel(side === 'o' ? 'oc' : 'dc', pref);
  document.getElementById('irow').style.display = 'none';
}

function updateInfo() {
  const o = getCity('o'), d = getCity('d');
  if (!o || !d) { document.getElementById('irow').style.display = 'none'; return; }
  const rd = Math.round(hav(o.lat, o.lng, d.lat, d.lng) * 1.3);
  const modes = [];
  if (canShink(o, d)) modes.push('🚅新幹線');
  if (canFly(o, d, rd)) modes.push('✈️飛行機');
  if (canCar(o, d)) modes.push('🚗自家用車');
  document.getElementById('oi').textContent = o.l;
  document.getElementById('di').textContent = `${d.l}　約${rd}km　│　${modes.join(' ')}`;
  document.getElementById('irow').style.display = 'grid';
  document.getElementById('toll').value = Math.round(rd * 18 / 100) * 100;
}

function swapOD() {
  const op = document.getElementById('op').value, oi = document.getElementById('oc').value;
  const dp = document.getElementById('dp').value, di = document.getElementById('dc').value;
  document.getElementById('op').value = dp; buildCitySel('oc', dp, di === '' ? null : +di);
  document.getElementById('dp').value = op; buildCitySel('dc', op, oi === '' ? null : +oi);
  updateInfo();
}

function sw(t) {
  document.querySelectorAll('.tab').forEach((e, i) => e.classList.toggle('on', (t === 'basic' && i === 0) || (t === 'adv' && i === 1)));
  document.getElementById('tb-basic').style.display = t === 'basic' ? 'block' : 'none';
  document.getElementById('tb-adv').style.display   = t === 'adv'   ? 'block' : 'none';
}

function tog(k, v, btn) {
  S[k] = v;
  btn.closest('.tg').querySelectorAll('.tb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

function togP(v, btn) {
  S.priority = v;
  btn.closest('.tg').querySelectorAll('.tb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

function togPlan(type, btn) {
  P.timeType = type;
  btn.closest('.tg').querySelectorAll('.tb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('plan-time-label').textContent = type === 'arrive' ? '到着希望時刻' : '出発予定時刻';
}

// ---- スコア計算 ----
function scoreF(r, mC, mT, mO) {
  const cn = mC > 0 ? 1 - r.tc / mC : 1;
  const tn = mT > 0 ? 1 - r.tm / mT : 1;
  const fn = 1 - r.fat / 5;
  const on = mO > 0 ? 1 - r.op / mO : 1;
  if (S.priority === 'cost')    return cn * 3 + tn + fn + on;
  if (S.priority === 'time')    return cn + tn * 3 + fn + on;
  if (S.priority === 'comfort') return cn + tn + fn * 3 + on;
  if (S.priority === 'opp')     return cn + tn + fn + on * 3;
  return cn * 1.3 + tn * 1.3 + fn + on * 1.4;
}

// ---- 比較実行 ----
function calc() {
  const o = getCity('o'), d = getCity('d');
  if (!o || !d) { alert('出発地と目的地を両方選択してください'); return; }
  if (o.l === d.l) { alert('出発地と目的地が同じです'); return; }

  const pax    = +document.getElementById('pax').value    || 1;
  const isR    = S.trip === 'roundtrip';
  const trips  = isR ? 2 : 1;
  const nights = +document.getElementById('nights').value  || 0;
  const hourly = +document.getElementById('hourly').value  || 0;
  const airAcc = +document.getElementById('airAccess').value || 0;
  const mpg    = +document.getElementById('mpg').value    || 15;
  const gasp   = +document.getElementById('gasp').value   || 170;
  const toll   = +document.getElementById('toll').value   || 0;
  const park   = +document.getElementById('park').value   || 1500;
  const gM     = S.seat === 'grn' ? 1.45 : 1;
  const bD     = S.book === 'early' ? 0.85 : S.book === 'smart' ? 0.94 : 1;
  const ld     = hav(o.lat, o.lng, d.lat, d.lng);
  const rd     = Math.round(ld * 1.3);
  const results = [];

  // 新幹線
  if (canShink(o, d)) {
    const st = shinkMin1(o, d), tm = st * trips;
    const accessKm = (o.stt === null ? (o.sam || 0) : 0) + (d.stt === null ? (d.sam || 0) : 0);
    const fare = shinkFare(Math.round(ld * 1.2 + accessKm)) * gM * bD + ((o.sam > 0 ? 1000 : 0) + (d.sam > 0 ? 1000 : 0));
    const tc = fare * pax * trips;
    const op1 = opp(tm, 0.40, hourly, pax);
    results.push({
      id: 'shink', name: '新幹線', icon: '🚅',
      tc, tm, op: op1, two: tc + op1, fat: st > 180 ? 3 : 2, flex: 4,
      route: `${o.l}${o.stt === null && o.sam > 0 ? `→${HUB_NAME[o.hubStt] || '乗換'}(乗換)` : ''}→新幹線→${d.stt === null && d.sam > 0 ? `(乗換)${HUB_NAME[d.hubStt] || ''}→` : ''}${d.l}`,
      bd: { '新幹線料金': Math.round(fare * pax * trips), '機会損失': Math.round(op1) },
    });
  }

  // 飛行機
  if (canFly(o, d, rd)) {
    const fmin = Math.max(40, Math.round(ld / 8));
    const tm2 = ((o.hasAir ? 60 : 90) + 60 + fmin + (d.hasAir ? 30 : 50)) * trips;
    const base = airFare(ld, S.air);
    const tc2 = (base * pax + airAcc * pax) * trips;
    const op2 = opp(tm2, 0.70, hourly, pax);
    results.push({
      id: 'fly', name: '飛行機', icon: '✈️',
      tc: tc2, tm: tm2, op: op2, two: tc2 + op2, fat: 4, flex: 2,
      route: `${o.l}→空港→フライト→空港→${d.l}`,
      bd: { [`航空券(${S.air.toUpperCase()})`]: Math.round(base * pax * trips), '空港アクセス': Math.round(airAcc * pax * trips), '機会損失': Math.round(op2) },
    });
  }

  // 自家用車
  if (canCar(o, d)) {
    const dMin = Math.round((rd / 80) * 60);
    const fuel = (rd / mpg) * gasp;
    const pc   = park * Math.max(nights, isR ? 0 : 1);
    const tc3  = (fuel + toll) * trips + pc;
    const tm3  = dMin * trips + 30;
    const op3  = opp(dMin * trips, 1.0, hourly, 1);
    results.push({
      id: 'car', name: '自家用車', icon: '🚗',
      tc: tc3, tm: tm3, op: op3, two: tc3 + op3, fat: rd > 400 ? 5 : rd > 200 ? 4 : 3, flex: 5,
      route: `${o.l}→高速・一般道(約${rd}km)→${d.l}`,
      bd: { 'ガソリン': Math.round(fuel * trips), '高速料金': Math.round(toll * trips), '駐車場': Math.round(pc), '機会損失': Math.round(op3) },
    });
  }

  if (!results.length) { alert('この区間に対応する交通手段がありません'); return; }

  const mC   = Math.max(...results.map(r => r.tc));
  const mT   = Math.max(...results.map(r => r.tm));
  const mO   = Math.max(...results.map(r => r.op));
  const minC = Math.min(...results.map(r => r.tc));
  const minT = Math.min(...results.map(r => r.tm));
  results.forEach(r => r.score = scoreF(r, mC, mT, mO));
  const maxSc = Math.max(...results.map(r => r.score));
  results.forEach(r => r.pct = Math.round((r.score / maxSc) * 100));
  const winner = results.reduce((a, b) => a.score > b.score ? a : b);
  const pL = { balanced:'バランス', cost:'費用', time:'時間', comfort:'快適性', opp:'機会損失' }[S.priority];

  // 結果表示
  document.getElementById('wbox').innerHTML = `
    <div class="wtitle">${pL}重視スコアで選ぶなら</div>
    <div class="wtext">${winner.icon} ${winner.name} がおすすめ（${isR ? '往復' : '片道'} / ${pax}名）</div>
    <div class="wsub">${winner.route}</div>
    <div class="sd">
      <div class="sdc"><div class="sdl">実費</div><div class="sdv">¥${fmt(winner.tc)}</div></div>
      <div class="sdc"><div class="sdl">所要時間</div><div class="sdv">${fmtM(winner.tm)}</div></div>
      <div class="sdc"><div class="sdl">機会損失込</div><div class="sdv">¥${fmt(winner.two)}</div></div>
    </div>`;

  const clr = { shink: '#378ADD', fly: '#1D9E75', car: '#BA7517' };
  document.getElementById('cards').innerHTML = results.map(r => {
    const isBest = r.id === winner.id;
    const cC = r.tc === minC ? 'g' : r.tc === mC ? 'b' : '';
    const tC = r.tm === minT ? 'g' : r.tm === mT ? 'b' : '';
    const f  = '●'.repeat(r.fat) + '○'.repeat(5 - r.fat);
    const fl = '●'.repeat(r.flex) + '○'.repeat(5 - r.flex);
    return `<div class="card${isBest ? ' best' : ''}">
      ${isBest ? '<div class="bdg">おすすめ</div>' : ''}
      <div class="cico">${r.icon}</div><div class="cname">${r.name}</div>
      <div class="mr"><span class="ml">実費</span><span class="mv ${cC}">¥${fmt(r.tc)}</span></div>
      <div class="mr"><span class="ml">所要時間</span><span class="mv ${tC}">${fmtM(r.tm)}</span></div>
      <div class="mr"><span class="ml">機会損失</span><span class="mv">¥${fmt(r.op)}</span></div>
      <div class="mr"><span class="ml">機会損失込</span><span class="mv">¥${fmt(r.two)}</span></div>
      <div class="mr"><span class="ml">疲労度</span><span class="mv" style="font-size:9px;letter-spacing:-1px;">${f}</span></div>
      <div class="mr"><span class="ml">柔軟性</span><span class="mv" style="font-size:9px;letter-spacing:-1px;">${fl}</span></div>
      <div class="sb">
        <div class="slb2"><span>総合スコア</span><span>${r.pct}%</span></div>
        <div class="st"><div class="sf" style="width:${r.pct}%;background:${clr[r.id]};"></div></div>
      </div>
    </div>`;
  }).join('');

  const mkC = (id, vFn, lFn) => {
    const mx = Math.max(...results.map(vFn));
    document.getElementById(id).innerHTML = results.map(r => {
      const w  = Math.max(8, Math.round((vFn(r) / mx) * 100));
      const bd = Object.entries(r.bd).filter(([k]) => k !== '機会損失').map(([k, v]) => `${k}:¥${fmt(v)}`).join(' / ');
      return `<div class="brow">
        <div class="bm">${r.icon}${r.name}</div>
        <div class="bt"><div class="bf" style="width:${w}%;background:${clr[r.id]};"><span>${lFn(r)}</span></div></div>
      </div><div class="bsub">${bd}</div>`;
    }).join('');
  };
  mkC('cc',  r => r.tc,  r => `¥${fmt(r.tc)}`);
  mkC('tc2', r => r.tm,  r => fmtM(r.tm));
  mkC('oc2', r => r.two, r => `¥${fmt(r.two)}`);

  document.getElementById('results').className = 'res show';

  // ---- プラン作成セクション更新 ----
  G = { o, d, rd, ld };
  document.getElementById('plan-modes').innerHTML = results.map(r => `
    <button class="plan-mode-btn${r.id === winner.id ? ' rec' : ''}" data-mode="${r.id}" onclick="selectTransport('${r.id}')">
      ${r.id === winner.id ? '<span class="pmb-badge">おすすめ</span>' : ''}
      <span class="pmb-icon">${r.icon}</span>
      <span class="pmb-name">${r.name}</span>
    </button>`).join('');
  document.getElementById('plan-section').style.display = 'block';
  document.getElementById('plan-step3').style.display = 'none';
  document.getElementById('plan-step4').style.display = 'none';
  document.getElementById('plan-step5').style.display = 'none';
  P.mode = null;
  document.querySelectorAll('.plan-mode-btn').forEach(b => b.classList.remove('on'));
  const today = new Date();
  document.getElementById('plan-date').value = today.toISOString().split('T')[0];
}

// ---- 交通手段選択 ----
function selectTransport(modeId) {
  P.mode = modeId;
  document.querySelectorAll('.plan-mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === modeId));
  document.getElementById('plan-step3').style.display = 'block';
  document.getElementById('plan-step4').style.display = 'none';
  document.getElementById('plan-step5').style.display = 'none';
  document.getElementById('plan-step3').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- スケジュール生成 ----
function genShinkSchedules(o, d, isArr, tMin) {
  const oH = o.stt !== null ? o.stt : o.hubStt;
  const dH = d.stt !== null ? d.stt : d.hubStt;
  const rideMin = Math.max(Math.abs(oH - dH), 15);
  const accO = (o.sam || 0) + 10;
  const accD = (d.sam || 0);
  const oStn = shinkStn(o), dStn = shinkStn(d);
  const freq = rideMin < 90 ? 15 : rideMin < 180 ? 20 : 30;
  const totalMin = accO + rideMin + accD;
  const baseCityDep = isArr ? tMin - totalMin : tMin;
  const baseShinkDep = baseCityDep + accO;
  const scheds = [];
  for (let off = -2; off <= 2; off++) {
    const shinkDep = Math.round(baseShinkDep / freq) * freq + off * freq;
    if (shinkDep < 6 * 60 || shinkDep > 23 * 60) continue;
    const cityDep = shinkDep - accO;
    if (cityDep < 5 * 60) continue;
    const shinkArr = shinkDep + rideMin;
    const cityArr = shinkArr + accD;
    const steps = [];
    steps.push([toHHMM(cityDep), `${o.l}出発`]);
    if ((o.sam || 0) > 0) steps.push([toHHMM(cityDep + (o.sam || 0)), `${oStn}到着`]);
    steps.push([toHHMM(shinkDep), `${oStn}発（新幹線）`]);
    steps.push([toHHMM(shinkArr), `${dStn}着`]);
    if ((d.sam || 0) > 0) steps.push([toHHMM(cityArr), `${d.l}到着`]);
    scheds.push({
      type: 'shink',
      depTime: toHHMM(cityDep),
      arrTime: toHHMM(cityArr),
      rideOnly: `新幹線 ${toHHMM(shinkDep)}発 → ${toHHMM(shinkArr)}着`,
      totalMin,
      steps,
      goTo: { time: toJP(cityDep), name: oStn },
    });
  }
  return scheds;
}

function genAirSchedules(o, d, isArr, tMin, ld) {
  const flightMin = Math.max(40, Math.round(ld / 8));
  const accO = apAccess(o.pref);
  const accD = apAccess(d.pref);
  const buf = 60;
  const oAp = apName(o.pref), dAp = apName(d.pref);
  const totalMin = accO + buf + flightMin + accD;
  const baseCityDep = isArr ? tMin - totalMin : tMin;
  const baseFlightDep = baseCityDep + accO + buf;
  const freq = 120;
  const scheds = [];
  for (let off = -2; off <= 2; off++) {
    const flightDep = Math.round(baseFlightDep / freq) * freq + off * freq;
    if (flightDep < 6 * 60 || flightDep > 22 * 60) continue;
    const cityDep = flightDep - accO - buf;
    if (cityDep < 4 * 60) continue;
    const flightArr = flightDep + flightMin;
    const cityArr = flightArr + accD;
    scheds.push({
      type: 'fly',
      depTime: toHHMM(cityDep),
      arrTime: toHHMM(cityArr),
      rideOnly: `フライト ${toHHMM(flightDep)}発 → ${toHHMM(flightArr)}着（約${flightMin}分）`,
      totalMin,
      goTo: { time: toJP(cityDep), name: oAp },
      steps: [
        [toHHMM(cityDep), `${o.l}出発`],
        [toHHMM(cityDep + accO), `${oAp}到着・チェックイン`],
        [toHHMM(flightDep - 20), `搭乗ゲートへ移動`],
        [toHHMM(flightDep), `${oAp}発（フライト 約${flightMin}分）`],
        [toHHMM(flightArr), `${dAp}着`],
        [toHHMM(cityArr), `${d.l}到着`],
      ],
    });
  }
  return scheds;
}

function genCarSchedule(o, d, isArr, tMin, rd) {
  const driveMin = Math.round((rd / 80) * 60);
  const prepMin = 15;
  const totalMin = prepMin + driveMin;
  const cityDep = isArr ? tMin - totalMin : tMin;
  const cityArr = cityDep + totalMin;
  return [{
    type: 'car',
    depTime: toHHMM(cityDep),
    arrTime: toHHMM(cityArr),
    rideOnly: `高速・一般道 約${rd}km / 約${driveMin}分`,
    totalMin,
    goTo: { time: toJP(cityDep), name: o.l },
    steps: [
      [toHHMM(cityDep), `出発準備完了`],
      [toHHMM(cityDep + prepMin), `${o.l}出発（高速道路へ）`],
      [toHHMM(cityArr), `${d.l}到着（予定）`],
    ],
  }];
}

// ---- 便検索 ----
function searchSchedule() {
  if (!P.mode) { alert('交通手段を選択してください'); return; }
  const timeStr = document.getElementById('plan-time').value;
  if (!timeStr) { alert('時刻を入力してください'); return; }
  const tMin = parseMin(timeStr);
  const isArr = P.timeType === 'arrive';
  const { o, d, rd, ld } = G;
  let scheds = [];
  if (P.mode === 'shink') scheds = genShinkSchedules(o, d, isArr, tMin);
  else if (P.mode === 'fly') scheds = genAirSchedules(o, d, isArr, tMin, ld);
  else if (P.mode === 'car') scheds = genCarSchedule(o, d, isArr, tMin, rd);
  _scheds = scheds;
  renderSchedules(scheds);
}

function renderSchedules(scheds) {
  const el = document.getElementById('schedule-list');
  if (!scheds.length) {
    el.innerHTML = '<p class="note" style="padding:.75rem 0;">この時間帯の便が見つかりません。別の時刻をお試しください。</p>';
    document.getElementById('plan-step4').style.display = 'block';
    return;
  }
  el.innerHTML = scheds.map((s, i) => `
    <div class="sched-card" onclick="pickSchedule(${i})">
      <div class="sched-hdr">
        <span class="sched-time">${s.depTime} <span class="sched-arr">→</span> ${s.arrTime}</span>
        <span class="sched-dur">${fmtM(s.totalMin)}</span>
      </div>
      <div class="sched-ride">${s.rideOnly}</div>
    </div>
  `).join('');
  document.getElementById('plan-step4').style.display = 'block';
  document.getElementById('plan-step5').style.display = 'none';
  document.getElementById('plan-step4').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- 便選択 → 最終ガイド ----
function pickSchedule(idx) {
  document.querySelectorAll('.sched-card').forEach((c, i) => c.classList.toggle('selected', i === idx));
  const s = _scheds[idx];
  const itin = s.steps.map(([t, l]) => `
    <div class="it-row">
      <div class="it-time">${t}</div>
      <div class="it-lbl">${l}</div>
    </div>`).join('');
  document.getElementById('final-guide').innerHTML = `
    <div class="final-box">
      <div class="final-title">✅ 出発プランが確定しました</div>
      <div class="final-main">
        <div class="final-at">${s.goTo.time}に</div>
        <div class="final-dest">${s.goTo.name}</div>
        <div class="final-cta">に向かってください</div>
      </div>
      <div class="final-itin">
        <div class="itin-ttl">📋 行程</div>
        ${itin}
      </div>
      <p class="note">※時刻は概算です。実際の便・時刻は各交通機関の公式サイトでご確認ください。</p>
    </div>`;
  document.getElementById('plan-step5').style.display = 'block';
  document.getElementById('plan-step5').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- 初期化 ----
document.addEventListener('DOMContentLoaded', () => {
  buildPrefSel('op');
  buildPrefSel('dp');
  document.getElementById('op').value = '愛媛県';
  buildCitySel('oc', '愛媛県', 0);
});
