import type { NextApiRequest, NextApiResponse } from "next";

type Ok = {
  ok: true;
  seriesId: string;
  latestPeriod: string;   // "YYYY-MM"
  latestIndex: number;    // index, 1982-84=100
  yoyPct: number | null;  // YoY %, null if prior month missing
  asOfISO: string;        // when the payload was generated
  source: string;         // BLS...
  // optional cache metadata (UI can ignore safely)
  cached?: boolean;
  cacheAgeSeconds?: number;
};
type Err = { ok: false; error: string };

type BLSObservation = { year: string; period: string; value: string; periodName?: string };
type BLSSeries = { seriesID: string; data: BLSObservation[] };
type BLSResponse = { status?: string; Results?: { series?: BLSSeries[] }; message?: string | string[] };

function monthFromPeriod(p: string): number | null {
  if (!/^M\d{2}$/.test(p)) return null;          // ignore M13 (annual avg)
  const m = Number(p.slice(1, 3));
  return m >= 1 && m <= 12 ? m : null;
}
function toNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") { const n = Number(x); return Number.isFinite(n) ? n : null; }
  return null;
}

// ── Weekly in-memory cache (persists per lambda instance) ──────────────────────
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
let _cache: { ts: number; payload: Ok } | null = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Err>) {
  const force = req.query.force === "1";
  const now = Date.now();

  // Serve from memory cache when fresh and not forced.
  if (!force && _cache && (now - _cache.ts) < TTL_MS) {
    const ageSec = Math.floor((now - _cache.ts) / 1000);
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400, max-age=0");
    return res.status(200).json({ ..._cache.payload, cached: true, cacheAgeSeconds: ageSec });
  }

  const KEY = process.env.BLS_API_KEY;
  if (!KEY) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, error: "Missing BLS_API_KEY in production env." });
  }

  try {
    // Fetch a 10-year window (plenty for YoY)
    const nowD = new Date();
    const endYear = nowD.getUTCFullYear();
    const startYear = endYear - 10;

    const body = {
      seriesid: ["CUSR0000SA0"],  // CPI-U, SA, All Items (1982-84=100)
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

    const bls = (await r.json()) as BLSResponse;
    if (bls.status !== "REQUEST_SUCCEEDED" || !bls.Results?.series?.length) {
      const msg = Array.isArray(bls.message) ? bls.message.join("; ") : (bls.message || "No CPI data");
      throw new Error(msg);
    }

    const series = bls.Results.series[0];
    const obs = series.data;

    // Monthly observations only
    const monthly = obs
      .map((o) => {
        const y = toNumber(o.year);
        const m = monthFromPeriod(o.period);
        const idx = toNumber(o.value);
        if (y === null || m === null || idx === null) return null;
        return { y, m, idx };
      })
      .filter((x): x is { y: number; m: number; idx: number } => x !== null)
      .sort((a, b) => (a.y - b.y) || (a.m - b.m));

    if (!monthly.length) throw new Error("No monthly CPI observations");

    const latest = monthly[monthly.length - 1];
    const latestPeriod = `${latest.y}-${String(latest.m).padStart(2, "0")}`;
    const prior = monthly.findLast(o => o.y === latest.y - 1 && o.m === latest.m);
    const yoyPct = prior ? ((latest.idx - prior.idx) / prior.idx) * 100 : null;

    const payload: Ok = {
      ok: true,
      seriesId: series.seriesID,
      latestPeriod,
      latestIndex: Number(latest.idx.toFixed(3)),
      yoyPct: yoyPct === null ? null : Number(yoyPct.toFixed(2)),
      asOfISO: new Date().toISOString(),
      source: "BLS (CUSR0000SA0, SA, All items)",
    };

    // Save & return with edge cache headers (1 week)
    _cache = { ts: now, payload };
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400, max-age=0");
    return res.status(200).json({ ...payload, cached: false, cacheAgeSeconds: 0 });
  } catch (e: unknown) {
    // If BLS fails but we have a stale cache, serve it instead of erroring.
    if (_cache) {
      const ageSec = Math.floor((now - _cache.ts) / 1000);
      res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400, max-age=0");
      return res.status(200).json({ ..._cache.payload, cached: true, cacheAgeSeconds: ageSec });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
