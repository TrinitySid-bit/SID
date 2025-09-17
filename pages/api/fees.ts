import type { NextApiRequest, NextApiResponse } from "next";

type Ok = {
  ok: true;
  feeSharePct: number;
  sampleBlocks: number;
  asOfISO: string;
  source: string;
};
type Err = { ok: false; error: string };

interface BlockSummary {
  id: string;    // block hash
  height: number;
}

// Halving every 210,000 blocks. Return subsidy in satoshis (NUMBER math; no BigInt).
function subsidySats(height: number): number {
  const era = Math.floor(height / 210_000);
  const sats = Math.floor((50 * 1e8) / Math.pow(2, era)); // 50 BTC → sats, halved per era
  return sats > 0 ? sats : 0;
}

// Type guards / safe pickers (avoid `any`)
function pickBlockSummary(u: unknown): BlockSummary | null {
  if (typeof u !== "object" || u === null) return null;
  const rec = u as Record<string, unknown>;
  const idVal = rec["id"];
  const hVal = rec["height"];
  if (typeof idVal === "string" && typeof hVal === "number") {
    return { id: idVal, height: hVal };
  }
  return null;
}

function pickTotalFees(u: unknown): number {
  if (typeof u !== "object" || u === null) return 0;
  const rec = u as Record<string, unknown>;
  const extras = rec["extras"];
  if (typeof extras === "object" && extras !== null) {
    const er = extras as Record<string, unknown>;
    if (typeof er["totalFees"] === "number") return er["totalFees"] as number;
  }
  if (typeof rec["fee"] === "number") return rec["fee"] as number;
  return 0;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Ok | Err>
) {
  const nParam = Number(req.query.n);
  const n = Number.isFinite(nParam) ? Math.min(25, Math.max(10, nParam)) : 20;

  try {
    const r = await fetch("https://mempool.space/api/blocks", { cache: "no-store" });
    if (!r.ok) throw new Error(`blocks fetch ${r.status}`);
    const blocksRaw: unknown = await r.json();
    if (!Array.isArray(blocksRaw)) throw new Error("Unexpected blocks shape");

    const summaries: BlockSummary[] = [];
    for (const u of blocksRaw) {
      const b = pickBlockSummary(u);
      if (b) summaries.push(b);
    }

    const chosen = summaries.slice(0, n);

    let feesSum = 0;
    let subsSum = 0;
    let counted = 0;

    // Fetch per-block details for reliable total fees
    for (const b of chosen) {
      const rd = await fetch(`https://mempool.space/api/block/${b.id}`, { cache: "no-store" });
      if (!rd.ok) continue;
      const detailRaw: unknown = await rd.json();
      const totalFees = pickTotalFees(detailRaw);
      const subs = subsidySats(b.height);
      feesSum += totalFees;
      subsSum += subs;
      counted += 1;
    }

    const denom = feesSum + subsSum;
    const pct = denom > 0 ? (feesSum / denom) * 100 : 0;

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      feeSharePct: Number(pct.toFixed(2)),
      sampleBlocks: counted,
      asOfISO: new Date().toISOString(),
      source: "mempool.space /api/blocks + /api/block/{hash}",
    });
  } catch (e: unknown) {
    res.status(200).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
