import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { running, localServiceRequest } from "../scripts/service.js";
import { runtimePaths } from "../server/paths.js";
test("updater lifecycle requests bypass model/search proxies and remain bounded", async (t) => {
  let calls = 0;
  const server = http
    .createServer((req, res) => {
      calls++;
      if (req.url === "/slow") return;
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          assert.equal(body, "{}");
          res.end(JSON.stringify({ ok: true }));
        });
      } else
        res.end(
          JSON.stringify({
            app: "luckytri",
            home: runtimePaths().home,
            version: "fixture",
            pid: process.pid,
          }),
        );
    })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`,
    fetcher = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("proxy request must not be used");
  };
  try {
    assert.equal((await running({ base, local: true })).pid, process.pid);
    assert.equal(
      (
        await (
          await localServiceRequest(base + "/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).json()
      ).ok,
      true,
    );
    await assert.rejects(
      localServiceRequest(base + "/slow", { timeout: 50 }),
      /超时/,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = fetcher;
  }
});
