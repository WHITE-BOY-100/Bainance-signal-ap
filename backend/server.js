const express = require('express');
const { SpotClient, USDMClient } = require('binance');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Spot Client
const spotClient = new SpotClient({
  api_key: process.env.BINANCE_API_KEY,
  api_secret: process.env.BINANCE_API_SECRET,
});

// Futures Client
const futuresClient = new USDMClient({
  api_key: process.env.BINANCE_API_KEY,
  api_secret: process.env.BINANCE_API_SECRET,
});

// Common endpoints
app.get('/api/balance', async (req, res) => {
  const { type } = req.query; // spot or futures
  try {
    if (type === 'futures') {
      const data = await futuresClient.getBalance();
      res.json(data);
    } else {
      const data = await spotClient.getAccount();
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/positions', async (req, res) => {
  try {
    const data = await futuresClient.getPositionRisk();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 5001;
app.listen(PORT, () => console.log(`✅ Backend (Spot + Futures) running on ${PORT}`));
