import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend } from "recharts";
import Tooltip from "./Tooltip";

const CONFIG = {
  baseDateISO: "2025-10-01",
  worldElecBaseTWh2024: 30000,
  worldElecGrowth: 0.025,
} as const;

const KNOWN_ERAS = [
  { start: "2009-01-03", subsidy: 50.0 },
  { start: "2012-11-28", subsidy: 25.0 },
  { start: "2016-07-09", subsidy: 12.5 },
  { start: "2020-05-11", subsidy: 6.25 },
  { start: "2024-04-20", subsidy: 3.125 },
];
function genFutureEras(startISO: string, s0: number, n: number) {
  const out: { start: string; subsidy: number }[] = [];
  let d = new Date(startISO), s = s0;
  for (let i = 0; i < n; i++) {
    const nd = new Date(d); nd.setFullYear(nd.getFullYear() + 4);
    s = s / 2; out.push({ start: nd.toISOString().slice(0,10), subsidy: s }); d = nd;
  }
  return out;
}
const ALL_ERAS = [...KNOWN_ERAS, ...genFutureEras("2024-04-20", 3.125, 24)];

const PRESETS = {
  Bearish: { capUtilMultiplier: 0.7,   elecPriceMultiplier: 0.844, markup: 1.2 },
  Base:    { capUtilMultiplier: 1.0,   elecPriceMultiplier: 1.0,   markup: 1.5 },
  Bullish: { capUtilMultiplier: 1.0,   elecPriceMultiplier: 1.169, markup: 2.0 },
} as const;
type PresetName = keyof typeof PRESETS;

const BLOCKS_PER_YEAR = (365.2425 * 24 * 3600) / 600;

function yearsBetween(aISO: string, bISO: string){ return (new Date(bISO).getTime()-new Date(aISO).getTime())/(365.2425*24*3600*1000) }
function formatUSD(x: number){ return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }
function formatShortUSD(x: number){ try { return new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(x);} catch { return `$${Math.round(x).toLocaleString()}`; } }
function fmtDate(iso: string){ return new Date(iso).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}); }

const THRESHOLDS_BLOCKS = [
  { label: "1 block", blocks: 1, time: "10 minutes" },
  { label: "6 blocks", blocks: 6, time: "1 hour" },
  { label: "144 blocks", blocks: 144, time: "1 day" },
  { label: "1,008 blocks", blocks: 1008, time: "1 week" },
  { label: "4,320 blocks", blocks: 4320, time: "1 month (30d)" },
];

const ADOPTION = { steepness: 0.55, floor: 1e-6 } as const;

export default function EnergyCapBTCModel() {
  // Primary controls
  const [preset, setPreset] = useState<PresetName>("Base");
  const [year, setYear] = useState(2050);
  const [month, setMonth] = useState(10);
  const [day, setDay] = useState(13);
  const [stackBTC, setStackBTC] = useState(0.01);
  const [showReal, setShowReal] = useState(false);

  // Model parameters (values only — no unused setters)
  const [capSharePct] = useState(1.5);
  const [feesPct] = useState(15);
  const [elecBaseUSDkWh] = useState(0.06);
  const [elecDriftPct] = useState(1.0);
  const [cpiPct] = useState(2.5);
  const [overheadPhi] = useState(1.15);

  // Historical share (from /api/history)
  const [histByYear, setHistByYear] = useState<Record<number, { share:number; twh:number }> | null>(null);
  const [histLastYear, setHistLastYear] = useState<number | null>(null);
  const [histLastShare, setHistLastShare] = useState<number | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);

  const targetISO = useMemo(() => {
    const mm = String(month).padStart(2,"0"); const dd = String(day).padStart(2,"0");
    return `${year}-${mm}-${dd}`;
  }, [year, month, day]);

  // Fetch historical series once
  useEffect(() => {
    (async () => {
      try {
        setHistErr(null);
        const r = await fetch("/api/history", { cache: "no-store" });
        const js: unknown = await r.json();
        const o = js as { ok?: boolean; byYear?: Record<number, {share:number;twh:number}>; lastYear?: number; lastShare?: number; error?: string };
        if (!o?.ok) throw new Error(o?.error || "history API error");
        setHistByYear(o.byYear || null);
        setHistLastYear(typeof o.lastYear === "number" ? o.lastYear : null);
        setHistLastShare(typeof o.lastShare === "number" ? o.lastShare : null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setHistErr(msg);
      }
    })();
  }, []);

  // Helpers
  const subsidyOnDate = useCallback((iso: string) => {
    const t = new Date(iso).getTime(); let s = ALL_ERAS[0].subsidy;
    for (let i=0;i<ALL_ERAS.length;i++){ const ts = new Date(ALL_ERAS[i].start).getTime(); if (t>=ts) s = ALL_ERAS[i].subsidy; else break; }
    return s;
  },[]);

  const worldElectricityTWh = useCallback((iso: string | number) => {
    const y = typeof iso === "string" ? new Date(iso).getUTCFullYear() : iso;
    const yearsRel = y - 2024;
    return CONFIG.worldElecBaseTWh2024 * Math.pow(1 + CONFIG.worldElecGrowth, yearsRel);
  },[]);

  const electricityPriceUSDkWh = useCallback((iso: string, p: PresetName) => {
    const years = yearsBetween(CONFIG.baseDateISO, iso);
    const baseUSD = elecBaseUSDkWh * Math.pow(1 + elecDriftPct/100, years);
    return baseUSD * PRESETS[p].elecPriceMultiplier;
  }, [elecBaseUSDkWh, elecDriftPct]);

  const cpiFactor = useCallback((iso: string) => {
    const years = yearsBetween(CONFIG.baseDateISO, iso);
    return Math.pow(1 + cpiPct/100, years);
  }, [cpiPct]);

  // Anchored adoption ramp from last historical share (smooth forward)
  const anchoredAdoption = useCallback((iso: string, p: PresetName) => {
    const y = new Date(iso).getUTCFullYear();
    const util = PRESETS[p].capUtilMultiplier;
    const capShareFraction = (capSharePct/100) * util;

    const baseYear = (histLastYear ?? new Date(CONFIG.baseDateISO).getUTCFullYear());
    const anchorShare = (histLastShare !== null && isFinite(histLastShare)) ? histLastShare : 0.001;
    const a0Raw = capShareFraction > 0 ? (anchorShare / capShareFraction) : 0.01;
    const a0 = Math.max(ADOPTION.floor + 1e-6, Math.min(1 - 1e-6, a0Raw));

    const y0 = baseYear - (1/ADOPTION.steepness) * Math.log(1/a0 - 1); // passes through (baseYear, a0)
    const x = 1 / (1 + Math.exp(-ADOPTION.steepness * (y - y0)));
    return Math.max(ADOPTION.floor, Math.min(1, x));
  }, [capSharePct, histLastYear, histLastShare]);

  const priceFromEnergyCap = useCallback((iso: string, p: PresetName) => {
    const S = subsidyOnDate(iso);
    const S_eff = S * (1 + feesPct/100);
    const worldTWh = worldElectricityTWh(iso);
    const util = PRESETS[p].capUtilMultiplier;

    const y = new Date(iso).getUTCFullYear();
    let share: number;

    if (histByYear && typeof histByYear[y]?.share === "number") {
      share = histByYear[y].share; // measured past
    } else {
      const adopt = anchoredAdoption(iso, p); // future
      share = (capSharePct/100) * util * adopt;
    }

    const btcTWh = worldTWh * share;
    const energyPerBlockWh = (btcTWh * 1e12) / BLOCKS_PER_YEAR;
    const usdPerKWh = electricityPriceUSDkWh(iso, p);
    const costPerBlockUSD = (energyPerBlockWh/1000) * usdPerKWh * overheadPhi;

    const floorPerBTC = costPerBlockUSD / S_eff;
    const fairPerBTC = floorPerBTC * PRESETS[p].markup;
    const fairPerBTCReal = fairPerBTC / cpiFactor(iso);
    return { S, S_eff, fairPerBTC, fairPerBTCReal, floorPerBTC, share };
  }, [feesPct, overheadPhi, capSharePct, histByYear, anchoredAdoption, worldElectricityTWh, electricityPriceUSDkWh, cpiFactor, subsidyOnDate]);

  // Milestones: first halving era where stack >= threshold blocks
  const milestones = useMemo(() => {
    const feeMult = 1 + feesPct/100;
    return THRESHOLDS_BLOCKS.map((t) => {
      let found: { start: string; subsidy: number } | null = null;
      for (let i = 0; i < ALL_ERAS.length; i++) {
        const S_i = ALL_ERAS[i].subsidy;
        const S_eff_i = S_i * feeMult;
        const blocksFromStack = stackBTC / S_eff_i;
        if (blocksFromStack >= t.blocks) { found = ALL_ERAS[i]; break; }
      }
      if (!found) return { label: t.label, time: t.time, date: null as string|null, era: null as number|null, subsidyBTC: null as number|null, blocksAtEra: null as number|null };
      const date = found.start;
      const subsidyBTC = found.subsidy;
      const blocksAtEra = stackBTC / (subsidyBTC * feeMult);
      const eraIndex = ALL_ERAS.findIndex(e => e.start === found!.start);
      return { label: t.label, time: t.time, date, era: eraIndex, subsidyBTC, blocksAtEra };
    });
  }, [stackBTC, feesPct]);

  // Chart series: Genesis -> +25y
  const seriesFull = useMemo(() => {
    const base = new Date(CONFIG.baseDateISO); const baseYear = base.getFullYear();
    const startYear = 2009, endYear = baseYear + 25;
    const mm = String(base.getMonth()+1).padStart(2,"0"), dd = String(base.getDate()).padStart(2,"0");
    const out: { year:number; price:number }[] = [];
    for (let y=startYear; y<=endYear; y++) {
      const iso = `${y}-${mm}-${dd}`;
      const r = priceFromEnergyCap(iso, preset);
      out.push({ year: y, price: (showReal ? r.fairPerBTCReal : r.fairPerBTC) });
    }
    return out;
  }, [preset, showReal, priceFromEnergyCap]);

  const r = useMemo(()=>priceFromEnergyCap(targetISO, preset), [targetISO, preset, priceFromEnergyCap]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8 space-y-6">
      {/* HERO */}
      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          <span className="text-bitcoin">SID</span>: Scarcity • Incentives • Demand
        </h1>
        <p className="text-sm text-fg-muted">
          You’re buying <b>scarce digital real estate</b> the network will fight to win — block by block, year after year.
        </p>
      </header>

      {/* TOP ROW — Your Stack + Scenario */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Your Stack */}
        <div className="card p-4 space-y-4">
          <div className="flex items-center">
            <h3 className="font-semibold">Your Stack — Value</h3>
            <Tooltip title="Your Stack — Value">
              <div>
                <p><b>What:</b> Fair-value estimate of your current BTC stack at the selected date.</p>
                <p className="mt-1"><b>Driven by:</b> energy cost per block, subsidy (+fees), and scenario markup.</p>
                <p className="mt-1"><b>Changing “Your stack”</b> scales this value linearly.</p>
              </div>
            </Tooltip>
          </div>
          <div className="font-extrabold tracking-tight text-bitcoin leading-none text-[clamp(28px,5.5vw,64px)]">
            {formatUSD((showReal ? r.fairPerBTCReal : r.fairPerBTC) * stackBTC)}
          </div>
          <div className="text-xs text-fg-subtle">{stackBTC} BTC • {showReal ? "Real (today’s $)" : "Nominal"} fair value</div>
          <div className="mt-2 text-sm">Per BTC: <span className="font-semibold">{formatUSD(showReal ? r.fairPerBTCReal : r.fairPerBTC)}</span></div>
          <div className="text-xs text-fg-subtle">Floor (per BTC, nominal): {formatUSD(r.floorPerBTC)}</div>
          <div className="mt-2 text-sm">
            On {fmtDate(targetISO)}, your stack equals <span className="font-semibold">{(stackBTC / r.S_eff).toFixed(3)}</span> blocks (≈
            <span className="font-semibold"> {(10 * (stackBTC / r.S_eff)).toFixed(1)} minutes</span> of energy-backed work).
          </div>

          <div className="mt-2">
            <label className="text-sm font-medium">Your stack (BTC)</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input type="number" inputMode="decimal" min={0} step={0.001} value={stackBTC} onChange={(e)=>setStackBTC(Math.max(0, Number(e.target.value)))} className="w-40 border border-border bg-panel rounded px-2 py-1" />
              <div className="flex gap-2 text-xs">
                {[0.001, 0.01, 0.1, 1].map(v=>(
                  <button key={v} onClick={()=>setStackBTC(v)} className="px-2 py-1 rounded-full border border-border bg-panel hover:bg-card">{v} BTC</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Scenario & Date */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center">
            <label className="text-sm font-medium">Scenario</label>
            <Tooltip title="Scenario">
              <div>
                <p><b>What:</b> Utilization of energy cap, electricity pricing multiplier, and markup.</p>
                <p className="mt-1"><b>Bearish→Bullish</b> increases utilization & markup (higher prices).</p>
              </div>
            </Tooltip>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.keys(PRESETS).map((name)=>(
              <button key={name} onClick={()=>setPreset(name as PresetName)} className={`px-3 py-1 rounded-full border text-sm transition ${preset===name?"bg-bitcoin text-black border-transparent shadow":"bg-panel text-fg border border-border hover:bg-card"}`}>{name}</button>
            ))}
          </div>

          <div className="flex items-center">
            <label className="text-sm font-medium">Target date</label>
            <Tooltip title="Target date">
              <div>
                <p><b>What:</b> The date for the model computation.</p>
                <p className="mt-1"><b>Past:</b> Uses measured network share. <b>Future:</b> Smoothly transitions to your cap.</p>
              </div>
            </Tooltip>
          </div>
          <div className="mt-2 space-y-2">
            <input type="range" min={2009} max={2175} value={year} onChange={(e)=>setYear(Number(e.target.value))} className="w-full accent-bitcoin" />
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" min={2009} max={2175} value={year} onChange={(e)=>setYear(Number(e.target.value))} className="w-24 border border-border bg-panel rounded px-2 py-1" />
              <input type="number" min={1} max={12} value={month} onChange={(e)=>setMonth(Number(e.target.value))} className="w-20 border border-border bg-panel rounded px-2 py-1" />
              <input type="number" min={1} max={31} value={day} onChange={(e)=>setDay(Number(e.target.value))} className="w-20 border border-border bg-panel rounded px-2 py-1" />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm">Nominal</span>
            <button onClick={()=>setShowReal(!showReal)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${showReal?"bg-bitcoin":"bg-panel border border-border"}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${showReal?"translate-x-5":"translate-x-1"}`} />
            </button>
            <span className="text-sm">Real (CPI)</span>
            <Tooltip title="Nominal vs Real">
              <div>
                <p><b>Nominal:</b> dollars at the date.</p>
                <p><b>Real:</b> CPI-adjusted back to today’s buying power.</p>
              </div>
            </Tooltip>
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center">
              <label className="text-sm font-medium">Model dials</label>
              <Tooltip title="Model dials">
                <div>
                  <p><b>Cap share:</b> Max share of world electricity BTC can access in steady state.</p>
                  <p><b>φ (overhead):</b> Multiplies energy spend to include non-electric OPEX/CAPEX.</p>
                </div>
              </Tooltip>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-fg-subtle mb-1">Bitcoin energy cap share</div>
                <div className="flex items-center gap-2">
                  <input type="number" value={capSharePct} disabled className="w-28 border border-border bg-panel rounded px-2 py-1 opacity-60" />
                  <span className="text-xs text-fg-subtle">%</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-subtle mb-1">Overhead factor φ</div>
                <input type="number" value={overheadPhi} disabled className="w-28 border border-border bg-panel rounded px-2 py-1 opacity-60" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Milestones */}
      <section className="card p-4 border-2 border-bitcoin/60">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center">
            <h3 className="font-semibold mb-1"><span className="text-bitcoin">Your stack commands the network</span> — milestones in time</h3>
            <Tooltip title="Milestones">
              <div>
                <p><b>What:</b> First halving eras where your current stack equals 1 block, 1 hour, 1 day, etc.</p>
                <p><b>Why:</b> As subsidy halves, the same stack commands more blocks (more time).</p>
              </div>
            </Tooltip>
          </div>
          <span className="pill text-[11px] whitespace-nowrap">⚡ Competition intensifies as hashrate rises</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
          {milestones.map((m) => (
            <div key={m.label} className="rounded-2xl border border-border bg-panel p-3">
              <div className="text-sm font-semibold">{m.label}</div>
              <div className="text-xs text-fg-subtle">{m.time}</div>
              <div className="mt-2 text-sm">{m.date ? <>First reached: <b>{fmtDate(m.date)}</b></> : "Not within ~200 years"}</div>
              {m.date && (<div className="mt-1 text-xs text-fg-subtle">Era: {m.era} • Subsidy ≈ {m.subsidyBTC?.toFixed(6)} BTC/block<br/>Your stack ≈ {m.blocksAtEra?.toFixed(2)} blocks then</div>)}
              {m.date && (<div className="mt-2 text-[11px]"><span className="text-bitcoin font-semibold">Commanded time:</span> ~{m.time}. <span className="opacity-80">Translation:</span> the network would fight ~{m.time} for your stack.</div>)}
            </div>
          ))}
        </div>
      </section>

      {/* Chart */}
      <section className="card p-4 space-y-2">
        <div className="flex items-center">
          <h3 className="font-semibold">1 BTC — Genesis → +25 Years (Model)</h3>
          <Tooltip title="Price chart">
            <div>
              <p><b>Past:</b> Uses measured network share (hashrate × efficiency).</p>
              <p><b>Future:</b> Smoothly transitions to your cap share.</p>
              <p>Toggle Nominal/Real to see CPI-adjusted buying power.</p>
            </div>
          </Tooltip>
        </div>
        {histErr && <div className="text-xs text-red-400">History data error: {histErr}</div>}
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={seriesFull} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#A9B6C2" }} />
              <YAxis tickFormatter={(v:number|string)=>formatShortUSD(typeof v==="number"?v:Number(v))} tick={{ fontSize: 12, fill: "#A9B6C2" }} />
              <RTooltip formatter={(v:number|string)=>formatUSD(typeof v==="number"?v:Number(v))} labelFormatter={(l:number|string)=>`Year ${String(l)}`} contentStyle={{ background:"#0F141A", border:"1px solid #1F2937", color:"#E6EDF3" }} labelStyle={{ color:"#F7931A", fontWeight:700 }} itemStyle={{ color:"#E6EDF3" }} />
              <Legend />
              <Line type="monotone" dataKey="price" name={showReal ? "Per BTC (Real)" : "Per BTC (Nominal)"} stroke="#F7931A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="text-xs text-fg-subtle">Education only; not financial advice.</section>
    </div>
  );
}
