function createStateEngine() {
  const sharedState = {
    identity: {
      name: "SARA",
      mode: "ws0-runtime-foundation"
    },
    services: {
      backend: "up",
      frontend: "expected",
      stateEngine: "stubbed-singleton"
    },
    display: {
      surface: "always-on",
      route: "/"
    },
    nextWorkstreams: ["WS1", "WS2"]
  };

  return {
    getRuntimeSnapshot() {
      return {
        generatedAt: new Date().toISOString(),
        deviceTarget: "Raspberry Pi 5",
        sharedState
      };
    }
  };
}

module.exports = { createStateEngine };
