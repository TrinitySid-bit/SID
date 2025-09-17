import type { NextApiRequest, NextApiResponse } from "next";

type Ok = {
  ok: true;
  seriesId: string;
  latestPeriod: string;   // e.g. "2025-08"
  latestIndex: number;    // index, base 1982-84=100
  yoyPct: number | null;  // YoY % (SA), null if prior month missing
  asOfISO: string;
  source: string;
};
type Err = { ok: false; error: string };

type BLSObservation = {
  year: string;       // "2025"
  period: string;     // "M08" (monthly); "M13" = annual avg (ignore)
  value: string;      // "315.234" (string)
  periodName?: string;
};

type BLSSeries = {
  seriesID: string;
  data: BLSObservation[];
};

type BLSResponse = {
  status?: string;
  Results?: { series?: BLSSeries[] };
  message?: string | string[];
};

function monthFromPeriod(p: string): number | null {
  // Expect "M01".."M12"; ignore "M13" (annual average)
  if (!/^M\d{2}$/.test(p)) return null;
  const m = Number(p.slice(1, 3));
  if (m >= 1 && m <= 12) return m;
  return null;
}

function toNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<Ok | Err>
) {
  const KEY = process.env.BLS_API_KEY;
  if (!KEY) {
    res.status(200).json({ ok: false, error: "Missing BLS_API_KEY (set it on Vercel → Project → Settings → Environment Variables → Production)" });
    return;
  }

  try {
    const now = new Date();
    const endYear = now.getUTCFullYear();
    const startYear = endYear - 10; // 10y window is more than enough

    const body = {
      seriesid: ["CUSR0000SA0"],     // CPI-U, SA, All Items (1982-84=100)
      startyear: String(startYear),
      endyear: String(endYear),
      registrationkey: KEY,
    };

    const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Avoid caching in Vercel edge; we want live-ish
      cache: "no-store",
      body: JSON.stringify(body),
    });

    if (!r.ok) throw new Error(`BLS HTTP ${r.status}`);

    const j: unknown = await r.json();
    const bls = j as BLSResponse;

    if (bls.status !== "REQUEST_SUCCEEDED" || !bls.Results?.series || bls.Results.series.length === 0) {
      const msg = Array.isArray(bls.message) ? bls.message.join("; ") : (bls.message || "No CPI data returned");
      throw new Error(msg);
    }

    const series = bls.Results.series[0];
    const sId = series.seriesID;
    const obs = Array.isArray(series.data) ? series.data : [];

    // Filter monthly observations (M01..M12), map to numeric fields
    const monthly = obs
      .map((o): { y: number; m: number; idx: number } | null => {
        const y = toNumber(o.year);
        const m = monthFromPeriod(o.period || "");
        const idx = toNumber(o.value);
        if (y === null || m === null || idx === null) return null;
        return { y, m, idx };
      })
      .filter((x): x is { y: number; m: number; idx: number } => x !== null);

    if (monthly.length === 0) throw new Error("No monthly CPI observations");

    // Sort ascending by (y, m)
    monthly.sort((a, b) => (a.y - b.y) || (a.m - b.m));

    // Latest is the last element
    const latest = monthly[monthly.length - 1];
    const latestPeriod = `${latest.y}-${String(latest.m).padStart(2, "0")}`;
    const latestIndex = latest.idx;

    // Find YoY: same month in prior year
    const targetY = latest.y - 1;
    const prior = monthly.findLast(o => o.y === targetY && o.m === latest.m);
    const yoyPct = prior ? ((latest.idx - prior.idx) / prior.idx) * 100 : null;

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      seriesId: sId,
      latestPeriod,
      latestIndex: Number(latestIndex.toFixed(3)),
      yoyPct: yoyPct === null ? null : Number(yoyPct.toFixed(2)),
      asOfISO: new Date().toISOString(),
      source: "BLS public API v2 (CUSR0000SA0, SA, All items)",
    });
  } catch (e: unknown) {
    res.status(200).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
