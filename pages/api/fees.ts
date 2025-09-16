/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/fees?n=40
 * Computes fee share = sum(totalFees) / sum(reward) for the last N blocks.
 * Uses mempool.space REST API:
 *   - /api/blocks               -> last ~10 blocks (we’ll page by refetching if needed)
 *   - /api/v1/block/:hash       -> has "extras" with totalFees and reward (sats)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const asOfISO = new Date().toISOString();
  const nRequested = Number(req.query.n ?? 40);
  const N = Number.isFinite(nRequested) && nRequested > 0 && nRequested <= 120 ? Math.floor(nRequested) : 40;

  try {
    // 1) Get recent block hashes (we’ll collect until we have >= N)
    const blockHashes: string[] = [];
    let tries = 0;
    let lastSeenHash: string | undefined;

    // Helper to fetch /api/blocks with optional "from hash"
    async function fetchBlocks(fromHash?: string) {
      const url = fromHash ? `https://mempool.space/api/blocks/${fromHash}` : "https://mempool.space/api/blocks";
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`Blocks fetch failed (${r.status})`);
      const arr: any[] = await r.json();
      return arr; // [{ id, height, previousblockhash, ... }]
    }

    while (blockHashes.length < N && tries < 12) {
      const arr = await fetchBlocks(lastSeenHash);
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const b of arr) {
        const id = b?.id;
        if (typeof id === "string") blockHashes.push(id);
        lastSeenHash = b?.id; // mempool returns blocks newest->oldest; /blocks/:hash returns older set
        if (blockHashes.length >= N) break;
      }
      tries++;
    }

    if (blockHashes.length === 0) {
      return res.status(502).json({ ok: false, error: "No blocks returned from upstream" });
    }

    // Trim to exactly N
    const wanted = blockHashes.slice(0, N);

    // 2) For each hash, fetch detailed block to get extras (fees + reward in sats)
    async function getOne(hash: string) {
      const r = await fetch(`https://mempool.space/api/v1/block/${hash}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j: any = await r.json();
      const fees = Number(j?.extras?.totalFees);
      const reward = Number(j?.extras?.reward);
      const height = Number(j?.height);
      const ts = Number(j?.timestamp) * 1000 || null;
      if (!Number.isFinite(fees) || !Number.isFinite(reward)) return null;
      return { hash, height, ts, fees, reward };
    }

    const results = await Promise.all(wanted.map(getOne));
    const rows = results.filter(Boolean) as { hash: string; height: number; ts: number | null; fees: number; reward: number }[];

    if (rows.length === 0) {
      return res.status(502).json({ ok: false, error: "No fee/reward data available" });
    }

    // 3) Aggregate
    const totalFees = rows.reduce((a, r) => a + r.fees, 0);
    const totalReward = rows.reduce((a, r) => a + r.reward, 0);
    const feeShare = totalReward > 0 ? totalFees / totalReward : 0;

    // Some quick stats
    const avgFees = totalFees / rows.length;
    const median = (vals: number[]) => {
      const v = [...vals].sort((a, b) => a - b);
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const medFees = median(rows.map(r => r.fees));

    return res.status(200).json({
      ok: true,
      asOfISO,
      sampleBlocks: rows.length,
      feeSharePct: feeShare * 100,
      totals: {
        totalFeesSat: totalFees,
        totalRewardSat: totalReward
      },
      averages: {
        avgFeesSat: avgFees,
        medianFeesSat: medFees
      }
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
