// ---- 設定 ----
const S = { trip: 'oneway', seat: 'ord', book: 'normal', air: 'fsc', priority: 'balanced' };
const P = { mode: null, timeType: 'depart' };
let G = { o: null, d: null, rd: 0, ld: 0 };
let _scheds = [];
let _gmLoaded = false, _gmLoading = false;

// ---- ユーティリティ ----
function hav(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((la2 - la1) * r / 2), y = Math.sin((lo2 - lo1) * r / 2);
  return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(la1 * r) * Math.cos(la2 * r) * y * y));
}
const fmt  = n => Math.round(n).toLocaleString('ja-JP');
const fmtM = m => { if (m == null || isNaN(m)) return '—'; const h = Math.floor(m / 60), mn = m % 60; return h > 0 ? `${h}時間${mn > 0 ? mn + '分' : ''}` : `${mn}分`; };
// 都市名 → Yahoo検索用の駅名クリーン化 (「さいたま市大宮区」→「さいたま」、「千代田区」→「千代田」、「盛岡市」→「盛岡」)
function cleanCity(name) {
  if (/^(.+)市.+区$/.test(name)) return name.match(/^(.+)市/)[1];
  return name.replace(/[市区町村]$/, '');
}
const opp  = (min, rate, h, pax) => h > 0 ? (min / 60) * h * rate * pax : 0;

// ---- 時刻ユーティリティ ----
function parseMin(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function toHHMM(m) { m = ((m % 1440) + 1440) % 1440; return `${String(~~(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function toJP(m) { m = ((m % 1440) + 1440) % 1440; const h = ~~(m / 60), mn = m % 60; return `${h}時${mn ? mn + '分' : '00分'}`; }
function makeDateObj(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}
function toUnix(dateStr, timeStr) { return Math.floor(makeDateObj(dateStr, timeStr).getTime() / 1000); }

// ---- 料金テーブル ----
function shinkFare(km) {
  // JR実運賃+特急料金(指定席)の実績値に基づくブラケット
  const t = [50,  100,  200,  300,  400,  500,  600,  700,  800,  900, 1000];
  const v = [3500, 5500, 8000,11000,13500,15000,16500,17500,18500,20500,22000];
  for (let i = 0; i < t.length; i++) if (km < t[i]) return v[i];
  return 22500;
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

// ---- 新幹線ハブ駅名 ----
// stt/hubStt → 駅名（路線別に正しくマッピング）
// 同じstt値が東海道系と東北系で重複するため、都道府県で路線を判定して解決する
const HUB_NAME = { 0:'東京', 36:'上野', 99:'名古屋', 138:'新大阪', 170:'新神戸', 202:'岡山', 231:'広島', 256:'新山口', 280:'小倉', 295:'博多', 34:'大宮', 84:'仙台', 161:'新青森', 208:'新函館北斗', 110:'新潟', 75:'長野', 65:'高崎', 200:'鹿児島中央' };

// 都道府県 → 路線系統
const PREF_LINE = {
  '北海道':'tohoku','青森県':'tohoku','岩手県':'tohoku','宮城県':'tohoku',
  '秋田県':'tohoku','山形県':'tohoku','福島県':'tohoku',
  '茨城県':'tohoku','栃木県':'tohoku','群馬県':'joetsu',
  '埼玉県':'tohoku','千葉県':'tokaido','東京都':'tokaido','神奈川県':'tokaido',
  '新潟県':'joetsu','富山県':'hokuriku','石川県':'hokuriku','福井県':'hokuriku',
  '山梨県':'tokaido','長野県':'hokuriku','岐阜県':'tokaido','静岡県':'tokaido',
  '愛知県':'tokaido','三重県':'tokaido',
  '滋賀県':'tokaido','京都府':'tokaido','大阪府':'tokaido','兵庫県':'sanyo',
  '奈良県':'tokaido','和歌山県':'tokaido',
  '鳥取県':'sanyo','島根県':'sanyo','岡山県':'sanyo','広島県':'sanyo','山口県':'sanyo',
  '徳島県':'sanyo','香川県':'sanyo','愛媛県':'sanyo','高知県':'sanyo',
  '福岡県':'kyushu','佐賀県':'kyushu','長崎県':'kyushu','熊本県':'kyushu',
  '大分県':'kyushu','宮崎県':'kyushu','鹿児島県':'kyushu','沖縄県':null,
};

// stt値 → 駅名マッピング（路線別。同じ値で異なる駅がある場合は路線で解決）
const STT_STATION = {
  // === 東海道・山陽・九州 ===
  'tokaido:0':'東京','tokaido:18':'新横浜','tokaido:38':'小田原',
  'tokaido:45':'浜松','tokaido:52':'三島','tokaido:60':'静岡',
  'tokaido:68':'静岡','tokaido:74':'浜松','tokaido:76':'浜松',
  'tokaido:80':'豊橋','tokaido:82':'名古屋','tokaido:88':'名古屋',
  'tokaido:99':'名古屋','tokaido:121':'米原','tokaido:126':'京都',
  'tokaido:130':'京都','tokaido:131':'京都','tokaido:133':'京都',
  'tokaido:138':'新大阪','tokaido:145':'新大阪',
  'tokaido:155':'新大阪','tokaido:28':'東京',
  'sanyo:145':'新神戸','sanyo:155':'新神戸',
  'sanyo:170':'新神戸','sanyo:202':'岡山','sanyo:215':'福山',
  'sanyo:231':'広島','sanyo:243':'新岩国','sanyo:256':'新山口',
  'sanyo:261':'新山口','sanyo:272':'新下関','sanyo:280':'小倉','sanyo:295':'博多',
  'kyushu:295':'博多','kyushu:327':'熊本','kyushu:330':'博多',
  'kyushu:357':'新八代','kyushu:365':'鹿児島中央','kyushu:280':'小倉',
  'kyushu:256':'新山口','kyushu:272':'小倉',
  // === 東北・秋田・山形 ===
  'tohoku:0':'東京','tohoku:26':'大宮','tohoku:28':'大宮','tohoku:34':'大宮',
  'tohoku:36':'上野','tohoku:38':'熊谷',
  'tohoku:48':'宇都宮','tohoku:40':'小山',
  'tohoku:72':'郡山','tohoku:74':'福島','tohoku:76':'福島',
  'tohoku:80':'福島','tohoku:82':'福島',
  'tohoku:84':'仙台','tohoku:88':'仙台',
  'tohoku:100':'仙台','tohoku:101':'仙台','tohoku:102':'仙台',
  'tohoku:110':'山形','tohoku:112':'米沢',
  'tohoku:115':'一関','tohoku:130':'新花巻','tohoku:131':'北上',
  'tohoku:138':'盛岡','tohoku:145':'秋田',
  'tohoku:155':'大曲','tohoku:160':'八戸','tohoku:168':'新青森',
  'tohoku:175':'新青森',
  'tohoku:200':'新青森','tohoku:208':'新函館北斗',
  // === 上越 ===
  'joetsu:0':'東京','joetsu:26':'大宮','joetsu:34':'大宮',
  'joetsu:38':'熊谷','joetsu:48':'高崎','joetsu:65':'高崎',
  'joetsu:88':'長岡','joetsu:100':'新潟','joetsu:110':'新潟',
  // === 北陸 ===
  'hokuriku:0':'東京','hokuriku:26':'大宮','hokuriku:34':'大宮',
  'hokuriku:65':'高崎','hokuriku:68':'佐久平','hokuriku:74':'上田',
  'hokuriku:75':'長野','hokuriku:82':'長野',
  'hokuriku:121':'福井','hokuriku:122':'富山','hokuriku:126':'金沢',
  'hokuriku:130':'金沢','hokuriku:131':'金沢','hokuriku:133':'金沢',
};

// 都道府県のデフォルトハブ駅（STT_STATIONにも見つからないフォールバック）
const PREF_DEFAULT_HUB = {
  '北海道':'新函館北斗','青森県':'新青森','岩手県':'盛岡','宮城県':'仙台',
  '秋田県':'秋田','山形県':'山形','福島県':'郡山',
  '茨城県':'上野','栃木県':'宇都宮','群馬県':'高崎',
  '埼玉県':'大宮','千葉県':'東京','東京都':'東京','神奈川県':'新横浜',
  '新潟県':'新潟','富山県':'富山','石川県':'金沢','福井県':'福井',
  '山梨県':'東京','長野県':'長野','岐阜県':'名古屋','静岡県':'静岡',
  '愛知県':'名古屋','三重県':'名古屋',
  '滋賀県':'京都','京都府':'京都','大阪府':'新大阪','兵庫県':'新神戸',
  '奈良県':'京都','和歌山県':'新大阪',
  '鳥取県':'岡山','島根県':'岡山','岡山県':'岡山','広島県':'広島','山口県':'新山口',
  '徳島県':'岡山','香川県':'岡山','愛媛県':'岡山','高知県':'岡山',
  '福岡県':'博多','佐賀県':'博多','長崎県':'博多','熊本県':'熊本',
  '大分県':'小倉','宮崎県':'鹿児島中央','鹿児島県':'鹿児島中央',
};

function resolveStation(sttVal, pref) {
  const line = PREF_LINE[pref];
  if (line) {
    const name = STT_STATION[`${line}:${sttVal}`];
    if (name) return name;
  }
  // フォールバック: 全路線から検索
  for (const key of Object.keys(STT_STATION)) {
    if (key.endsWith(`:${sttVal}`)) return STT_STATION[key];
  }
  return null;
}

function shinkStn(c) {
  // 直通新幹線駅がある都市
  if (c.stt !== null) {
    const name = resolveStation(c.stt, c.pref);
    if (name) return name + '駅';
    // フォールバック: 市区町村名から駅名を推定
    return cleanCity(c.l) + '駅';
  }
  // ハブ駅経由の都市
  const name = resolveStation(c.hubStt, c.pref);
  if (name) return name + '駅';
  // 最終フォールバック: 都道府県デフォルト
  return (PREF_DEFAULT_HUB[c.pref] || '東京') + '駅';
}

// ---- 空港情報 ----
const AP = {
  '北海道':  { name: '新千歳空港',           access: 40,  iata: 'CTS' },
  '青森県':  { name: '青森空港',             access: 35,  iata: 'AOJ' },
  '岩手県':  { name: '花巻空港',             access: 40,  iata: 'HNA' },
  '宮城県':  { name: '仙台空港',             access: 30,  iata: 'SDJ' },
  '秋田県':  { name: '秋田空港',             access: 30,  iata: 'AXT' },
  '山形県':  { name: '山形空港',             access: 25,  iata: 'GAJ' },
  '福島県':  { name: '福島空港',             access: 40,  iata: 'FKS' },
  '茨城県':  { name: '茨城空港',             access: 30,  iata: 'IBR' },
  '栃木県':  { name: '羽田空港',             access: 100, iata: 'HND' },
  '群馬県':  { name: '羽田空港',             access: 110, iata: 'HND' },
  '埼玉県':  { name: '羽田空港',             access: 70,  iata: 'HND' },
  '千葉県':  { name: '成田空港',             access: 45,  iata: 'NRT' },
  '東京都':  { name: '羽田空港',             access: 40,  iata: 'HND' },
  '神奈川県':{ name: '羽田空港',             access: 45,  iata: 'HND' },
  '新潟県':  { name: '新潟空港',             access: 25,  iata: 'KIJ' },
  '富山県':  { name: '富山きときと空港',       access: 20,  iata: 'TOY' },
  '石川県':  { name: '小松空港',             access: 35,  iata: 'KMQ' },
  '福井県':  { name: '小松空港',             access: 60,  iata: 'KMQ' },
  '山梨県':  { name: '羽田空港',             access: 120, iata: 'HND' },
  '長野県':  { name: '信州まつもと空港',       access: 25,  iata: 'MMJ' },
  '岐阜県':  { name: '中部国際空港',          access: 60,  iata: 'NGO' },
  '静岡県':  { name: '富士山静岡空港',        access: 35,  iata: 'FSZ' },
  '愛知県':  { name: '中部国際空港',          access: 40,  iata: 'NGO' },
  '三重県':  { name: '中部国際空港',          access: 70,  iata: 'NGO' },
  '滋賀県':  { name: '関西国際空港',          access: 70,  iata: 'KIX' },
  '京都府':  { name: '伊丹空港',             access: 45,  iata: 'ITM' },
  '大阪府':  { name: '伊丹空港',             access: 30,  iata: 'ITM' },
  '兵庫県':  { name: '伊丹空港',             access: 35,  iata: 'ITM' },
  '奈良県':  { name: '関西国際空港',          access: 75,  iata: 'KIX' },
  '和歌山県':{ name: '関西国際空港',          access: 70,  iata: 'KIX' },
  '鳥取県':  { name: '鳥取砂丘コナン空港',     access: 25,  iata: 'TTJ' },
  '島根県':  { name: '出雲縁結び空港',        access: 25,  iata: 'IZO' },
  '岡山県':  { name: '岡山桃太郎空港',        access: 30,  iata: 'OKJ' },
  '広島県':  { name: '広島空港',             access: 45,  iata: 'HIJ' },
  '山口県':  { name: '山口宇部空港',          access: 35,  iata: 'UBJ' },
  '徳島県':  { name: '徳島阿波おどり空港',     access: 30,  iata: 'TKS' },
  '香川県':  { name: '高松空港',             access: 30,  iata: 'TAK' },
  '愛媛県':  { name: '松山空港',             access: 20,  iata: 'MYJ' },
  '高知県':  { name: '高知龍馬空港',          access: 25,  iata: 'KCZ' },
  '福岡県':  { name: '福岡空港',             access: 15,  iata: 'FUK' },
  '佐賀県':  { name: '佐賀空港',             access: 40,  iata: 'HSG' },
  '長崎県':  { name: '長崎空港',             access: 40,  iata: 'NGS' },
  '熊本県':  { name: '阿蘇くまもと空港',       access: 50,  iata: 'KMJ' },
  '大分県':  { name: '大分空港',             access: 50,  iata: 'OIT' },
  '宮崎県':  { name: '宮崎ブーゲンビリア空港', access: 20,  iata: 'KMI' },
  '鹿児島県':{ name: '鹿児島空港',            access: 40,  iata: 'KOJ' },
  '沖縄県':  { name: '那覇空港',             access: 20,  iata: 'OKA' },
};
function apName(pref)   { return (AP[pref] || { name: '最寄り空港' }).name; }
function apAccess(pref) { return (AP[pref] || { access: 60 }).access; }
function apIata(pref)   { return (AP[pref] || {}).iata || ''; }

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
  document.getElementById('toll').value = Math.round(rd * 24 / 100) * 100;
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

// ---- 在来線アクセス運賃概算 ----
// sam（ハブ駅までの所要分）からJR在来線の概算運賃を算出
// JR在来線運賃テーブル（営業キロ基準）: 所要分 → 概算距離 → 運賃
function localFareEstimate(samMin) {
  if (!samMin || samMin <= 0) return 0;
  // 在来線は概ね時速60km（特急）～40km（普通）→ 平均50km/h ≒ samMin * 0.83km
  const km = samMin * 0.83;
  // JR在来線運賃概算（自由席特急料金込み）
  if (km <= 10) return 200;
  if (km <= 20) return 420;
  if (km <= 30) return 590;
  if (km <= 40) return 770;
  if (km <= 50) return 990;
  if (km <= 60) return 1170;
  if (km <= 80) return 1520;
  if (km <= 100) return 1980;
  return Math.round(1980 + (km - 100) * 20);
}

// ==== リアルデータ取得 ====

// ---- タイムアウトラッパー ----
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ---- ① Netlifyプロキシ経由（サーバーキー）----
async function fetchViaProxy(mode, o, d, ts, isArr) {
  const url = `/api/directions?mode=${mode}&olat=${o.lat}&olng=${o.lng}&dlat=${d.lat}&dlng=${d.lng}&ts=${ts}&isArr=${isArr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('PROXY_HTTP_' + res.status);
  const data = await res.json();
  if (data.status === 'NO_KEY') throw new Error('NO_KEY');
  if (data.status !== 'OK') throw new Error(data.status || 'API_ERROR');
  return data;
}

// ---- プロキシとクライアントキーを並行して試し、先に成功した方を返す ----
async function fetchBest(apiMode, o, d, ts, isArr, dateStr, timeStr) {
  const T = 12000; // コールドスタート考慮で12秒
  const attempts = [withTimeout(fetchViaProxy(apiMode, o, d, ts, isArr), T)];
  if (getClientKey()) {
    attempts.push(withTimeout(fetchViaClientKey(apiMode, o, d, dateStr, timeStr, isArr), T));
  }
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ---- ② クライアントAPIキー経由（フォールバック）----
function getClientKey() { return localStorage.getItem('gm_key') || ''; }
function saveClientKey(k) { localStorage.setItem('gm_key', k.trim()); }

function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    const key = getClientKey();
    if (!key) { reject(new Error('NO_KEY')); return; }
    if (_gmLoaded) { resolve(); return; }
    if (_gmLoading) {
      let waited = 0;
      const t = setInterval(() => {
        if (_gmLoaded) { clearInterval(t); resolve(); }
        else if ((waited += 200) > 15000) { clearInterval(t); reject(new Error('LOAD_TIMEOUT')); }
      }, 200);
      return;
    }
    _gmLoading = true;
    window._gmCB = () => { _gmLoaded = true; _gmLoading = false; resolve(); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=_gmCB&language=ja`;
    s.onerror = () => { _gmLoading = false; reject(new Error('LOAD_ERROR')); };
    document.head.appendChild(s);
  });
}

async function fetchViaClientKey(mode, o, d, dateStr, timeStr, isArr) {
  await loadGoogleMaps();
  const dt = makeDateObj(dateStr, timeStr);
  const ds = new google.maps.DirectionsService();
  const travelMode = mode === 'driving'
    ? google.maps.TravelMode.DRIVING
    : google.maps.TravelMode.TRANSIT;

  const req = {
    origin: { lat: o.lat, lng: o.lng },
    destination: { lat: d.lat, lng: d.lng },
    travelMode,
    provideRouteAlternatives: true,
  };

  if (mode === 'transit') {
    req.transitOptions = isArr ? { arrivalTime: dt } : { departureTime: dt };
  } else {
    req.drivingOptions = { departureTime: dt, trafficModel: 'bestguess' };
  }

  return new Promise((resolve, reject) => {
    ds.route(req, (res, status) => {
      if (status === 'OK') resolve({ _fromSDK: true, routes: res.routes });
      else reject(new Error(status));
    });
  });
}

// ---- REST APIレスポンス解析（プロキシ用）----
function parseTransitFromREST(data, o, d) {
  const scheds = [];
  for (const route of (data.routes || []).slice(0, 5)) {
    const leg = route.legs?.[0];
    if (!leg?.departure_time) continue;
    const totalMin = Math.round(leg.duration.value / 60);
    const transitSteps = leg.steps.filter(s => s.travel_mode === 'TRANSIT');
    if (!transitSteps.length) continue;

    const firstT = transitSteps[0].transit_details;
    const steps = [];
    steps.push([leg.departure_time.text, `${o.l}出発`]);
    for (const step of leg.steps) {
      if (step.travel_mode !== 'TRANSIT') continue;
      const t = step.transit_details;
      const lineName = t.line.name || t.line.short_name || t.line.vehicle?.name || '鉄道';
      const headsign = t.headsign ? `（${t.headsign}行き）` : '';
      steps.push([t.departure_time.text, `${t.departure_stop.name}発（${lineName}${headsign}）`]);
      steps.push([t.arrival_time.text, `${t.arrival_stop.name}着`]);
    }
    if (steps[steps.length - 1][1] !== `${d.l}到着`) {
      steps.push([leg.arrival_time.text, `${d.l}到着`]);
    }

    const goToDate = new Date((firstT.departure_time.value - 15 * 60) * 1000);
    const goToJP = `${goToDate.getHours()}時${goToDate.getMinutes() > 0 ? goToDate.getMinutes() + '分' : '00分'}`;
    const lineNames = transitSteps.map(s => s.transit_details.line.name || s.transit_details.line.vehicle?.name || '').filter(Boolean);

    scheds.push({
      type: 'shink', depTime: leg.departure_time.text, arrTime: leg.arrival_time.text,
      rideOnly: lineNames.join(' → '), totalMin,
      goTo: { time: goToJP, name: firstT.departure_stop.name },
      steps, isReal: true,
    });
  }
  return scheds;
}

// ---- JavaScript SDK レスポンス解析（フォールバック用）----
function parseTransitFromSDK(data, o, d) {
  const scheds = [];
  for (const route of (data.routes || []).slice(0, 5)) {
    const leg = route.legs?.[0];
    if (!leg?.departure_time) continue;
    const totalMin = Math.round(leg.duration.value / 60);
    const transitSteps = leg.steps.filter(s => s.travel_mode === 'TRANSIT');
    if (!transitSteps.length) continue;

    const firstT = transitSteps[0].transit;
    const steps = [];
    steps.push([leg.departure_time.text, `${o.l}出発`]);
    for (const step of leg.steps) {
      if (step.travel_mode !== 'TRANSIT') continue;
      const t = step.transit;
      const lineName = t.line.name || t.line.short_name || t.line.vehicle?.name || '鉄道';
      const headsign = t.headsign ? `（${t.headsign}行き）` : '';
      steps.push([t.departure_time.text, `${t.departure_stop.name}発（${lineName}${headsign}）`]);
      steps.push([t.arrival_time.text, `${t.arrival_stop.name}着`]);
    }
    if (steps[steps.length - 1][1] !== `${d.l}到着`) {
      steps.push([leg.arrival_time.text, `${d.l}到着`]);
    }

    const goToMs = firstT.departure_time.value * 1000 - 15 * 60 * 1000;
    const goToDate = new Date(goToMs);
    const goToJP = `${goToDate.getHours()}時${goToDate.getMinutes() > 0 ? goToDate.getMinutes() + '分' : '00分'}`;
    const lineNames = transitSteps.map(s => s.transit.line.name || s.transit.line.vehicle?.name || '').filter(Boolean);

    scheds.push({
      type: 'shink', depTime: leg.departure_time.text, arrTime: leg.arrival_time.text,
      rideOnly: lineNames.join(' → '), totalMin,
      goTo: { time: goToJP, name: firstT.departure_stop.name },
      steps, isReal: true,
    });
  }
  return scheds;
}

function parseDrivingRoute(data, o, d, dateStr, timeStr, isArr) {
  const leg = data.routes?.[0]?.legs?.[0];
  if (!leg) return [];
  const totalMin = Math.round((leg.duration_in_traffic?.value || leg.duration.value) / 60);
  const distKm = Math.round(leg.distance.value / 1000);

  let depDate;
  if (isArr) {
    const arrDate = makeDateObj(dateStr, timeStr);
    depDate = new Date(arrDate.getTime() - totalMin * 60 * 1000);
  } else {
    depDate = makeDateObj(dateStr, timeStr);
  }
  const arrDate = new Date(depDate.getTime() + totalMin * 60 * 1000);

  const f = dt => `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  const depStr = f(depDate), arrStr = f(arrDate);
  const goDate = new Date(depDate.getTime() - 15 * 60 * 1000);
  const goJP = `${goDate.getHours()}時${goDate.getMinutes() > 0 ? goDate.getMinutes() + '分' : '00分'}`;

  return [{
    type: 'car', depTime: depStr, arrTime: arrStr,
    rideOnly: `実交通量込み約${distKm}km / 約${totalMin}分`,
    totalMin,
    goTo: { time: goJP, name: o.l },
    steps: [
      [depStr, `${o.l}出発`],
      [arrStr, `${d.l}到着（予定）`],
    ],
    isReal: true,
  }];
}

// ==== Yahoo!路線情報API ====

// ---- 時刻ユーティリティ（Yahoo!形式 "YYYYMMDDHHmm[ss]"）----
function yhTimeToHHMM(t) {
  if (!t || t.length < 12) return '--:--';
  return `${t.slice(8, 10)}:${t.slice(10, 12)}`;
}
function yhTimeToMin(t) {
  if (!t || t.length < 12) return 0;
  return parseInt(t.slice(8, 10)) * 60 + parseInt(t.slice(10, 12));
}
function toYahooDatetime(dateStr, timeStr) {
  // "2024-01-19" + "09:00" → "202401190900"
  return dateStr.replace(/-/g, '') + timeStr.replace(':', '');
}

// ---- Yahoo!路線情報APIレスポンス解析 ----
// 出発地→目的地を直接Yahoo検索するため、ここでは手動でアクセス区間を追加しない。
// Yahoo自身がしおかぜ等の在来線特急も含む最適ルートと通し運賃を返す。
function parseYahooTransit(data, o, d) {
  const features = data.Feature || [];
  const scheds = [];
  if (features.length > 0) {
    console.log('[parseYahoo] Feature[0] 構造:', JSON.stringify(features[0]?.Property?.Summary));
  }

  for (const feat of features.slice(0, 5)) {
    const sumMove = feat.Property?.Summary?.Move;
    const detail  = feat.Property?.Detail?.Move || [];
    if (!sumMove?.DepartureTime) continue;

    // DurationはAPIによって分/秒のどちらの場合もある。1440超なら秒とみなして変換
    const rawDur   = parseInt(sumMove.Duration) || 0;
    const totalMin = rawDur > 1440 ? Math.round(rawDur / 60) : rawDur;
    if (!totalMin) continue;

    // 料金: IC優先 → 現金 → 総額（通し運賃がそのまま返る）
    const rawPrices = sumMove.Price;
    const prices    = Array.isArray(rawPrices) ? rawPrices : (rawPrices ? [rawPrices] : []);
    const priceEl   = prices.find(p => p.Type === 'IC')
                   || prices.find(p => p.Type === '現金')
                   || prices.find(p => p.Type === '総額');
    const fare = priceEl ? parseInt(priceEl.Amount) : null;

    // ステップ構築: Yahooが返すroute全体をそのまま解析（在来線特急も含む）
    const steps     = [];
    const segments  = []; // { lineName, depStn, arrStn, depTime, arrTime }

    steps.push([yhTimeToHHMM(sumMove.DepartureTime), `${o.l}出発`]);

    for (const mv of detail) {
      if (String(mv.Type) !== '1') continue; // 徒歩スキップ
      const lineName = mv.TransportName || '鉄道';
      const depT = yhTimeToHHMM(mv.DepartureTime);
      const arrT = yhTimeToHHMM(mv.ArrivalTime);
      segments.push({ lineName, depStn: mv.DepartureStation, arrStn: mv.ArrivalStation, depT, arrT });
      steps.push([depT, `${mv.DepartureStation}発（${lineName}）`]);
      steps.push([arrT, `${mv.ArrivalStation}着`]);
    }
    if (!segments.length) continue;

    const arrHHMM = yhTimeToHHMM(sumMove.ArrivalTime);
    if (steps[steps.length - 1]?.[1] !== `${d.l}到着`) {
      steps.push([arrHHMM, `${d.l}到着`]);
    }

    // rideOnly: 乗換を含む分かりやすいルート表示（例: 新居浜→[サンポート]→坂出→[マリンライナー]→岡山→[のぞみ]→東京）
    let rideOnly;
    if (segments.length === 1) {
      rideOnly = `${segments[0].depStn}→[${segments[0].lineName}]→${segments[0].arrStn}`;
    } else {
      rideOnly = segments[0].depStn + segments.map(s => `→[${s.lineName}]→${s.arrStn}`).join('');
    }

    // goTo: 最初の乗車便の出発駅・15分前（向かう時刻）
    const firstLeg = detail.find(mv => String(mv.Type) === '1');
    const goToName = firstLeg?.DepartureStation || cleanCity(o.l) + '駅';
    const goToMin  = firstLeg ? yhTimeToMin(firstLeg.DepartureTime) - 15 : yhTimeToMin(sumMove.DepartureTime);
    const goToJP   = toJP(((goToMin % 1440) + 1440) % 1440);

    const depHHMM = yhTimeToHHMM(sumMove.DepartureTime);

    scheds.push({
      type: 'shink',
      depTime:  depHHMM,
      arrTime:  arrHHMM,
      rideOnly,
      totalMin,
      fare,
      steps,
      goTo: { time: goToJP, name: goToName },
      isReal: true,
      _source: 'yahoo',
    });
  }
  return scheds;
}

// ---- Yahoo!乗換案内スクレイピング（サーバー経由）----
async function fetchYahooTransit(o, d, datetime, isArr) {
  // 駅名決定ロジック:
  //   stt != null（新幹線直通駅あり）→ shinkStn()でハブ駅名を使用（「中央区」→「東京」等の曖昧さ回避）
  //   stt == null（在来線アクセス必要）→ cleanCity()で市区名を使用（「新居浜」等、Yahoo!が最適ルート計算）
  const stnName = (c) => c.stt !== null
    ? shinkStn(c).replace('駅', '')
    : cleanCity(c.l);
  const fromStn = encodeURIComponent(stnName(o));
  const toStn   = encodeURIComponent(stnName(d));
  const url = `/api/yahoo-transit?fromStation=${fromStn}&toStation=${toStn}&datetime=${datetime}&isarr=${isArr}`;
  console.log('[Yahoo!transit] 呼び出し:', decodeURIComponent(url));
  const res = await fetch(url);
  if (!res.ok) throw new Error('YAHOO_HTTP_' + res.status);
  const data = await res.json();
  console.log('[Yahoo!transit] Feature数:', data?.Feature?.length ?? 0, '/ status:', data?.status);
  if (data.status === 'ERROR' || data.status === 'API_ERROR') throw new Error(data.status);
  if (data.status === 'INVALID_REQUEST' || data.status === 'NO_RESULT') throw new Error(data.status);
  return data;
}

// ---- 外部リンク ----
function yahooTransitLink(o, d, dateStr, timeStr, isArr) {
  const date = dateStr.replace(/-/g, '');
  const time = timeStr.replace(':', '');
  return `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(o.l)}&to=${encodeURIComponent(d.l)}&date=${date}&time=${time}&type=${isArr ? 4 : 1}`;
}
function googleFlightsLink(o, d, dateStr) {
  const from = apIata(o.pref), to = apIata(d.pref);
  if (!from || !to) return 'https://www.google.com/flights';
  return `https://www.google.com/flights#search;f=${from};t=${to};d=${dateStr};tt=o`;
}
function googleMapsCarLink(o, d) {
  return `https://www.google.com/maps/dir/${o.lat},${o.lng}/${d.lat},${d.lng}`;
}

// ---- 概算スケジュール（フォールバック）----
function genShinkSchedules(o, d, isArr, tMin) {
  const oH = o.stt !== null ? o.stt : o.hubStt;
  const dH = d.stt !== null ? d.stt : d.hubStt;
  const rideMin = Math.max(Math.abs(oH - dH), 15);
  const accO = (o.sam || 0) + 10, accD = (d.sam || 0);
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
    // 在来線乗換がある場合は市内駅を起点とする
    const oLocalStn = (o.sam || 0) > 0 ? `${o.l}駅` : oStn;
    const dLocalStn = (d.sam || 0) > 0 ? `${d.l}駅` : dStn;
    const rideDesc = [
      (o.sam || 0) > 0 ? `在来線 ${oLocalStn}→${oStn}` : null,
      `新幹線 ${oStn}→${dStn}（約${rideMin}分）`,
      (d.sam || 0) > 0 ? `在来線 ${dStn}→${dLocalStn}` : null,
    ].filter(Boolean).join(' → ');
    const steps = [];
    steps.push([toHHMM(cityDep), `${oLocalStn}出発${(o.sam || 0) > 0 ? '（在来線）' : ''}`]);
    if ((o.sam || 0) > 0) steps.push([toHHMM(cityDep + (o.sam || 0)), `${oStn}到着・乗換`]);
    steps.push([toHHMM(shinkDep), `${oStn}発（新幹線）`]);
    steps.push([toHHMM(shinkArr), `${dStn}着`]);
    if ((d.sam || 0) > 0) {
      steps.push([toHHMM(shinkArr + 10), `${dStn}発（在来線）`]);
      steps.push([toHHMM(cityArr), `${dLocalStn}到着`]);
    }
    scheds.push({
      type: 'shink', depTime: toHHMM(cityDep), arrTime: toHHMM(cityArr),
      rideOnly: rideDesc,
      totalMin, steps,
      goTo: { time: toJP(cityDep), name: oLocalStn },
      isReal: false,
    });
  }
  return scheds;
}

function genAirSchedules(o, d, isArr, tMin, ld) {
  const flightMin = Math.max(40, Math.round(ld / 8));
  const accO = apAccess(o.pref), accD = apAccess(d.pref);
  const buf = 60, oAp = apName(o.pref), dAp = apName(d.pref);
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
      type: 'fly', depTime: toHHMM(cityDep), arrTime: toHHMM(cityArr),
      rideOnly: `フライト ${toHHMM(flightDep)}発 → ${toHHMM(flightArr)}着（約${flightMin}分）`,
      totalMin, goTo: { time: toJP(cityDep), name: oAp },
      steps: [
        [toHHMM(cityDep), `${o.l}出発`],
        [toHHMM(cityDep + accO), `${oAp}到着・チェックイン`],
        [toHHMM(flightDep - 20), `搭乗ゲートへ移動`],
        [toHHMM(flightDep), `${oAp}発（フライト 約${flightMin}分）`],
        [toHHMM(flightArr), `${dAp}着`],
        [toHHMM(cityArr), `${d.l}到着`],
      ],
      isReal: false,
    });
  }
  return scheds;
}

function genCarSchedule(o, d, isArr, tMin, rd) {
  const driveMin = Math.round((rd / 90) * 60) + (rd > 500 ? 60 : rd > 300 ? 30 : 0);
  const totalMin = driveMin;
  const cityDep = isArr ? tMin - totalMin : tMin;
  const cityArr = cityDep + totalMin;
  return [{
    type: 'car', depTime: toHHMM(cityDep), arrTime: toHHMM(cityArr),
    rideOnly: `約${rd}km / 約${driveMin}分`,
    totalMin, goTo: { time: toJP(cityDep), name: o.l },
    steps: [
      [toHHMM(cityDep), `${o.l}出発`],
      [toHHMM(cityDep + 15), `高速道路へ`],
      [toHHMM(cityArr), `${d.l}到着（予定）`],
    ],
    isReal: false,
  }];
}

// ---- APIキー設定モーダル ----
function showKeyModal() {
  document.getElementById('key-input').value = getClientKey();
  document.getElementById('key-modal').style.display = 'flex';
}
function closeKeyModal() { document.getElementById('key-modal').style.display = 'none'; }
function applyKey() {
  const k = document.getElementById('key-input').value.trim();
  saveClientKey(k);
  _gmLoaded = false; _gmLoading = false;
  closeKeyModal();
}

// ---- ローディング ----
function setLoading(on) {
  document.getElementById('search-loading').style.display = on ? 'flex' : 'none';
  document.querySelector('#plan-step3 .cbtn').disabled = on;
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

  if (canShink(o, d)) {
    const st = shinkMin1(o, d), tm = st * trips;
    const accessKm = (o.stt === null ? (o.sam || 0) : 0) + (d.stt === null ? (d.sam || 0) : 0);
    const localFareO = localFareEstimate(o.sam || 0);
    const localFareD = localFareEstimate(d.sam || 0);
    const fare = shinkFare(Math.round(ld * 1.2 + accessKm)) * gM * bD + localFareO + localFareD;
    const tc = fare * pax * trips;
    const op1 = opp(tm, 0.40, hourly, pax);
    const oHub = shinkStn(o).replace('駅', '');
    const dHub = shinkStn(d).replace('駅', '');
    const shinkOnlyFare = Math.round(shinkFare(Math.round(ld * 1.2 + accessKm)) * gM * bD);
    const localTotal = localFareO + localFareD;
    const bd = { '新幹線料金': shinkOnlyFare * pax * trips };
    if (localTotal > 0) bd['在来線アクセス'] = localTotal * pax * trips;
    bd['機会損失'] = Math.round(op1);
    results.push({
      id: 'shink', name: '新幹線', icon: '🚅',
      tc, tm, op: op1, two: tc + op1, fat: st > 180 ? 3 : 2, flex: 4,
      route: `${o.l}${o.sam > 0 ? `→${oHub}(乗換)` : ''}→新幹線→${d.sam > 0 ? `(乗換)${dHub}→` : ''}${d.l}`,
      bd,
    });
  }

  if (canFly(o, d, rd)) {
    // フライト時間: 短距離でも最低60分、距離比例項に固定オフセットを加算（国内実績値に近似）
    const fmin = Math.max(60, Math.round(ld * 0.07) + 45);
    // 空港アクセス: APテーブルの都道府県別実績値を使用（出発側はチェックイン60分バッファ込み）
    const accO = apAccess(o.pref) + 60;
    const accD = apAccess(d.pref);
    const tm2 = (accO + fmin + accD) * trips;
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

  if (canCar(o, d)) {
    // 高速主体90km/h、長距離は休憩考慮(300km超で+30分、500km超で+60分)
    const dMin = Math.round((rd / 90) * 60) + (rd > 500 ? 60 : rd > 300 ? 30 : 0);
    const fuel = (rd / mpg) * gasp;
    const pc   = park * Math.max(nights, isR ? 0 : 1);
    const tc3  = (fuel + toll) * trips + pc;
    const tm3  = dMin * trips;
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

  document.getElementById('wbox').innerHTML = `
    <div class="wtitle">${pL}重視スコアで選ぶなら</div>
    <div class="wtext">${winner.icon} ${winner.name} がおすすめ（${isR ? '往復' : '片道'} / ${pax}名）</div>
    <div class="wsub">${winner.route}</div>
    <div class="sd">
      <div class="sdc"><div class="sdl">実費</div><div class="sdv">¥${fmt(winner.tc)}</div></div>
      <div class="sdc"><div class="sdl">所要時間</div><div class="sdv">${fmtM(winner.tm)}</div></div>
      <div class="sdc"><div class="sdl">機会損失込</div><div class="sdv">¥${fmt(winner.two)}</div></div>
    </div>`;

  G = { o, d, rd, ld };
  renderCards(results, winner);

  document.getElementById('results').className = 'res show';
  document.getElementById('plan-modes').innerHTML = results.map(r => `
    <button class="plan-mode-btn${r.id === winner.id ? ' rec' : ''}" data-mode="${r.id}" onclick="selectTransport('${r.id}')">
      ${r.id === winner.id ? '<span class="pmb-badge">おすすめ</span>' : ''}
      <span class="pmb-icon">${r.icon}</span>
      <span class="pmb-name">${r.name}</span>
    </button>`).join('');
  document.getElementById('plan-section').style.display = 'block';
  ['plan-step3','plan-step4','plan-step5'].forEach(id => document.getElementById(id).style.display = 'none');
  P.mode = null;
  document.querySelectorAll('.plan-mode-btn').forEach(b => b.classList.remove('on'));
  const _now = new Date(Date.now() + 5 * 60 * 1000); // 現在時刻+5分
  document.getElementById('plan-date').value = _now.toISOString().split('T')[0];
  document.getElementById('plan-time').value = `${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`;

  // バックグラウンドでリアルデータ取得・反映
  enrichWithRealData(results, o, d).catch(() => {
    document.querySelectorAll('.real-badge.rdb-loading').forEach(el => {
      el.textContent = '概算値';
      el.className = 'real-badge rdb-est';
    });
  });
}

// ---- カード描画 ----
const CLR = { shink: '#378ADD', fly: '#1D9E75', car: '#BA7517' };

function renderCards(results, winner) {
  const mC = Math.max(...results.map(r => r.tc));
  const mT = Math.max(...results.map(r => r.tm));
  const minC = Math.min(...results.map(r => r.tc));
  const minT = Math.min(...results.map(r => r.tm));

  document.getElementById('cards').innerHTML = results.map(r => {
    const isBest = r.id === winner.id;
    const cC = r.tc === minC ? 'g' : r.tc === mC ? 'b' : '';
    const tC = r.tm === minT ? 'g' : r.tm === mT ? 'b' : '';
    const f  = '●'.repeat(r.fat) + '○'.repeat(5 - r.fat);
    const fl = '●'.repeat(r.flex) + '○'.repeat(5 - r.flex);
    const badge = r._enriched
      ? (r._realFare
          ? `<div class="real-badge rdb-ok">✅ 実データ</div>`
          : `<div class="real-badge rdb-partial">⏱ 時間:実データ / 料金:概算</div>`)
      : `<div class="real-badge rdb-loading" id="badge-${r.id}">⟳ リアルデータ取得中...</div>`;
    const flyLink = r.id === 'fly'
      ? `<div class="real-badge rdb-fly"><a href="${googleFlightsLink(G.o, G.d, document.getElementById('plan-date')?.value || new Date().toISOString().split('T')[0])}" target="_blank" rel="noopener">✈️ Google Flightsで実際の料金を確認</a></div>`
      : '';
    return `<div class="card${isBest ? ' best' : ''}" id="card-${r.id}">
      ${isBest ? '<div class="bdg">おすすめ</div>' : ''}
      <div class="cico">${r.icon}</div><div class="cname">${r.name}</div>
      <div class="mr"><span class="ml">実費</span><span class="mv ${cC}" id="cost-${r.id}">¥${fmt(r.tc)}</span></div>
      <div class="mr"><span class="ml">所要時間</span><span class="mv ${tC}" id="time-${r.id}">${fmtM(r.tm)}</span></div>
      <div class="mr"><span class="ml">機会損失</span><span class="mv" id="opp-${r.id}">¥${fmt(r.op)}</span></div>
      <div class="mr"><span class="ml">機会損失込</span><span class="mv" id="two-${r.id}">¥${fmt(r.two)}</span></div>
      <div class="mr"><span class="ml">疲労度</span><span class="mv" style="font-size:9px;letter-spacing:-1px;">${f}</span></div>
      <div class="mr"><span class="ml">柔軟性</span><span class="mv" style="font-size:9px;letter-spacing:-1px;">${fl}</span></div>
      <div class="sb">
        <div class="slb2"><span>総合スコア</span><span id="pct-${r.id}">${r.pct}%</span></div>
        <div class="st"><div class="sf" id="bar-${r.id}" style="width:${r.pct}%;background:${CLR[r.id]};"></div></div>
      </div>
      ${r.id === 'fly' ? flyLink : badge}
    </div>`;
  }).join('');

  const mkC = (id, vFn, lFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const mx = Math.max(...results.map(vFn)) || 1;
    el.innerHTML = results.map(r => {
      const w  = Math.max(8, Math.round((vFn(r) / mx) * 100));
      const bd = Object.entries(r.bd).filter(([k]) => k !== '機会損失').map(([k, v]) => `${k}:¥${fmt(v)}`).join(' / ');
      return `<div class="brow">
        <div class="bm">${r.icon}${r.name}</div>
        <div class="bt"><div class="bf" style="width:${w}%;background:${CLR[r.id]};"><span>${lFn(r)}</span></div></div>
      </div><div class="bsub">${bd}</div>`;
    }).join('');
  };
  mkC('cc',  r => r.tc,  r => `¥${fmt(r.tc)}`);
  mkC('tc2', r => r.tm,  r => fmtM(r.tm));
  mkC('oc2', r => r.two, r => `¥${fmt(r.two)}`);
}

// ---- リアルタイムデータ取得・反映 ----
async function enrichWithRealData(results, o, d) {
  const ts = Math.floor(Date.now() / 1000) + 300; // 5分後出発想定
  const hasShink = results.some(r => r.id === 'shink');
  const hasCar   = results.some(r => r.id === 'car');
  const isR      = S.trip === 'roundtrip';
  const trips    = isR ? 2 : 1;
  const pax      = +document.getElementById('pax').value    || 1;
  const hourly   = +document.getElementById('hourly').value  || 0;
  const mpg      = +document.getElementById('mpg').value    || 15;
  const gasp     = +document.getElementById('gasp').value   || 170;
  const toll     = +document.getElementById('toll').value   || 0;
  const nights   = +document.getElementById('nights').value  || 0;
  const park     = +document.getElementById('park').value   || 1500;

  // 現在日時を Yahoo! 形式に変換（YYYYMMDDHHMM）
  // 出発地→目的地を直接Yahoo検索するためsamAdjust不要
  const nowDt = new Date(ts * 1000);
  const pad2  = n => String(n).padStart(2, '0');
  const yahooNowDt = `${nowDt.getFullYear()}${pad2(nowDt.getMonth()+1)}${pad2(nowDt.getDate())}${pad2(nowDt.getHours())}${pad2(nowDt.getMinutes())}`;

  const [yahooRes, drivingRes] = await Promise.allSettled([
    hasShink ? withTimeout(fetchYahooTransit(o, d, yahooNowDt, false), 10000) : Promise.reject('skip'),
    hasCar   ? withTimeout(fetchViaProxy('driving', o, d, ts, false), 7000)   : Promise.reject('skip'),
  ]);

  let updated = false;

  // 新幹線: Yahoo!路線情報APIで実運賃・実時間を反映
  const shinkR = results.find(r => r.id === 'shink');
  if (shinkR) {
    let gotYahoo = false;
    if (yahooRes.status === 'fulfilled') {
      const data     = yahooRes.value;
      console.log('[enrich] Yahoo!レスポンス Feature数:', data?.Feature?.length ?? 0);
      const sumMove  = data.Feature?.[0]?.Property?.Summary?.Move;
      console.log('[enrich] sumMove:', JSON.stringify(sumMove));
      if (sumMove) {
        // DurationはAPIによって分/秒のどちらの場合もある。1440超なら秒とみなして変換
        // 出発地→目的地の直接検索のため、Yahooの返す時間・運賃をそのまま使用
        const rawDur  = parseInt(sumMove.Duration) || 0;
        const realMin = rawDur > 1440 ? Math.round(rawDur / 60) : rawDur;
        // Price: 単一オブジェクトの場合も配列化
        const rawPrices = sumMove.Price;
        const prices    = Array.isArray(rawPrices) ? rawPrices : (rawPrices ? [rawPrices] : []);
        const priceEl   = prices.find(p => p.Type === 'IC')
                       || prices.find(p => p.Type === '現金')
                       || prices.find(p => p.Type === '総額');
        const yahooFare = priceEl ? parseInt(priceEl.Amount) : null;
        console.log('[enrich] realMin:', realMin, '/ yahooFare:', yahooFare);

        if (realMin) shinkR.tm = realMin * trips;
        if (yahooFare) {
          shinkR.tc = yahooFare * pax * trips;
          // 内訳をYahooの通し運賃に更新（ハブ分割の概算を上書き）
          shinkR.bd = {
            'Yahoo!通し運賃(IC)': yahooFare * pax * trips,
            '機会損失': Math.round(shinkR.op),
          };
        }
        shinkR.op        = opp(shinkR.tm, 0.40, hourly, pax);
        shinkR.two       = shinkR.tc + shinkR.op;
        shinkR._realFare = !!fare;
        shinkR._enriched = true;
        gotYahoo = true;
        updated  = true;
      }
    } else {
      console.warn('[enrich] Yahoo!失敗:', yahooRes.reason);
    }
    if (!gotYahoo) {
      const el = document.getElementById('badge-shink');
      if (el) { el.textContent = '概算値'; el.className = 'real-badge rdb-est'; }
    }
  }

  // 車: driving APIデータを反映（実距離・交通量込み時間）
  const carR = results.find(r => r.id === 'car');
  if (carR) {
    if (drivingRes.status === 'fulfilled') {
      const data = drivingRes.value;
      const leg  = data.routes?.[0]?.legs?.[0];
      if (leg?.duration?.value && leg?.distance?.value) {
        const realMin = Math.round((leg.duration_in_traffic?.value || leg.duration.value) / 60);
        const realKm  = Math.round(leg.distance.value / 1000);
        const fuel    = (realKm / mpg) * gasp;
        const pc      = park * Math.max(nights, isR ? 0 : 1);

        carR.tm   = realMin * trips;
        carR.tc   = (fuel + toll) * trips + pc;
        carR.op   = opp(carR.tm, 1.0, hourly, 1);
        carR.two  = carR.tc + carR.op;
        carR.route = `${o.l}→実ルート(${realKm}km / 交通量込み)→${d.l}`;
        carR.bd['ガソリン'] = Math.round(fuel * trips);
        carR._realFare  = true;
        carR._enriched  = true;
        carR._realKm    = realKm;
        updated = true;
      }
    }
    if (!carR._enriched) {
      const el = document.getElementById('badge-car');
      if (el) { el.textContent = '概算値'; el.className = 'real-badge rdb-est'; }
    }
  }

  if (!updated) return;

  // スコア再計算
  const mC = Math.max(...results.map(r => r.tc));
  const mT = Math.max(...results.map(r => r.tm));
  const mO = Math.max(...results.map(r => r.op));
  results.forEach(r => r.score = scoreF(r, mC, mT, mO));
  const maxSc = Math.max(...results.map(r => r.score));
  results.forEach(r => r.pct = Math.round((r.score / maxSc) * 100));
  const winner = results.reduce((a, b) => a.score > b.score ? a : b);

  // カード数値をDOM更新（再レンダリングせず差し替え）
  const minC = Math.min(...results.map(r => r.tc));
  const minT = Math.min(...results.map(r => r.tm));
  results.forEach(r => {
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt(`cost-${r.id}`, `¥${fmt(r.tc)}`);
    setTxt(`time-${r.id}`, fmtM(r.tm));
    setTxt(`opp-${r.id}`,  `¥${fmt(r.op)}`);
    setTxt(`two-${r.id}`,  `¥${fmt(r.two)}`);
    setTxt(`pct-${r.id}`,  `${r.pct}%`);
    const bar = document.getElementById(`bar-${r.id}`);
    if (bar) bar.style.width = r.pct + '%';

    // バッジ更新
    const badge = document.getElementById(`badge-${r.id}`);
    if (badge && r._enriched) {
      badge.textContent = r._realFare
        ? (r.id === 'car' ? `✅ 実ルート ${r._realKm}km / 交通量込み` : '✅ Yahoo!乗換案内 実データ（時間・料金）')
        : '⏱ Yahoo!乗換案内 時間:実データ / 料金:概算';
      badge.className = 'real-badge ' + (r._realFare ? 'rdb-ok' : 'rdb-partial');
    }

    // おすすめバッジ
    const card = document.getElementById(`card-${r.id}`);
    if (card) card.classList.toggle('best', r.id === winner.id);

    // 費用色クラス更新
    const costEl = document.getElementById(`cost-${r.id}`);
    if (costEl) costEl.className = `mv ${r.tc === minC ? 'g' : r.tc === mC ? 'b' : ''}`;
    const timeEl = document.getElementById(`time-${r.id}`);
    if (timeEl) timeEl.className = `mv ${r.tm === minT ? 'g' : r.tm === mT ? 'b' : ''}`;
  });

  // バーチャート更新
  const mkC = (id, vFn, lFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const mx = Math.max(...results.map(vFn)) || 1;
    el.innerHTML = results.map(r => {
      const w  = Math.max(8, Math.round((vFn(r) / mx) * 100));
      const bd = Object.entries(r.bd).filter(([k]) => k !== '機会損失').map(([k, v]) => `${k}:¥${fmt(v)}`).join(' / ');
      return `<div class="brow">
        <div class="bm">${r.icon}${r.name}</div>
        <div class="bt"><div class="bf" style="width:${w}%;background:${CLR[r.id]};"><span>${lFn(r)}</span></div></div>
      </div><div class="bsub">${bd}</div>`;
    }).join('');
  };
  mkC('cc',  r => r.tc,  r => `¥${fmt(r.tc)}`);
  mkC('tc2', r => r.tm,  r => fmtM(r.tm));
  mkC('oc2', r => r.two, r => `¥${fmt(r.two)}`);

  // wbox（おすすめ）更新
  const pL = { balanced:'バランス', cost:'費用', time:'時間', comfort:'快適性', opp:'機会損失' }[S.priority];
  document.getElementById('wbox').innerHTML = `
    <div class="wtitle">${pL}重視スコアで選ぶなら</div>
    <div class="wtext">${winner.icon} ${winner.name} がおすすめ（${isR ? '往復' : '片道'} / ${pax}名）</div>
    <div class="wsub">${winner.route}</div>
    <div class="sd">
      <div class="sdc"><div class="sdl">実費</div><div class="sdv">¥${fmt(winner.tc)}</div></div>
      <div class="sdc"><div class="sdl">所要時間</div><div class="sdv">${fmtM(winner.tm)}</div></div>
      <div class="sdc"><div class="sdl">機会損失込</div><div class="sdv">¥${fmt(winner.two)}</div></div>
    </div>`;
}

// ---- 交通手段選択 ----
function selectTransport(modeId) {
  P.mode = modeId;
  document.querySelectorAll('.plan-mode-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === modeId));
  document.getElementById('plan-step3').style.display = 'block';
  ['plan-step4','plan-step5'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('plan-step3').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- 便検索（メイン）----
async function searchSchedule() {
  if (!P.mode) { alert('交通手段を選択してください'); return; }
  const timeStr = document.getElementById('plan-time').value;
  const dateStr = document.getElementById('plan-date').value;
  if (!timeStr || !dateStr) { alert('日付と時刻を入力してください'); return; }

  const isArr = P.timeType === 'arrive';
  const tMin  = parseMin(timeStr);
  const ts    = toUnix(dateStr, timeStr);
  const { o, d, rd, ld } = G;

  setLoading(true);
  ['plan-step4','plan-step5'].forEach(id => document.getElementById(id).style.display = 'none');

  try {
    if (P.mode === 'shink') {
      let scheds = null;

      // 指定日時が過去の場合は翌日同時刻で検索
      const specifiedDt = makeDateObj(dateStr, timeStr);
      let searchDateStr = dateStr;
      let pastTimeNote = '';
      if (specifiedDt < new Date()) {
        const tomorrow = new Date(specifiedDt.getTime() + 86400000);
        searchDateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
        pastTimeNote = `（※指定時刻が過去のため翌日 ${searchDateStr} の便を表示）`;
      }

      // ── Yahoo!検索用datetime・isArr の決定 ──────────────────────────
      // Yahoo!のtype=4（到着時刻指定）は前日夜発・翌朝着の長時間ルートを返し
      // 10時間フィルタで全件除外されて概算フォールバックになる問題を回避するため、
      // 到着時刻指定の場合は「推定所要時間を逆算した出発時刻」でtype=1（出発時刻指定）に変換する。
      let yahooDatetime, yahooIsArr;
      if (!isArr) {
        // 出発時刻指定: そのまま
        yahooDatetime = toYahooDatetime(searchDateStr, timeStr);
        yahooIsArr    = false;
      } else {
        // 到着時刻指定: 推定所要時間（+30分バッファ）を引いて出発時刻に変換
        const estMin   = shinkMin1(o, d) + 30;          // 概算所要時間+30分余裕
        const depMin   = tMin - estMin;
        const depTime  = toHHMM(((depMin % 1440) + 1440) % 1440);
        // 深夜を跨ぐ場合は前日日付
        let depDateStr = searchDateStr;
        if (depMin < 0) {
          const prev = new Date(makeDateObj(searchDateStr, '00:00').getTime() - 86400000);
          depDateStr = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(prev.getDate()).padStart(2,'0')}`;
        }
        yahooDatetime = toYahooDatetime(depDateStr, depTime);
        yahooIsArr    = false; // type=1（出発時刻指定）に変換
        pastTimeNote  = (pastTimeNote ? pastTimeNote + '　' : '')
                      + `（到着 ${timeStr} から逆算・${depTime} 頃出発の便を検索）`;
      }

      let dataSource = 'est'; // 'yahoo', 'google', 'est'

      // ① Yahoo!路線情報API（実運賃・実時刻）- 最大2回試行
      for (let attempt = 0; attempt < 2 && !scheds?.length; attempt++) {
        try {
          // 2回目は30分後の出発便も検索（接続の関係で便がない場合のバックアップ）
          const tryDatetime = attempt === 0
            ? yahooDatetime
            : toYahooDatetime(searchDateStr, toHHMM(
                (!isArr ? tMin : tMin - shinkMin1(o, d) - 30) + 30
              ));
          const data = await withTimeout(fetchYahooTransit(o, d, tryDatetime, yahooIsArr), 13000);
          if (data?.Feature?.length) {
            scheds = parseYahooTransit(data, o, d);
            dataSource = 'yahoo';
          }
        } catch (e) {
          if (e.message !== 'NO_KEY') console.warn(`Yahoo transit attempt${attempt + 1}:`, e.message);
        }
      }

      // ② Google Maps transit（フォールバック）
      if (!scheds?.length) {
        try {
          const data = await fetchBest('transit', o, d, ts, isArr, dateStr, timeStr);
          if (data) {
            scheds = data._fromSDK
              ? parseTransitFromSDK(data, o, d)
              : parseTransitFromREST(data, o, d);
            dataSource = 'google';
          }
        } catch (e) {
          console.warn('Google transit:', e.message);
        }
      }

      // ③ 概算（Yahoo・Google両方失敗時のみ）
      if (!scheds?.length) scheds = genShinkSchedules(o, d, isArr, tMin);

      _scheds = scheds;
      // 外部リンク: 到着時刻指定の場合もYahoo!にisarr=trueで渡す
      renderSchedules(scheds, {
        extLink: yahooTransitLink(o, d, searchDateStr, timeStr, isArr),
        extLinkLabel: isArr ? 'Yahoo!乗換案内で到着時刻指定の実際の時刻を確認' : 'Yahoo!乗換案内で実際の時刻を確認',
        dataSource,
        pastTimeNote,
        isArr,
      });

    } else if (P.mode === 'fly') {
      const scheds = genAirSchedules(o, d, isArr, tMin, ld);
      _scheds = scheds;
      renderSchedules(scheds, {
        extLink: googleFlightsLink(o, d, dateStr),
        extLinkLabel: 'Google Flightsで実際の便を検索',
        isFlight: true,
      });

    } else if (P.mode === 'car') {
      let depTimeStr = timeStr;
      if (isArr) {
        const estMin = Math.round((rd / 90) * 60) + (rd > 500 ? 60 : rd > 300 ? 30 : 0);
        depTimeStr = toHHMM(tMin - estMin);
      }
      const depTs = toUnix(dateStr, depTimeStr);
      let scheds = null;
      const data = await fetchBest('driving', o, d, depTs, false, dateStr, depTimeStr);
      if (data) scheds = parseDrivingRoute(data, o, d, dateStr, timeStr, isArr);
      if (!scheds?.length) scheds = genCarSchedule(o, d, isArr, tMin, rd);
      _scheds = scheds;
      renderSchedules(scheds, {
        extLink: googleMapsCarLink(o, d),
        extLinkLabel: 'Google Mapsで経路・渋滞を確認',
      });
    }
  } catch (err) {
    console.error(err);
    let scheds;
    if (P.mode === 'shink') scheds = genShinkSchedules(o, d, isArr, tMin);
    else if (P.mode === 'fly') scheds = genAirSchedules(o, d, isArr, tMin, ld);
    else scheds = genCarSchedule(o, d, isArr, tMin, rd);
    _scheds = scheds;
    renderSchedules(scheds, {});
  } finally {
    setLoading(false);
  }
}

// ---- スケジュール表示 ----
function renderSchedules(scheds, opts = {}) {
  const { extLink, extLinkLabel, isFlight, dataSource, pastTimeNote, isArr } = opts;
  const el = document.getElementById('schedule-list');

  const isReal = scheds.some(s => s.isReal);
  let banner = '';
  if (dataSource === 'yahoo') {
    const arrNote = isArr ? '　※到着希望時刻から逆算した出発便を表示しています。' : '';
    const noteHtml = pastTimeNote ? `<div class="sched-banner est" style="margin-top:4px;">⚠️ ${pastTimeNote}</div>` : '';
    banner = `<div class="sched-banner real">✅ Yahoo!乗換案内の実データを取得しました${arrNote}</div>${noteHtml}`;
  } else if (dataSource === 'google' || (isReal && !isFlight)) {
    banner = `<div class="sched-banner real">✅ Google Maps のリアルタイムデータを取得しました</div>`;
  } else if (isFlight) {
    banner = `<div class="sched-banner est">📊 フライトは推定スケジュールです。実際の便は下のボタンから検索してください。</div>`;
  } else {
    banner = `<div class="sched-banner est">📊 概算スケジュールです。下のリンクで実際の時刻をご確認ください。</div>`;
  }

  if (!scheds.length) {
    el.innerHTML = banner + '<p class="note" style="padding:.75rem 0;">この時間帯の便が見つかりません。別の時刻をお試しください。</p>';
    document.getElementById('plan-step4').style.display = 'block';
    return;
  }

  const cards = scheds.map((s, i) => `
    <div class="sched-card" onclick="pickSchedule(${i})">
      <div class="sched-hdr">
        <span class="sched-time">${s.depTime} <span class="sched-arr">→</span> ${s.arrTime}</span>
        <span class="sched-dur">${fmtM(s.totalMin)}${s.fare ? `　¥${fmt(s.fare)}` : ''}</span>
      </div>
      <div class="sched-ride">${s.rideOnly}</div>
      ${!s.isReal ? '<div class="sched-est-note">📊 概算（実時刻はYahoo!乗換案内でご確認ください）</div>' : ''}
    </div>`).join('');

  const extBtn = extLink
    ? `<a class="ext-link-btn" href="${extLink}" target="_blank" rel="noopener">🔗 ${extLinkLabel || '外部サイトで確認'}</a>`
    : '';

  el.innerHTML = banner + cards + extBtn;
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

  const badgeText = s._source === 'yahoo' ? '✅ Yahoo!乗換案内 実データ'
                  : s._source === 'google' ? '✅ Google Maps リアルタイムデータ'
                  : s.isReal ? '✅ リアルタイムデータ' : '📊 概算データ';
  const badge = s.isReal
    ? `<div class="final-data-badge real-badge">${badgeText}</div>`
    : `<div class="final-data-badge est-badge">${badgeText}</div>`;

  document.getElementById('final-guide').innerHTML = `
    <div class="final-box">
      <div class="final-title">✅ 出発プランが確定しました</div>
      ${badge}
      <div class="final-main">
        <div class="final-at">${s.goTo.time}に</div>
        <div class="final-dest">${s.goTo.name}</div>
        <div class="final-cta">に向かってください</div>
      </div>
      <div class="final-itin">
        <div class="itin-ttl">📋 行程</div>
        ${itin}
      </div>
      <p class="note">※${s._source === 'yahoo' ? '経路・時刻・運賃はYahoo!乗換案内のデータに基づきます。' : s.isReal ? '経路・時刻はGoogle Mapsデータに基づきます。' : '時刻は概算です。'}実際の運賃・時刻は各交通機関の公式サイトでご確認ください。</p>
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
  document.getElementById('dp').value = '東京都';
  buildCitySel('dc', '東京都', 1); // 中央区（index 1）
  updateInfo();
  // クライアントキーがあれば Maps JS を事前ロード（検索時の遅延を減らす）
  if (getClientKey()) loadGoogleMaps().catch(() => {});
});
