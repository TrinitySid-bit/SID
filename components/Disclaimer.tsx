export default function Disclaimer() {
  return (
    <section className="card p-4 mt-6" aria-label="Disclaimer">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-bitcoin">Disclaimer</h2>
      <p className="text-sm mt-2 leading-relaxed">
        Education only, not financial advice — All models are inherently wrong and should be treated as such.
        All your models will be destroyed. This is designed exclusively to help visualize future value/demand
        for your stack, today. I encourage you, strongly, to get off zero. This project is dedicated to my Son,
        the world needs more bitcoiners.
      </p>
      <p className="text-xs text-fg-subtle mt-3">
        © {new Date().getFullYear()} SID Model
      </p>
    </section>
  );
}
