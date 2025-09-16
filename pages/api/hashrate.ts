import type { NextApiRequest, NextApiResponse } from "next";

type Ok = {
  ok: true;
  hashrate_ehs: number | null; // ExaHash/s (may be null if source lacks it)
  difficulty: number | null;   // raw
  difficulty_trillions: number | null;
  source: string;
  asOfISO: string;
};
type Err = { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Err>) {
  try {
    // Try mempool.space difficulty-adjustment (doesn't give hashrate reliably but good for diff)
    const r1 = await fetch("https://mempool.space/api/v1/difficulty-adjustment", { cache: "no-store" });
    if (r1.ok) {
      const j = (await r1.json()) as Record<string, unknown>;
      const diff = typeof j.difficulty === "number" ? j.difficulty : Number(j.difficulty);
      const difficulty = Number.isFinite(diff) ? Number(diff) : null;
      const difficulty_trillions = typeof difficulty === "number" ? difficulty / 1e12 : null;

      return res.status(200).json({
        ok: true,
        hashrate_ehs: null,
        difficulty,
        difficulty_trillions,
        source: "mempool.space",
        asOfISO: new Date().toISOString(),
      });
    }

    // Fallback: blockchain.info hashrate (GH/s) and difficulty (raw)
    const [h2, d2] = await Promise.all([
      fetch("https://blockchain.info/q/hashrate?cors=true", { cache: "no-store" }),
      fetch("https://blockchain.info/q/getdifficulty?cors=true", { cache: "no-store" }),
    ]);
    if (h2.ok || d2.ok) {
      const ghText = h2.ok ? await h2.text() : "";
      const diffText = d2.ok ? await d2.text() : "";
      const gh = ghText ? Number(ghText) : NaN;            // GigaHash/s
      const hashrate_ehs = Number.isFinite(gh) ? gh / 1e9 : null; // convert GH/s -> EH/s
      const difficulty = diffText ? Number(diffText) : null;
      const difficulty_trillions = typeof difficulty === "number" ? difficulty / 1e12 : null;

      return res.status(200).json({
        ok: true,
        hashrate_ehs,
        difficulty,
        difficulty_trillions,
        source: "blockchain.info",
        asOfISO: new Date().toISOString(),
      });
    }

    return res.status(502).json({ ok: false, error: "All sources failed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
