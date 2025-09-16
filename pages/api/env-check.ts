import type { NextApiRequest, NextApiResponse } from "next";
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const bls = process.env.BLS_API_KEY || "";
  const eia = process.env.EIA_API_KEY || "";
  res.status(200).json({
    ok: true,
    blsKeyPresent: !!bls,
    blsKeyLen: bls.length,
    eiaKeyPresent: !!eia,
    eiaKeyLen: eia.length,
  });
}
