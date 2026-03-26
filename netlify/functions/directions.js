// サーバー側でAPIキーを保持し、Google Maps Directions APIへのプロキシとして動作
// クライアントにAPIキーを公開しない

exports.handler = async (event) => {
  const key = process.env.GOOGLE_MAPS_KEY;

  if (!key) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'NO_KEY' }),
    };
  }

  const q = event.queryStringParameters || {};
  const { mode, olat, olng, dlat, dlng, ts, isArr } = q;

  if (!olat || !olng || !dlat || !dlng) {
    return {
      statusCode: 400,
      body: JSON.stringify({ status: 'INVALID_REQUEST' }),
    };
  }

  const params = new URLSearchParams({
    origin: `${olat},${olng}`,
    destination: `${dlat},${dlng}`,
    mode: mode || 'transit',
    key,
    language: 'ja',
    region: 'jp',
    alternatives: 'true',
  });

  if (ts) {
    if (isArr === 'true') {
      params.set('arrival_time', ts);
    } else {
      params.set('departure_time', ts);
    }
  }

  // transit_mode を絞らず、在来線・新幹線・地下鉄すべて含める
  // （特急しおかぜ等の在来線特急も確実にルートに含めるため）

  if (mode === 'driving') {
    params.set('traffic_model', 'best_guess');
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'ERROR', message: err.message }),
    };
  }
};
