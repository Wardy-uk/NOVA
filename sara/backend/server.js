const express = require("express");
const cors = require("cors");

const { createStateEngine } = require("./src/state/stateEngine");
const { getIntegrationStatus } = require("./src/integrations");

const port = Number(process.env.SARA_PORT || 4301);
const frontendOrigin = process.env.SARA_FRONTEND_ORIGIN || "*";
const stateEngine = createStateEngine();

const app = express();

app.use(express.json());
app.use(cors({ origin: frontendOrigin }));

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "sara-backend",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/runtime", (_req, res) => {
  res.json({
    ok: true,
    runtime: stateEngine.getRuntimeSnapshot(),
    integrations: getIntegrationStatus()
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`SARA backend listening on http://0.0.0.0:${port}`);
});
