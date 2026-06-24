import crypto from "crypto";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const apiKey = process.env.VITE_BINANCE_API_KEY;
  const secret = process.env.VITE_BINANCE_SECRET;

  if (!apiKey || !secret) {
    res.status(500).json({ error: "API keys not configured" });
    return;
  }

  try {
    const ts = Date.now();
    const query = `timestamp=${ts}&recvWindow=10000`;
    const sig = crypto.createHmac("sha256", secret).update(query).digest("hex");
    const url = `https://api.binance.com/api/v3/account?${query}&signature=${sig}`;
    const r = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    const data = await r.json();
    if (!r.ok) { res.status(r.status).json({ error: data.msg || "Binance error" }); return; }
    const balances = (data.balances || [])
      .map(b => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
      .filter(b => b.free + b.locked > 0)
      .sort((a, b) => (b.free + b.locked) - (a.free + a.locked));
    res.status(200).json({ balances });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
