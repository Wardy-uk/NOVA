import { useEffect, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_SARA_API_BASE_URL || "http://127.0.0.1:4301";

function StatusCard({ label, value }) {
  return (
    <div className="status-card">
      <span className="status-label">{label}</span>
      <strong className="status-value">{value}</strong>
    </div>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadRuntime() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/runtime`);
        if (!response.ok) {
          throw new Error(`Runtime request failed with ${response.status}`);
        }

        const payload = await response.json();
        if (active) {
          setRuntime(payload.runtime);
          setError("");
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unknown runtime error");
        }
      }
    }

    loadRuntime();
    const pollHandle = window.setInterval(loadRuntime, 15000);

    return () => {
      active = false;
      window.clearInterval(pollHandle);
    };
  }, []);

  const sharedState = runtime?.sharedState;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">WS0 Runtime Foundation</p>
        <h1>SARA is running as one shared system surface.</h1>
        <p className="lede">
          This baseline proves the Pi runtime path, backend reachability, and frontend-to-backend
          connectivity without stepping into later workstreams.
        </p>
      </section>

      <section className="status-grid">
        <StatusCard label="Backend API" value={sharedState?.services.backend || "loading"} />
        <StatusCard label="Frontend Surface" value={sharedState?.services.frontend || "loading"} />
        <StatusCard label="State Model" value={sharedState?.services.stateEngine || "loading"} />
        <StatusCard label="Target Device" value={runtime?.deviceTarget || "loading"} />
      </section>

      <section className="panel">
        <h2>Runtime contract</h2>
        {error ? (
          <p className="error">Backend connectivity failed: {error}</p>
        ) : (
          <>
            <p>Identity: {sharedState?.identity.name || "loading"}</p>
            <p>Mode: {sharedState?.identity.mode || "loading"}</p>
            <p>Display route: {sharedState?.display.route || "loading"}</p>
            <p>Generated: {runtime?.generatedAt || "loading"}</p>
          </>
        )}
      </section>
    </main>
  );
}
