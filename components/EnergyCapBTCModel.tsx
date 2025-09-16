import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend } from "recharts";
import Tooltip from "./Tooltip";

const CONFIG = {
  baseDateISO: "2025-10-01",
  worldElecBaseTWh2024: 30000,
  worldElecGrowth: 0.025,
  liveRefreshSec: 60,
  substackUrl: "https://easingismeming.substack.com/p/introducing-the-sid-model",
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
function fmtTime(iso: string){ return new Date(iso).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}); }

const THRESHOLDS_BLOCKS = [
  { label: "1 block", blocks: 1, time: "10 minutes" },
  { label: "6 blocks", blocks: 6, time: "1 hour" },
  { label: "144 blocks", blocks: 144, time: "1 day" },
  { label: "1,008 blocks", blocks: 1008, time: "1 week" },
  { label: "4,320 blocks", blocks: 4320, time: "1 month (30d)" },
];

const ADOPTION = { steepness: 0.55, floor: 1e-6 } as const;

type HistoryResp = {
  ok: true;
  byYear: Record<number, { share: number; twh: number }>;
  lastYear: number;
  lastShare: number;
  source: string;
};
type HistoryErr = { ok: false; error: string };

export default function EnergyCapBTCModel() {
  // NAV anchor
  const milestonesRef = useRef<HTMLDivElement | null>(null);

  // Primary controls
  const [preset, setPreset] = useState<PresetName>("Base");
  const [year, setYear] = useState(2050);
  const [month, setMonth] = useState(10);
  const [day, setDay] = useState(13);
  const [stackBTC, setStackBTC] = useState(0.01);
  const [showReal, setShowReal] = useState(false);

  // Model dials
  const [capSharePct, setCapSharePct] = useState(1.5);
  const [feesPct, setFeesPct] = useState(15);
  const [elecBaseUSDkWh, setElecBaseUSDkWh] = useState(0.06);
  const [elecDriftPct, setElecDriftPct] = useState(1.0);
  const [cpiPct, setCpiPct] = useState(2.5);
  const [overheadPhi, setOverheadPhi] = useState(1.15);

  // Historical share (from /api/history)
  const [histByYear, setHistByYear] = useState<Record<number, { share:number; twh:number }> | null>(null);
  const [histLastYear, setHistLastYear] = useState<number | null>(null);
  const [histLastShare, setHistLastShare] = useState<number | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);

  // Live CPI
  const [useLiveCpi, setUseLiveCpi] = useState(true);
  const [cpiYoYLatest, setCpiYoYLatest] = useState<number | null>(null);
  const [cpiLatestDate, setCpiLatestDate] = useState<string | null>(null);
  const [cpiSyncing, setCpiSyncing] = useState(false);
  const [cpiError, setCpiError] = useState<string | null>(null);

  // Live Hashrate
  const [hashSyncing, setHashSyncing] = useState(false);
  const [hashErr, setHashErr] = useState<string | null>(null);
  const [hashEhs, setHashEhs] = useState<number | null>(null);
  const [hashDiffT, setHashDiffT] = useState<number | null>(null);
  const [hashSource, setHashSource] = useState<string | null>(null);
  const [hashAsOf, setHashAsOf] = useState<string | null>(null);

  // Live Difficulty
  const [diffSyncing, setDiffSyncing] = useState(false);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [diffDifficultyRaw, setDiffDifficultyRaw] = useState<number | null>(null);
  const [diffDifficultyT, setDiffDifficultyT] = useState<number | null>(null);
  const [diffChangePct, setDiffChangePct] = useState<number | null>(null);
  const [diffBlocksRem, setDiffBlocksRem] = useState<number | null>(null);
  const [diffBlocksInto, setDiffBlocksInto] = useState<number | null>(null);
  const [diffProgressPct, setDiffProgressPct] = useState<number | null>(null);
  const [diffNextHeight, setDiffNextHeight] = useState<number | null>(null);
  const [diffETAISO, setDiffETAISO] = useState<string | null>(null);

  // Live Fee share
  const [feeSyncing, setFeeSyncing] = useState(false);
  const [feeErr, setFeeErr] = useState<string | null>(null);
  const [feeSharePctLive, setFeeSharePctLive] = useState<number | null>(null);
  const [feeSample, setFeeSample] = useState<number | null>(null);
  const [feeAsOf, setFeeAsOf] = useState<string | null>(null);

  // Live Electricity (EIA)
  const [elecSyncing, setElecSyncing] = useState(false);
  const [elecErr, setElecErr] = useState<string | null>(null);
  const [elecLatestUSD, setElecLatestUSD] = useState<number | null>(null);
  const [elecLatestPeriod, setElecLatestPeriod] = useState<string | null>(null);
  const [elecYoYPct, setElecYoYPct] = useState<number | null>(null);
  const [elecCAGR5, setElecCAGR5] = useState<number | null>(null);
  const [elecCAGR10, setElecCAGR10] = useState<number | null>(null);
  const [elecDriftChoice, setElecDriftChoice] = useState<"YoY"|"5y"|"10y">("10y");

  const targetISO = useMemo(() => {
    const mm = String(month).padStart(2,"0"); const dd = String(day).padStart(2,"0");
    return `${year}-${mm}-${dd}`;
  }, [year, month, day]);

  // ---- Live fetchers ----
  async function syncCpi() {
    try {
      setCpiSyncing(true); setCpiError(null);
      const r = await fetch("/api/cpi"); const js: unknown = await r.json();
      const d = js as { ok?: boolean; yoyPct?: number; latest?: { dateISO?: string }; error?: string };
      if (!d?.ok) throw new Error(d?.error || "CPI API error");
      const yoy = typeof d.yoyPct === "number" ? d.yoyPct : null;
      const dt = d.latest?.dateISO || null;
      setCpiYoYLatest(yoy); setCpiLatestDate(dt);
      if (useLiveCpi && yoy !== null) setCpiPct(Number(yoy.toFixed(2)));
    } catch (e: unknown) {
      setCpiError(e instanceof Error ? e.message : String(e));
    } finally { setCpiSyncing(false); }
  }
  async function syncHashrate() {
    try {
      setHashSyncing(true); setHashErr(null);
      const r = await fetch("/api/hashrate"); const js: unknown = await r.json();
      const d = js as { ok?: boolean; hashrate_ehs?: number; difficulty_trillions?: number; source?: string; asOfISO?: string; error?: string };
      if (!d?.ok) throw new Error(d?.error || "Hashrate API error");
      setHashEhs(typeof d.hashrate_ehs === "number" ? d.hashrate_ehs : null);
      setHashDiffT(typeof d.difficulty_trillions === "number" ? d.difficulty_trillions : null);
      setHashSource(d.source || null);
      setHashAsOf(d.asOfISO || null);
    } catch (e: unknown) { setHashErr(e instanceof Error ? e.message : String(e)); }
    finally { setHashSyncing(false); }
  }
  async function syncDifficulty() {
    try {
      setDiffSyncing(true); setDiffErr(null);
      const r = await fetch("/api/difficulty"); const js: unknown = await r.json();
      const d = js as {
        ok?: boolean; difficulty?: number; difficulty_trillions?: number; estChangePct?: number;
        epoch?: { blocksRemaining?: number; blocksIntoEpoch?: number; progressPct?: number; nextRetargetHeight?: number; estRetargetDateISO?: string };
        error?: string;
      };
      if (!d?.ok) throw new Error(d?.error || "Difficulty API error");
      const diffT = (typeof d.difficulty_trillions === "number" && isFinite(d.difficulty_trillions))
        ? d.difficulty_trillions
        : (typeof d.difficulty === "number" ? d.difficulty / 1e12 : null);
      setDiffDifficultyRaw(typeof d.difficulty === "number" ? d.difficulty : null);
      setDiffDifficultyT(diffT);
      setDiffChangePct(typeof d.estChangePct === "number" ? d.estChangePct : null);
      const e = d.epoch || {};
      setDiffBlocksRem(typeof e.blocksRemaining === "number" ? e.blocksRemaining : null);
      setDiffBlocksInto(typeof e.blocksIntoEpoch === "number" ? e.blocksIntoEpoch : null);
      setDiffProgressPct(typeof e.progressPct === "number" ? e.progressPct : null);
      setDiffNextHeight(typeof e.nextRetargetHeight === "number" ? e.nextRetargetHeight : null);
      setDiffETAISO(typeof e.estRetargetDateISO === "string" ? e.estRetargetDateISO : null);
    } catch (e: unknown) { setDiffErr(e instanceof Error ? e.message : String(e)); }
    finally { setDiffSyncing(false); }
  }
  async function syncFees(n = 40) {
    try {
      setFeeSyncing(true); setFeeErr(null);
      const r = await fetch(`/api/fees?n=${n}`); const js: unknown = await r.json();
      const d = js as { ok?: boolean; feeSharePct?: number; sampleBlocks?: number; asOfISO?: string; error?: string };
      if (!d?.ok) throw new Error(d?.error || "Fees API error");
      setFeeSharePctLive(typeof d.feeSharePct === "number" ? d.feeSharePct : null);
      setFeeSample(typeof d.sampleBlocks === "number" ? d.sampleBlocks : null);
      setFeeAsOf(d.asOfISO || null);
    } catch (e: unknown) { setFeeErr(e instanceof Error ? e.message : String(e)); }
    finally { setFeeSyncing(false); }
  }
  async function syncElectricity() {
    try {
      setElecSyncing(true); setElecErr(null);
      const r = await fetch("/api/electricity"); const js: unknown = await r.json();
      const d = js as {
        ok?: boolean;
        latest?: { price_usd_per_kwh?: number; period?: string };
        yoyPct?: number; cagr5Pct?: number; cagr10Pct?: number;
        error?: string;
      };
      if (!d?.ok) throw new Error(d?.error || "Electricity API error");
      const usd = d.latest?.price_usd_per_kwh;
      setElecLatestUSD(typeof usd === "number" ? usd : null);
      setElecLatestPeriod(d.latest?.period || null);
      setElecYoYPct(typeof d.yoyPct === "number" ? d.yoyPct : null);
      setElecCAGR5(typeof d.cagr5Pct === "number" ? d.cagr5Pct : null);
      setElecCAGR10(typeof d.cagr10Pct === "number" ? d.cagr10Pct : null);
    } catch (e: unknown) { setElecErr(e instanceof Error ? e.message : String(e)); }
    finally { setElecSyncing(false); }
  }

  // Fetch on mount, then refresh live cards every 60s
  useEffect(() => {
    (async () => {
      try {
        setHistErr(null);
        const r = await fetch("/api/history", { cache: "no-store" });
        const js: unknown = await r.json();
        const d = js as HistoryResp | HistoryErr;
        if (!("ok" in d) || !d.ok) throw new Error((d as HistoryErr).error || "history API error");
        setHistByYear(d.byYear);
        setHistLastYear(d.lastYear);
        setHistLastShare(d.lastShare);
      } catch (e: unknown) {
        setHistErr(e instanceof Error ? e.message : String(e));
      }
    })();

    const doAll = () => {
      syncCpi();
      syncHashrate();
      syncDifficulty();
      syncFees(40);
      syncElectricity();
    };
    doAll();
    const id = setInterval(doAll, CONFIG.liveRefreshSec * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* TOP NAV */}
      <nav className="flex items-center justify-between py-1">
        <div className="text-sm">
          <a href="#milestones" className="underline decoration-bitcoin/70 underline-offset-4 hover:text-bitcoin">
            Jump to milestones
          </a>
        </div>
        <a href={CONFIG.substackUrl} target="_blank" rel="noreferrer" className="text-sm pill hover:opacity-90">
          Model explainer (Substack)
        </a>
      </nav>

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
                <p className="mt-1"><b>Past:</b> Measured network share. <b>Future:</b> Smooth transition to your cap.</p>
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
                  <input type="number" min={0} max={100} step={0.1} value={capSharePct} onChange={(e)=>setCapSharePct(Math.max(0, Number(e.target.value)))} className="w-28 border border-border bg-panel rounded px-2 py-1" />
                  <span className="text-xs text-fg-subtle">%</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-subtle mb-1">Overhead factor φ</div>
                <input type="number" min={1} step={0.01} value={overheadPhi} onChange={(e)=>setOverheadPhi(Math.max(1, Number(e.target.value)))} className="w-28 border border-border bg-panel rounded px-2 py-1" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 🔥 MILESTONES — make it the hero section */}
      <section id="milestones" ref={milestonesRef} className="relative p-4 rounded-2xl border-2 border-bitcoin/80 bg-gradient-to-b from-[#120A00] via-[#0F141A] to-[#0F141A] shadow-[0_0_0_4px_rgba(247,147,26,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center">
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              <span className="text-bitcoin">Your stack commands the network</span> — milestones in time
            </h2>
            <Tooltip title="Milestones">
              <div>
                <p><b>What:</b> First halving eras where your current stack equals 1 block, 1 hour, 1 day, etc.</p>
                <p><b>Why:</b> As subsidy halves, the same stack commands more blocks (more time).</p>
              </div>
            </Tooltip>
          </div>
          <button
            onClick={()=>milestonesRef.current?.scrollIntoView({ behavior:"smooth", block:"start" })}
            className="pill text-[12px] bg-bitcoin text-black hover:opacity-90 whitespace-nowrap"
            title="Focus this section"
          >
            Focus milestones
          </button>
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

      {/* SECOND ROW — Live inputs */}
      <section className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Difficulty */}
        <div className="card p-4 space-y-2 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <h3 className="font-semibold">Difficulty retarget (live)</h3>
              <Tooltip title="Difficulty retarget">
                <div>
                  <p><b>What:</b> Current difficulty and next retarget estimate.</p>
                  <p><b>Why:</b> Reflects network competitiveness. Debug via the JSON link if needed.</p>
                </div>
              </Tooltip>
            </div>
            <div className="flex gap-2">
              <a className="text-xs underline text-fg-subtle hover:text-bitcoin" href="/api/difficulty" target="_blank" rel="noreferrer">Open raw JSON</a>
              <button onClick={syncDifficulty} disabled={diffSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
                {diffSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
          {diffErr ? (
            <div className="text-xs text-red-400">Error: {diffErr}</div>
          ) : (
            <>
              <div className="text-sm">Current difficulty: <span className="font-semibold">{diffDifficultyT !== null ? `${diffDifficultyT.toFixed(2)} T` : "—"}</span></div>
              <div className="text-xs text-fg-subtle">{diffDifficultyRaw !== null ? `raw: ${diffDifficultyRaw.toExponential(2)}` : ""}</div>
              <div className="text-sm">Est. change next retarget: <span className="font-semibold">{diffChangePct !== null ? `${diffChangePct > 0 ? "+" : ""}${diffChangePct.toFixed(2)}%` : "—"}</span></div>
              <div className="text-xs text-fg-subtle">Epoch progress: {diffProgressPct !== null ? `${diffProgressPct.toFixed(1)}%` : "—"} • Blocks into: {diffBlocksInto ?? "—"} • Remaining: {diffBlocksRem ?? "—"}</div>
              <div className="text-xs text-fg-subtle">Next retarget height: {diffNextHeight ?? "—"}</div>
              <div className="text-[11px] text-fg-subtle mt-1">Retarget ETA: {diffETAISO ? `${fmtDate(diffETAISO)} ${fmtTime(diffETAISO)}` : "—"}</div>
              <div className="w-full h-2 bg-panel rounded-full border border-border overflow-hidden mt-1">
                <div className="h-2 bg-bitcoin" style={{ width: `${Math.max(0, Math.min(100, diffProgressPct ?? 0))}%` }} />
              </div>
            </>
          )}
        </div>

        {/* Fee share */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <h3 className="font-semibold">Fee share (live)</h3>
              <Tooltip title="Fee share">
                <div>
                  <p><b>What:</b> Fees / (fees + subsidy) across recent blocks.</p>
                  <p><b>Tip:</b> If you see 0.0, open the JSON to confirm API output.</p>
                </div>
              </Tooltip>
            </div>
            <div className="flex gap-2">
              <a className="text-xs underline text-fg-subtle hover:text-bitcoin" href="/api/fees?n=40" target="_blank" rel="noreferrer">Open raw JSON</a>
              <button onClick={() => syncFees(40)} disabled={feeSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
                {feeSyncing ? "Syncing…" : "Sync now"}
              </button>
              <button onClick={() => { if (feeSharePctLive !== null) setFeesPct(Number(feeSharePctLive.toFixed(1))); }} disabled={feeSharePctLive === null} className="px-3 py-1 rounded-full border text-sm transition disabled:opacity-60 bg-bitcoin text-black border-transparent" title="Set model Fees % to this live value">
                Use
              </button>
            </div>
          </div>
          {feeErr ? (
            <div className="text-xs text-red-400">Error: {feeErr}</div>
          ) : (
            <>
              <div className="text-2xl font-extrabold tracking-tight">{feeSharePctLive !== null ? `${feeSharePctLive.toFixed(1)}%` : "—"}</div>
              <div className="text-xs text-fg-subtle">Sample: {feeSample ?? "—"} blocks {feeAsOf ? `• ${fmtDate(feeAsOf)} ${fmtTime(feeAsOf)}` : ""}</div>
            </>
          )}
        </div>

        {/* Network heat */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <h3 className="font-semibold">Network heat (live)</h3>
              <Tooltip title="Network heat">
                <div>
                  <p><b>What:</b> Hashrate & difficulty proxy.</p>
                  <p><b>Debug:</b> Use the JSON link if values are blank.</p>
                </div>
              </Tooltip>
            </div>
            <div className="flex gap-2">
              <a className="text-xs underline text-fg-subtle hover:text-bitcoin" href="/api/hashrate" target="_blank" rel="noreferrer">Open raw JSON</a>
              <button onClick={syncHashrate} disabled={hashSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
                {hashSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
          {hashErr ? (
            <div className="text-xs text-red-400">Error: {hashErr}</div>
          ) : (
            <>
              <div className="text-sm">Hashrate: <span className="font-semibold">{hashEhs !== null ? `${hashEhs.toFixed(1)} EH/s` : "—"}</span></div>
              <div className="text-xs text-fg-subtle">Difficulty proxy: {hashDiffT !== null ? `${hashDiffT.toFixed(2)} T` : "—"}</div>
              <div className="text-[11px] text-fg-subtle">{hashSource ? `Source: ${hashSource}` : ""} {hashAsOf ? `• ${fmtDate(hashAsOf)} ${fmtTime(hashAsOf)}` : ""}</div>
              <div className="pill text-[11px] w-fit mt-1">⚡ Higher hashrate ⇒ fiercer competition</div>
            </>
          )}
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

      {/* FOOTER with Substack */}
      <footer className="pt-2">
        <a href={CONFIG.substackUrl} target="_blank" rel="noreferrer" className="text-xs underline text-fg-subtle hover:text-bitcoin">
          Read the SID model explainer on Substack
        </a>
        <div className="text-xs text-fg-subtle mt-2">Education only; not financial advice.</div>
      </footer>
    </div>
  );
}
