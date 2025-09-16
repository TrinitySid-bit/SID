/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";

function cagr(latest: number, oldest: number, years: number) {
  if (!Number.isFinite(latest) || !Number.isFinite(oldest) || latest <= 0 || oldest <= 0 || years <= 0) return null;
  return Math.pow(latest / oldest, 1 / years) - 1;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = process.env.EIA_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: "Missing EIA_API_KEY" });

  const url =
    "https://api.eia.gov/v2/electricity/retail-sales/data/?" +
    "frequency=monthly&" +
    "data%5B0%5D=price&" +
    "facets%5Bsectorid%5D%5B0%5D=IND&" +
    "facets%5Bstateid%5D%5B0%5D=US&" +
    "sort%5B0%5D%5Bcolumn%5D=period&" +
    "sort%5B0%5D%5Bdirection%5D=desc&" +
    "offset=0&length=120&" +
    "api_key=" + encodeURIComponent(key);

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `EIA error ${r.status}` });
    const j: any = await r.json();

    const rows = j?.response?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(502).json({ ok: false, error: "No data rows from EIA" });
    }

    const latest = rows[0];
    const latestCents = Number(latest?.price);
    const latestUSD = Number.isFinite(latestCents) ? latestCents / 100 : null;
    const latestPeriod = String(latest?.period || "");

    const row12 = rows[12] ?? null;
    const yoy =
      row12 && Number.isFinite(Number(row12.price)) && latestUSD !== null
        ? ((latestCents / Number(row12.price)) - 1) * 100
        : null;

    const row60 = rows[60] ?? null;
    const cagr5 =
      row60 && Number.isFinite(Number(row60.price)) && latestUSD !== null
        ? cagr(latestCents, Number(row60.price), 5)! * 100
        : null;

    const row120 = rows[120] ?? null;
    const cagr10 =
      row120 && Number.isFinite(Number(row120.price)) && latestUSD !== null
        ? cagr(latestCents, Number(row120.price), 10)! * 100
        : null;

    const suggestedDriftPct = [cagr10, cagr5, yoy].find((v) => v !== null) ?? null;

    return res.status(200).json({
      ok: true,
      source: "EIA v2 retail-sales price (US, Industrial)",
      asOfISO: new Date().toISOString(),
      latest: {
        period: latestPeriod,
        price_cents_per_kwh: latestCents,
        price_usd_per_kwh: latestUSD,
      },
      yoyPct: yoy,
      cagr5Pct: cagr5,
      cagr10Pct: cagr10,
      suggestedDriftPct,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
