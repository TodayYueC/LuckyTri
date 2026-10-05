import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertPublicHost } from "../core/net-guard.js";
import { VERSION } from "../version.js";
import { readManifest, satisfies, validateManifest } from "./manifest.js";
import { readZip, stripRoot, writeTree } from "./zip.js";

const DOWNLOAD = 20 * 1024 * 1024;
const STAGED_FOR = 30 * 60000;

async function download(url, hops = 0, timeoutMs = 30000) {
  if (hops > 3) throw new Error("跳转过多");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("这个地址不能访问");
  await assertPublicHost(parsed.hostname, lookup, "这个地址不能访问");
  let response;
  try {
    response = await fetch(parsed, {
      redirect: "manual",
      headers: { "User-Agent": `LuckyTri/${VERSION}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("插件包下载失败");
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const next = new URL(response.headers.get("location") || "", parsed).href;
    return download(next, hops + 1, timeoutMs);
  }
  if (!response.ok) throw new Error("插件包下载失败");
  const length = Number(response.headers.get("content-length"));
  if (length > DOWNLOAD) throw new Error("插件包过大");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > DOWNLOAD) throw new Error("插件包过大");
  return bytes;
}

function preview(bytes, { source, trusted = false, sha256 = "" }) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (sha256 && sha256.toLowerCase() !== hash)
    throw new Error("插件包校验不符");
  const files = stripRoot(readZip(bytes));
  const manifestFile = files.find(
    (file) => file.name === "luckytri-plugin.json",
  );
  if (!manifestFile) throw new Error("插件清单无法读取");
  const manifest = validateManifest(
    JSON.parse(manifestFile.bytes.toString("utf8")),
  );
  return {
    token: randomUUID(),
    bytes,
    files,
    manifest,
    sha256: hash,
    source,
    trusted: trusted && !!sha256,
    at: Date.now(),
  };
}

export function createInstaller(host) {
  const staged = new Map();
  function remember(item) {
    for (const [token, old] of staged)
      if (Date.now() - old.at > STAGED_FOR) staged.delete(token);
    staged.set(item.token, item);
    return describe(item);
  }
  function describe(item) {
    return {
      token: item.token,
      trusted: item.trusted,
      sha256: item.sha256,
      source: item.source,
      manifest: item.manifest,
      permissions: item.manifest.permissions,
      network: item.manifest.network,
    };
  }
  return {
    async stageUrl({ url, sha256 = "" }) {
      const bytes = await download(url);
      return remember(
        preview(bytes, { source: "url", sha256, trusted: !!sha256 }),
      );
    },
    async stageRegistry({ url, sha256, id }) {
      const bytes = await download(url);
      const item = preview(bytes, { source: "market", sha256, trusted: true });
      if (id && item.manifest.id !== id) throw new Error("插件包和索引不一致");
      return remember(item);
    },
    async stageGithub(repository) {
      const parsed = new URL(repository);
      if (parsed.hostname !== "github.com") throw new Error("这个地址不能访问");
      const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
      if (!owner || !repo) throw new Error("插件仓库地址无效");
      const name = repo.replace(/\.git$/, "");
      let bytes;
      try {
        const release = await download(
          `https://api.github.com/repos/${owner}/${name}/releases/latest`,
        );
        const data = JSON.parse(bytesToText(release));
        const asset = (data.assets || []).find((item) =>
          String(item.name || "").endsWith(".zip"),
        );
        bytes = await download(asset?.browser_download_url || data.zipball_url);
      } catch {
        bytes = await download(
          `https://codeload.github.com/${owner}/${name}/zip/refs/heads/main`,
        );
      }
      return remember(preview(bytes, { source: "github", trusted: false }));
    },
    stageUpload(bytes) {
      return remember(
        preview(Buffer.from(bytes), { source: "upload", trusted: false }),
      );
    },
    stageDir(dir) {
      const manifest = readManifest(dir);
      const item = {
        token: randomUUID(),
        dir,
        manifest,
        sha256: "",
        source: "dev",
        trusted: false,
        at: Date.now(),
      };
      return remember(item);
    },
    commit(token) {
      const item = staged.get(token);
      if (!item || Date.now() - item.at > STAGED_FOR)
        throw new Error("这次导入已经过期");
      const { manifest } = item;
      const target =
        item.source === "dev"
          ? item.dir
          : join(host.dataRoot, manifest.id, manifest.version);
      if (item.source !== "dev") {
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        writeTree(target, item.files);
        const checked = readManifest(target);
        if (checked.id !== manifest.id || checked.version !== manifest.version)
          throw new Error("插件包和索引不一致");
      }
      host.db
        .prepare(
          `INSERT INTO plugin_installs(id,version,enabled,state,source,sha256,api,permissions,granted,manifest,path,error,installed,updated)
           VALUES (?,?,0,'installed',?,?,?,?,'[]',?,?, '',?,?)
           ON CONFLICT(id) DO UPDATE SET version=excluded.version,source=excluded.source,sha256=excluded.sha256,api=excluded.api,permissions=excluded.permissions,manifest=excluded.manifest,path=excluded.path,error='',updated=excluded.updated`,
        )
        .run(
          manifest.id,
          manifest.version,
          item.source,
          item.sha256,
          manifest.pluginApi,
          JSON.stringify(manifest.permissions),
          JSON.stringify(manifest),
          target,
          host.now(),
          host.now(),
        );
      staged.delete(token);
      host.store.revision++;
      return host.list().find((row) => row.id === manifest.id);
    },
    async registries() {
      const saved = host.db
        .prepare("SELECT id,url FROM plugin_sources ORDER BY created")
        .all();
      if (saved.length) return saved;
      const url =
        "https://raw.githubusercontent.com/TodayYueC/LuckyTri-Plugins/main/index.json";
      return [{ id: "default", url }];
    },
    saveRegistry(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("这个地址不能访问");
      const id = createHash("sha256").update(url).digest("hex").slice(0, 16);
      host.db
        .prepare(
          "INSERT INTO plugin_sources(id,url,created) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url",
        )
        .run(id, url, host.now());
      return id;
    },
    removeRegistry(id) {
      host.db.prepare("DELETE FROM plugin_sources WHERE id=?").run(id);
    },
    async catalog() {
      const plugins = [];
      let unavailable = false;
      for (const source of await this.registries()) {
        try {
          const bytes = await download(source.url, 0, 8000);
          const index = JSON.parse(bytes.toString("utf8"));
          if (index.format !== 1 || !Array.isArray(index.plugins))
            throw new Error("插件索引无效");
          for (const plugin of index.plugins) {
            const versions = (plugin.versions || []).filter(
              (item) =>
                item.pluginApi &&
                satisfies(item.luckytri || ">=1.0.0 <2.0.0", VERSION),
            );
            if (!versions.length) continue;
            plugins.push({
              ...plugin,
              source: source.url,
              versions,
              latest: versions[versions.length - 1],
            });
          }
        } catch {
          unavailable = true;
        }
      }
      return { plugins, unavailable };
    },
    async remove(id, { data = false } = {}) {
      await host.disable(id);
      const row = host.db
        .prepare("SELECT * FROM plugin_installs WHERE id=?")
        .get(id);
      if (row?.source !== "builtin" && row?.source !== "dev" && row?.path)
        rmSync(row.path, { recursive: true, force: true });
      if (data) {
        rmSync(join(host.dataRoot, id, "data"), {
          recursive: true,
          force: true,
        });
        host.db
          .prepare("DELETE FROM plugin_settings WHERE plugin_id=?")
          .run(id);
        host.db.prepare("DELETE FROM plugin_kv WHERE plugin_id=?").run(id);
      }
      if (row?.source !== "builtin")
        host.db.prepare("DELETE FROM plugin_installs WHERE id=?").run(id);
      else
        host.db
          .prepare(
            "UPDATE plugin_installs SET enabled=0,state='installed',granted='[]' WHERE id=?",
          )
          .run(id);
      host.store.revision++;
      return host.list();
    },
    rollback(id) {
      const row = host.db
        .prepare("SELECT * FROM plugin_installs WHERE id=?")
        .get(id);
      if (!row) throw new Error("插件不存在");
      const parent = join(host.dataRoot, id);
      const versions = readdirSync(parent).filter(
        (name) => name !== "data" && name !== row.version,
      );
      const previous = versions.sort().at(-1);
      if (!previous) throw new Error("没有可以退回的版本");
      const dir = join(parent, previous);
      const manifest = readManifest(dir);
      host.db
        .prepare(
          "UPDATE plugin_installs SET version=?,path=?,manifest=?,permissions=?,updated=? WHERE id=?",
        )
        .run(
          manifest.version,
          dir,
          JSON.stringify(manifest),
          JSON.stringify(manifest.permissions),
          host.now(),
          id,
        );
      host.store.revision++;
      return host.list().find((item) => item.id === id);
    },
  };
}

function bytesToText(bytes) {
  return Buffer.from(bytes).toString("utf8");
}

export function copyPlugin(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}
