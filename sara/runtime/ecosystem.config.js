const path = require("path");

const saraRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(saraRoot, "..");

module.exports = {
  apps: [
    {
      name: "sara-backend",
      cwd: saraRoot,
      script: path.join(saraRoot, "backend", "server.js"),
      env: {
        SARA_PORT: "4301",
        SARA_FRONTEND_ORIGIN: "http://127.0.0.1:4173"
      }
    },
    {
      name: "sara-frontend",
      cwd: saraRoot,
      script: path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
      args: "preview frontend --host 0.0.0.0 --port 4173",
      env: {
        VITE_SARA_API_BASE_URL: "http://127.0.0.1:4301"
      }
    }
  ]
};
