// api/chart.js : proxy Yahoo Finance untuk dashboard (jalan di server Vercel, bukan di browser)
const RANGES = ['1y', '2y', '5y', '6y'];
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function getYahoo(symbol, range) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) throw new Error('Yahoo HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

module.exports = async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const range = String(req.query.range || '5y');
  // Hanya saham BEI (.JK) supaya endpoint ini tidak bisa disalahgunakan sebagai proxy bebas
  if (!/^[A-Z0-9]{2,6}\.JK$/.test(symbol) || !RANGES.includes(range)) {
    return res.status(400).json({ error: 'parameter tidak valid' });
  }
  try {
    const j = await getYahoo(symbol, range);
    const r0 = j.chart && j.chart.result && j.chart.result[0];
    if (!r0 || !r0.timestamp) throw new Error('data kosong');
    const off = (r0.meta && r0.meta.gmtoffset) || 25200; // WIB
    const q = r0.indicators.quote[0];
    const out = { symbol, d: [], o: [], h: [], l: [], c: [], v: [] };

    r0.timestamp.forEach((ts, i) => {
      const c = q.close[i];
      if (c == null || c <= 0) return;
      const o = q.open[i] ?? c;
      const h = q.high[i] ?? Math.max(o, c);
      const l = q.low[i] ?? Math.min(o, c);
      const v = q.volume[i] ?? 0;
      const date = new Date((ts + off) * 1000).toISOString().slice(0, 10);
      // Yahoo kadang mengirim bar hari ini dua kali: yang terakhir dipakai
      let k = out.d.length;
      if (k && out.d[k - 1] === date) k -= 1;
      out.d[k] = date; out.o[k] = o; out.h[k] = h; out.l[k] = l; out.c[k] = c; out.v[k] = v;
    });

    if (out.d.length < 40) throw new Error('data kurang');
    // CDN Vercel menyimpan hasil 15 menit; browser selalu cek ulang ke CDN
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=900');
    return res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
