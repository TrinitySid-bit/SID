import type { NextApiRequest, NextApiResponse } from "next";

/** Minimal shape we need from mempool.space /api/blocks */
type MinimalBlock = {
  id?: string;
  hash?: string;
  height?: number;
  timestamp?: number;
  fees?: number;    // sats
  reward?: number;  // sats
};

/** Fetch 10 blocks. If fromHash is provided, mempool returns the 10 blocks prior to that hash. */
async function fetchBlocks(fromHash?: string): Promise<MinimalBlock[]> {
  const base = "https://mempool.space/api/blocks";
  const url = fromHash ? `${base}/${fromHash}` : base;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Blocks fetch failed (${r.status})`);
  const arr: unknown = await r.json();
  if (!Array.isArray(arr)) throw new Error("Blocks response not array");

  // Map defensively from unknown → MinimalBlock without using 'any'
  const out: MinimalBlock[] = [];
  for (const x of arr) {
    const o = x as Record<string, unknown>;
    const id = typeof o["id"] === "string" ? (o["id"] as string) : undefined;
    const hash = typeof o["hash"] === "string" ? (o["hash"] as string) : id;
    const height = typeof o["height"] === "number" ? (o["height"] as number) : undefined;
    const timestamp = typeof o["timestamp"] === "number" ? (o["timestamp"] as number) : undefined;

    // fees may appear at o.fees or o.extras.totalFees depending on backend
    let fees: number | undefined;
    if (typeof o["fees"] === "number") {
      fees = o["fees"] as number;
    } else if (o["extras"] && typeof o["extras"] === "object" && o["extras"] !== null) {
      const ex = o["extras"] as Record<string, unknown>;
      if (typeof ex["totalFees"] === "number") fees = ex["totalFees"] as number;
    }

    const reward = typeof o["reward"] === "number" ? (o["reward"] as number) : undefined;

    out.push({ id, hash, height, timestamp, fees, reward });
  }
  return out;
}

/** Block subsidy in BTC given block height. 210k-block halvings starting at 50 BTC. */
function subsidyBTC(height: number): number {
  const HALVING_INTERVAL = 210_000;
  const halvings = Math.floor(height / HALVING_INTERVAL);
  const initial = 50;
  const s = initial / Math.pow(2, halvings);
  return s > 0 ? s : 0;
}

type Ok = {
  ok: true;
  feeSharePct: number;       // fees / (fees + subsidy) over the sampled window
  sampleBlocks: number;      // number of blocks sampled
  asOfISO: string;           // timestamp of most recent sampled block
  source: string;            // mempool.space
};
type Err = { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Ok | Err>
) {
  try {
    const sample = Math.max(5, Math.min(200, Number(req.query.n ?? 40)));

    // Collect newest→older until we have 'sample' blocks
    let blocks: MinimalBlock[] = [];
    let fromHash: string | undefined = undefined;
    while (blocks.length < sample) {
      const page = await fetchBlocks(fromHash);
      if (page.length === 0) break;
      blocks = blocks.concat(page);
      // next page uses the last block hash in the current page
      const last = page[page.length - 1];
      fromHash = (last.hash ?? last.id) as string | undefined;
      if (!fromHash) break;
    }
    if (blocks.length === 0) {
      return res.status(502).json({ ok: false, error: "No blocks returned from mempool.space" });
    }

    // Trim to requested sample size
    const sampleBlocks = blocks.slice(0, sample);

    let feesBTC = 0;
    let subsidyBTCsum = 0;

    for (const b of sampleBlocks) {
      const height = typeof b.height === "number" ? b.height : undefined;
      const feesSats = typeof b.fees === "number" ? b.fees : 0;

      if (typeof height === "number") {
        subsidyBTCsum += subsidyBTC(height);
      }
      feesBTC += feesSats / 1e8;
    }

    const denom = feesBTC + subsidyBTCsum;
    const feeSharePct = denom > 0 ? (feesBTC / denom) * 100 : 0;

    // As-of = newest sampled block timestamp
    const newestTs = sampleBlocks[0]?.timestamp;
    const asOfISO = typeof newestTs === "number" ? new Date(newestTs * 1000).toISOString() : new Date().toISOString();

    return res.status(200).json({
      ok: true,
      feeSharePct,
      sampleBlocks: sampleBlocks.length,
      asOfISO,
      source: "mempool.space",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
