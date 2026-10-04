// An in-process stand-in for the host, so a plugin can be exercised without
// starting the sandbox. It records calls; it does not grant real abilities.
export function fakeContext(id = "example") {
  const calls = [];
  const note = (method, params) => {
    calls.push({ method, params });
    return Promise.resolve({ ok: true });
  };
  const ctx = {
    plugin: { id, version: "0.0.0", dataDir: "" },
    api: { version: "1.0", has: () => true },
    now: () => Promise.resolve(0),
    log: {
      info: (...a) => note("log", a),
      warn: (...a) => note("log", a),
      error: (...a) => note("log", a),
    },
    settings: { get: () => Promise.resolve({}), onChange() {} },
    storage: {
      get: () => Promise.resolve(null),
      set: (key, value) => note("storage.set", { key, value }),
      delete: (key) => note("storage.delete", { key }),
      list: () => Promise.resolve([]),
    },
    net: { fetch: (url) => note("net.fetch", { url }) },
    mind: {
      state: () => note("mind.state"),
      observe: (input) => note("observe", input),
      on() {},
    },
    senses: {
      set: (key, sense) => note("senses.set", { key, sense }),
      clear: (key) => note("senses.clear", { key }),
    },
    knowledge: { offer: (doc) => note("knowledge.offer", doc) },
    activities: {
      handle: (kind) => note("activities.handle", { kind }),
      setAvailable: (kind, reason) =>
        note("activities.available", { kind, reason }),
    },
    actions: { handle: (name) => note("actions.handle", { name }) },
    perceive: { handle: (type) => note("perceive.handle", { type }) },
    channel: {
      provide: (type) => note("channel.provide", { type }),
      receive: (type, message) => note("channel.receive", { type, message }),
      status: (type, status) => note("channel.status", { type, status }),
      reachable: () => Promise.resolve({ ok: true }),
    },
    models: { call: (req) => note("models.call", req) },
    http: {
      route: (method, path) => note("http.route", { method, path }),
      hook: (method, path) => note("http.hook", { method, path }),
    },
    status: { set: (status) => note("status.set", status) },
    notify: (notice) => note("notify", notice),
  };
  return { ctx, calls };
}
