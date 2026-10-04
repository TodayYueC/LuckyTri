import { registerHooks } from "node:module";

// A plugin process may use the language. It may not open the database, start
// another process, or reach the network unless it was explicitly allowed to.
const raw = process.env.LUCKYTRI_NET_RAW === "1";
const blocked = new Set([
  "sqlite",
  "child_process",
  "worker_threads",
  "cluster",
  "inspector",
  ...(raw
    ? []
    : ["net", "http", "https", "tls", "dgram", "dns", "http2", "tls"]),
]);

function denied(specifier) {
  const name = String(specifier || "").replace(/^node:/, "");
  const root = name.split("/")[0];
  return blocked.has(name) || blocked.has(root);
}

registerHooks({
  resolve(specifier, context, next) {
    if (denied(specifier)) {
      const error = new Error("插件没有这个能力");
      error.code = "ERR_PLUGIN_DENIED";
      throw error;
    }
    return next(specifier, context);
  },
});

process.kill = () => {
  throw new Error("插件不能结束别的进程");
};
