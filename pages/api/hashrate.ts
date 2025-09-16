import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/hashrate
 * Returns live difficulty and an estimated network hashrate (EH/s).
 * Primary source: Blockchair; fallback: mempool.space.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const asOfISO = new Date().toISOString();

  // helpers
  const diffToHashrateEhs = (difficulty: number) => {
    // H/s = diff * 2^32 / 600; EH/s = H/s / 1e18
    const Hs = difficulty * Math.pow(2, 32) / 600;
    return Hs / 1e18;
  };

  try {
    // 1) Try Blockchair
    try {
      const r = await fetch("https://api.blockchair.com/bitcoin/stats", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        // Blockchair payload shape: { data: { difficulty: number, ... } }
        const diff = Number(j?.data?.difficulty);
        if (Number.isFinite(diff) && diff > 0) {
          const hashrate_ehs = diffToHashrateEhs(diff);
          return res.status(200).json({
            ok: true,
            source: "blockchair",
            asOfISO,
            difficulty: diff,
            difficulty_trillions: diff / 1e12,
            hashrate_ehs,
          });
        }
      }
    } catch {}

    // 2) Fallback: mempool.space difficulty-adjustment
    try {
      const r2 = await fetch("https://mempool.space/api/v1/difficulty-adjustment", { cache: "no-store" });
      if (r2.ok) {
        const j2 = await r2.json();
        // mempool returns: { difficulty: number, ... }
        const diff2 = Number(j2?.difficulty);
        if (Number.isFinite(diff2) && diff2 > 0) {
          const hashrate_ehs = diffToHashrateEhs(diff2);
          return res.status(200).json({
            ok: true,
            source: "mempool.space",
            asOfISO,
            difficulty: diff2,
            difficulty_trillions: diff2 / 1e12,
            hashrate_ehs,
          });
        }
      }
    } catch {}

    return res.status(502).json({ ok: false, error: "All upstream difficulty sources failed" });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
