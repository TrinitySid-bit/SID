import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Historical hashrate -> energy -> BTC share of global electricity by YEAR.
 * Sources:
 * - Hashrate (daily): Blockchain.com charts/hash-rate (TH/s) [server fetch]
 * - Efficiency curve (J/TH): heuristic anchors from IEA chart + industry specs (see comments)
 * - World electricity (TWh): your existing base (30,000 TWh in 2024) and drift (2.5%/yr)
 *
 * Returns: { ok, byYear: { [year]: { share: number, twh: number } }, lastYear, lastShare }
 */

// ---- Config: world electricity baseline ----
const WORLD_ELEC_BASE_TWH_2024 = 30000;
const WORLD_ELEC_GROWTH = 0.025; // 2.5%/yr

function worldElectricityTWh(year: number): number {
  const yearsRel = year - 2024;
  return WORLD_ELEC_BASE_TWH_2024 * Math.pow(1 + WORLD_ELEC_GROWTH, yearsRel);
}

// ---- Efficiency curve (J/TH) ----
// Anchors (rough, defensible, and easy to adjust):
// 2009–2011: CPU → extremely poor efficiency
// 2012–2013: GPU/FPGA → large step down
// 2014–2016: early ASICs → hundreds to ~100 J/TH trending down
// 2017–2018: ~80–90 J/TH
// 2019–2020: ~35–45 J/TH (S17/S19 era begins)
// 2021–2022: ~22–28 J/TH
// 2023–2025: ~17–22 J/TH (S19 XP, S21 class)
// Sources/examples: IEA efficiency chart; S19 XP ≈21.5 J/TH; network drop 89→33 J/TH (2018→2023).
function effJperTHByYear(y: number): number {
  if (y <= 2011) return 5_000_000; // CPU era (very rough)
  if (y <= 2013) return 50_000;    // GPU/FPGA era (rough)
  if (y <= 2016) return 120;       // early ASICs
  if (y <= 2018) return 85;        // S5–S9 mix
  if (y <= 2020) return 38;        // S17/S19 emerge
  if (y <= 2022) return 25;        // S19/S19 Pro era
  if (y <= 2024) return 18;        // S19 XP ~21.5 J/TH; fleet avg ~18–22
  return 16;                       // near-future baseline
}

// ---- Fetch Blockchain.com hashrate (daily) ----
// Example: https://api.blockchain.info/charts/hash-rate?format=json
type BtcChartPoint = { x: number; y: number };
type BtcChart = { status: string; values: BtcChartPoint[] };

async function fetchHashrate(): Promise<BtcChartPoint[]> {
  const url = "https://api.blockchain.info/charts/hash-rate?format=json";
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`hash-rate fetch failed (${r.status})`);
  const js: BtcChart = await r.json();
  if (!js?.values || !Array.isArray(js.values)) throw new Error("hash-rate malformed");
  return js.values; // y is TH/s
}

export type YearShare = { share: number; twh: number };

type Ok = {
  ok: true;
  byYear: Record<number, YearShare>;
  lastYear: number;
  lastShare: number;
  source: string;
};
type Err = { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok|Err>) {
  try {
    const points = await fetchHashrate();

    // Group by calendar year
    const byYear: Record<number, { sumTHs: number; n: number }> = {};
    for (const p of points) {
      const d = new Date(p.x * 1000);
      const y = d.getUTCFullYear();
      if (!byYear[y]) byYear[y] = { sumTHs: 0, n: 0 };
      byYear[y].sumTHs += p.y;
      byYear[y].n += 1;
    }

    // Convert to average TH/s per year -> average power (W) -> TWh/year
    const out: Record<number, YearShare> = {};
    const years = Object.keys(byYear).map(Number).sort((a,b)=>a-b);
    for (const y of years) {
      const avgTHs = byYear[y].sumTHs / byYear[y].n; // TH/s
      const jPerTH = effJperTHByYear(y);
      const powerW = avgTHs * jPerTH; // TH/s * J/TH = J/s = W
      const hours = 365.2425 * 24;
      const twh = (powerW * hours) / 1e12; // W*h -> Wh /1e12 -> TWh
      const worldTwh = worldElectricityTWh(y);
      const share = worldTwh > 0 ? twh / worldTwh : 0;
      out[y] = { share, twh };
    }

    const lastYear = years[years.length - 1];
    const lastShare = out[lastYear]?.share ?? 0;

    return res.status(200).json({
      ok: true,
      byYear: out,
      lastYear,
      lastShare,
      source: "Blockchain.com hashrate × efficiency curve",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
