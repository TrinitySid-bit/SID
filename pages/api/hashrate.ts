import type { NextApiRequest, NextApiResponse } from "next";

type OK = {
  ok: true;
  hashrate_ehs: number | null;
  difficulty: number | null;
  difficulty_trillions: number | null;
  source: string;
  asOfISO: string;
};
type ERR = { ok: false; error: string };

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<OK | ERR>
) {
  try {
    const r = await fetch("https://blockchain.info/q/getdifficulty", { cache: "no-store" });
    const text = await r.text();
    const difficulty = Number(text);
    if (!isFinite(difficulty)) throw new Error("Bad difficulty from source");

    // Hashrate ≈ difficulty × 2^32 / 600  (hashes/second)
    const H = difficulty * Math.pow(2, 32) / 600;
    const ehs = H / 1e18;

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      hashrate_ehs: ehs,
      difficulty,
      difficulty_trillions: difficulty / 1e12,
      source: "computed from blockchain.info difficulty",
      asOfISO: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(200).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
