// Yahoo!路線情報APIプロキシ（Vercel Serverless Function）
// 環境変数 YAHOO_CLIENT_ID でアプリケーションIDを管理

module.exports = async (req, res) => {
  const clientId = process.env.YAHOO_CLIENT_ID;

  if (!clientId) {
    console.warn('[yahoo-transit] YAHOO_CLIENT_ID が未設定です');
    return res.status(200).json({ status: 'NO_KEY' });
  }

  const { fromLat, fromLng, toLat, toLng, datetime, isarr } = req.query;

  if (!fromLat || !fromLng || !toLat || !toLng) {
    console.warn('[yahoo-transit] 必須パラメータ不足:', req.query);
    return res.status(400).json({ status: 'INVALID_REQUEST' });
  }

  const params = new URLSearchParams({
    appid:   clientId,
    from:    `${fromLat},${fromLng}`,
    to:      `${toLat},${toLng}`,
    output:  'json',
    results: '5',
    type:    isarr === 'true' ? '1' : '0',
  });
  if (datetime) params.set('datetime', datetime);

  // APIキーをログに出さないよう、デバッグURLはappidをマスク
  const debugUrl = `https://map.yahooapis.jp/transit/V1/search?from=${fromLat},${fromLng}&to=${toLat},${toLng}&datetime=${datetime || 'none'}&type=${isarr === 'true' ? 1 : 0}`;
  console.log('[yahoo-transit] 呼び出し:', debugUrl);

  const url = `https://map.yahooapis.jp/transit/V1/search?${params}`;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r     = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    console.log('[yahoo-transit] HTTPステータス:', r.status);

    if (!r.ok) {
      console.error('[yahoo-transit] APIエラー HTTP', r.status);
      return res.status(200).json({ status: 'API_ERROR', code: r.status });
    }

    const data = await r.json();

    // ResultInfo.Status でAPIレベルのエラーを検知
    const apiStatus = data?.ResultInfo?.Status;
    console.log('[yahoo-transit] ResultInfo.Status:', apiStatus, '/ ルート数:', data?.Feature?.length ?? 0);

    if (apiStatus && apiStatus !== 200) {
      console.error('[yahoo-transit] APIエラー Status:', apiStatus, data?.ResultInfo?.Description);
      return res.status(200).json({ status: 'API_ERROR', code: apiStatus, description: data?.ResultInfo?.Description });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    console.error('[yahoo-transit] 例外:', err.message);
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
};
