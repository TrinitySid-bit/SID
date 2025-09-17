import type { NextApiRequest, NextApiResponse } from "next";

type OK = {
  ok: true;
  difficulty: number;
  difficulty_trillions: number;
  estChangePct: number | null;
  epoch: {
    blocksRemaining: number;
    blocksIntoEpoch: number;
    progressPct: number;
    nextRetargetHeight: number;
    estRetargetDateISO: string;
  } | null;
  source: string;
  asOfISO: string;
};
type ERR = { ok: false; error: string };

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<OK | ERR>
) {
  try {
    const [diffRes, heightRes] = await Promise.all([
      fetch("https://blockchain.info/q/getdifficulty", { cache: "no-store" }),
      fetch("https://mempool.space/api/blocks/tip/height", { cache: "no-store" }),
    ]);

    const diffText = await diffRes.text();
    const difficulty = Number(diffText);
    const heightText = await heightRes.text();
    const tipHeight = Number(heightText);

    if (!isFinite(difficulty)) throw new Error("Bad difficulty from source");
    if (!Number.isInteger(tipHeight)) throw new Error("Bad height from mempool");

    const blocksInto = tipHeight % 2016;
    const blocksRemaining = 2016 - blocksInto;
    const progressPct = (blocksInto / 2016) * 100;
    const nextRetargetHeight = tipHeight - blocksInto + 2016;
    const estRetargetDateISO = new Date(Date.now() + blocksRemaining * 600 * 1000).toISOString();

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      difficulty,
      difficulty_trillions: difficulty / 1e12,
      estChangePct: null, // unknown until closer to retarget
      epoch: {
        blocksRemaining,
        blocksIntoEpoch: blocksInto,
        progressPct,
        nextRetargetHeight,
        estRetargetDateISO,
      },
      source: "blockchain.info + mempool.space",
      asOfISO: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(200).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
