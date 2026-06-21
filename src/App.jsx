import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ============================================================
   SCALP TERMINAL — Spot + Futures + Read-Only Account
   ============================================================ */

const SYMBOLS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT",
  "AVAXUSDT","DOTUSDT","LINKUSDT","TRXUSDT","MATICUSDT","LTCUSDT","SHIBUSDT",
  "ATOMUSDT","UNIUSDT","ETCUSDT","XLMUSDT","NEARUSDT","APTUSDT","FILUSDT",
  "ARBUSDT","OPUSDT","INJUSDT","SUIUSDT","TONUSDT","HBARUSDT","ICPUSDT",
  "VETUSDT","RUNEUSDT"
];

const TIMEFRAMES = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const KLINE_LIMIT = 80;

/* ---------- indicator math ---------- */
function ema(values, period) {
  const k = 2 / (period + 1);
  let prev = values[0];
  const out = [prev];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes) {
  if (closes.length < 26) return { line: 0, signal: 0, hist: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(-9), 9);
  const line = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { line, signal, hist: line - signal };
}

function sma(values, period) {
  if (values.length < period) return values[values.length - 1];
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function priceAction(highs, lows, closes) {
  const n = Math.min(8, closes.length - 1);
  if (n < 3) return 0;
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    if (highs[i] > highs[i - 1]) hh++; else lh++;
    if (lows[i] > lows[i - 1]) hl++; else ll++;
  }
  return (hh + hl - lh - ll) / (n * 2);
}

function detectCandlePatterns(klines) { /* ... your original full function ... */ 
  // Paste your original detectCandlePatterns function here
  const found = [];
  // ... (copy the whole function from your previous code)
  return found;
}

function findSwings(klines, lookback = 2) { /* original */ }
function detectChartPatterns(klines) { /* original */ }
function detectAllPatterns(klines) { /* original */ }
function detectSupportResistance(klines, maxLevels = 4) { /* original */ }

function computeSignal(klines) {
  // your original computeSignal function
  const closes = klines.map((k) => k.close);
  // ... rest of your original logic
  return { score: 0, label: "WAIT", rsiVal: 50, macdHist: 0, paScore: 0, patterns: [], latestPattern: null, levels: [] };
}

/* audio, formatting, Sparkline, SignalBadge, StrengthBar, CandlestickChart, PositionCalculator — all your original functions */

function playAlertTone(kind) { /* original */ }
function fmtPrice(p) { /* original */ }
function fmtPct(p) { /* original */ }

function Sparkline({ data, positive }) { /* original full function */ }
function SignalBadge({ label, score }) { /* original */ }
function StrengthBar({ score }) { /* original */ }
function CandlestickChart({ symbol, klines, patterns, levels, interval, onClose }) { /* original full function */ }
function PositionCalculator({ defaultEntry, symbol }) { /* original */ }
function Field({ label, value, onChange }) { /* original */ }
function Row({ label, value, highlight }) { /* original */ }

function Th({ label, sortKey, sortKeyActive, sortDir, toggleSort, align = "right" }) { /* original */ }

/* ============================================================
   MAIN APP
   ============================================================ */

export default function ScalpTerminal() {
  const [mode, setMode] = useState("futures"); // "spot" | "futures"

  const [rows, setRows] = useState({});
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [connStatus, setConnStatus] = useState("connecting");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [interval, setInterval_] = useState("1m");
  const [chartSymbol, setChartSymbol] = useState(null);
  const [watchlist, setWatchlist] = useState(() => new Set());
  const [watchOnly, setWatchOnly] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [recentAlert, setRecentAlert] = useState(null);

  // Account
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [showAccountPanel, setShowAccountPanel] = useState(false);

  const wsRefs = useRef({});
  const dataRef = useRef({});
  const alertedRef = useRef({});
  const alertsEnabledRef = useRef(false);

  useEffect(() => { alertsEnabledRef.current = alertsEnabled; }, [alertsEnabled]);

  // Fetch Account
  const fetchAccountData = async () => {
    try {
      const res = await fetch(`http://localhost:5001/api/balance?type=${mode}`);
      const data = await res.json();
      setAccount(data);

      if (mode === "futures") {
        const posRes = await fetch('http://localhost:5001/api/positions');
        const posData = await posRes.json();
        setPositions(posData.filter(p => Math.abs(parseFloat(p.positionAmt || 0)) > 0.0001));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAccountData();
    const int = setInterval(fetchAccountData, 15000);
    return () => clearInterval(int);
  }, [mode]);

  function toggleWatch(symbol) {
    setWatchlist(prev => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  // Main Data + WebSocket Effect
  useEffect(() => {
    let cancelled = false;
    setConnStatus("connecting");
    setRows({});
    dataRef.current = {};
    Object.values(wsRefs.current).forEach(ws => ws?.close());
    wsRefs.current = {};

    const isFutures = mode === "futures";
    const baseUrl = isFutures ? "https://fapi.binance.com" : "https://api.binance.com";
    const wsBase = isFutures ? "wss://fstream.binance.com" : "wss://stream.binance.com";
    const path = isFutures ? "/fapi/v1" : "/api/v3";

    async function initSymbol(sym) {
      try {
        const res = await fetch(`\( {baseUrl} \){path}/klines?symbol=\( {sym}&interval= \){interval}&limit=${KLINE_LIMIT}`);
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;

        const klines = data.map(k => ({
          open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
          close: parseFloat(k[4]), volume: parseFloat(k[5])
        }));

        const tickerRes = await fetch(`\( {baseUrl} \){path}/ticker/24hr?symbol=${sym}`);
        const ticker = await tickerRes.json();

        const signal = computeSignal(klines);
        dataRef.current[sym] = {
          symbol: sym, klines, price: klines[klines.length-1].close,
          pct24h: parseFloat(ticker.priceChangePercent || 0),
          signal
        };

        if (!cancelled) setRows(prev => ({...prev, [sym]: dataRef.current[sym]}));
        openSocket(sym);
      } catch (e) {}
    }

    function openSocket(sym) {
      const lower = sym.toLowerCase();
      const ws = new WebSocket(`\( {wsBase}/ws/ \){lower}@kline_${interval}`);
      wsRefs.current[sym] = ws;
      ws.onopen = () => setConnStatus("live");
      ws.onmessage = (msg) => {
        // Your original onmessage logic here (update candle + signal)
        // ... paste your original onmessage code ...
      };
    }

    SYMBOLS.forEach((sym, idx) => setTimeout(() => !cancelled && initSymbol(sym), idx * 80));

    return () => {
      cancelled = true;
      Object.values(wsRefs.current).forEach(ws => ws?.close());
    };
  }, [interval, mode]);

  // rowList, toggleSort, counts etc. (copy from your original)

  const rowList = useMemo(() => {
    // your original rowList logic
    let list = Object.values(rows);
    // ... filtering and sorting logic from original ...
    return list;
  }, [rows, sortKey, sortDir, filter, search, watchOnly, watchlist]);

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#C9D1D9] font-mono text-sm flex flex-col">
      {/* Header with Mode Switch */}
      <div className="border-b border-[#1C232C] px-5 py-3.5 flex items-center justify-between bg-[#0F141A]">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${connStatus === "live" ? "bg-[#3DD68C] animate-pulse" : "bg-[#5A6472]"}`} />
          <h1 className="text-[15px] font-bold text-[#E6EDF3]">SCALP<span className="text-[#F0B90B]">TERM</span></h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-[#11161D] p-1 rounded border border-[#1C232C]">
            <button onClick={() => setMode("spot")} className={`px-5 py-1 text-xs font-bold rounded ${mode === "spot" ? "bg-[#F0B90B] text-black" : "text-[#8B96A5]"}`}>SPOT</button>
            <button onClick={() => setMode("futures")} className={`px-5 py-1 text-xs font-bold rounded ${mode === "futures" ? "bg-[#F0B90B] text-black" : "text-[#8B96A5]"}`}>FUTURES</button>
          </div>

          <button onClick={() => setShowAccountPanel(!showAccountPanel)} className="px-4 py-1.5 bg-[#1C232C] hover:bg-[#242C36] rounded text-sm">
            💰 Account
          </button>
        </div>
      </div>

      {/* Your original Toolbar, Table, Footer, Chart Modal, Alert Toast here */}

      {/* Account Panel */}
      {showAccountPanel && (
        <div className="fixed right-6 top-24 w-96 bg-[#0F141A] border border-[#242C36] rounded-xl p-5 z-50 shadow-2xl">
          <h3 className="text-[#E6EDF3] font-bold mb-4">{mode.toUpperCase()} Account (Read Only)</h3>
          {account && (
            <div className="space-y-4">
              <div className="bg-[#11161D] p-4 rounded-lg">
                <div className="text-[#5A6472]">Available USDT</div>
                <div className="text-3xl font-bold text-[#3DD68C]">
                  {mode === "futures" 
                    ? (account.find?.(b => b.asset === 'USDT')?.availableBalance || '0')
                    : (account.balances?.find?.(b => b.asset === 'USDT')?.free || '0')}
                </div>
              </div>

              {mode === "futures" && positions.length > 0 && (
                <div className="space-y-2">
                  {positions.map((p, i) => (
                    <div key={i} className="bg-[#11161D] p-3 rounded">
                      <div>{p.symbol} {parseFloat(p.positionAmt)} ({p.leverage}x)</div>
                      <div className="text-xs">PNL: <span className={parseFloat(p.unRealizedProfit) >= 0 ? "text-[#3DD68C]" : "text-[#F2545B]"}>{parseFloat(p.unRealizedProfit).toFixed(2)}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
