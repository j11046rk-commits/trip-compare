// Yahoo!路線情報APIプロキシ（Vercel Serverless Function）
// 環境変数 YAHOO_CLIENT_ID でアプリケーションIDを管理
// クライアントにAPIキーを公開しない

module.exports = async (req, res) => {
  const clientId = process.env.YAHOO_CLIENT_ID;

  if (!clientId) {
    return res.status(200).json({ status: 'NO_KEY' });
  }

  const { fromLat, fromLng, toLat, toLng, datetime, isarr } = req.query;

  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ status: 'INVALID_REQUEST' });
  }

  const params = new URLSearchParams({
    appid:   clientId,
    from:    `${fromLat},${fromLng}`,
    to:      `${toLat},${toLng}`,
    output:  'json',
    results: '5',
    type:    isarr === 'true' ? '1' : '0',  // 0=出発時刻指定 / 1=到着時刻指定
  });

  if (datetime) params.set('datetime', datetime); // YYYYMMDDHHmm 形式

  const url = `https://map.yahooapis.jp/transit/V1/search?${params}`;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r     = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!r.ok) {
      return res.status(200).json({ status: 'API_ERROR', code: r.status });
    }

    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
};
