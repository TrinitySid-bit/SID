import type { NextApiRequest, NextApiResponse } from "next";

type OK = { ok: true; feeSharePct: number; sampleBlocks: number; asOfISO: string; source: string };
type ERR = { ok: false; error: string };

// Halving every 210,000 blocks. Subsidy in satoshis.
function subsidySats(height: number): number {
  const era = Math.floor(height / 210000);
  const base = 50n * 100_000_000n; // 50 BTC in sats
  const sats = Number(base >> BigInt(era));
  return sats;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<OK | ERR>) {
  const n = Math.min(50, Math.max(10, Number(req.query.n) || 25));

  try {
    const r = await fetch("https://mempool.space/api/blocks", { cache: "no-store" });
    if (!r.ok) throw new Error(`blocks fetch ${r.status}`);
    const blocks: any[] = await r.json();

    const chosen = Array.isArray(blocks) ? blocks.slice(0, n) : [];
    let feesSum = 0;
    let subsSum = 0;
    let counted = 0;

    for (const b of chosen) {
      const height = typeof b?.height === "number" ? b.height : null;
      const totalFees =
        (b?.extras && typeof b.extras.totalFees === "number") ? b.extras.totalFees :
        (typeof (b as any)?.totalFees === "number" ? (b as any).totalFees : null);

      if (height === null || totalFees === null) continue;

      const subs = subsidySats(height);
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
      source: "mempool.space /api/blocks",
    });
  } catch (e: unknown) {
    res.status(200).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
