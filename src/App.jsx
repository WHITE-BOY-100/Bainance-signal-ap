import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ============================================================
   SCALP TERMINAL — live Binance signal dashboard
   Design: dark terminal aesthetic, monospace numerics,
   dense sortable table, inline sparklines, signal strength bars.
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

/* simple price-action: detect higher-highs/higher-lows momentum over last N candles */
function priceAction(highs, lows, closes) {
  const n = Math.min(8, closes.length - 1);
  if (n < 3) return 0;
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    if (highs[i] > highs[i - 1]) hh++; else lh++;
    if (lows[i] > lows[i - 1]) hl++; else ll++;
  }
  return (hh + hl - lh - ll) / (n * 2); // -1..1
}

/* ---------- candlestick pattern detection (single/double candle) ---------- */
function detectCandlePatterns(klines) {
  const found = [];
  const n = klines.length;
  if (n < 3) return found;

  const body = (k) => Math.abs(k.close - k.open);
  const range = (k) => k.high - k.low || 1e-9;
  const upperWick = (k) => k.high - Math.max(k.open, k.close);
  const lowerWick = (k) => Math.min(k.open, k.close) - k.low;
  const isBull = (k) => k.close > k.open;
  const isBear = (k) => k.close < k.open;

  for (let i = 2; i < n; i++) {
    const c0 = klines[i - 2], c1 = klines[i - 1], c2 = klines[i];
    const idx = i;

    // Doji: very small body relative to range
    if (body(c2) / range(c2) < 0.1) {
      found.push({ index: idx, name: "Doji", type: "neutral" });
    }

    // Hammer: small body near top, long lower wick, little upper wick (bullish reversal, after downtrend)
    if (
      body(c2) / range(c2) < 0.35 &&
      lowerWick(c2) > body(c2) * 2 &&
      upperWick(c2) < body(c2) * 0.5 &&
      c1.close < c0.close
    ) {
      found.push({ index: idx, name: "Hammer", type: "bullish" });
    }

    // Shooting Star: small body near bottom, long upper wick (bearish reversal, after uptrend)
    if (
      body(c2) / range(c2) < 0.35 &&
      upperWick(c2) > body(c2) * 2 &&
      lowerWick(c2) < body(c2) * 0.5 &&
      c1.close > c0.close
    ) {
      found.push({ index: idx, name: "Shooting Star", type: "bearish" });
    }

    // Bullish Engulfing: prev bearish, curr bullish, curr body engulfs prev body
    if (
      isBear(c1) && isBull(c2) &&
      c2.open <= c1.close && c2.close >= c1.open &&
      body(c2) > body(c1)
    ) {
      found.push({ index: idx, name: "Bullish Engulfing", type: "bullish" });
    }

    // Bearish Engulfing
    if (
      isBull(c1) && isBear(c2) &&
      c2.open >= c1.close && c2.close <= c1.open &&
      body(c2) > body(c1)
    ) {
      found.push({ index: idx, name: "Bearish Engulfing", type: "bearish" });
    }

    // Morning Star: bearish, small indecisive candle, strong bullish closing above midpoint of first
    if (
      isBear(c0) && body(c1) / range(c1) < 0.4 &&
      isBull(c2) && c2.close > (c0.open + c0.close) / 2
    ) {
      found.push({ index: idx, name: "Morning Star", type: "bullish" });
    }

    // Evening Star
    if (
      isBull(c0) && body(c1) / range(c1) < 0.4 &&
      isBear(c2) && c2.close < (c0.open + c0.close) / 2
    ) {
      found.push({ index: idx, name: "Evening Star", type: "bearish" });
    }
  }
  return found;
}

/* ---------- multi-candle chart patterns (swing-based) ---------- */
function findSwings(klines, lookback = 2) {
  // returns indices of local highs/lows using a simple lookback window
  const highsIdx = [], lowsIdx = [];
  for (let i = lookback; i < klines.length - lookback; i++) {
    const win = klines.slice(i - lookback, i + lookback + 1);
    const h = klines[i].high, l = klines[i].low;
    if (win.every((k) => k.high <= h)) highsIdx.push(i);
    if (win.every((k) => k.low >= l)) lowsIdx.push(i);
  }
  return { highsIdx, lowsIdx };
}

function detectChartPatterns(klines) {
  const found = [];
  if (klines.length < 15) return found;
  const { highsIdx, lowsIdx } = findSwings(klines, 2);
  const tolerance = 0.0035; // ~0.35% price tolerance for "equal" levels

  const closeEnough = (a, b) => Math.abs(a - b) / ((a + b) / 2) < tolerance;

  // Double Top: two comparable swing highs with a swing low between them
  for (let i = 0; i < highsIdx.length - 1; i++) {
    const h1 = highsIdx[i], h2 = highsIdx[i + 1];
    const p1 = klines[h1].high, p2 = klines[h2].high;
    if (closeEnough(p1, p2)) {
      const lowBetween = lowsIdx.find((l) => l > h1 && l < h2);
      if (lowBetween !== undefined) {
        found.push({ index: h2, name: "Double Top", type: "bearish" });
      }
    }
  }

  // Double Bottom
  for (let i = 0; i < lowsIdx.length - 1; i++) {
    const l1 = lowsIdx[i], l2 = lowsIdx[i + 1];
    const p1 = klines[l1].low, p2 = klines[l2].low;
    if (closeEnough(p1, p2)) {
      const highBetween = highsIdx.find((h) => h > l1 && h < l2);
      if (highBetween !== undefined) {
        found.push({ index: l2, name: "Double Bottom", type: "bullish" });
      }
    }
  }

  // Head & Shoulders: three swing highs, middle one clearly higher than two comparable outer ones
  for (let i = 0; i < highsIdx.length - 2; i++) {
    const [a, b, c] = [highsIdx[i], highsIdx[i + 1], highsIdx[i + 2]];
    const pa = klines[a].high, pb = klines[b].high, pc = klines[c].high;
    if (pb > pa * 1.006 && pb > pc * 1.006 && closeEnough(pa, pc)) {
      found.push({ index: c, name: "Head & Shoulders", type: "bearish" });
    }
  }

  // Inverse Head & Shoulders
  for (let i = 0; i < lowsIdx.length - 2; i++) {
    const [a, b, c] = [lowsIdx[i], lowsIdx[i + 1], lowsIdx[i + 2]];
    const pa = klines[a].low, pb = klines[b].low, pc = klines[c].low;
    if (pb < pa * 0.994 && pb < pc * 0.994 && closeEnough(pa, pc)) {
      found.push({ index: c, name: "Inverse Head & Shoulders", type: "bullish" });
    }
  }

  // Ascending Triangle: flat resistance (equal highs) + rising lows
  if (highsIdx.length >= 2 && lowsIdx.length >= 2) {
    const lastHighs = highsIdx.slice(-2);
    const lastLows = lowsIdx.slice(-2);
    if (closeEnough(klines[lastHighs[0]].high, klines[lastHighs[1]].high) &&
        klines[lastLows[1]].low > klines[lastLows[0]].low * 1.002) {
      found.push({ index: lastHighs[1], name: "Ascending Triangle", type: "bullish" });
    }
    // Descending Triangle: flat support + falling highs
    if (closeEnough(klines[lastLows[0]].low, klines[lastLows[1]].low) &&
        klines[lastHighs[1]].high < klines[lastHighs[0]].high * 0.998) {
      found.push({ index: lastLows[1], name: "Descending Triangle", type: "bearish" });
    }
  }

  return found;
}

function detectAllPatterns(klines) {
  const candle = detectCandlePatterns(klines);
  const chart = detectChartPatterns(klines);
  return [...candle, ...chart].sort((a, b) => a.index - b.index);
}

/* ---------- support/resistance level detection ---------- */
function detectSupportResistance(klines, maxLevels = 4) {
  if (klines.length < 10) return [];
  const { highsIdx, lowsIdx } = findSwings(klines, 2);
  const tolerance = 0.004;

  function clusterLevels(idxList, priceFn) {
    const prices = idxList.map((i) => ({ price: priceFn(klines[i]), touches: 1, lastIdx: i }));
    const clusters = [];
    prices.forEach((p) => {
      const existing = clusters.find((c) => Math.abs(c.price - p.price) / p.price < tolerance);
      if (existing) {
        existing.touches += 1;
        existing.price = (existing.price * (existing.touches - 1) + p.price) / existing.touches;
        existing.lastIdx = Math.max(existing.lastIdx, p.lastIdx);
      } else {
        clusters.push({ ...p });
      }
    });
    return clusters.filter((c) => c.touches >= 2).sort((a, b) => b.touches - a.touches);
  }

  const resistance = clusterLevels(highsIdx, (k) => k.high).slice(0, maxLevels)
    .map((c) => ({ ...c, type: "resistance" }));
  const support = clusterLevels(lowsIdx, (k) => k.low).slice(0, maxLevels)
    .map((c) => ({ ...c, type: "support" }));

  return [...resistance, ...support];
}

/* combine into a single rule-based score -100..100 and label */
function computeSignal(klines) {
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  if (closes.length < 26) return { score: 0, label: "WAIT", rsiVal: 50, macdHist: 0, paScore: 0, patterns: [], latestPattern: null, levels: [] };

  const rsiVal = rsi(closes, 14);
  const { hist } = macd(closes);
  const ma9 = sma(closes, 9);
  const ma21 = sma(closes, 21);
  const paScore = priceAction(highs, lows, closes);
  const lastClose = closes[closes.length - 1];

  let score = 0;
  // RSI contribution: oversold -> bullish, overbought -> bearish
  if (rsiVal < 30) score += 35;
  else if (rsiVal < 45) score += 12;
  else if (rsiVal > 70) score -= 35;
  else if (rsiVal > 55) score -= 12;

  // MACD histogram momentum
  const histNorm = Math.max(-1, Math.min(1, hist / (lastClose * 0.001 || 1)));
  score += histNorm * 30;

  // MA cross (trend)
  score += ma9 > ma21 ? 15 : -15;

  // price action
  score += paScore * 20;

  score = Math.max(-100, Math.min(100, Math.round(score)));

  let label = "NEUTRAL";
  if (score >= 55) label = "STRONG BUY";
  else if (score >= 20) label = "BUY";
  else if (score <= -55) label = "STRONG SELL";
  else if (score <= -20) label = "SELL";

  const patterns = detectAllPatterns(klines);
  const latestPattern = patterns.length ? patterns[patterns.length - 1] : null;
  const levels = detectSupportResistance(klines);

  return { score, label, rsiVal, macdHist: hist, paScore, patterns, latestPattern, levels };
}

/* ---------- audio alert (Web Audio API, no external assets) ---------- */
let _audioCtx = null;
function playAlertTone(kind) {
  try {
    if (!_audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new Ctx();
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const ctx = _audioCtx;
    const now = ctx.currentTime;
    // bullish: two short rising beeps. bearish: two short falling beeps.
    const freqs = kind === "bullish" ? [660, 880] : [520, 360];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    });
  } catch (e) {
    // audio unavailable, ignore
  }
}

/* ---------- formatting ---------- */
function fmtPrice(p) {
  if (p == null) return "—";
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}
function fmtPct(p) {
  if (p == null) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

/* ---------- sparkline ---------- */
function Sparkline({ data, positive }) {
  if (!data || data.length < 2) {
    return <svg width="84" height="28" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 84, h = 28, pad = 2;
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastX = pad + (data.length - 1) * step;
  const lastY = h - pad - ((data[data.length - 1] - min) / range) * (h - pad * 2);
  const color = positive ? "#3DD68C" : "#F2545B";
  const areaPts = `${pad},${h - pad} ` + pts.join(" ") + ` ${lastX.toFixed(1)},${h - pad}`;
  return (
    <svg width={w} height={h} className="block">
      <polygon points={areaPts} fill={color} opacity="0.10" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

/* ---------- signal badge ---------- */
function SignalBadge({ label, score }) {
  const styles = {
    "STRONG BUY": "bg-[#3DD68C] text-[#0D1117] border-[#3DD68C]",
    "BUY": "bg-transparent text-[#3DD68C] border-[#3DD68C]/50",
    "NEUTRAL": "bg-transparent text-[#8B96A5] border-[#2A323D]",
    "SELL": "bg-transparent text-[#F2545B] border-[#F2545B]/50",
    "STRONG SELL": "bg-[#F2545B] text-[#0D1117] border-[#F2545B]",
    "WAIT": "bg-transparent text-[#5A6472] border-[#2A323D]",
  };
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${styles[label]} font-mono whitespace-nowrap`}>
      {label}
    </span>
  );
}

function StrengthBar({ score }) {
  const pct = Math.abs(score);
  const positive = score >= 0;
  return (
    <div className="w-16 h-1.5 bg-[#1C232C] rounded-full overflow-hidden relative">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${pct}%`,
          background: positive ? "#3DD68C" : "#F2545B",
          marginLeft: positive ? "0" : "auto",
        }}
      />
    </div>
  );
}

/* ---------- candlestick chart modal ---------- */
const PATTERN_COLOR = {
  bullish: "#3DD68C",
  bearish: "#F2545B",
  neutral: "#F0B90B",
};

function CandlestickChart({ symbol, klines, patterns, levels, interval, onClose }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [zoomRange, setZoomRange] = useState(null); // [startIdx, endIdx] or null = full range
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [showCalc, setShowCalc] = useState(false);
  const svgRef = useRef(null);

  if (!klines || klines.length === 0) return null;

  const fullN = klines.length;
  const view = zoomRange ? klines.slice(zoomRange[0], zoomRange[1] + 1) : klines;
  const viewOffset = zoomRange ? zoomRange[0] : 0;

  const w = 900, h = 420;
  const padL = 56, padR = 16, padT = 16, padB = 10;
  const volH = 70;
  const chartH = h - padB - volH - 6;
  const plotW = w - padL - padR;
  const plotH = chartH - padT;

  const highs = view.map((k) => k.high);
  const lows = view.map((k) => k.low);
  let maxP = Math.max(...highs);
  let minP = Math.min(...lows);
  // include S/R levels in range so lines stay visible when relevant
  if (levels && levels.length) {
    levels.forEach((l) => {
      if (l.price > maxP) maxP = l.price;
      if (l.price < minP) minP = l.price;
    });
  }
  const pad5 = (maxP - minP) * 0.06 || maxP * 0.01;
  maxP += pad5;
  minP -= pad5;
  const range = maxP - minP || 1;

  const n = view.length;
  const slot = plotW / n;
  const candleW = Math.max(2, slot * 0.62);

  const maxVol = Math.max(...view.map((k) => k.volume || 0), 1);

  const yFor = (price) => padT + plotH - ((price - minP) / range) * plotH;
  const xFor = (i) => padL + i * slot + slot / 2;
  const volYTop = chartH + 6;

  const patternAt = {};
  patterns.forEach((p) => {
    const localIdx = p.index - viewOffset;
    if (localIdx >= 0 && localIdx < n) patternAt[localIdx] = p;
  });

  const gridLevels = 5;
  const gridLines = Array.from({ length: gridLevels + 1 }, (_, i) => minP + (range * i) / gridLevels);

  const hovered = hoverIdx != null ? view[hoverIdx] : null;

  function handleMouseDown(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((x - padL) / slot)));
    setDragStart(idx);
    setDragEnd(idx);
  }
  function handleMouseMoveDrag(e) {
    if (dragStart == null) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((x - padL) / slot)));
    setDragEnd(idx);
  }
  function handleMouseUp() {
    if (dragStart != null && dragEnd != null && Math.abs(dragEnd - dragStart) > 2) {
      const lo = Math.min(dragStart, dragEnd) + viewOffset;
      const hi = Math.max(dragStart, dragEnd) + viewOffset;
      setZoomRange([lo, hi]);
    }
    setDragStart(null);
    setDragEnd(null);
  }
  function resetZoom() {
    setZoomRange(null);
  }

  const dragBoxX1 = dragStart != null ? xFor(Math.min(dragStart, dragEnd)) : null;
  const dragBoxX2 = dragStart != null ? xFor(Math.max(dragStart, dragEnd)) : null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0F141A] border border-[#242C36] rounded-lg w-full max-w-4xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1C232C]">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[#E6EDF3] font-bold font-sans text-sm">
              {symbol.replace("USDT", "")}<span className="text-[#5A6472]">/USDT</span>
            </h2>
            <span className="text-[10px] text-[#5A6472] font-mono uppercase border border-[#242C36] rounded px-1.5 py-0.5">
              {interval}
            </span>
            {zoomRange && (
              <button
                onClick={resetZoom}
                className="text-[10px] text-[#F0B90B] font-mono border border-[#F0B90B]/40 rounded px-1.5 py-0.5 hover:bg-[#F0B90B]/10"
              >
                reset zoom
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCalc((s) => !s)}
              className={`text-[10px] font-mono font-bold rounded px-2 py-1 border transition-colors ${
                showCalc
                  ? "bg-[#F0B90B] text-[#0D1117] border-[#F0B90B]"
                  : "text-[#8B96A5] border-[#242C36] hover:text-[#E6EDF3]"
              }`}
            >
              position calc
            </button>
            <button
              onClick={onClose}
              className="text-[#5A6472] hover:text-[#E6EDF3] transition-colors text-lg leading-none px-1"
              aria-label="Close chart"
            >
              ✕
            </button>
          </div>
        </div>

        {/* pattern legend strip */}
        {patterns.length > 0 && (
          <div className="px-5 py-2 border-b border-[#1C232C] flex items-center gap-2 flex-wrap font-sans">
            <span className="text-[10px] text-[#5A6472] uppercase tracking-wider">detected:</span>
            {patterns.slice(-6).map((p, i) => (
              <span
                key={i}
                className="text-[10px] font-bold px-2 py-0.5 rounded border font-mono"
                style={{
                  color: PATTERN_COLOR[p.type],
                  borderColor: `${PATTERN_COLOR[p.type]}55`,
                }}
              >
                {p.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex">
          {/* chart */}
          <div className="p-4 overflow-x-auto flex-1">
            <svg
              ref={svgRef}
              width={w}
              height={h}
              className="block select-none"
              style={{ minWidth: w, cursor: dragStart != null ? "ew-resize" : "crosshair" }}
              onMouseLeave={() => { setHoverIdx(null); if (dragStart != null) handleMouseUp(); }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMoveDrag}
              onMouseUp={handleMouseUp}
            >
              {/* gridlines + price labels */}
              {gridLines.map((price, i) => {
                const y = yFor(price);
                return (
                  <g key={i}>
                    <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="#1C232C" strokeWidth="1" />
                    <text x={padL - 8} y={y + 3} fill="#5A6472" fontSize="10" fontFamily="monospace" textAnchor="end">
                      {fmtPrice(price)}
                    </text>
                  </g>
                );
              })}

              {/* support/resistance lines */}
              {levels && levels.map((lvl, i) => {
                const y = yFor(lvl.price);
                if (y < padT || y > chartH) return null;
                const color = lvl.type === "resistance" ? "#F2545B" : "#3DD68C";
                return (
                  <g key={`lvl-${i}`}>
                    <line
                      x1={padL} x2={w - padR} y1={y} y2={y}
                      stroke={color} strokeWidth="1" strokeDasharray="5,3" opacity="0.55"
                    />
                    <text x={w - padR - 4} y={y - 3} fill={color} fontSize="9" fontFamily="monospace" textAnchor="end" opacity="0.85">
                      {lvl.type === "resistance" ? "R" : "S"} {fmtPrice(lvl.price)}
                    </text>
                  </g>
                );
              })}

              {/* candles */}
              {view.map((k, i) => {
                const x = xFor(i);
                const bull = k.close >= k.open;
                const color = bull ? "#3DD68C" : "#F2545B";
                const yHigh = yFor(k.high);
                const yLow = yFor(k.low);
                const yOpen = yFor(k.open);
                const yClose = yFor(k.close);
                const bodyTop = Math.min(yOpen, yClose);
                const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
                const pattern = patternAt[i];
                const volBarH = ((k.volume || 0) / maxVol) * (volH - 8);

                return (
                  <g key={i}>
                    <g
                      onMouseEnter={() => setHoverIdx(i)}
                    >
                      <rect x={x - slot / 2} y={padT} width={slot} height={plotH} fill="transparent" />
                      <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1" opacity={hoverIdx === i ? 1 : 0.85} />
                      <rect
                        x={x - candleW / 2}
                        y={bodyTop}
                        width={candleW}
                        height={bodyH}
                        fill={color}
                        opacity={hoverIdx === i ? 1 : 0.9}
                        rx="0.5"
                      />
                      {pattern && (
                        <>
                          <circle
                            cx={x}
                            cy={pattern.type === "bearish" ? yHigh - 10 : yLow + 10}
                            r="3"
                            fill={PATTERN_COLOR[pattern.type]}
                          />
                          <line
                            x1={x} x2={x}
                            y1={pattern.type === "bearish" ? yHigh - 7 : yLow + 7}
                            y2={pattern.type === "bearish" ? yHigh : yLow}
                            stroke={PATTERN_COLOR[pattern.type]}
                            strokeWidth="1"
                          />
                        </>
                      )}
                    </g>
                    {/* volume bar */}
                    <rect
                      x={x - candleW / 2}
                      y={volYTop + (volH - 8 - volBarH)}
                      width={candleW}
                      height={Math.max(1, volBarH)}
                      fill={color}
                      opacity={hoverIdx === i ? 0.85 : 0.45}
                    />
                  </g>
                );
              })}

              {/* hover crosshair */}
              {hovered && (
                <line
                  x1={xFor(hoverIdx)} x2={xFor(hoverIdx)}
                  y1={padT} y2={volYTop + volH - 8}
                  stroke="#5A6472" strokeWidth="1" strokeDasharray="2,2"
                />
              )}

              {/* drag-zoom selection box */}
              {dragStart != null && dragEnd != null && dragStart !== dragEnd && (
                <rect
                  x={Math.min(dragBoxX1, dragBoxX2)}
                  y={padT}
                  width={Math.abs(dragBoxX2 - dragBoxX1)}
                  height={plotH}
                  fill="#F0B90B"
                  opacity="0.12"
                  stroke="#F0B90B"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
              )}

              {/* volume panel label */}
              <text x={padL} y={volYTop - 4} fill="#5A6472" fontSize="9" fontFamily="monospace">VOLUME</text>
            </svg>

            {/* hover info bar */}
            <div className="flex items-center gap-4 px-1 pt-2 text-[11px] font-mono text-[#8B96A5] min-h-[18px] flex-wrap">
              {hovered ? (
                <>
                  <span>O <span className="text-[#E6EDF3]">{fmtPrice(hovered.open)}</span></span>
                  <span>H <span className="text-[#E6EDF3]">{fmtPrice(hovered.high)}</span></span>
                  <span>L <span className="text-[#E6EDF3]">{fmtPrice(hovered.low)}</span></span>
                  <span>C <span className="text-[#E6EDF3]">{fmtPrice(hovered.close)}</span></span>
                  <span>V <span className="text-[#E6EDF3]">{hovered.volume ? hovered.volume.toFixed(2) : "—"}</span></span>
                  {patternAt[hoverIdx] && (
                    <span className="font-bold" style={{ color: PATTERN_COLOR[patternAt[hoverIdx].type] }}>
                      {patternAt[hoverIdx].name}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[#5A6472]">hover candles for OHLCV · drag to zoom · dashed lines = support/resistance</span>
              )}
            </div>
          </div>

          {/* position size calculator panel */}
          {showCalc && (
            <PositionCalculator
              defaultEntry={klines[klines.length - 1].close}
              symbol={symbol}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- position size / stop-loss calculator ---------- */
function PositionCalculator({ defaultEntry, symbol }) {
  const [accountSize, setAccountSize] = useState("1000");
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState(defaultEntry ? String(defaultEntry) : "");
  const [stopLoss, setStopLoss] = useState("");
  const [direction, setDirection] = useState("long");

  const acc = parseFloat(accountSize) || 0;
  const risk = parseFloat(riskPct) || 0;
  const ent = parseFloat(entry) || 0;
  const sl = parseFloat(stopLoss) || 0;

  const riskAmount = acc * (risk / 100);
  const perUnitRisk = ent && sl ? Math.abs(ent - sl) : 0;
  const positionSize = perUnitRisk > 0 ? riskAmount / perUnitRisk : 0;
  const positionValue = positionSize * ent;
  const slPct = ent && sl ? (Math.abs(ent - sl) / ent) * 100 : 0;
  const valid = ent > 0 && sl > 0 && perUnitRisk > 0 &&
    ((direction === "long" && sl < ent) || (direction === "short" && sl > ent));

  return (
    <div className="w-64 border-l border-[#1C232C] p-4 flex flex-col gap-3 bg-[#11161D] font-sans">
      <h3 className="text-[11px] font-bold text-[#E6EDF3] uppercase tracking-wider">Position Calculator</h3>

      <div className="flex gap-1">
        {["long", "short"].map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`flex-1 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
              direction === d
                ? d === "long" ? "bg-[#3DD68C] text-[#0D1117]" : "bg-[#F2545B] text-[#0D1117]"
                : "bg-[#151A21] text-[#5A6472] border border-[#242C36]"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <Field label="Account size (USDT)" value={accountSize} onChange={setAccountSize} />
      <Field label="Risk per trade (%)" value={riskPct} onChange={setRiskPct} />
      <Field label="Entry price" value={entry} onChange={setEntry} />
      <Field label="Stop-loss price" value={stopLoss} onChange={setStopLoss} />

      <div className="border-t border-[#1C232C] pt-3 flex flex-col gap-1.5 text-[11px] font-mono">
        <Row label="Risk amount" value={`${riskAmount.toFixed(2)} USDT`} />
        <Row label="Stop distance" value={ent && sl ? `${slPct.toFixed(2)}%` : "—"} />
        <Row
          label="Position size"
          value={valid ? `${positionSize.toFixed(6)} ${symbol.replace("USDT", "")}` : "—"}
          highlight
        />
        <Row label="Position value" value={valid ? `${positionValue.toFixed(2)} USDT` : "—"} />
      </div>

      {!valid && ent > 0 && sl > 0 && (
        <p className="text-[10px] text-[#F2545B] leading-snug">
          {direction === "long"
            ? "For a long, stop-loss should be below entry."
            : "For a short, stop-loss should be above entry."}
        </p>
      )}
      <p className="text-[9px] text-[#5A6472] leading-snug mt-1">
        Educational tool only — not financial advice. Always confirm fees and exchange minimums before sizing a real trade.
      </p>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-[#5A6472] uppercase tracking-wide">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="bg-[#151A21] border border-[#242C36] rounded px-2 py-1.5 text-[12px] text-[#E6EDF3] outline-none focus:border-[#F0B90B]/50 font-mono"
      />
    </label>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[#5A6472]">{label}</span>
      <span className={highlight ? "text-[#F0B90B] font-bold" : "text-[#C9D1D9]"}>{value}</span>
    </div>
  );
}

/* ============================================================
   MAIN APP
   ============================================================ */

/* ---------- Binance signed request (HMAC-SHA256, Web Crypto API) ---------- */
async function hmacSHA256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchAccountBalance(apiKey, apiSecret) {
  const ts = Date.now();
  const query = `timestamp=${ts}&recvWindow=10000`;
  const sig = await hmacSHA256(apiSecret, query);
  const url = `https://api.binance.com/api/v3/account?${query}&signature=${sig}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json();
  // return only non-zero balances
  return (data.balances || [])
    .map((b) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
    .filter((b) => b.free + b.locked > 0)
    .sort((a, b) => (b.free + b.locked) - (a.free + a.locked));
}

export default function ScalpTerminal() {
  const [rows, setRows] = useState({}); // symbol -> { closes, highs, lows, price, pct24h, signal }
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [connStatus, setConnStatus] = useState("connecting");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [interval, setInterval_] = useState("1m");
  const [chartSymbol, setChartSymbol] = useState(null); // symbol currently shown in modal
  const [watchlist, setWatchlist] = useState(() => new Set());
  const [watchOnly, setWatchOnly] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [recentAlert, setRecentAlert] = useState(null);
  const [balances, setBalances] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState(null);
  const [showBalance, setShowBalance] = useState(false); // { symbol, label } for toast
  const wsRefs = useRef({});
  const dataRef = useRef({});
  const alertedRef = useRef({}); // symbol -> last alerted label, to avoid spamming
  const alertsEnabledRef = useRef(false);
  useEffect(() => { alertsEnabledRef.current = alertsEnabled; }, [alertsEnabled]);

  function toggleWatch(symbol) {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  async function loadBalance() {
    const apiKey = import.meta.env.VITE_BINANCE_API_KEY;
    const apiSecret = import.meta.env.VITE_BINANCE_SECRET;
    if (!apiKey || !apiSecret) {
      setBalanceError("API keys not configured in Vercel environment variables.");
      return;
    }
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const data = await fetchAccountBalance(apiKey, apiSecret);
      setBalances(data);
      setShowBalance(true);
    } catch (e) {
      setBalanceError(e.message || "Failed to fetch balance.");
    } finally {
      setBalanceLoading(false);
    }
  }

  /* fetch initial klines for all symbols via REST, then open websockets for live ticks.
     Re-runs whenever the selected interval changes (closes old sockets, refetches). */
  useEffect(() => {
    let cancelled = false;
    setConnStatus("connecting");
    setRows({});
    dataRef.current = {};
    // close any sockets from a previous interval
    Object.values(wsRefs.current).forEach((ws) => ws && ws.close());
    wsRefs.current = {};

    async function initSymbol(sym) {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${KLINE_LIMIT}`
        );
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        const klines = data.map((k) => ({
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          openTime: k[0],
        }));

        const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
        const ticker = await tickerRes.json();

        const signal = computeSignal(klines);
        dataRef.current[sym] = {
          symbol: sym,
          klines,
          price: klines[klines.length - 1].close,
          pct24h: parseFloat(ticker.priceChangePercent),
          vol24h: parseFloat(ticker.quoteVolume),
          signal,
        };
        if (!cancelled) {
          setRows((prev) => ({ ...prev, [sym]: dataRef.current[sym] }));
        }
        openSocket(sym);
      } catch (e) {
        // skip symbol on failure
      }
    }

    function openSocket(sym) {
      if (cancelled) return;
      const lower = sym.toLowerCase();
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${lower}@kline_${interval}`);
      wsRefs.current[sym] = ws;
      ws.onopen = () => setConnStatus("live");
      ws.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data);
          const k = payload.k;
          if (!k) return;
          const entry = dataRef.current[sym];
          if (!entry) return;
          const newCandle = {
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            openTime: k.t,
          };
          let klines = entry.klines.slice();
          if (k.x) {
            klines.push(newCandle);
            if (klines.length > KLINE_LIMIT) klines.shift();
          } else {
            klines[klines.length - 1] = newCandle;
          }
          const signal = computeSignal(klines);
          dataRef.current[sym] = {
            ...entry,
            klines,
            price: newCandle.close,
            signal,
          };
          // fire alert only on a fresh transition into STRONG BUY/SELL for this symbol
          if (alertsEnabledRef.current && (signal.label === "STRONG BUY" || signal.label === "STRONG SELL")) {
            if (alertedRef.current[sym] !== signal.label) {
              alertedRef.current[sym] = signal.label;
              playAlertTone(signal.label === "STRONG BUY" ? "bullish" : "bearish");
              setRecentAlert({ symbol: sym, label: signal.label, id: Date.now() });
            }
          } else if (signal.label !== "STRONG BUY" && signal.label !== "STRONG SELL") {
            alertedRef.current[sym] = null;
          }
          setRows((prev) => ({ ...prev, [sym]: dataRef.current[sym] }));
          setLastUpdate(Date.now());
        } catch (e) {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    }

    SYMBOLS.forEach((sym, idx) => {
      setTimeout(() => {
        if (!cancelled) initSymbol(sym);
      }, idx * 80);
    });

    return () => {
      cancelled = true;
      Object.values(wsRefs.current).forEach((ws) => ws && ws.close());
    };
  }, [interval]);

  const rowList = useMemo(() => {
    let list = Object.values(rows);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter((r) => r.symbol.includes(q));
    }
    if (filter === "BUY") {
      list = list.filter((r) => r.signal.label === "BUY" || r.signal.label === "STRONG BUY");
    } else if (filter === "SELL") {
      list = list.filter((r) => r.signal.label === "SELL" || r.signal.label === "STRONG SELL");
    }
    if (watchOnly) {
      list = list.filter((r) => watchlist.has(r.symbol));
    }
    list.sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case "symbol": av = a.symbol; bv = b.symbol; break;
        case "price": av = a.price; bv = b.price; break;
        case "pct24h": av = a.pct24h; bv = b.pct24h; break;
        case "rsi": av = a.signal.rsiVal; bv = b.signal.rsiVal; break;
        case "score": default: av = a.signal.score; bv = b.signal.score; break;
      }
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [rows, sortKey, sortDir, filter, search, watchOnly, watchlist]);

  // auto-dismiss alert toast after 5s
  useEffect(() => {
    if (!recentAlert) return;
    const t = setTimeout(() => setRecentAlert((cur) => (cur && cur.id === recentAlert.id ? null : cur)), 5000);
    return () => clearTimeout(t);
  }, [recentAlert]);

  const toggleSort = useCallback((key) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  const loadedCount = Object.keys(rows).length;
  const buyCount = Object.values(rows).filter((r) => r.signal.label.includes("BUY")).length;
  const sellCount = Object.values(rows).filter((r) => r.signal.label.includes("SELL")).length;

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#C9D1D9] font-mono text-sm flex flex-col">
      {/* HEADER */}
      <div className="border-b border-[#1C232C] px-5 py-3.5 flex items-center justify-between flex-wrap gap-3 bg-[#0F141A]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connStatus === "live" ? "bg-[#3DD68C] animate-pulse" : "bg-[#5A6472]"}`} />
            <h1 className="text-[15px] font-bold tracking-tight text-[#E6EDF3] font-sans">
              SCALP<span className="text-[#F0B90B]">TERM</span>
            </h1>
          </div>
          <span className="text-[11px] text-[#5A6472] font-sans hidden sm:inline">
            {loadedCount}/{SYMBOLS.length} pairs · {interval} interval
          </span>
        </div>

        <div className="flex items-center gap-4 text-[11px] font-sans">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3DD68C]" />
            <span className="text-[#8B96A5]">{buyCount} buy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F2545B]" />
            <span className="text-[#8B96A5]">{sellCount} sell</span>
          </div>
          <span className="text-[#3DD68C] uppercase text-[10px] tracking-wider font-bold">
            {connStatus === "live" ? "● live" : "connecting…"}
          </span>
          <button
            onClick={() => { if (!balances) loadBalance(); else setShowBalance((s) => !s); }}
            disabled={balanceLoading}
            className={`text-[10px] font-bold font-mono px-2.5 py-1 rounded border transition-colors ${
              showBalance
                ? "bg-[#F0B90B] text-[#0D1117] border-[#F0B90B]"
                : "text-[#8B96A5] border-[#242C36] hover:text-[#E6EDF3]"
            }`}
          >
            {balanceLoading ? "loading…" : "⬡ balance"}
          </button>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="px-5 py-2.5 border-b border-[#1C232C] flex items-center gap-3 flex-wrap bg-[#0D1117]">
        <div className="flex gap-0.5 bg-[#11161D] border border-[#1C232C] rounded p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setInterval_(tf.value)}
              className={`px-2.5 py-1 rounded text-[11px] font-bold font-mono transition-colors ${
                interval === tf.value
                  ? "bg-[#F0B90B] text-[#0D1117]"
                  : "text-[#5A6472] hover:text-[#C9D1D9]"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search symbol…"
          className="bg-[#151A21] border border-[#242C36] rounded px-3 py-1.5 text-[12px] text-[#E6EDF3] placeholder-[#5A6472] outline-none focus:border-[#F0B90B]/50 w-40 font-mono"
        />
        <div className="flex gap-1">
          {["ALL", "BUY", "SELL"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded text-[11px] font-bold font-sans tracking-wide transition-colors ${
                filter === f
                  ? "bg-[#1C232C] text-[#E6EDF3] border border-[#2A323D]"
                  : "text-[#5A6472] border border-transparent hover:text-[#8B96A5]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setWatchOnly((w) => !w)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold font-sans tracking-wide transition-colors ${
            watchOnly
              ? "bg-[#F0B90B]/15 text-[#F0B90B] border border-[#F0B90B]/40"
              : "text-[#5A6472] border border-transparent hover:text-[#8B96A5]"
          }`}
        >
          <span>★</span> watchlist {watchlist.size > 0 ? `(${watchlist.size})` : ""}
        </button>
        <button
          onClick={() => setAlertsEnabled((a) => !a)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold font-sans tracking-wide transition-colors ${
            alertsEnabled
              ? "bg-[#3DD68C]/15 text-[#3DD68C] border border-[#3DD68C]/40"
              : "text-[#5A6472] border border-transparent hover:text-[#8B96A5]"
          }`}
          title="Play a sound when a pair flips to STRONG BUY/SELL"
        >
          {alertsEnabled ? "🔔" : "🔕"} alerts
        </button>
        <span className="text-[10px] text-[#5A6472] font-sans ml-auto hidden md:inline">
          click a row to open chart · rule-based: RSI + MACD + MA cross + patterns
        </span>
      </div>

      {/* BALANCE PANEL */}
      {balanceError && (
        <div className="px-5 py-2 bg-[#1A0F11] border-b border-[#F2545B]/30 text-[11px] text-[#F2545B] font-mono flex items-center gap-2">
          <span>⚠</span> {balanceError}
        </div>
      )}
      {showBalance && balances && (
        <div className="border-b border-[#1C232C] bg-[#0F141A] px-5 py-3 flex items-center gap-4 flex-wrap">
          <span className="text-[10px] text-[#5A6472] font-sans uppercase tracking-wider">Account Balance</span>
          {balances.slice(0, 10).map((b) => (
            <div key={b.asset} className="flex items-center gap-1.5 bg-[#151A21] border border-[#242C36] rounded px-2.5 py-1.5">
              <span className="text-[11px] font-bold text-[#F0B90B] font-mono">{b.asset}</span>
              <span className="text-[11px] text-[#E6EDF3] font-mono tabular-nums">
                {(b.free + b.locked).toFixed(4)}
              </span>
              {b.locked > 0 && (
                <span className="text-[9px] text-[#5A6472] font-mono">({b.locked.toFixed(4)} locked)</span>
              )}
            </div>
          ))}
          <button
            onClick={loadBalance}
            className="text-[10px] text-[#5A6472] hover:text-[#E6EDF3] font-mono ml-auto transition-colors"
          >
            ↻ refresh
          </button>
        </div>
      )}

      {/* TABLE */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[#0D1117] z-10">
            <tr className="border-b border-[#1C232C] text-[10px] text-[#5A6472] font-sans uppercase tracking-wider">
              <th className="px-2 py-2 text-center font-medium w-8"></th>
              <Th label="Pair" sortKey="symbol" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort} align="left" />
              <th className="px-3 py-2 text-center font-medium">Candle</th>
              <Th label="Price" sortKey="price" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
              <Th label="24h %" sortKey="pct24h" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium">Chart</th>
              <th className="px-3 py-2 text-left font-medium">Pattern</th>
              <Th label="RSI" sortKey="rsi" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium">MACD</th>
              <Th label="Strength" sortKey="score" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium pr-5">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rowList.map((r) => {
              const sparkData = r.klines.map((k) => k.close);
              const positive = r.pct24h >= 0;
              const lastCandle = r.klines[r.klines.length - 1];
              const candleUp = lastCandle ? lastCandle.close >= lastCandle.open : true;
              const latestPattern = r.signal.latestPattern;
              const isWatched = watchlist.has(r.symbol);
              return (
                <tr
                  key={r.symbol}
                  onClick={() => setChartSymbol(r.symbol)}
                  className="border-b border-[#161B22] hover:bg-[#11161D] transition-colors group cursor-pointer"
                >
                  <td className="px-2 py-2.5 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleWatch(r.symbol); }}
                      className={`text-[13px] leading-none transition-colors ${
                        isWatched ? "text-[#F0B90B]" : "text-[#2A323D] hover:text-[#5A6472]"
                      }`}
                      title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                    >
                      ★
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[#E6EDF3] font-semibold">{r.symbol.replace("USDT", "")}</span>
                      <span className="text-[#5A6472] text-[10px]">/USDT</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                        candleUp ? "bg-[#3DD68C]/15 text-[#3DD68C]" : "bg-[#F2545B]/15 text-[#F2545B]"
                      }`}
                      title={candleUp ? "Current candle up" : "Current candle down"}
                    >
                      {candleUp ? "▲" : "▼"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#E6EDF3] tabular-nums">{fmtPrice(r.price)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${positive ? "text-[#3DD68C]" : "text-[#F2545B]"}`}>
                    {fmtPct(r.pct24h)}
                  </td>
                  <td className="px-3 py-2.5 flex justify-end">
                    <Sparkline data={sparkData} positive={sparkData[sparkData.length - 1] >= sparkData[0]} />
                  </td>
                  <td className="px-3 py-2.5">
                    {latestPattern ? (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap"
                        style={{
                          color: PATTERN_COLOR[latestPattern.type],
                          borderColor: `${PATTERN_COLOR[latestPattern.type]}55`,
                        }}
                      >
                        {latestPattern.name}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#3A434F]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className={r.signal.rsiVal > 70 ? "text-[#F2545B]" : r.signal.rsiVal < 30 ? "text-[#3DD68C]" : "text-[#8B96A5]"}>
                      {r.signal.rsiVal.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className={r.signal.macdHist >= 0 ? "text-[#3DD68C]" : "text-[#F2545B]"}>
                      {r.signal.macdHist >= 0 ? "+" : ""}{r.signal.macdHist.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[10px] text-[#5A6472] w-8 text-right">{r.signal.score}</span>
                      <StrengthBar score={r.signal.score} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right pr-5">
                    <SignalBadge label={r.signal.label} score={r.signal.score} />
                  </td>
                </tr>
              );
            })}
            {rowList.length === 0 && loadedCount < SYMBOLS.length && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-[#5A6472] font-sans text-xs">
                  loading market data…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* FOOTER */}
      <div className="border-t border-[#1C232C] px-5 py-2 flex items-center justify-between text-[10px] text-[#5A6472] font-sans bg-[#0F141A]">
        <span>data: binance public api · educational use only · not financial advice</span>
        <span>{lastUpdate ? `updated ${new Date(lastUpdate).toLocaleTimeString()}` : "—"}</span>
      </div>

      {/* CHART MODAL */}
      {chartSymbol && rows[chartSymbol] && (
        <CandlestickChart
          symbol={chartSymbol}
          klines={rows[chartSymbol].klines}
          patterns={rows[chartSymbol].signal.patterns}
          levels={rows[chartSymbol].signal.levels}
          interval={interval}
          onClose={() => setChartSymbol(null)}
        />
      )}

      {/* ALERT TOAST */}
      {recentAlert && (
        <div
          className={`fixed bottom-5 right-5 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-lg border shadow-2xl font-sans cursor-pointer ${
            recentAlert.label === "STRONG BUY"
              ? "bg-[#0F1A14] border-[#3DD68C]/50"
              : "bg-[#1A0F11] border-[#F2545B]/50"
          }`}
          onClick={() => { setChartSymbol(recentAlert.symbol); setRecentAlert(null); }}
        >
          <span className={`text-lg ${recentAlert.label === "STRONG BUY" ? "text-[#3DD68C]" : "text-[#F2545B]"}`}>
            {recentAlert.label === "STRONG BUY" ? "▲" : "▼"}
          </span>
          <div className="leading-tight">
            <div className="text-[12px] font-bold text-[#E6EDF3]">
              {recentAlert.symbol.replace("USDT", "")}/USDT
            </div>
            <div className={`text-[10px] font-bold ${recentAlert.label === "STRONG BUY" ? "text-[#3DD68C]" : "text-[#F2545B]"}`}>
              {recentAlert.label}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ label, sortKey, sortKeyActive, sortDir, toggleSort, align = "right" }) {
  const isActive = sortKey === sortKeyActive;
  return (
    <th
      onClick={() => toggleSort(sortKey)}
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-[#8B96A5] transition-colors ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      <span className={isActive ? "text-[#E6EDF3]" : ""}>
        {label}
        {isActive && <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}
