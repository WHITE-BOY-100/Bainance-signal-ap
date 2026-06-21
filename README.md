# Scalp Terminal

Live Binance signal dashboard — RSI, MACD, candlestick + chart pattern detection,
support/resistance, position calculator, watchlist, alerts.

## මේක permanent, mobile-accessible app එකක් කරගන්න steps

### 1. GitHub එකට upload කරන්න

1. [github.com](https://github.com) login වෙන්න
2. "New repository" → නමක් දෙන්න (උදා: `scalp-terminal`) → Create
3. මේ folder එකේ files **සියල්ල** (`src/` folder එක ඇතුළුව) ඒ repo එකට upload කරන්න:
   - GitHub වෙබ් එකේම "uploading an existing file" කියන link එක click කරලා, files drag-and-drop කරන්න පුළුවන් (mobile browser එකෙන් වුණත් කරගන්න පුළුවන්)
   - හෝ, computer එකක් තියෙනවා නම් `git` command line පාවිච්චි කරන්න

### 2. Vercel එකට deploy කරන්න

1. [vercel.com](https://vercel.com) යන්න → "Sign up" → **Continue with GitHub** තෝරන්න (ඔයාගේ GitHub account එකෙන්ම login වෙන්න)
2. Login වුණාම "Add New..." → "Project" click කරන්න
3. ඔයා දැන් upload කරපු `scalp-terminal` repo එක list එකේ පෙන්නාවි → "Import" click කරන්න
4. Settings default විදිහටම තියන්න (Vercel auto-detect කරනවා මේක Vite project එකක් කියලා) → "Deploy" click කරන්න
5. විනාඩි 1-2කින් deploy වෙලා ඉවරයි. ඔයාට URL එකක් ලැබෙනවා (උදා: `scalp-terminal-yourname.vercel.app`)

### 3. Mobile එකේ use කරන්න

ඒ URL එක mobile browser එකේ (Chrome/Safari) open කරන්න — හරියටම මේ Claude artifact එකේ වගේම app එක load වෙනවා, ඒත් **permanent**, සහ direct browser එකක run වෙන නිසා Binance API access එක reliable වෙනවා.

**Bonus**: Home screen එකට add කරගන්න පුළුවන් (Chrome → Menu → "Add to Home Screen") — app icon එකක් වගේ පෙනෙනවා.

### Update කරන්න ඕන වුණොත්

GitHub repo එකේ `src/App.jsx` file එක edit කරලා commit කළාම, Vercel auto-detect කරලා redeploy කරගන්නවා — manual step එකක් අවශ්‍ය නෑ.

---

## Local development (optional — computer එකක් තියෙනවා නම්)

```bash
npm install
npm run dev
```

Build for production:
```bash
npm run build
```

---

**වැදගත්**: මේක rule-based technical analysis tool එකක්, financial advice නෙවෙයි. Signals විශ්වාස කරලා trade කරන්න කලින් paper-trade කරලා බලන්න, position size + stop-loss හැම trade එකකම compulsory කරගන්න.
