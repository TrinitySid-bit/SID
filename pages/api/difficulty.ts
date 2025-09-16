/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Returns:
 *  - ok: boolean
 *  - difficulty: number (raw)
 *  - difficulty_trillions: number (raw / 1e12)
 *  - estChangePct?: number
 *  - epoch?: { blocksIntoEpoch, blocksRemaining, progressPct, nextRetargetHeight, estRetargetDateISO }
 *  - source: string
 *  - asOfISO: string
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1) Try mempool.space
    const r1 = await fetch("https://mempool.space/api/v1/difficulty-adjustment", { cache: "no-store" });
    if (r1.ok) {
      const j: any = await r1.json();
      // j.difficulty is raw difficulty (e.g., ~9e13)
      const diffRaw = Number(j?.difficulty);
      const difficulty = Number.isFinite(diffRaw) ? diffRaw : NaN;

      const difficulty_trillions = Number.isFinite(difficulty) ? difficulty / 1e12 : NaN;

      const out = {
        ok: Number.isFinite(difficulty),
        difficulty,
        difficulty_trillions,
        estChangePct: typeof j?.difficultyChange === "number" ? j.difficultyChange : null,
        epoch: {
          blocksIntoEpoch: typeof j?.blocks_mined === "number" ? j.blocks_mined : null,
          blocksRemaining: typeof j?.remainingBlocks === "number" ? j.remainingBlocks : null,
          progressPct: typeof j?.progressPercent === "number" ? j.progressPercent : null,
          nextRetargetHeight: typeof j?.nextRetargetHeight === "number" ? j.nextRetargetHeight : null,
          estRetargetDateISO: j?.estimatedRetargetDate ? new Date(j.estimatedRetargetDate).toISOString() : null,
        },
        source: "mempool.space",
        asOfISO: new Date().toISOString(),
      };
      if (out.ok) return res.status(200).json(out);
    }

    // 2) Fallback: blockchain.info
    const r2 = await fetch("https://blockchain.info/q/getdifficulty?cors=true", { cache: "no-store" });
    if (r2.ok) {
      const text = await r2.text();
      const difficulty = Number(text);
      const difficulty_trillions = Number.isFinite(difficulty) ? difficulty / 1e12 : NaN;
      return res.status(200).json({
        ok: Number.isFinite(difficulty),
        difficulty,
        difficulty_trillions,
        estChangePct: null,
        epoch: null,
        source: "blockchain.info",
        asOfISO: new Date().toISOString(),
      });
    }

    return res.status(502).json({ ok: false, error: "All difficulty sources failed" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
