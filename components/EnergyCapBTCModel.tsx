import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

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
function generateFutureEras(startISO: string, startSubsidy: number, count: number) {
  const out: { start: string; subsidy: number }[] = [];
  let d = new Date(startISO);
  let s = startSubsidy;
  for (let i = 0; i < count; i++) {
    const nd = new Date(d);
    nd.setFullYear(nd.getFullYear() + 4);
    s = s / 2;
    out.push({ start: nd.toISOString().slice(0, 10), subsidy: s });
    d = nd;
  }
  return out;
}
const FUTURE_ERAS = generateFutureEras("2024-04-20", 3.125, 24);
const ALL_ERAS = [...KNOWN_ERAS, ...FUTURE_ERAS];

const PRESETS = {
  Bearish: { capUtilMultiplier: 0.7,   elecPriceMultiplier: 0.844, markup: 1.2 },
  Base:    { capUtilMultiplier: 1.0,   elecPriceMultiplier: 1.0,   markup: 1.5 },
  Bullish: { capUtilMultiplier: 1.0,   elecPriceMultiplier: 1.169, markup: 2.0 },
} as const;
type PresetName = keyof typeof PRESETS;

const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;
const BLOCKS_PER_YEAR = (365.2425 * 24 * 3600) / 600;

function yearsBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  return (b - a) / MS_PER_YEAR;
}
function formatUSD(x: number) {
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function formatShortUSD(x: number) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(x); }
  catch { return `$${Math.round(x).toLocaleString()}`; }
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const THRESHOLDS_BLOCKS = [
  { label: "1 block",     blocks: 1,    time: "10 minutes" },
  { label: "6 blocks",    blocks: 6,    time: "1 hour" },
  { label: "144 blocks",  blocks: 144,  time: "1 day" },
  { label: "1,008 blocks",blocks: 1008, time: "1 week" },
  { label: "4,320 blocks",blocks: 4320, time: "1 month (30d)" },
];

export default function EnergyCapBTCModel() {
  // Scenario/date/stack
  const [preset, setPreset] = useState<PresetName>("Base");
  const [year, setYear] = useState(2050);
  const [month, setMonth] = useState(10);
  const [day, setDay] = useState(13);
  const [stackBTC, setStackBTC] = useState(0.01);

  // Inputs
  const [capSharePct, setCapSharePct] = useState(1.5);
  const [feesPct, setFeesPct] = useState(15);
  const [elecBaseUSDkWh, setElecBaseUSDkWh] = useState(0.06);
  const [elecDriftPct, setElecDriftPct] = useState(1.0);
  const [cpiPct, setCpiPct] = useState(2.5);
  const [overheadPhi, setOverheadPhi] = useState(1.15);

  // Live CPI
  const [useLiveCpi, setUseLiveCpi] = useState(true);
  const [cpiYoYLatest, setCpiYoYLatest] = useState<number | null>(null);
  const [cpiLatestDate, setCpiLatestDate] = useState<string | null>(null);
  const [cpiSyncing, setCpiSyncing] = useState(false);
  const [cpiError, setCpiError] = useState<string | null>(null);

  // Live Hashrate (still used in Network heat)
  const [hashSyncing, setHashSyncing] = useState(false);
  const [hashErr, setHashErr] = useState<string | null>(null);
  const [hashEhs, setHashEhs] = useState<number | null>(null);
  const [hashDiffT, setHashDiffT] = useState<number | null>(null);
  const [hashSource, setHashSource] = useState<string | null>(null);
  const [hashAsOf, setHashAsOf] = useState<string | null>(null);

  // Live Difficulty / Retarget
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

  // Nominal vs Real
  const [showReal, setShowReal] = useState(false);

  const targetISO = useMemo(() => {
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }, [year, month, day]);

  // --- Live CPI fetcher ---
  async function syncCpi() {
    try {
      setCpiSyncing(true); setCpiError(null);
      const res = await fetch("/api/cpi"); const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "CPI API error");
      const yoy = typeof data.yoyPct === "number" ? data.yoyPct : null;
      const dt = data.latest?.dateISO || null;
      setCpiYoYLatest(yoy); setCpiLatestDate(dt);
      if (useLiveCpi && yoy !== null) setCpiPct(Number(yoy.toFixed(2)));
    } catch (e: any) { setCpiError(String(e?.message || e)); }
    finally { setCpiSyncing(false); }
  }

  // --- Live Hashrate fetcher ---
  async function syncHashrate() {
    try {
      setHashSyncing(true); setHashErr(null);
      const res = await fetch("/api/hashrate"); const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Hashrate API error");
      setHashEhs(Number(data.hashrate_ehs));
      setHashDiffT(Number((Number(data.difficulty) / 1e12) || data.difficulty_trillions || 0));
      setHashSource(String(data.source || "unknown"));
      setHashAsOf(String(data.asOfISO || ""));
    } catch (e: any) { setHashErr(String(e?.message || e)); }
    finally { setHashSyncing(false); }
  }

  // --- Live Difficulty/Retarget fetcher ---
  async function syncDifficulty() {
    try {
      setDiffSyncing(true); setDiffErr(null);
      const res = await fetch("/api/difficulty"); const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Difficulty API error");

      // Prefer explicit trillions if provided
      const diffT = (typeof data?.difficulty_trillions === "number" && isFinite(data.difficulty_trillions))
        ? Number(data.difficulty_trillions)
        : (typeof data?.difficulty === "number" && isFinite(data.difficulty))
          ? Number(data.difficulty) / 1e12
          : null;

      setDiffDifficultyRaw(typeof data?.difficulty === "number" ? Number(data.difficulty) : null);
      setDiffDifficultyT(diffT);

      const ch = typeof data?.estChangePct === "number" ? Number(data.estChangePct) : null;
      const br = Number(data?.epoch?.blocksRemaining);
      const bi = Number(data?.epoch?.blocksIntoEpoch);
      const pp = Number(data?.epoch?.progressPct);
      const nh = Number(data?.epoch?.nextRetargetHeight);
      const eta = String(data?.epoch?.estRetargetDateISO || "");

      setDiffChangePct(Number.isFinite(ch as number) ? ch : null);
      setDiffBlocksRem(Number.isFinite(br) ? br : null);
      setDiffBlocksInto(Number.isFinite(bi) ? bi : null);
      setDiffProgressPct(Number.isFinite(pp) ? pp : null);
      setDiffNextHeight(Number.isFinite(nh) ? nh : null);
      setDiffETAISO(eta || null);
    } catch (e: any) { setDiffErr(String(e?.message || e)); }
    finally { setDiffSyncing(false); }
  }

  // --- Live Fee share fetcher ---
  async function syncFees(n = 40) {
    try {
      setFeeSyncing(true); setFeeErr(null);
      const res = await fetch(`/api/fees?n=${n}`); const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Fees API error");
      setFeeSharePctLive(Number(data.feeSharePct));
      setFeeSample(Number(data.sampleBlocks));
      setFeeAsOf(String(data.asOfISO || ""));
    } catch (e: any) { setFeeErr(String(e?.message || e)); }
    finally { setFeeSyncing(false); }
  }

  // --- Live Electricity fetcher ---
  async function syncElectricity() {
    try {
      setElecSyncing(true); setElecErr(null);
      const res = await fetch("/api/electricity"); const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Electricity API error");
      const usd = Number(data?.latest?.price_usd_per_kwh);
      setElecLatestUSD(Number.isFinite(usd) ? usd : null);
      setElecLatestPeriod(String(data?.latest?.period || ""));
      setElecYoYPct(typeof data?.yoyPct === "number" ? Number(data.yoyPct) : null);
      setElecCAGR5(typeof data?.cagr5Pct === "number" ? Number(data.cagr5Pct) : null);
      setElecCAGR10(typeof data?.cagr10Pct === "number" ? Number(data.cagr10Pct) : null);
      if (typeof data?.suggestedDriftPct === "number" && (elecDriftPct === 1.0 || elecDriftPct === 0)) {
        setElecDriftPct(Number(data.suggestedDriftPct.toFixed(2)));
      }
    } catch (e: any) { setElecErr(String(e?.message || e)); }
    finally { setElecSyncing(false); }
  }

  useEffect(() => {
    syncCpi();
    syncHashrate();
    syncDifficulty();
    syncFees(40);
    syncElectricity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Model math ---
  function subsidyOnDate(iso: string) {
    const t = new Date(iso).getTime();
    let current = ALL_ERAS[0].subsidy;
    for (let i = 0; i < ALL_ERAS.length; i++) {
      const eraStart = new Date(ALL_ERAS[i].start).getTime();
      if (t >= eraStart) current = ALL_ERAS[i].subsidy; else break;
    }
    return current;
  }
  function worldElectricityTWh(iso: string) {
    const yearsRel = new Date(iso).getUTCFullYear() - 2024;
    return CONFIG.worldElecBaseTWh2024 * Math.pow(1 + CONFIG.worldElecGrowth, yearsRel);
  }
  function electricityPriceUSDkWh(iso: string, p: PresetName) {
    const years = yearsBetween(CONFIG.baseDateISO, iso);
    const baseUSD = elecBaseUSDkWh * Math.pow(1 + elecDriftPct/100, years);
    return baseUSD * PRESETS[p].elecPriceMultiplier;
  }
  function cpiFactor(iso: string) {
    const years = yearsBetween(CONFIG.baseDateISO, iso);
    return Math.pow(1 + cpiPct/100, years);
  }
  function worldTwhToBtcTwh(worldTWh: number, capSharePct_: number, util: number) {
    return worldTWh * (capSharePct_/100) * util;
  }

  const priceFromEnergyCap = (iso: string, p: PresetName) => {
    const S = subsidyOnDate(iso);
    const S_eff = S * (1 + feesPct/100);
    const worldTWh = worldElectricityTWh(iso);
    const btcTWh = worldTwhToBtcTwh(worldTWh, capSharePct, PRESETS[p].capUtilMultiplier);
    const energyPerBlockWh = (btcTWh * 1e12) / BLOCKS_PER_YEAR;
    const usdPerKWh = electricityPriceUSDkWh(iso, p);
    const costPerBlockUSD = (energyPerBlockWh/1000) * usdPerKWh * overheadPhi;
    const floorPerBTC = costPerBlockUSD / S_eff;
    const fairPerBTC = floorPerBTC * PRESETS[p].markup;
    const cpi = cpiFactor(iso);
    const fairPerBTCReal = fairPerBTC / cpi;
    return { S, S_eff, floorPerBTC, fairPerBTC, fairPerBTCReal };
  };

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
      if (!found) return { label: t.label, time: t.time, date: null, era: null, subsidyBTC: null, blocksAtEra: null };
      const date = found.start;
      const subsidyBTC = found.subsidy;
      const blocksAtEra = stackBTC / (subsidyBTC * feeMult);
      const eraIndex = ALL_ERAS.findIndex(e => e.start === found!.start);
      return { label: t.label, time: t.time, date, era: eraIndex, subsidyBTC, blocksAtEra };
    });
  }, [stackBTC, feesPct]);

  const seriesFull = useMemo(() => {
    const base = new Date(CONFIG.baseDateISO);
    const baseYear = base.getFullYear();
    const startYear = 2009;
    const endYear = baseYear + 25;
    const mm = String(base.getMonth() + 1).padStart(2, "0");
    const dd = String(base.getDate()).padStart(2, "0");
    const out: { year: number; price: number }[] = [];
    for (let y = startYear; y <= endYear; y++) {
      const iso = `${y}-${mm}-${dd}`;
      const r = priceFromEnergyCap(iso, preset);
      out.push({ year: y, price: (showReal ? r.fairPerBTCReal : r.fairPerBTC) });
    }
    return out;
  }, [preset, showReal, capSharePct, feesPct, elecBaseUSDkWh, elecDriftPct, cpiPct, overheadPhi]);

  const r = useMemo(() => priceFromEnergyCap(targetISO, preset),
    [targetISO, preset, capSharePct, feesPct, elecBaseUSDkWh, elecDriftPct, cpiPct, overheadPhi]
  );

  function resetToDefaults(){
    setPreset("Base"); setCapSharePct(1.5); setFeesPct(15); setElecBaseUSDkWh(0.06);
    setElecDriftPct(1.0); setCpiPct(2.5); setOverheadPhi(1.15); setStackBTC(0.01);
    setYear(2050); setMonth(10); setDay(13); setShowReal(false); setUseLiveCpi(true);
    setCpiYoYLatest(null); setCpiLatestDate(null); setCpiError(null);
    setHashEhs(null); setHashDiffT(null); setHashSource(null); setHashAsOf(null); setHashErr(null);
    setDiffDifficultyRaw(null); setDiffDifficultyT(null); setDiffChangePct(null);
    setDiffBlocksRem(null); setDiffBlocksInto(null); setDiffProgressPct(null); setDiffNextHeight(null); setDiffETAISO(null); setDiffErr(null);
    setFeeSharePctLive(null); setFeeSample(null); setFeeAsOf(null); setFeeErr(null);
    setElecLatestUSD(null); setElecLatestPeriod(null); setElecYoYPct(null); setElecCAGR5(null); setElecCAGR10(null); setElecErr(null);
  }

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
        {/* Your Stack — VALUE + INPUT */}
        <div className="card p-4 space-y-4">
          <div>
            <h3 className="font-semibold">Your Stack — Value</h3>
            <div className="font-extrabold tracking-tight text-bitcoin leading-none text-[clamp(28px,5.5vw,64px)]">
              {formatUSD((showReal ? r.fairPerBTCReal : r.fairPerBTC) * stackBTC)}
            </div>
            <div className="text-xs text-fg-subtle">{stackBTC} BTC • {showReal ? "Real (today’s $)" : "Nominal"} fair value</div>
            <div className="mt-2 text-sm">Per BTC: <span className="font-semibold">{formatUSD(showReal ? r.fairPerBTCReal : r.fairPerBTC)}</span></div>
            <div className="text-xs text-fg-subtle">Floor (per BTC, nominal): {formatUSD(r.floorPerBTC)}</div>
            <div className="mt-2 text-sm">
              On {fmtDate(targetISO)}, your stack equals <span className="font-semibold">{(stackBTC / r.S_eff).toFixed(3)}</span> blocks (≈
              <span className="font-semibold"> {(10 * (stackBTC / r.S_eff)).toFixed(1)} minutes</span> of energy-backed work at that date).
            </div>
          </div>

          {/* Stack input */}
          <div className="mt-2">
            <label className="text-sm font-medium">Your stack (BTC)</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.001}
                value={stackBTC}
                onChange={(e)=>setStackBTC(Math.max(0, Number(e.target.value)))}
                className="w-40 border border-border bg-panel rounded px-2 py-1"
              />
              <div className="flex gap-2 text-xs">
                {[0.001, 0.01, 0.1, 1].map(v => (
                  <button
                    key={v}
                    onClick={()=>setStackBTC(v)}
                    className="px-2 py-1 rounded-full border border-border bg-panel hover:bg-card"
                  >
                    {v} BTC
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Scenario & Date — stays on top */}
        <div className="card p-4 space-y-3">
          <div>
            <label className="text-sm font-medium">Scenario</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.keys(PRESETS).map((name) => (
                <button
                  key={name}
                  onClick={() => setPreset(name as PresetName)}
                  className={`px-3 py-1 rounded-full border text-sm transition ${preset === name ? "bg-bitcoin text-black border-transparent shadow" : "bg-panel text-fg border border-border hover:bg-card"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Target date</label>
            <div className="mt-2 space-y-2">
              <input type="range" min={2009} max={2175} value={year} onChange={(e)=>setYear(Number(e.target.value))} className="w-full accent-bitcoin" />
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={2009} max={2175} value={year} onChange={(e)=>setYear(Number(e.target.value))} className="w-24 border border-border bg-panel rounded px-2 py-1" />
                <input type="number" min={1} max={12} value={month} onChange={(e)=>setMonth(Number(e.target.value))} className="w-20 border border-border bg-panel rounded px-2 py-1" />
                <input type="number" min={1} max={31} value={day} onChange={(e)=>setDay(Number(e.target.value))} className="w-20 border border-border bg-panel rounded px-2 py-1" />
              </div>
            </div>
          </div>

          {/* Nominal / Real */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm">Nominal</span>
            <button onClick={()=>setShowReal(!showReal)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${showReal?"bg-bitcoin":"bg-panel border border-border"}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${showReal?"translate-x-5":"translate-x-1"}`} />
            </button>
            <span className="text-sm">Real (CPI)</span>
          </div>

          {/* Live CPI controls */}
          <div className="mt-3 border-t border-border pt-3">
            <label className="text-sm font-medium">Inflation (CPI, BLS SA)</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={() => setUseLiveCpi(!useLiveCpi)} className={`px-3 py-1 rounded-full border text-sm transition ${useLiveCpi ? "bg-bitcoin text-black border-transparent shadow" : "bg-panel text-fg border border-border hover:bg-card"}`}>
                {useLiveCpi ? "Using Live YoY" : "Manual %"}
              </button>
              <button onClick={syncCpi} disabled={cpiSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
                {cpiSyncing ? "Syncing…" : "Sync now"}
              </button>
              {cpiYoYLatest !== null && (<span className="text-xs text-fg-subtle">Latest YoY: <b>{cpiYoYLatest.toFixed(2)}%</b>{cpiLatestDate ? ` (${fmtDate(cpiLatestDate)})` : ""}</span>)}
              {cpiError && <span className="text-xs text-red-400">Error: {cpiError}</span>}
            </div>
            <div className="mt-2">
              <div className="text-xs text-fg-subtle mb-1">Projection rate used by the model</div>
              <input type="number" step={0.1} value={cpiPct} onChange={(e)=>setCpiPct(Number(e.target.value))} disabled={useLiveCpi} className="w-32 border border-border bg-panel rounded px-2 py-1 disabled:opacity-60" />
              <span className="ml-2 text-xs text-fg-subtle">%</span>
            </div>
          </div>
        </div>
      </section>

      {/* SECOND ROW — Difficulty (wider), Fees, Electricity, Network heat */}
      <section className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Difficulty — span 2 cols for room */}
        <div className="card p-4 space-y-2 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Difficulty retarget (live)</h3>
            <button onClick={syncDifficulty} disabled={diffSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
              {diffSyncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {diffErr ? (
            <div className="text-xs text-red-400">Error: {diffErr}</div>
          ) : (
            <>
              <div className="text-sm">
                Current difficulty:{" "}
                <span className="font-semibold">
                  {diffDifficultyT !== null ? `${diffDifficultyT.toFixed(2)} T` : "—"}
                </span>
              </div>
              <div className="text-xs text-fg-subtle">
                {diffDifficultyRaw !== null ? `raw: ${diffDifficultyRaw.toExponential(2)}` : ""}
              </div>
              <div className="text-sm">Est. change next retarget: <span className="font-semibold">{diffChangePct !== null ? `${diffChangePct > 0 ? "+" : ""}${diffChangePct.toFixed(2)}%` : "—"}</span></div>
              <div className="text-xs text-fg-subtle">Next retarget height: {diffNextHeight ?? "—"}</div>
              <div className="mt-2">
                <div className="text-xs text-fg-subtle">Epoch progress: {diffProgressPct !== null ? `${diffProgressPct.toFixed(1)}%` : "—"} • Blocks remaining: {diffBlocksRem ?? "—"}</div>
                <div className="w-full h-2 bg-panel rounded-full border border-border overflow-hidden mt-1">
                  <div className="h-2 bg-bitcoin" style={{ width: `${Math.max(0, Math.min(100, diffProgressPct ?? 0))}%` }} />
                </div>
                <div className="text-[11px] text-fg-subtle mt-1">Retarget ETA: {diffETAISO ? `${fmtDate(diffETAISO)} ${fmtTime(diffETAISO)}` : "—"}</div>
              </div>
            </>
          )}
        </div>

        {/* Fee share */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Fee share (live)</h3>
            <div className="flex gap-2">
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
              <div className="text-[11px] text-fg-subtle">Fee share = fees / (subsidy + fees) across recent blocks.</div>
            </>
          )}
        </div>

        {/* Electricity — span 1 col on lg here to fit grid (difficulty took 2) */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Electricity price (US Industrial, EIA)</h3>
            <div className="flex gap-2">
              <button onClick={syncElectricity} disabled={elecSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
                {elecSyncing ? "Syncing…" : "Sync now"}
              </button>
              <button onClick={() => { if (elecLatestUSD !== null) setElecBaseUSDkWh(Number(elecLatestUSD.toFixed(4))); }} disabled={elecLatestUSD === null} className="px-3 py-1 rounded-full border text-sm transition disabled:opacity-60 bg-bitcoin text-black border-transparent" title="Set model $/kWh to latest EIA value">
                Use as base
              </button>
            </div>
          </div>
          {elecErr ? (
            <div className="text-xs text-red-400">Error: {elecErr}</div>
          ) : (
            <>
              <div className="text-sm">
                Latest avg price: <span className="font-semibold">{elecLatestUSD !== null ? `$${elecLatestUSD.toFixed(4)}/kWh` : "—"}</span>
                <span className="text-xs text-fg-subtle ml-2">{elecLatestPeriod ?? ""}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="rounded-xl border border-border bg-panel p-2">
                  <div className="text-[11px] text-fg-subtle">YoY</div>
                  <div className="text-sm font-semibold">{elecYoYPct !== null ? `${elecYoYPct.toFixed(2)}%` : "—"}</div>
                </div>
                <div className="rounded-xl border border-border bg-panel p-2">
                  <div className="text-[11px] text-fg-subtle">5-yr CAGR</div>
                  <div className="text-sm font-semibold">{elecCAGR5 !== null ? `${elecCAGR5.toFixed(2)}%` : "—"}</div>
                </div>
                <div className="rounded-xl border border-border bg-panel p-2">
                  <div className="text-[11px] text-fg-subtle">10-yr CAGR</div>
                  <div className="text-sm font-semibold">{elecCAGR10 !== null ? `${elecCAGR10.toFixed(2)}%` : "—"}</div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Network heat */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Network heat (live)</h3>
            <button onClick={syncHashrate} disabled={hashSyncing} className="px-3 py-1 rounded-full border border-border bg-panel hover:bg-card text-sm disabled:opacity-60">
              {hashSyncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {hashErr ? (
            <div className="text-xs text-red-400">Error: {hashErr}</div>
          ) : (
            <>
              <div className="text-sm">Hashrate: <span className="font-semibold">{hashEhs !== null ? `${hashEhs.toFixed(1)} EH/s` : "—"}</span></div>
              <div className="text-xs text-fg-subtle">Difficulty: {hashDiffT !== null ? `${hashDiffT.toFixed(1)} T` : "—"}</div>
              <div className="text-[11px] text-fg-subtle">{hashSource ? `Source: ${hashSource}` : ""} {hashAsOf ? `• ${fmtDate(hashAsOf)} ${fmtTime(hashAsOf)}` : ""}</div>
              <div className="pill text-[11px] w-fit mt-1">⚡ Higher hashrate ⇒ fiercer competition</div>
            </>
          )}
        </div>
      </section>

      {/* Your stack commands the network — milestones */}
      <section className="card p-4 border-2 border-bitcoin/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold mb-1">
              <span className="text-bitcoin">Your stack commands the network</span> — milestones in time
            </h3>
            <p className="text-xs text-fg-subtle">
              Bitcoin prices blockspace in <b>time</b>. Every ~10 minutes is a ruthlessly competitive auction paid in electricity.
              As subsidy halves, the same stack commands <i>more</i> blocks. Below are the <b>first epochs</b> when your current
              stack equals each time slice. On those dates, miners would aim their hash for about that long to win <b>your slice</b>.
            </p>
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

      {/* Genesis → +25y Price Chart */}
      <section className="card p-4 space-y-2">
        <h3 className="font-semibold">1 BTC — Genesis → +25 Years (Model)</h3>
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={seriesFull} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#A9B6C2" }} />
              <YAxis tickFormatter={(v: number | string) => formatShortUSD(typeof v === "number" ? v : Number(v))} tick={{ fontSize: 12, fill: "#A9B6C2" }} />
              <Tooltip
                formatter={(v: number | string) => formatUSD(typeof v === "number" ? v : Number(v))}
                labelFormatter={(l: number | string) => `Year ${String(l)}`}
                contentStyle={{ background: "#0F141A", border: "1px solid #1F2937", color: "#E6EDF3" }}
                labelStyle={{ color: "#F7931A", fontWeight: 700 }}
                itemStyle={{ color: "#E6EDF3" }}
              />
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
