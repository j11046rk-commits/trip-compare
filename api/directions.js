// Google Maps Directions APIプロキシ（Vercel Serverless Function）
// 環境変数 GOOGLE_MAPS_KEY でAPIキーを管理
// クライアントにAPIキーを公開しない

module.exports = async (req, res) => {
  const key = process.env.GOOGLE_MAPS_KEY;

  if (!key) {
    return res.status(200).json({ status: 'NO_KEY' });
  }

  const { mode, olat, olng, dlat, dlng, ts, isArr } = req.query;

  if (!olat || !olng || !dlat || !dlng) {
    return res.status(400).json({ status: 'INVALID_REQUEST' });
  }

  const params = new URLSearchParams({
    origin:       `${olat},${olng}`,
    destination:  `${dlat},${dlng}`,
    mode:         mode || 'transit',
    key,
    language:     'ja',
    region:       'jp',
    alternatives: 'true',
  });

  if (ts) {
    params.set(isArr === 'true' ? 'arrival_time' : 'departure_time', ts);
  }

  if (mode === 'driving') {
    params.set('traffic_model', 'best_guess');
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const r     = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data  = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
};
