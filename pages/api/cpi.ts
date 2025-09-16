import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/cpi
 * Pulls CPI-U All Items, Seasonally Adjusted (CUSR0000SA0) from BLS API.
 * Returns latest monthly value and YoY% for that month.
 *
 * .env.local: BLS_API_KEY=<your bls key>  (optional; higher rate limits)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const series = (req.query.series as string) || "CUSR0000SA0";
    const now = new Date();
    const endYear = now.getUTCFullYear();
    const startYear = endYear - 6; // last ~6 years is plenty

    const body: any = {
      seriesid: [series],
      startyear: String(startYear),
      endyear: String(endYear),
    };
    if (process.env.BLS_API_KEY) body.registrationKey = process.env.BLS_API_KEY;

    const bls = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!bls.ok) {
      const text = await bls.text();
      return res.status(bls.status).json({ ok: false, error: `BLS HTTP ${bls.status}: ${text}` });
    }

    const json = await bls.json();
    if (json.status !== "REQUEST_SUCCEEDED") {
      return res.status(500).json({ ok: false, error: json?.message || "BLS API error" });
    }

    const seriesData = json?.Results?.series?.[0]?.data;
    if (!Array.isArray(seriesData) || seriesData.length === 0) {
      return res.status(404).json({ ok: false, error: "No CPI data returned" });
    }

    // Data is reverse-chronological; find the newest real month (M01..M12)
    const monthly = seriesData.filter((d: any) => /^M(0[1-9]|1[0-2])$/.test(d.period));
    if (monthly.length === 0) return res.status(404).json({ ok: false, error: "No monthly CPI rows" });

    const latest = monthly[0]; // newest first
    const latestYear = Number(latest.year);
    const latestMonth = Number(latest.period.substring(1)); // "M10" -> 10
    const latestVal = Number(latest.value);

    // find same month last year for YoY
    const yoyRow = monthly.find((d: any) => Number(d.year) === latestYear - 1 && Number(d.period.substring(1)) === latestMonth);
    const yoyVal = yoyRow ? Number(yoyRow.value) : undefined;

    const dateISO = new Date(Date.UTC(latestYear, latestMonth - 1, 1)).toISOString().slice(0, 10);
    const yoyPct = yoyVal ? ((latestVal - yoyVal) / yoyVal) * 100 : undefined;

    return res.status(200).json({
      ok: true,
      series,
      latest: { dateISO, value: latestVal },
      yoyPct, // e.g., 3.2 (%)
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
