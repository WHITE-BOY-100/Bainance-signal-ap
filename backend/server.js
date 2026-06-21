const express = require('express');
const { USDMClient } = require('binance');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' })); // development සඳහා
app.use(express.json());

const client = new USDMClient({
  api_key: process.env.BINANCE_API_KEY,
  api_secret: process.env.BINANCE_API_SECRET,
});

// Read-only endpoints
app.get('/futures/balance', async (req, res) => {
  try {
    const data = await client.getBalance();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/futures/positions', async (req, res) => {
  try {
    const data = await client.getPositionRisk();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/futures/trades', async (req, res) => {
  try {
    const { symbol, limit = 20 } = req.query;
    const data = await client.getAccountTrades({ symbol, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 5001;
app.listen(PORT, () => console.log(`✅ Backend running → http://localhost:${PORT}`));
