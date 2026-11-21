export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>08 · Lista de compras compartible — API</h1>
      <p>
        Servicio backend en Next.js App Router (<code>runtime = &quot;nodejs&quot;</code>) con
        Firebase Admin SDK y validación Zod.
      </p>
      <p>
        Estado del servicio: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
