import type { NextApiRequest, NextApiResponse } from "next";

type BlsSeriesPoint = {
  period: string; // "M01".."M12"
  year: string;   // "2025"
  value: string;  // e.g. "312.331"
};

type BlsSeries = {
  seriesID: string;
  data: BlsSeriesPoint[];
};

type BlsResponse = {
  status: string;
  Results?: { series: BlsSeries[] };
  message?: string[];
};

type CpiOk = {
  ok: true;
  latest: { dateISO: string; value: number };
  yoyPct: number;
  source: string;
};

type CpiErr = { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<CpiOk | CpiErr>) {
  try {
    const seriesId = (req.query.series as string) || "CUSR0000SA0"; // CPI-U, SA
    const key = process.env.BLS_API_KEY;
    if (!key) return res.status(500).json({ ok: false, error: "Missing BLS_API_KEY" });

    const now = new Date();
    const startYear = String(now.getUTCFullYear() - 2);
    const endYear = String(now.getUTCFullYear());

    const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesid: [seriesId], startyear: startYear, endyear: endYear, registrationKey: key }),
      cache: "no-store",
    });

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: `BLS API HTTP ${r.status}` });
    }
    const j: BlsResponse = await r.json();

    const series = j?.Results?.series?.[0];
    if (!series || !Array.isArray(series.data) || series.data.length === 0) {
      return res.status(502).json({ ok: false, error: "No CPI data returned" });
    }

    // BLS returns reverse-chronological; find latest month and the same month last year
    const latest = series.data[0];
    const latestVal = Number(latest.value);
    const latestYear = Number(latest.year);
    const latestMonth = Number(latest.period.replace("M", ""));
    if (!Number.isFinite(latestVal) || !latestYear || !latestMonth) {
      return res.status(502).json({ ok: false, error: "Malformed CPI latest point" });
    }

    const lastYearPoint = series.data.find(
      (p) => Number(p.year) === latestYear - 1 && Number(p.period.replace("M", "")) === latestMonth
    );
    if (!lastYearPoint) {
      return res.status(502).json({ ok: false, error: "Missing prior-year CPI point" });
    }
    const lastYearVal = Number(lastYearPoint.value);
    if (!Number.isFinite(lastYearVal)) {
      return res.status(502).json({ ok: false, error: "Malformed prior-year CPI value" });
    }

    const yoyPct = ((latestVal - lastYearVal) / lastYearVal) * 100;
    const dateISO = new Date(Date.UTC(latestYear, latestMonth - 1, 1)).toISOString();

    return res.status(200).json({
      ok: true,
      latest: { dateISO, value: latestVal },
      yoyPct,
      source: "BLS publicAPI v2 (SA series)",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
