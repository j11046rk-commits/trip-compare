// Yahoo!路線情報 - transit.yahoo.co.jp スクレイピング実装
// 旧YOLP APIは2020年に廃止済みのため、Webページから実データを取得

module.exports = async (req, res) => {
  const { fromStation, toStation, datetime, isarr } = req.query;

  if (!fromStation || !toStation || !datetime || datetime.length < 12) {
    console.warn('[yahoo-transit] パラメータ不足:', req.query);
    return res.status(400).json({ status: 'INVALID_REQUEST' });
  }

  // datetime: YYYYMMDDHHMM
  const dateStr = datetime.slice(0, 8); // YYYYMMDD
  const timeStr = datetime.slice(8, 12); // HHMM
  const type    = isarr === 'true' ? '4' : '1';

  const url = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(fromStation)}&to=${encodeURIComponent(toStation)}&date=${dateStr}&time=${timeStr}&type=${type}&shin=1&expkind=1`;
  console.log('[yahoo-transit] スクレイピング:', url.replace(/from=[^&]+/, 'from=...').replace(/to=[^&]+/, 'to=...'));

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);

    if (!r.ok) {
      console.error('[yahoo-transit] HTTP', r.status);
      return res.status(200).json({ status: 'API_ERROR', code: r.status });
    }

    const html = await r.text();

    // __NEXT_DATA__ からfeatureInfoListを取得
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
    let featureInfoList = null;

    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        featureInfoList = findDeep(nextData, 'featureInfoList');
      } catch (e) {
        console.warn('[yahoo-transit] JSON parse失敗:', e.message);
      }
    }

    // フォールバック: regexでsummaryInfo抽出
    if (!featureInfoList || !featureInfoList.length) {
      featureInfoList = extractBySummaryRegex(html, dateStr);
    }

    if (!featureInfoList || !featureInfoList.length) {
      console.warn('[yahoo-transit] ルート情報取得失敗');
      return res.status(200).json({ status: 'NO_RESULT', Feature: [] });
    }

    const features = buildFeatures(featureInfoList, dateStr, fromStation, toStation);

    if (!features.length) {
      return res.status(200).json({ status: 'NO_RESULT', Feature: [] });
    }

    const f0 = features[0].Property.Summary.Move;
    const f0dep = f0.DepartureTime ? f0.DepartureTime.slice(8,10)+':'+f0.DepartureTime.slice(10,12) : '?';
    const f0arr = f0.ArrivalTime   ? f0.ArrivalTime.slice(8,10)+':'+f0.ArrivalTime.slice(10,12)   : '?';
    const f0detail = features[0].Property.Detail?.Move || [];
    const f0route = f0detail.filter(m => m.Type==='1').map(m => m.TransportName||'鉄道').join('→');
    console.log(`[yahoo-transit] 成功: ${features.length}件 / 先頭: ${f0dep}→${f0arr} (${f0.Duration}分) ¥${f0.Price?.[0]?.Amount} [${f0route}]`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ Feature: features, ResultInfo: { Status: 200 } });

  } catch (err) {
    console.error('[yahoo-transit] 例外:', err.message);
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
};

// オブジェクト内を再帰探索してキーに対応する値を返す
function findDeep(obj, key) {
  if (typeof obj !== 'object' || obj === null) return null;
  if (key in obj) return obj[key];
  for (const val of Object.values(obj)) {
    const found = findDeep(val, key);
    if (found) return found;
  }
  return null;
}

// regexフォールバック: summaryInfoを抽出してfeatureInfoList形式に変換
function extractBySummaryRegex(html, dateStr) {
  const re = /"departureTime":"(\d{2}:\d{2})","arrivalTime":"(\d{2}:\d{2})","totalTime":"([^"]+)","totalPrice":"([^"]+)"/g;
  const railRe = /"railName":"([^"]+)"/g;
  const railNames = [];
  let m;
  while ((m = railRe.exec(html)) !== null) {
    if (!railNames.includes(m[1])) railNames.push(m[1]);
  }

  const list = [];
  let i = 0;
  while ((m = re.exec(html)) !== null) {
    list.push({
      summaryInfo: {
        departureTime: m[1],
        arrivalTime:   m[2],
        totalTime:     m[3],
        totalPrice:    m[4],
      },
      edgeInfoList: [
        { pointName: null, stationName: null, railName: railNames[i] || 'ＪＲ新幹線', timeInfo: [{ time: m[1] }], pointIcon: 0 },
        { pointName: null, stationName: null, railName: '',                           timeInfo: [{ time: m[2] }], pointIcon: 1 },
      ],
    });
    i++;
  }
  return list;
}

// 路線品質スコア（低いほど優秀なルート）
// 優先度: 乗り換え回数(少ない) > 特急/快速利用(あり) > 所要時間(短い) > 出発時刻(早い)
function routeScore(feat) {
  const edges = feat.edgeInfoList || [];
  // 【重要】edgeInfoListは中間駅も含む全停車駅をエッジとして返す場合がある。
  // そのため「同一路線名の連続エッジ」を1路線としてカウントし、
  // 乗車路線数（=乗換回数+1）を正確に計算する。
  // 例: しおかぜ(8駅分のエッジ) + のぞみ(7駅分のエッジ) → seg=2（正解）
  //     単純カウントだと seg=15 になり普通列車ルートに負けてしまう
  let seg = 0;
  let prevLine = null;
  let hasExpress = false;
  const EXP_RE = /特急|新幹線|しおかぜ|南風|宇和海|いしづち|あしずり|うずしお|剣山|あか|まりん|マリン|サンポート|快速|リレー|はやぶさ|のぞみ|ひかり|さくら|みずほ|つばめ|かもめ|ソニック|にちりん|きりしま|はやと|いぶたま|ゆふ|くろしお|はるか|雷鳥|サンダーバード|しらさぎ|ひだ|南紀|スーパー/;

  for (const e of edges) {
    const n = (e.railName || '').trim();
    if (n) {
      if (n !== prevLine) {
        seg++;          // 新しい路線に乗り換え
        prevLine = n;
        if (EXP_RE.test(n)) hasExpress = true;
      }
      // 同一路線の継続エッジはカウントしない
    } else {
      prevLine = null; // 徒歩等（railNameなし）で路線区切りをリセット
    }
  }
  if (!seg) seg = 99;

  const totalMin = parseJpTime(feat.summaryInfo?.totalTime || '');
  const dep      = feat.summaryInfo?.departureTime || '23:59';

  // スコア計算（数値が小さいほど良い）
  return seg * 100000
       + (hasExpress ? 0 : 50000)   // 特急なしは5万点ペナルティ
       + totalMin * 10               // 所要時間（分）×10
       + parseInt(dep.replace(':', ''));  // 出発時刻（HH:MM → 数値）
}

// featureInfoList → Yahoo! API Feature形式に変換
function buildFeatures(featureInfoList, dateStr, fromStation, toStation) {
  // 乗り換え少・特急優先・所要時間短・出発時刻早 の順にソート
  // 夜間接続切れ等の非現実的なルート（10時間超）は除外
  const sorted = featureInfoList
    .filter(f => {
      const t = parseJpTime(f.summaryInfo?.totalTime || '');
      return t > 0 && t < 600; // 10時間以内（東京→鹿児島中央など長距離を考慮）
    })
    .sort((a, b) => routeScore(a) - routeScore(b));

  const features = [];

  for (const feat of sorted.slice(0, 5)) {
    const si = feat.summaryInfo;
    if (!si?.departureTime || !si?.arrivalTime || !si?.totalTime || !si?.totalPrice) continue;

    const totalMin = parseJpTime(si.totalTime);
    if (!totalMin) continue;

    const fare = parseInt(String(si.totalPrice).replace(/,/g, ''));
    if (!fare) continue;

    const depFull = toYahooFmt(dateStr, si.departureTime);
    const arrFull = toYahooFmt(dateStr, si.arrivalTime, si.departureTime);

    // edgeInfoList から乗車区間を構築（中間駅グループ化対応）
    // pointIcon: 0=最初の乗車駅, 3=乗換で次の電車に乗る駅, 2=乗換到着のみ, 1=最終到着
    // timeInfo.type: 3=単一イベント, 2=到着(乗換前), 1=出発(乗換後)
    // 【修正】同一railNameの連続エッジ（中間停車駅）を1路線としてまとめる
    const detailMoves = [];
    const edges = feat.edgeInfoList || [];

    let i = 0;
    while (i < edges.length) {
      const edge = edges[i];
      const n = (edge.railName || '').trim();

      if (!n) { i++; continue; } // 徒歩等はスキップ

      // この路線の出発情報（乗車駅のエッジ）
      const depInfo = edge.timeInfo?.find(t => t.type === 3) ||
                      edge.timeInfo?.find(t => t.type === 1);
      if (!depInfo) { i++; continue; }

      // 同一railNameの連続エッジ（中間停車駅）をまとめてスキップ
      let j = i + 1;
      while (j < edges.length && (edges[j].railName || '').trim() === n) {
        j++;
      }

      // 次の路線または終着のエッジ
      const nextEdge = j < edges.length ? edges[j] : null;
      if (!nextEdge) { i = j; continue; }

      const arrInfo = nextEdge.timeInfo?.find(t => t.type === 2) ||
                      nextEdge.timeInfo?.find(t => t.type === 3) ||
                      nextEdge.timeInfo?.[0];
      if (!arrInfo) { i = j; continue; }

      detailMoves.push({
        Type:             '1',
        TransportName:    n,
        DepartureStation: edge.pointName     || edge.stationName     || fromStation,
        ArrivalStation:   nextEdge.pointName || nextEdge.stationName || toStation,
        DepartureTime:    toYahooFmt(dateStr, depInfo.time),
        ArrivalTime:      toYahooFmt(dateStr, arrInfo.time, depInfo.time),
      });

      i = j; // 次の路線グループへ
    }

    // edgeInfoListが空の場合は1ステップの概略を構築
    if (!detailMoves.length) {
      detailMoves.push({
        Type:             '1',
        TransportName:    edges[0]?.railName || 'ＪＲ',
        DepartureStation: fromStation.replace('駅', ''),
        ArrivalStation:   toStation.replace('駅', ''),
        DepartureTime:    depFull,
        ArrivalTime:      arrFull,
      });
    }

    features.push({
      Property: {
        Summary: {
          Move: {
            DepartureTime: depFull,
            ArrivalTime:   arrFull,
            Duration:      totalMin,
            Price:         [{ Type: 'IC', Amount: String(fare) }],
          },
        },
        Detail: { Move: detailMoves },
      },
    });
  }

  return features;
}

// "1時間36分" → 96
function parseJpTime(str) {
  const h = parseInt((str.match(/(\d+)時間/) || [])[1] || '0');
  const m = parseInt((str.match(/(\d+)分/)   || [])[1] || '0');
  return h * 60 + m;
}

// "18:09" → "YYYYMMDD1809"（到着が翌日の場合は+1日）
function toYahooFmt(dateStr, timeHHMM, depTimeHHMM) {
  const compact = timeHHMM.replace(':', '');
  let date = dateStr;
  if (depTimeHHMM) {
    // 到着時刻が出発時刻より早ければ翌日
    if (parseInt(timeHHMM) < parseInt(depTimeHHMM)) {
      const d = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`);
      d.setDate(d.getDate() + 1);
      const p2 = n => String(n).padStart(2, '0');
      date = `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}`;
    }
  }
  return date + compact;
}
