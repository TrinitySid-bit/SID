import dynamic from "next/dynamic";
import Head from "next/head";
import Disclaimer from "../components/Disclaimer";

// Lazy-load the heavy chart code client-side
const EnergyCapBTCModel = dynamic(() => import("../components/EnergyCapBTCModel"), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>SID Model — Scarcity • Incentives • Demand</title>
        <meta
          name="description"
          content="A disciplined, energy-based way to price Bitcoin across any time horizon."
        />
      </Head>
      <main className="min-h-screen p-4 sm:p-6 md:p-8">
        <div className="mx-auto max-w-6xl">
          <EnergyCapBTCModel />
          <Disclaimer />
        </div>
      </main>
    </>
  );
}
