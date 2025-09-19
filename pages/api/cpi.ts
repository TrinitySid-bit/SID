import type { NextApiRequest, NextApiResponse } from "next";

// ---- Types ----
type Ok = {
  ok: true;
  source: "BLS" | "FRED";
  seriesId: string;
  latestPeriod: string;    // YYYY-MM
  latestIndex: number;     // 1982-84=100
  yoyPct: number | null;   // YoY %
  asOfISO: string;
  isStale?: boolean;       // served from cache
};
type Err = { ok: false; error: string };

// ---- In-process cache (per serverless instance) ----
let CACHE: { data: Ok; ts: number } | null = null;
const HOUR = 60 * 60 * 1000;
// cache for 12 hours by default
const TTL_MS = 12 * HOUR;

// ---- Helpers ----
function monthFromPeriod(p: string): number | null {
  if (!/^M\\d{2}$/.test(p)) return null;
  const m = Number(p.slice(1, 3));
  return m >= 1 && m <= 12 ? m : null;
}
function toNum(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") { const n = Number(x); return Number.isFinite(n) ? n : null; }
  return null;
}
function fmtPeriod(y: number, m: number): string {
  return `${y}-${String(m).padStart(2,"0")}`;
}

// ---- Fetch BLS CPI-U SA (CUSR0000SA0) ----
async function fetchBLS(KEY: string): Promise<Ok> {
  const now = new Date();
  const endYear = now.getUTCFullYear();
  const startYear = endYear - 10;
  const body = {
    seriesid: ["CUSR0000SA0"],
    startyear: String(startYear),
    endyear: String(endYear),
    registrationkey: KEY,
  };
  const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`BLS HTTP ${r.status}`);
  const j = await r.json() as {
    status?: string,
    Results?: { series?: Array<{ seriesID: string, data: Array<{year: string, period: string, value: string}> }> },
    message?: string | string[]
  };
  if (j.status !== "REQUEST_SUCCEEDED" || !j.Results?.series?.length) {
    const msg = Array.isArray(j.message) ? j.message.join("; ") : (j.message || "BLS response not OK");
    throw new Error(msg);
  }
  const s = j.Results.series[0];
  const rows = s.data;
  const monthly = rows.map((o) => {
    const y = toNum(o.year);
    const m = monthFromPeriod(o.period);
    const idx = toNum(o.value);
    if (y===null || m===null || idx===null) return null;
    return { y, m, idx };
  }).filter((x): x is {y:number;m:number;idx:number} => !!x)
    .sort((a,b)=> (a.y-b.y) || (a.m-b.m));
  if (!monthly.length) throw new Error("No BLS monthly observations");

  const latest = monthly[monthly.length-1];
  const prior = monthly.findLast(o => o.y === latest.y-1 && o.m === latest.m);
  const yoy = prior ? ((latest.idx - prior.idx)/prior.idx)*100 : null;

  return {
    ok: true,
    source: "BLS",
    seriesId: s.seriesID,
    latestPeriod: fmtPeriod(latest.y, latest.m),
    latestIndex: Number(latest.idx.toFixed(3)),
    yoyPct: yoy===null ? null : Number(yoy.toFixed(2)),
    asOfISO: new Date().toISOString(),
  };
}

// ---- Fetch FRED CPIAUCSL (CPI-U SA) fallback ----
async function fetchFRED(KEY: string): Promise<Ok> {
  // CPIAUCSL: CPI for All Urban Consumers: All Items in U.S. City Average (SA), 1982-84=100, monthly
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${encodeURIComponent(KEY)}&file_type=json&observation_start=2015-01-01`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`FRED HTTP ${r.status}`);
  const j = await r.json() as { observations?: Array<{ date: string, value: string }> };
  const obs = Array.isArray(j.observations) ? j.observations : [];
  const monthly = obs.map(o => {
    const idx = toNum(o.value);
    if (idx===null) return null;
    const [Y,M] = o.date.split("-").map(Number);
    if (!Number.isFinite(Y) || !Number.isFinite(M)) return null;
    return { y: Y, m: M, idx };
  }).filter((x): x is {y:number;m:number;idx:number} => !!x);
  if (!monthly.length) throw new Error("No FRED observations");

  monthly.sort((a,b)=> (a.y-b.y) || (a.m-b.m));
  const latest = monthly[monthly.length-1];
  const prior = monthly.find(o => o.y === latest.y-1 && o.m === latest.m);
  const yoy = prior ? ((latest.idx - prior.idx)/prior.idx)*100 : null;

  return {
    ok: true,
    source: "FRED",
    seriesId: "CPIAUCSL",
    latestPeriod: fmtPeriod(latest.y, latest.m),
    latestIndex: Number(latest.idx.toFixed(3)),
    yoyPct: yoy===null ? null : Number(yoy.toFixed(2)),
    asOfISO: new Date().toISOString(),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok|Err>) {
  // Allow manual bypass of cache: /api/cpi?force=1
  const force = String(req.query.force||"") === "1";

  // Serve from in-memory cache if fresh and not forced
  if (!force && CACHE && (Date.now() - CACHE.ts) < TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
    return res.status(200).json({ ...CACHE.data, isStale: true });
  }

  const blsKey = process.env.BLS_API_KEY || "";
  const fredKey = process.env.FRED_API_KEY || "";

  try {
    if (!blsKey) throw new Error("Missing BLS_API_KEY");
    const data = await fetchBLS(blsKey);
    CACHE = { data, ts: Date.now() };
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
    return res.status(200).json(data);
  } catch (blsErr) {
    // Try FRED fallback if available
    try {
      if (!fredKey) throw new Error("Missing FRED_API_KEY");
      const data = await fetchFRED(fredKey);
      CACHE = { data, ts: Date.now() };
      res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
      return res.status(200).json(data);
    } catch (fredErr) {
      // If we have a cached value, serve it
      if (CACHE) {
        res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
        return res.status(200).json({ ...CACHE.data, isStale: true });
      }
      // Otherwise fail clearly
      const msg = (blsErr instanceof Error ? blsErr.message : String(blsErr)) +
                  (fredErr ? ` | FRED: ${fredErr instanceof Error ? fredErr.message : String(fredErr)}` : "");
      return res.status(200).json({ ok:false, error: msg });
    }
  }
}
