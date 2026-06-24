import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const SYMBOLS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT",
  "AVAXUSDT","DOTUSDT","LINKUSDT","TRXUSDT","MATICUSDT","LTCUSDT","SHIBUSDT",
  "ATOMUSDT","UNIUSDT","ETCUSDT","XLMUSDT","NEARUSDT","APTUSDT","FILUSDT",
  "ARBUSDT","OPUSDT","INJUSDT","SUIUSDT","TONUSDT","HBARUSDT","ICPUSDT",
  "VETUSDT","RUNEUSDT","AAVEUSDT","MKRUSDT","SNXUSDT","COMPUSDT","CRVUSDT",
  "LDOUSDT","STXUSDT","TIAUSDT","SEIUSDT","WLDUSDT","FETUSDT","AGIXUSDT",
  "RENDERUSDT","ARKMUSDT","JUPUSDT","PYTHUSDT","EIGENUSDT","TAIKOUSDT",
  "ENAUSDT","ONDOUSDT"
];

const TIMEFRAMES = [
  {value:"1m",label:"1m"},{value:"5m",label:"5m"},
  {value:"15m",label:"15m"},{value:"1h",label:"1H"},
  {value:"4h",label:"4H"},{value:"1d",label:"1D"},
];
const KLINE_LIMIT = 100;
const PC = {bullish:"#3DD68C",bearish:"#F2545B",neutral:"#F0B90B"};

/* ── Math ── */
const ema=(v,p)=>{const k=2/(p+1);let e=v[0];return v.map((x,i)=>{if(!i)return e;e=x*k+e*(1-k);return e;});};
const sma=(v,p)=>v.slice(-p).reduce((a,b)=>a+b,0)/Math.min(v.length,p);
const stdev=(v,p)=>{const s=v.slice(-p),m=s.reduce((a,b)=>a+b,0)/s.length;return Math.sqrt(s.reduce((a,b)=>a+(b-m)**2,0)/s.length);};
function calcRSI(c,p=14){
  if(c.length<p+1)return 50;
  let g=0,l=0;
  for(let i=c.length-p;i<c.length;i++){const d=c[i]-c[i-1];d>=0?g+=d:l-=d;}
  const ag=g/p,al=l/p;return al===0?100:100-100/(1+ag/al);
}
function calcMACD(c){
  if(c.length<26)return{line:0,signal:0,hist:0};
  const e12=ema(c,12),e26=ema(c,26),ml=e12.map((v,i)=>v-e26[i]);
  const sl=ema(ml.slice(-9),9);
  return{line:ml[ml.length-1],signal:sl[sl.length-1],hist:ml[ml.length-1]-sl[sl.length-1]};
}
function calcBB(c,p=20,m=2){
  if(c.length<p)return{upper:0,middle:0,lower:0,bw:0,pct:0.5};
  const mid=sma(c,p),sd=stdev(c,p),upper=mid+m*sd,lower=mid-m*sd,last=c[c.length-1];
  return{upper,middle:mid,lower,bw:(upper-lower)/mid,pct:(last-lower)/(upper-lower)};
}
function calcATR(k,p=14){
  if(k.length<2)return 0;
  const trs=k.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-k[i].close),Math.abs(x.low-k[i].close)));
  return trs.slice(-p).reduce((a,b)=>a+b,0)/Math.min(trs.length,p);
}
function calcVolSurge(v,p=20){if(v.length<p+1)return 1;const avg=v.slice(-p-1,-1).reduce((a,b)=>a+b,0)/p;return avg>0?v[v.length-1]/avg:1;}
function calcStochRSI(c,p=14){
  if(c.length<p*2)return{k:50,d:50};
  const rs=[];for(let i=p;i<=c.length;i++)rs.push(calcRSI(c.slice(i-p,i),p));
  const mn=Math.min(...rs.slice(-p)),mx=Math.max(...rs.slice(-p));
  const raw=mx===mn?0.5:(rs[rs.length-1]-mn)/(mx-mn);
  return{k:raw*100,d:raw*100};
}

/* ── Swings ── */
function findSwings(k,lb=3){
  const hi=[],lo=[];
  for(let i=lb;i<k.length-lb;i++){
    const w=k.slice(i-lb,i+lb+1);
    if(w.every(x=>x.high<=k[i].high))hi.push(i);
    if(w.every(x=>x.low>=k[i].low))lo.push(i);
  }
  return{hi,lo};
}

/* ── Candle patterns ── */
function detectCandlePatterns(k){
  const found=[];const n=k.length;if(n<4)return found;
  const body=x=>Math.abs(x.close-x.open),rng=x=>x.high-x.low||1e-9;
  const uw=x=>x.high-Math.max(x.open,x.close),lw=x=>Math.min(x.open,x.close)-x.low;
  const bull=x=>x.close>x.open,bear=x=>x.close<x.open;
  for(let i=3;i<n;i++){
    const[c0,c1,c2,c3]=[k[i-3],k[i-2],k[i-1],k[i]];
    if(body(c3)/rng(c3)<0.08)found.push({index:i,name:"Doji",type:"neutral",desc:"Indecision — watch next candle"});
    if(body(c3)/rng(c3)<0.08&&lw(c3)>rng(c3)*0.6&&uw(c3)<rng(c3)*0.1)found.push({index:i,name:"Dragonfly Doji",type:"bullish",desc:"Strong bullish reversal"});
    if(body(c3)/rng(c3)<0.08&&uw(c3)>rng(c3)*0.6&&lw(c3)<rng(c3)*0.1)found.push({index:i,name:"Gravestone Doji",type:"bearish",desc:"Strong bearish reversal"});
    if(body(c3)/rng(c3)<0.35&&lw(c3)>body(c3)*2&&uw(c3)<body(c3)*0.5&&bear(c2))found.push({index:i,name:"Hammer",type:"bullish",desc:"Bullish reversal after downtrend"});
    if(body(c3)/rng(c3)<0.35&&uw(c3)>body(c3)*2&&lw(c3)<body(c3)*0.5&&bear(c2))found.push({index:i,name:"Inverted Hammer",type:"bullish",desc:"Potential bullish reversal"});
    if(body(c3)/rng(c3)<0.35&&uw(c3)>body(c3)*2&&lw(c3)<body(c3)*0.5&&bull(c2))found.push({index:i,name:"Shooting Star",type:"bearish",desc:"Bearish reversal after uptrend"});
    if(body(c3)/rng(c3)<0.35&&lw(c3)>body(c3)*2&&uw(c3)<body(c3)*0.5&&bull(c2))found.push({index:i,name:"Hanging Man",type:"bearish",desc:"Bearish reversal signal"});
    if(bear(c2)&&bull(c3)&&c3.open<=c2.close&&c3.close>=c2.open&&body(c3)>body(c2))found.push({index:i,name:"Bullish Engulfing",type:"bullish",desc:"Strong bullish reversal"});
    if(bull(c2)&&bear(c3)&&c3.open>=c2.close&&c3.close<=c2.open&&body(c3)>body(c2))found.push({index:i,name:"Bearish Engulfing",type:"bearish",desc:"Strong bearish reversal"});
    if(bear(c1)&&body(c2)/rng(c2)<0.4&&bull(c3)&&c3.close>(c1.open+c1.close)/2)found.push({index:i,name:"Morning Star",type:"bullish",desc:"3-candle bullish reversal"});
    if(bull(c1)&&body(c2)/rng(c2)<0.4&&bear(c3)&&c3.close<(c1.open+c1.close)/2)found.push({index:i,name:"Evening Star",type:"bearish",desc:"3-candle bearish reversal"});
    if(bull(c1)&&bull(c2)&&bull(c3)&&body(c1)/rng(c1)>0.6&&body(c2)/rng(c2)>0.6&&body(c3)/rng(c3)>0.6)found.push({index:i,name:"Three White Soldiers",type:"bullish",desc:"Very strong bullish continuation"});
    if(bear(c1)&&bear(c2)&&bear(c3)&&body(c1)/rng(c1)>0.6&&body(c2)/rng(c2)>0.6&&body(c3)/rng(c3)>0.6)found.push({index:i,name:"Three Black Crows",type:"bearish",desc:"Very strong bearish continuation"});
    if(bear(c2)&&bull(c3)&&c3.open<c2.low&&c3.close>(c2.open+c2.close)/2&&c3.close<c2.open)found.push({index:i,name:"Piercing Line",type:"bullish",desc:"Bullish reversal"});
    if(bull(c2)&&bear(c3)&&c3.open>c2.high&&c3.close<(c2.open+c2.close)/2&&c3.close>c2.open)found.push({index:i,name:"Dark Cloud Cover",type:"bearish",desc:"Bearish reversal"});
    if(Math.abs(c2.low-c3.low)/c2.low<0.002&&bear(c2)&&bull(c3))found.push({index:i,name:"Tweezer Bottom",type:"bullish",desc:"Bullish reversal at support"});
    if(Math.abs(c2.high-c3.high)/c2.high<0.002&&bull(c2)&&bear(c3))found.push({index:i,name:"Tweezer Top",type:"bearish",desc:"Bearish reversal at resistance"});
    if(bull(c3)&&uw(c3)/rng(c3)<0.03&&lw(c3)/rng(c3)<0.03&&body(c3)/rng(c3)>0.9)found.push({index:i,name:"Bullish Marubozu",type:"bullish",desc:"Full-body bull — strong momentum"});
    if(bear(c3)&&uw(c3)/rng(c3)<0.03&&lw(c3)/rng(c3)<0.03&&body(c3)/rng(c3)>0.9)found.push({index:i,name:"Bearish Marubozu",type:"bearish",desc:"Full-body bear — strong momentum"});
  }
  return found;
}

/* ── Chart patterns ── */
function detectChartPatterns(k){
  const found=[];if(k.length<15)return found;
  const{hi,lo}=findSwings(k,3),tol=0.004;
  const close=(a,b)=>Math.abs(a-b)/((a+b)/2)<tol;
  for(let i=0;i<hi.length-1;i++){const[h1,h2]=[hi[i],hi[i+1]];if(close(k[h1].high,k[h2].high)&&lo.some(l=>l>h1&&l<h2))found.push({index:h2,name:"Double Top",type:"bearish",desc:"Strong reversal — sell on neckline break"});}
  for(let i=0;i<lo.length-1;i++){const[l1,l2]=[lo[i],lo[i+1]];if(close(k[l1].low,k[l2].low)&&hi.some(h=>h>l1&&h<l2))found.push({index:l2,name:"Double Bottom",type:"bullish",desc:"Strong reversal — buy on neckline break"});}
  for(let i=0;i<hi.length-2;i++){const[a,b,c]=[hi[i],hi[i+1],hi[i+2]];const[pa,pb,pc]=[k[a].high,k[b].high,k[c].high];if(pb>pa*1.005&&pb>pc*1.005&&close(pa,pc))found.push({index:c,name:"Head & Shoulders",type:"bearish",desc:"Reliable top reversal"});}
  for(let i=0;i<lo.length-2;i++){const[a,b,c]=[lo[i],lo[i+1],lo[i+2]];const[pa,pb,pc]=[k[a].low,k[b].low,k[c].low];if(pb<pa*0.995&&pb<pc*0.995&&close(pa,pc))found.push({index:c,name:"Inv H&S",type:"bullish",desc:"Reliable bottom reversal"});}
  if(hi.length>=2&&lo.length>=2){
    const lh=hi.slice(-2),ll=lo.slice(-2);
    if(close(k[lh[0]].high,k[lh[1]].high)&&k[ll[1]].low>k[ll[0]].low*1.002)found.push({index:lh[1],name:"Ascending Triangle",type:"bullish",desc:"Bullish breakout"});
    if(close(k[ll[0]].low,k[ll[1]].low)&&k[lh[1]].high<k[lh[0]].high*0.998)found.push({index:ll[1],name:"Descending Triangle",type:"bearish",desc:"Bearish breakdown"});
    if(k[lh[1]].high<k[lh[0]].high*0.998&&k[ll[1]].low>k[ll[0]].low*1.002)found.push({index:Math.max(lh[1],ll[1]),name:"Symmetrical Triangle",type:"neutral",desc:"Wait for breakout direction"});
    const hr=k[lh[1]].high>k[lh[0]].high,lr=k[ll[1]].low>k[ll[0]].low;
    if(hr&&lr&&(k[ll[1]].low-k[ll[0]].low)>(k[lh[1]].high-k[lh[0]].high))found.push({index:lh[1],name:"Rising Wedge",type:"bearish",desc:"Bearish reversal"});
    if(!hr&&!lr&&(k[lh[0]].high-k[lh[1]].high)>(k[ll[0]].low-k[ll[1]].low))found.push({index:ll[1],name:"Falling Wedge",type:"bullish",desc:"Bullish reversal"});
  }
  return found;
}

/* ── S/R ── */
function detectSR(k,max=5){
  if(k.length<10)return[];
  const{hi,lo}=findSwings(k,2),tol=0.004;
  function cluster(idxList,pFn){
    const prices=idxList.map(i=>({price:pFn(k[i]),touches:1}));const cls=[];
    prices.forEach(p=>{const ex=cls.find(c=>Math.abs(c.price-p.price)/p.price<tol);ex?(ex.touches++,ex.price=(ex.price*(ex.touches-1)+p.price)/ex.touches):cls.push({...p});});
    return cls.filter(c=>c.touches>=2).sort((a,b)=>b.touches-a.touches);
  }
  return[...cluster(hi,x=>x.high).slice(0,max).map(c=>({...c,type:"resistance"})),...cluster(lo,x=>x.low).slice(0,max).map(c=>({...c,type:"support"}))];
}

/* ── Signal engine ── */
function computeSignal(klines){
  const c=klines.map(k=>k.close),v=klines.map(k=>k.volume||0),last=c[c.length-1];
  const empty={score:0,label:"WAIT",confidence:0,rsiVal:50,macdHist:0,bbPct:0.5,volSurge:1,stochK:50,atr:0,patterns:[],latestPattern:null,levels:[],tradeCard:null,bb:{upper:0,middle:0,lower:0}};
  if(c.length<26)return empty;
  const rsiVal=calcRSI(c),{hist:macdHist}=calcMACD(c),bb=calcBB(c),atr=calcATR(klines),volSurge=calcVolSurge(v),{k:stochK}=calcStochRSI(c);
  const e9=ema(c,9),e21=ema(c,21),e50=ema(c,50);
  const ma9=e9[e9.length-1],ma21=e21[e21.length-1],ma50=e50[e50.length-1];
  let score=0,conf=0,total=7;
  if(rsiVal<30){score+=25;conf++;}else if(rsiVal<45)score+=10;else if(rsiVal>70){score-=25;conf++;}else if(rsiVal>55)score-=10;
  const mn=Math.max(-1,Math.min(1,macdHist/(last*0.001||1)));score+=mn*20;if(Math.abs(mn)>0.5)conf++;
  if(bb.pct<0.2){score+=15;conf++;}else if(bb.pct<0.4)score+=5;else if(bb.pct>0.8){score-=15;conf++;}else if(bb.pct>0.6)score-=5;
  if(ma9>ma21&&ma21>ma50){score+=15;conf++;}else if(ma9<ma21&&ma21<ma50){score-=15;conf++;}else score+=ma9>ma21?5:-5;
  if(volSurge>1.5)score+=score>0?10:-10;
  if(stochK<20){score+=10;conf++;}else if(stochK>80){score-=10;conf++;}
  if(bb.bw<0.04)score+=score>0?5:-5;
  score=Math.max(-100,Math.min(100,Math.round(score)));
  const confidence=Math.min(95,Math.round((conf/total)*100+(Math.abs(score)/100)*30));
  let label="NEUTRAL";
  if(score>=65&&confidence>=60)label="STRONG BUY";
  else if(score>=25)label="BUY";
  else if(score<=-65&&confidence>=60)label="STRONG SELL";
  else if(score<=-25)label="SELL";
  const candleP=detectCandlePatterns(klines),chartP=detectChartPatterns(klines);
  const patterns=[...candleP,...chartP].sort((a,b)=>a.index-b.index);
  const latestPattern=patterns.length?patterns[patterns.length-1]:null;
  const levels=detectSR(klines);
  let tradeCard=null;
  if(label==="STRONG BUY"||label==="BUY"){
    const sl=last-atr*1.5,tp1=last+atr*2,tp2=last+atr*3.5;
    tradeCard={direction:"LONG",entry:last,sl,tp1,tp2,rrr:"1:2",spotType:"Spot Long",futuresType:"Futures Long (2-5x)",slPct:((last-sl)/last*100).toFixed(2),tp1Pct:((tp1-last)/last*100).toFixed(2),tp2Pct:((tp2-last)/last*100).toFixed(2),note:label==="STRONG BUY"?"High confidence — all indicators align":"Moderate signal — use smaller size"};
  }else if(label==="STRONG SELL"||label==="SELL"){
    const sl=last+atr*1.5,tp1=last-atr*2,tp2=last-atr*3.5;
    tradeCard={direction:"SHORT",entry:last,sl,tp1,tp2,rrr:"1:2",spotType:"Spot — exit/reduce",futuresType:"Futures Short (2-5x)",slPct:((sl-last)/last*100).toFixed(2),tp1Pct:((last-tp1)/last*100).toFixed(2),tp2Pct:((last-tp2)/last*100).toFixed(2),note:label==="STRONG SELL"?"High confidence — all indicators align":"Moderate signal — wait for confirmation"};
  }
  return{score,label,confidence,rsiVal,macdHist,bbPct:bb.pct,volSurge,stochK,atr,patterns,latestPattern,levels,tradeCard,bb};
}

/* ── Format ── */
const fmtP=p=>{if(p==null)return"—";if(p>=1000)return p.toLocaleString(undefined,{maximumFractionDigits:2});if(p>=1)return p.toFixed(4);return p.toFixed(6);};
const fmtPct=p=>p==null?"—":`${p>0?"+":""}${p.toFixed(2)}%`;

/* ── Audio ── */
let _actx=null;
function playAlert(kind){
  try{
    if(!_actx){const C=window.AudioContext||window.webkitAudioContext;_actx=new C();}
    if(_actx.state==="suspended")_actx.resume();
    const ctx=_actx,now=ctx.currentTime;
    [kind==="bullish"?660:520,kind==="bullish"?880:360].forEach((freq,i)=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type="sine";o.frequency.value=freq;const t=now+i*0.14;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.18,t+0.015);g.gain.exponentialRampToValueAtTime(0.001,t+0.12);
      o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+0.13);
    });
  }catch(e){}
}

/* ── Mini Candlestick Chart (inline table) ── */
function MiniChart({klines}){
  if(!klines||klines.length<5)return<div className="w-20 h-10 bg-[#151A21] rounded"/>;
  const view=klines.slice(-20);
  const w=80,h=36,n=view.length,slot=w/n,cw=Math.max(1.5,slot*0.6);
  const hi=Math.max(...view.map(k=>k.high)),lo=Math.min(...view.map(k=>k.low)),rng=hi-lo||1;
  const yF=p=>2+(h-4)-(((p-lo)/rng)*(h-4));
  return(
    <svg width={w} height={h} className="block">
      {view.map((k,i)=>{
        const x=i*slot+slot/2,bull=k.close>=k.open,col=bull?"#3DD68C":"#F2545B";
        const yH=yF(k.high),yL=yF(k.low),yO=yF(k.open),yC=yF(k.close);
        const bTop=Math.min(yO,yC),bH=Math.max(1,Math.abs(yC-yO));
        return(<g key={i}>
          <line x1={x} x2={x} y1={yH} y2={yL} stroke={col} strokeWidth="0.8" opacity="0.8"/>
          <rect x={x-cw/2} y={bTop} width={cw} height={bH} fill={col} opacity="0.9" rx="0.3"/>
        </g>);
      })}
    </svg>
  );
}

/* ── Pattern popup box ── */
function PatternPopup({pattern,symbol,tradeCard,onViewChart,onClose}){
  if(!pattern)return null;
  const col=PC[pattern.type];
  return(
    <div className="fixed bottom-16 left-3 right-3 z-50 animate-bounce-once" onClick={e=>e.stopPropagation()}>
      <div className="bg-[#0F141A] border rounded-xl shadow-2xl overflow-hidden" style={{borderColor:`${col}60`}}>
        <div className="px-4 py-2.5 flex items-center justify-between" style={{background:`${col}18`}}>
          <div className="flex items-center gap-2">
            <span className="text-base">{pattern.type==="bullish"?"▲":pattern.type==="bearish"?"▼":"◆"}</span>
            <div>
              <div className="text-[12px] font-bold font-sans" style={{color:col}}>{pattern.name} detected!</div>
              <div className="text-[10px] text-[#8B96A5] font-sans">{symbol.replace("USDT","")} · {pattern.desc}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#5A6472] text-lg px-1">✕</button>
        </div>
        {tradeCard&&(
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2 text-center font-mono text-[11px]">
              <div className="bg-[#151A21] rounded p-2"><div className="text-[9px] text-[#5A6472] mb-0.5">Entry</div><div className="font-bold text-[#E6EDF3]">{fmtP(tradeCard.entry)}</div></div>
              <div className="rounded p-2" style={{background:"#F2545B18"}}><div className="text-[9px] text-[#F2545B] mb-0.5">Stop Loss</div><div className="font-bold text-[#F2545B]">{fmtP(tradeCard.sl)}</div><div className="text-[9px] text-[#F2545B]/70">-{tradeCard.slPct}%</div></div>
              <div className="rounded p-2" style={{background:"#3DD68C18"}}><div className="text-[9px] text-[#3DD68C] mb-0.5">Target</div><div className="font-bold text-[#3DD68C]">{fmtP(tradeCard.tp1)}</div><div className="text-[9px] text-[#3DD68C]/70">+{tradeCard.tp1Pct}%</div></div>
            </div>
            <div className="flex gap-2 text-[10px] font-sans">
              <span className="flex-1 text-center py-1.5 rounded font-bold" style={{background:`${col}20`,color:col}}>{tradeCard.direction==="LONG"?tradeCard.spotType:tradeCard.spotType}</span>
              <button onClick={onViewChart} className="flex-1 text-center py-1.5 rounded font-bold bg-[#F0B90B] text-[#0D1117]">View Chart →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Trade Card Modal ── */
function TradeCard({card,symbol,onClose}){
  if(!card)return null;
  const bull=card.direction==="LONG",col=bull?"#3DD68C":"#F2545B";
  return(
    <div className="fixed inset-0 bg-black/75 z-50 flex items-end justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F141A] border border-[#242C36] rounded-xl w-full max-w-sm shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#1C232C] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-[#E6EDF3] font-sans">{symbol.replace("USDT","")}/USDT</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{background:`${col}22`,color:col}}>{bull?"▲ LONG":"▼ SHORT"}</span>
          </div>
          <button onClick={onClose} className="text-[#5A6472] text-xl">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3 font-mono">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-[#151A21] rounded-lg p-2.5"><div className="text-[9px] text-[#5A6472] uppercase mb-1">Entry</div><div className="text-[13px] font-bold text-[#E6EDF3]">{fmtP(card.entry)}</div></div>
            <div className="rounded-lg p-2.5" style={{background:"#F2545B12"}}><div className="text-[9px] text-[#F2545B] uppercase mb-1">Stop Loss</div><div className="text-[12px] font-bold text-[#F2545B]">{fmtP(card.sl)}</div><div className="text-[9px] text-[#F2545B]/70">-{card.slPct}%</div></div>
            <div className="rounded-lg p-2.5" style={{background:"#3DD68C12"}}><div className="text-[9px] text-[#3DD68C] uppercase mb-1">TP1</div><div className="text-[12px] font-bold text-[#3DD68C]">{fmtP(card.tp1)}</div><div className="text-[9px] text-[#3DD68C]/70">+{card.tp1Pct}%</div></div>
          </div>
          <div className="rounded-lg p-2.5 text-center" style={{background:"#3DD68C12"}}><div className="text-[9px] text-[#3DD68C] uppercase mb-1">TP2 (Extended) · RRR {card.rrr}</div><div className="text-[13px] font-bold text-[#3DD68C]">{fmtP(card.tp2)}</div><div className="text-[9px] text-[#3DD68C]/70">+{card.tp2Pct}%</div></div>
          <div className="border border-[#242C36] rounded-lg p-2.5 flex flex-col gap-1.5 text-[11px]">
            <div className="flex justify-between"><span className="text-[#5A6472]">Spot</span><span className="text-[#E6EDF3] font-bold">{card.spotType}</span></div>
            <div className="flex justify-between"><span className="text-[#5A6472]">Futures</span><span className="text-[#E6EDF3] font-bold">{card.futuresType}</span></div>
          </div>
          <div className="rounded-lg px-3 py-2 text-[10px]" style={{background:"#F0B90B18",borderColor:"#F0B90B44",border:"1px solid"}}><span className="text-[#F0B90B]">{card.note}</span></div>
          <p className="text-[9px] text-[#5A6472] text-center">Not financial advice · Always use risk management</p>
        </div>
      </div>
    </div>
  );
}

/* ── Full Chart Modal ── */
function ChartModal({symbol,klines,signal,interval,onClose}){
  const[hover,setHover]=useState(null);
  const[zoom,setZoom]=useState(null);
  const[dragS,setDragS]=useState(null);
  const[dragE,setDragE]=useState(null);
  const svgRef=useRef(null);
  if(!klines||!klines.length)return null;
  const{patterns,levels}=signal;
  const view=zoom?klines.slice(zoom[0],zoom[1]+1):klines,off=zoom?zoom[0]:0;
  const W=860,H=400,pL=52,pR=12,pT=14,pB=8,volH=60,chartH=H-pB-volH-4,plotH=chartH-pT,plotW=W-pL-pR;
  const hA=view.map(k=>k.high),lA=view.map(k=>k.low);
  let maxP=Math.max(...hA),minP=Math.min(...lA);
  if(levels.length){levels.forEach(l=>{if(l.price>maxP)maxP=l.price;if(l.price<minP)minP=l.price;});}
  const pad=(maxP-minP)*0.06||maxP*0.01;maxP+=pad;minP-=pad;const rng=maxP-minP||1;
  const n=view.length,slot=plotW/n,cw=Math.max(2,slot*0.65),maxV=Math.max(...view.map(k=>k.volume||0),1);
  const yF=p=>pT+plotH-((p-minP)/rng)*plotH,xF=i=>pL+i*slot+slot/2,volTop=chartH+4;
  const patAt={};patterns.forEach(p=>{const li=p.index-off;if(li>=0&&li<n)patAt[li]=p;});
  const grid=Array.from({length:6},(_,i)=>minP+(rng*i)/5);
  function mDown(e){const r=svgRef.current.getBoundingClientRect(),idx=Math.max(0,Math.min(n-1,Math.floor((e.clientX-r.left-pL)/slot)));setDragS(idx);setDragE(idx);}
  function mMove(e){if(dragS==null)return;const r=svgRef.current.getBoundingClientRect();setDragE(Math.max(0,Math.min(n-1,Math.floor((e.clientX-r.left-pL)/slot))));}
  function mUp(){if(dragS!=null&&dragE!=null&&Math.abs(dragE-dragS)>2)setZoom([Math.min(dragS,dragE)+off,Math.max(dragS,dragE)+off]);setDragS(null);setDragE(null);}
  const hk=hover!=null?view[hover]:null;
  return(
    <div className="fixed inset-0 bg-black/75 z-40 flex items-center justify-center p-2 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F141A] border border-[#242C36] rounded-xl w-full max-w-4xl shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C232C]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[#E6EDF3] font-bold font-sans text-sm">{symbol.replace("USDT","")}<span className="text-[#5A6472]">/USDT</span></span>
            <span className="text-[9px] border border-[#242C36] rounded px-1.5 py-0.5 text-[#5A6472] font-mono">{interval}</span>
            {zoom&&<button onClick={()=>setZoom(null)} className="text-[9px] text-[#F0B90B] border border-[#F0B90B]/40 rounded px-1.5 py-0.5">reset zoom</button>}
            {signal.patterns.slice(-3).map((p,i)=><span key={i} className="text-[9px] font-bold px-1.5 py-0.5 rounded border" style={{color:PC[p.type],borderColor:`${PC[p.type]}44`}}>{p.name}</span>)}
          </div>
          <button onClick={onClose} className="text-[#5A6472] text-lg px-1">✕</button>
        </div>
        <div className="p-3 overflow-x-auto">
          <svg ref={svgRef} width={W} height={H} className="block select-none" style={{minWidth:W,cursor:dragS!=null?"ew-resize":"crosshair"}}
            onMouseLeave={()=>{setHover(null);if(dragS!=null)mUp();}} onMouseDown={mDown} onMouseMove={mMove} onMouseUp={mUp}>
            {grid.map((p,i)=>{const y=yF(p);return(<g key={i}><line x1={pL} x2={W-pR} y1={y} y2={y} stroke="#1C232C" strokeWidth="1"/><text x={pL-6} y={y+3} fill="#5A6472" fontSize="9" fontFamily="monospace" textAnchor="end">{fmtP(p)}</text></g>);})}
            {levels.map((l,i)=>{const y=yF(l.price);if(y<pT||y>chartH)return null;const col=l.type==="resistance"?"#F2545B":"#3DD68C";return(<g key={`sr${i}`}><line x1={pL} x2={W-pR} y1={y} y2={y} stroke={col} strokeWidth="1" strokeDasharray="5,3" opacity="0.5"/><text x={W-pR-2} y={y-3} fill={col} fontSize="8" fontFamily="monospace" textAnchor="end">{l.type==="resistance"?"R":"S"} {fmtP(l.price)}</text></g>);})}
            {view.map((k,i)=>{
              const x=xF(i),bull=k.close>=k.open,col=bull?"#3DD68C":"#F2545B";
              const yH=yF(k.high),yL=yF(k.low),yO=yF(k.open),yC=yF(k.close);
              const bTop=Math.min(yO,yC),bH=Math.max(1.5,Math.abs(yC-yO)),vBH=((k.volume||0)/maxV)*(volH-6);
              const pat=patAt[i],isHov=hover===i;
              return(<g key={i}>
                <g onMouseEnter={()=>setHover(i)}>
                  <rect x={x-slot/2} y={pT} width={slot} height={plotH} fill="transparent"/>
                  {pat&&<rect x={x-slot/2} y={pT} width={slot} height={plotH} fill={PC[pat.type]} opacity="0.08"/>}
                  <line x1={x} x2={x} y1={yH} y2={yL} stroke={col} strokeWidth="1" opacity={isHov?1:0.85}/>
                  <rect x={x-cw/2} y={bTop} width={cw} height={bH} fill={col} opacity={isHov?1:0.9} rx="0.5"/>
                  {pat&&<><circle cx={x} cy={pat.type==="bearish"?yH-10:yL+10} r="4" fill={PC[pat.type]}/><line x1={x} x2={x} y1={pat.type==="bearish"?yH-6:yL+6} y2={pat.type==="bearish"?yH:yL} stroke={PC[pat.type]} strokeWidth="1.5"/></>}
                </g>
                <rect x={x-cw/2} y={volTop+(volH-6-vBH)} width={cw} height={Math.max(1,vBH)} fill={col} opacity={isHov?0.8:0.4}/>
              </g>);
            })}
            {hover!=null&&<line x1={xF(hover)} x2={xF(hover)} y1={pT} y2={volTop+volH-6} stroke="#5A6472" strokeWidth="1" strokeDasharray="2,2"/>}
            {dragS!=null&&dragE!=null&&dragS!==dragE&&<rect x={Math.min(xF(dragS),xF(dragE))} y={pT} width={Math.abs(xF(dragE)-xF(dragS))} height={plotH} fill="#F0B90B" opacity="0.1" stroke="#F0B90B" strokeWidth="1" strokeDasharray="3,3"/>}
            <text x={pL} y={volTop-2} fill="#5A6472" fontSize="8" fontFamily="monospace">VOL</text>
          </svg>
          <div className="flex flex-wrap gap-3 px-1 pt-1 text-[10px] font-mono text-[#8B96A5] min-h-[16px]">
            {hk?(<><span>O <span className="text-[#E6EDF3]">{fmtP(hk.open)}</span></span><span>H <span className="text-[#E6EDF3]">{fmtP(hk.high)}</span></span><span>L <span className="text-[#E6EDF3]">{fmtP(hk.low)}</span></span><span>C <span className="text-[#E6EDF3]">{fmtP(hk.close)}</span></span><span>V <span className="text-[#E6EDF3]">{(hk.volume||0).toFixed(2)}</span></span>{patAt[hover]&&<span className="font-bold" style={{color:PC[patAt[hover].type]}}>{patAt[hover].name} — {patAt[hover].desc}</span>}</>):
            <span className="text-[#5A6472]">hover=OHLCV · drag=zoom · dashed=S/R · colored bg=pattern</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Signal Badge ── */
function SigBadge({label}){
  const s={"STRONG BUY":"bg-[#3DD68C] text-[#0D1117]","BUY":"text-[#3DD68C] border border-[#3DD68C]/60","NEUTRAL":"text-[#5A6472] border border-[#2A323D]","SELL":"text-[#F2545B] border border-[#F2545B]/60","STRONG SELL":"bg-[#F2545B] text-[#0D1117]","WAIT":"text-[#5A6472] border border-[#2A323D]"};
  return<span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide font-mono whitespace-nowrap ${s[label]||s.WAIT}`}>{label}</span>;
}
function StrBar({score}){return<div className="w-12 h-1.5 bg-[#1C232C] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${Math.abs(score)}%`,background:score>=0?"#3DD68C":"#F2545B"}}/></div>;}
function Th({label,sortKey,sortKeyActive,sortDir,toggleSort,align="right"}){
  const active=sortKey===sortKeyActive;
  return<th onClick={()=>toggleSort(sortKey)} className={`px-2 py-2 font-medium cursor-pointer select-none hover:text-[#8B96A5] transition-colors ${align==="left"?"text-left":"text-right"}`}><span className={active?"text-[#E6EDF3]":""}>{label}{active&&<span className="ml-0.5">{sortDir==="asc"?"↑":"↓"}</span>}</span></th>;
}

/* ══ PRICE ALERT MANAGER ══ */
function PriceAlerts({rows,onClose}){
  const[alerts,setAlerts]=useState([]);
  const[sym,setSym]=useState("BTCUSDT");
  const[price,setPrice]=useState("");
  const[dir,setDir]=useState("above");
  const triggeredRef=useRef(new Set());

  useEffect(()=>{
    if(!alerts.length)return;
    alerts.forEach(a=>{
      const row=rows[a.symbol];if(!row)return;
      const cur=row.price;
      const triggered=(a.direction==="above"&&cur>=a.price)||(a.direction==="below"&&cur<=a.price);
      if(triggered&&!triggeredRef.current.has(a.id)){
        triggeredRef.current.add(a.id);
        playAlert(a.direction==="above"?"bullish":"bearish");
        alert(`🔔 ${a.symbol.replace("USDT","")}: Price ${a.direction} ${fmtP(a.price)}`);
      }
    });
  },[rows,alerts]);

  function addAlert(){
    if(!price)return;
    setAlerts(prev=>[...prev,{id:Date.now(),symbol:sym,price:parseFloat(price),direction:dir}]);
    setPrice("");
  }

  return(
    <div className="fixed inset-0 bg-black/75 z-50 flex items-end justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0F141A] border border-[#242C36] rounded-xl w-full max-w-sm shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C232C]">
          <span className="font-bold text-[#E6EDF3] font-sans text-sm">🔔 Price Alerts</span>
          <button onClick={onClose} className="text-[#5A6472] text-xl">✕</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <select value={sym} onChange={e=>setSym(e.target.value)} className="flex-1 bg-[#151A21] border border-[#242C36] rounded px-2 py-1.5 text-[11px] text-[#E6EDF3] font-mono outline-none">
              {SYMBOLS.map(s=><option key={s} value={s}>{s.replace("USDT","")}</option>)}
            </select>
            <select value={dir} onChange={e=>setDir(e.target.value)} className="bg-[#151A21] border border-[#242C36] rounded px-2 py-1.5 text-[11px] text-[#E6EDF3] font-mono outline-none">
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input value={price} onChange={e=>setPrice(e.target.value)} placeholder="Price…" inputMode="decimal"
              className="flex-1 bg-[#151A21] border border-[#242C36] rounded px-2 py-1.5 text-[11px] text-[#E6EDF3] font-mono outline-none focus:border-[#F0B90B]/50"/>
            <button onClick={addAlert} className="bg-[#F0B90B] text-[#0D1117] font-bold text-[11px] rounded px-3 py-1.5">Add</button>
          </div>
          {alerts.length>0&&(
            <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
              {alerts.map(a=>(
                <div key={a.id} className={`flex items-center justify-between bg-[#151A21] rounded px-2.5 py-1.5 text-[10px] font-mono ${triggeredRef.current.has(a.id)?"opacity-40":""}`}>
                  <span className="text-[#E6EDF3]">{a.symbol.replace("USDT","")} {a.direction} <span className="text-[#F0B90B]">{fmtP(a.price)}</span></span>
                  <button onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))} className="text-[#F2545B] ml-2">✕</button>
                </div>
              ))}
            </div>
          )}
          {!alerts.length&&<p className="text-[10px] text-[#5A6472] font-sans text-center py-2">No active alerts</p>}
        </div>
      </div>
    </div>
  );
}

/* ══ MAIN APP ══ */
export default function ScalpTerminal(){
  const[rows,setRows]=useState({});
  const[sortKey,setSortKey]=useState("score");
  const[sortDir,setSortDir]=useState("desc");
  const[filter,setFilter]=useState("ALL");
  const[search,setSearch]=useState("");
  const[connStatus,setConnStatus]=useState("connecting");
  const[lastUpdate,setLastUpdate]=useState(null);
  const[interval,setInterval_]=useState("5m");
  const[chartSymbol,setChartSymbol]=useState(null);
  const[tradeSymbol,setTradeSymbol]=useState(null);
  const[watchlist,setWatchlist]=useState(()=>new Set());
  const[watchOnly,setWatchOnly]=useState(false);
  const[alertsEnabled,setAlertsEnabled]=useState(false);
  const[recentAlert,setRecentAlert]=useState(null);
  const[patternPopup,setPatternPopup]=useState(null);
  const[showPriceAlerts,setShowPriceAlerts]=useState(false);
  const[balances,setBalances]=useState(null);
  const[balLoading,setBalLoading]=useState(false);
  const[balError,setBalError]=useState(null);
  const[showBal,setShowBal]=useState(false);
  const[prevLabels,setPrevLabels]=useState({});
  const[flashPrices,setFlashPrices]=useState({});
  const wsRefs=useRef({});
  const dataRef=useRef({});
  const alertedRef=useRef({});
  const alertsRef=useRef(false);
  const prevPrices=useRef({});
  useEffect(()=>{alertsRef.current=alertsEnabled;},[alertsEnabled]);

  function toggleWatch(sym){setWatchlist(p=>{const n=new Set(p);n.has(sym)?n.delete(sym):n.add(sym);return n;});}

  async function loadBal(){
    setBalLoading(true);setBalError(null);
    try{const r=await fetch("/api/balance");const d=await r.json();if(!r.ok)throw new Error(d.error||"Failed");setBalances(d.balances);setShowBal(true);}
    catch(e){setBalError(e.message);}
    finally{setBalLoading(false);}
  }

  useEffect(()=>{
    let cancelled=false;
    setConnStatus("connecting");setRows({});dataRef.current={};
    Object.values(wsRefs.current).forEach(w=>w&&w.close());wsRefs.current={};

    async function init(sym){
      try{
        const[kRes,tRes]=await Promise.all([fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${KLINE_LIMIT}`),fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`)]);
        const[kd,td]=await Promise.all([kRes.json(),tRes.json()]);
        if(cancelled||!Array.isArray(kd))return;
        const klines=kd.map(k=>({open:parseFloat(k[1]),high:parseFloat(k[2]),low:parseFloat(k[3]),close:parseFloat(k[4]),volume:parseFloat(k[5]),openTime:k[0]}));
        const signal=computeSignal(klines);
        dataRef.current[sym]={symbol:sym,klines,price:klines[klines.length-1].close,pct24h:parseFloat(td.priceChangePercent),signal};
        if(!cancelled)setRows(p=>({...p,[sym]:dataRef.current[sym]}));
        openWS(sym);
      }catch(e){}
    }

    function openWS(sym){
      if(cancelled)return;
      const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@kline_${interval}`);
      wsRefs.current[sym]=ws;ws.onopen=()=>setConnStatus("live");
      ws.onmessage=msg=>{
        try{
          const{k}=JSON.parse(msg.data);if(!k)return;
          const entry=dataRef.current[sym];if(!entry)return;
          const nc={open:parseFloat(k.o),high:parseFloat(k.h),low:parseFloat(k.l),close:parseFloat(k.c),volume:parseFloat(k.v),openTime:k.t};
          let klines=entry.klines.slice();
          if(k.x){klines.push(nc);if(klines.length>KLINE_LIMIT)klines.shift();}else klines[klines.length-1]=nc;
          const signal=computeSignal(klines);
          const prevPrice=prevPrices.current[sym];
          const priceChanged=prevPrice&&prevPrice!==nc.close;
          prevPrices.current[sym]=nc.close;
          if(priceChanged)setFlashPrices(p=>({...p,[sym]:nc.close>prevPrice?"up":"down"}));
          dataRef.current[sym]={...entry,klines,price:nc.close,signal};

          // Alert on new signal
          if(alertsRef.current&&(signal.label==="STRONG BUY"||signal.label==="STRONG SELL")){
            if(alertedRef.current[sym]!==signal.label){
              alertedRef.current[sym]=signal.label;
              playAlert(signal.label==="STRONG BUY"?"bullish":"bearish");
              setRecentAlert({symbol:sym,label:signal.label,id:Date.now()});
            }
          }else if(!["STRONG BUY","STRONG SELL"].includes(signal.label))alertedRef.current[sym]=null;

          // Pattern popup on new pattern
          if(signal.latestPattern){
            setPrevLabels(prev=>{
              const prevP=prev[sym];
              if(prevP!==signal.latestPattern.name&&signal.tradeCard){
                setPatternPopup({symbol:sym,pattern:signal.latestPattern,tradeCard:signal.tradeCard});
              }
              return{...prev,[sym]:signal.latestPattern.name};
            });
          }

          setRows(p=>({...p,[sym]:dataRef.current[sym]}));
          setLastUpdate(Date.now());
        }catch(e){}
      };
    }

    SYMBOLS.forEach((sym,i)=>setTimeout(()=>{if(!cancelled)init(sym);},i*60));
    return()=>{cancelled=true;Object.values(wsRefs.current).forEach(w=>w&&w.close());};
  },[interval]);

  useEffect(()=>{if(!recentAlert)return;const t=setTimeout(()=>setRecentAlert(c=>c&&c.id===recentAlert.id?null:c),5000);return()=>clearTimeout(t);},[recentAlert]);

  // clear flash after 400ms
  useEffect(()=>{
    const keys=Object.keys(flashPrices);if(!keys.length)return;
    const t=setTimeout(()=>setFlashPrices({}),400);return()=>clearTimeout(t);
  },[flashPrices]);

  const toggleSort=useCallback(key=>{setSortKey(pk=>{if(pk===key){setSortDir(d=>d==="asc"?"desc":"asc");return pk;}setSortDir("desc");return key;});},[]);

  const rowList=useMemo(()=>{
    let list=Object.values(rows);
    if(search.trim()){const q=search.trim().toUpperCase();list=list.filter(r=>r.symbol.includes(q));}
    if(filter==="BUY")list=list.filter(r=>r.signal.label.includes("BUY"));
    else if(filter==="SELL")list=list.filter(r=>r.signal.label.includes("SELL"));
    if(watchOnly)list=list.filter(r=>watchlist.has(r.symbol));
    list.sort((a,b)=>{
      let av,bv;
      if(sortKey==="symbol"){av=a.symbol;bv=b.symbol;}
      else if(sortKey==="price"){av=a.price;bv=b.price;}
      else if(sortKey==="pct24h"){av=a.pct24h;bv=b.pct24h;}
      else if(sortKey==="rsi"){av=a.signal.rsiVal;bv=b.signal.rsiVal;}
      else if(sortKey==="conf"){av=a.signal.confidence;bv=b.signal.confidence;}
      else{av=a.signal.score;bv=b.signal.score;}
      if(typeof av==="string")return sortDir==="asc"?av.localeCompare(bv):bv.localeCompare(av);
      return sortDir==="asc"?av-bv:bv-av;
    });
    return list;
  },[rows,sortKey,sortDir,filter,search,watchOnly,watchlist]);

  const loaded=Object.keys(rows).length;
  const buys=Object.values(rows).filter(r=>r.signal.label.includes("BUY")).length;
  const sells=Object.values(rows).filter(r=>r.signal.label.includes("SELL")).length;

  return(
    <div className="min-h-screen bg-[#0D1117] text-[#C9D1D9] font-mono text-sm flex flex-col">

      {/* HEADER */}
      <div className="border-b border-[#1C232C] px-3 py-2 flex items-center justify-between flex-wrap gap-2 bg-[#0F141A]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connStatus==="live"?"bg-[#3DD68C] animate-pulse":"bg-[#5A6472]"}`}/>
          <span className="text-[14px] font-bold text-[#E6EDF3] font-sans tracking-tight">SCALP<span className="text-[#F0B90B]">TERM</span></span>
          <span className="text-[10px] text-[#5A6472] font-sans">{loaded}/{SYMBOLS.length}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-[#5A6472]"><span className="text-[#3DD68C]">●</span> {buys}buy</span>
          <span className="text-[10px] text-[#5A6472]"><span className="text-[#F2545B]">●</span> {sells}sell</span>
          <span className={`text-[10px] font-bold ${connStatus==="live"?"text-[#3DD68C]":"text-[#5A6472]"}`}>{connStatus==="live"?"● LIVE":"connecting…"}</span>
          <button onClick={()=>setShowPriceAlerts(true)} className="text-[10px] font-bold font-sans px-2 py-1 rounded border text-[#8B96A5] border-[#242C36] hover:text-[#E6EDF3]">🔔</button>
          <button onClick={()=>{if(!balances)loadBal();else setShowBal(s=>!s);}} disabled={balLoading}
            className={`text-[10px] font-bold font-mono px-2 py-1 rounded border transition-colors ${showBal?"bg-[#F0B90B] text-[#0D1117] border-[#F0B90B]":"text-[#8B96A5] border-[#242C36] hover:text-[#E6EDF3]"}`}>
            {balLoading?"…":"⬡ bal"}
          </button>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="px-3 py-2 border-b border-[#1C232C] flex items-center gap-2 flex-wrap bg-[#0D1117]">
        <div className="flex gap-0.5 bg-[#11161D] border border-[#1C232C] rounded p-0.5">
          {TIMEFRAMES.map(tf=>(
            <button key={tf.value} onClick={()=>setInterval_(tf.value)}
              className={`px-2 py-1 rounded text-[10px] font-bold font-mono transition-colors ${interval===tf.value?"bg-[#F0B90B] text-[#0D1117]":"text-[#5A6472] hover:text-[#C9D1D9]"}`}>
              {tf.label}
            </button>
          ))}
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search…"
          className="bg-[#151A21] border border-[#242C36] rounded px-2 py-1 text-[11px] text-[#E6EDF3] placeholder-[#5A6472] outline-none focus:border-[#F0B90B]/50 w-24 font-mono"/>
        <div className="flex gap-0.5">
          {["ALL","BUY","SELL"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)}
              className={`px-2.5 py-1 rounded text-[10px] font-bold font-sans transition-colors ${filter===f?"bg-[#1C232C] text-[#E6EDF3] border border-[#2A323D]":"text-[#5A6472] hover:text-[#8B96A5]"}`}>
              {f}
            </button>
          ))}
        </div>
        <button onClick={()=>setWatchOnly(w=>!w)}
          className={`px-2 py-1 rounded text-[10px] font-bold font-sans transition-colors ${watchOnly?"bg-[#F0B90B]/15 text-[#F0B90B] border border-[#F0B90B]/40":"text-[#5A6472] hover:text-[#8B96A5]"}`}>
          ★{watchlist.size>0?` (${watchlist.size})`:""}
        </button>
        <button onClick={()=>setAlertsEnabled(a=>!a)}
          className={`px-2 py-1 rounded text-[10px] font-bold font-sans transition-colors ${alertsEnabled?"bg-[#3DD68C]/15 text-[#3DD68C] border border-[#3DD68C]/40":"text-[#5A6472] hover:text-[#8B96A5]"}`}>
          {alertsEnabled?"🔔 on":"🔕 off"}
        </button>
      </div>

      {/* BALANCE */}
      {balError&&<div className="px-4 py-2 bg-[#1A0F11] border-b border-[#F2545B]/30 text-[10px] text-[#F2545B] font-mono">⚠ {balError}</div>}
      {showBal&&balances&&(
        <div className="border-b border-[#1C232C] bg-[#0F141A] px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] text-[#5A6472] uppercase tracking-wider font-sans">Balance</span>
          {balances.slice(0,8).map(b=>(
            <div key={b.asset} className="flex items-center gap-1 bg-[#151A21] border border-[#242C36] rounded px-2 py-1">
              <span className="text-[10px] font-bold text-[#F0B90B]">{b.asset}</span>
              <span className="text-[10px] text-[#E6EDF3] tabular-nums">{(b.free+b.locked).toFixed(4)}</span>
            </div>
          ))}
          <button onClick={loadBal} className="text-[9px] text-[#5A6472] hover:text-[#E6EDF3] ml-auto">↻</button>
        </div>
      )}

      {/* TABLE */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-[#0D1117] z-10">
            <tr className="border-b border-[#1C232C] text-[9px] text-[#5A6472] font-sans uppercase tracking-wider">
              <th className="px-2 py-2 w-7"></th>
              <Th label="Pair" sortKey="symbol" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort} align="left"/>
              <th className="px-1 py-2 text-center">▲▼</th>
              <Th label="Price" sortKey="price" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort}/>
              <Th label="24h%" sortKey="pct24h" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort}/>
              <th className="px-2 py-2 text-right">Chart</th>
              <th className="px-2 py-2 text-left hidden md:table-cell">Pattern</th>
              <Th label="RSI" sortKey="rsi" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort}/>
              <Th label="Conf%" sortKey="conf" sortKeyActive={sortKey} sortDir={sortDir} toggleSort={toggleSort}/>
              <th className="px-2 py-2 text-right hidden sm:table-cell">Str</th>
              <th className="px-2 py-2 text-right pr-3">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rowList.map(r=>{
              const pos=r.pct24h>=0;
              const last=r.klines[r.klines.length-1];
              const up=last?last.close>=last.open:true;
              const lp=r.signal.latestPattern;
              const hasCard=!!r.signal.tradeCard;
              const iw=watchlist.has(r.symbol);
              const flash=flashPrices[r.symbol];
              return(
                <tr key={r.symbol} className={`border-b border-[#161B22] transition-colors cursor-pointer ${hasCard?"bg-[#F0B90B]/5 hover:bg-[#F0B90B]/10":"hover:bg-[#11161D]"}`}>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={e=>{e.stopPropagation();toggleWatch(r.symbol);}} className={`text-[12px] leading-none transition-colors ${iw?"text-[#F0B90B]":"text-[#2A323D] hover:text-[#5A6472]"}`}>★</button>
                  </td>
                  <td className="px-2 py-1.5" onClick={()=>setChartSymbol(r.symbol)}>
                    <div className="flex items-center gap-1">
                      <span className="text-[#E6EDF3] font-bold text-[11px]">{r.symbol.replace("USDT","")}</span>
                      {hasCard&&<span className="text-[8px] px-1 py-0.5 rounded bg-[#F0B90B]/20 text-[#F0B90B] font-bold">TRADE</span>}
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-center" onClick={()=>setChartSymbol(r.symbol)}>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${up?"bg-[#3DD68C]/15 text-[#3DD68C]":"bg-[#F2545B]/15 text-[#F2545B]"}`}>{up?"▲":"▼"}</span>
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums transition-colors duration-300 ${flash==="up"?"text-[#3DD68C]":flash==="down"?"text-[#F2545B]":"text-[#E6EDF3]"}`} onClick={()=>setChartSymbol(r.symbol)}>
                    {fmtP(r.price)}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${pos?"text-[#3DD68C]":"text-[#F2545B]"}`} onClick={()=>setChartSymbol(r.symbol)}>{fmtPct(r.pct24h)}</td>
                  <td className="px-2 py-1" onClick={()=>setChartSymbol(r.symbol)}>
                    <MiniChart klines={r.klines}/>
                  </td>
                  <td className="px-2 py-1.5 hidden md:table-cell" onClick={()=>setChartSymbol(r.symbol)}>
                    {lp?<span className="text-[9px] font-bold px-1.5 py-0.5 rounded border" style={{color:PC[lp.type],borderColor:`${PC[lp.type]}44`}}>{lp.name}</span>:<span className="text-[9px] text-[#3A434F]">—</span>}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.signal.rsiVal>70?"text-[#F2545B]":r.signal.rsiVal<30?"text-[#3DD68C]":"text-[#8B96A5]"}`} onClick={()=>setChartSymbol(r.symbol)}>
                    {r.signal.rsiVal.toFixed(0)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" onClick={()=>setChartSymbol(r.symbol)}>
                    <span className={`text-[10px] font-bold ${r.signal.confidence>=70?"text-[#3DD68C]":r.signal.confidence>=40?"text-[#F0B90B]":"text-[#5A6472]"}`}>{r.signal.confidence}%</span>
                  </td>
                  <td className="px-2 py-1.5 hidden sm:table-cell" onClick={()=>setChartSymbol(r.symbol)}><StrBar score={r.signal.score}/></td>
                  <td className="px-2 py-1.5 text-right pr-3" onClick={()=>{if(hasCard)setTradeSymbol(r.symbol);else setChartSymbol(r.symbol);}}>
                    <SigBadge label={r.signal.label}/>
                  </td>
                </tr>
              );
            })}
            {rowList.length===0&&loaded<SYMBOLS.length&&(
              <tr><td colSpan={11} className="text-center py-12 text-[#5A6472] font-sans text-xs">loading {SYMBOLS.length} pairs…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* FOOTER */}
      <div className="border-t border-[#1C232C] px-4 py-1.5 flex items-center justify-between text-[9px] text-[#5A6472] font-sans bg-[#0F141A]">
        <span>binance public api · not financial advice</span>
        <span>{lastUpdate?new Date(lastUpdate).toLocaleTimeString():"—"}</span>
      </div>

      {/* MODALS */}
      {chartSymbol&&rows[chartSymbol]&&<ChartModal symbol={chartSymbol} klines={rows[chartSymbol].klines} signal={rows[chartSymbol].signal} interval={interval} onClose={()=>setChartSymbol(null)}/>}
      {tradeSymbol&&rows[tradeSymbol]&&<TradeCard card={rows[tradeSymbol].signal.tradeCard} symbol={tradeSymbol} onClose={()=>setTradeSymbol(null)}/>}
      {showPriceAlerts&&<PriceAlerts rows={rows} onClose={()=>setShowPriceAlerts(false)}/>}
      {patternPopup&&<PatternPopup pattern={patternPopup.pattern} symbol={patternPopup.symbol} tradeCard={patternPopup.tradeCard} onViewChart={()=>{setChartSymbol(patternPopup.symbol);setPatternPopup(null);}} onClose={()=>setPatternPopup(null)}/>}
      {recentAlert&&(
        <div className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 px-3 py-2.5 rounded-lg border shadow-2xl font-sans cursor-pointer ${recentAlert.label.includes("BUY")?"bg-[#0F1A14] border-[#3DD68C]/50":"bg-[#1A0F11] border-[#F2545B]/50"}`}
          onClick={()=>{setTradeSymbol(recentAlert.symbol);setRecentAlert(null);}}>
          <span className={`text-base ${recentAlert.label.includes("BUY")?"text-[#3DD68C]":"text-[#F2545B]"}`}>{recentAlert.label.includes("BUY")?"▲":"▼"}</span>
          <div><div className="text-[11px] font-bold text-[#E6EDF3]">{recentAlert.symbol.replace("USDT","")}/USDT</div><div className={`text-[9px] font-bold ${recentAlert.label.includes("BUY")?"text-[#3DD68C]":"text-[#F2545B]"}`}>{recentAlert.label}</div></div>
        </div>
      )}
    </div>
  );
}
