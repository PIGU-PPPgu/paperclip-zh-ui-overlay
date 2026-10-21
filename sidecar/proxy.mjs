import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import httpProxy from "http-proxy";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAssetsDir = path.resolve(moduleDir, "..");
const allowedAssets = new Map([
  ["/paperclip-zh/overlay.js", ["overlay.js", "text/javascript; charset=utf-8"]],
  ["/paperclip-zh/overrides.zh-CN.json", ["overrides.zh-CN.json", "application/json; charset=utf-8"]],
  ["/paperclip-zh/zh-CN.community.json", ["vendor/penclip-zh-CN.json", "application/json; charset=utf-8"]],
]);

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function parsePublicOrigin(value) {
  if (value == null || value === "") return null;
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))
    || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Chinese UI public origin must be an HTTPS origin or loopback HTTP origin");
  }
  return url;
}

function copyHeaders(headers, { html = false, upstreamOrigin = null, proxyOrigin = null } = {}) {
  const result = { ...headers };
  for (const key of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) {
    delete result[key];
  }
  if (html) {
    delete result["content-length"];
    delete result["content-encoding"];
    delete result.etag;
    result["cache-control"] = "no-cache";
  }
  if (upstreamOrigin && proxyOrigin && typeof result.location === "string" && result.location.startsWith(upstreamOrigin)) {
    result.location = proxyOrigin + result.location.slice(upstreamOrigin.length);
  }
  return result;
}

export function createChineseProxy({
  upstreamUrl = "http://127.0.0.1:3100",
  assetsDir = defaultAssetsDir,
  bindHost = "127.0.0.1",
  bindPort = 3101,
  publicOrigin = null,
} = {}) {
  const upstream = new URL(upstreamUrl);
  const external = parsePublicOrigin(publicOrigin);
  if (upstream.protocol !== "http:" || !isLoopback(upstream.hostname) || upstream.pathname !== "/") {
    throw new Error("Paperclip upstream must be a loopback HTTP origin");
  }
  if (!isLoopback(bindHost) || !Number.isInteger(Number(bindPort)) || Number(bindPort) < 0 || Number(bindPort) > 65535) {
    throw new Error("Chinese UI sidecar must bind to a loopback host and valid port");
  }
  const assetBytes = new Map();
  for (const [urlPath, [relative, contentType]] of allowedAssets) {
    const bytes = readFileSync(path.join(assetsDir, relative));
    assetBytes.set(urlPath, { bytes, contentType });
  }
  const version = createHash("sha256")
    .update(Buffer.concat([...assetBytes.values()].map((entry) => entry.bytes)))
    .digest("hex").slice(0, 12);
  const scriptTag = `<script defer src="/paperclip-zh/overlay.js?v=${version}"></script>`;
  const wsProxy = httpProxy.createProxyServer({ target: upstreamUrl, ws: true, changeOrigin: false });
  wsProxy.on("error", (_error, _request, socket) => {
    if (socket && typeof socket.destroy === "function") socket.destroy();
  });

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/_paperclip_zh/health") {
      const probe = http.get(new URL("/api/health", upstream), (upstreamResponse) => {
        const chunks = [];
        upstreamResponse.on("data", (chunk) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
          let upstreamHealth = null;
          try { upstreamHealth = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
          const ok = upstreamResponse.statusCode === 200 && upstreamHealth?.status === "ok";
          response.writeHead(ok ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(JSON.stringify({ status: ok ? "ok" : "degraded", mode: "external-sidecar", upstreamVersion: upstreamHealth?.version ?? null, assetVersion: version }));
        });
      });
      probe.on("error", () => {
        response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ status: "degraded", mode: "external-sidecar", upstreamVersion: null, assetVersion: version }));
      });
      return;
    }
    const asset = assetBytes.get(pathname);
    if (asset) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }); response.end(); return;
      }
      response.writeHead(200, {
        "content-type": asset.contentType,
        "content-length": asset.bytes.length,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : asset.bytes);
      return;
    }
    if (pathname.startsWith("/paperclip-zh/") || pathname.startsWith("/_paperclip_zh/")) {
      response.writeHead(404); response.end(); return;
    }

    const headers = {
      ...request.headers,
      host: external?.host ?? upstream.host,
      "x-forwarded-host": external?.host ?? request.headers.host ?? `${bindHost}:${bindPort}`,
      "x-forwarded-proto": external ? external.protocol.slice(0, -1) : "http",
      "accept-encoding": "identity",
    };
    const upstreamRequest = http.request(upstream, {
      method: request.method,
      path: request.url,
      headers,
    }, (upstreamResponse) => {
      const isHtml = request.method === "GET" && !pathname.startsWith("/api/")
        && upstreamResponse.statusCode === 200
        && String(upstreamResponse.headers["content-type"] ?? "").toLowerCase().includes("text/html")
        && !upstreamResponse.headers["content-encoding"];
      const headerOptions = { upstreamOrigin: upstream.origin, proxyOrigin: external?.origin ?? `http://${request.headers.host}` };
      if (!isHtml) {
        response.writeHead(upstreamResponse.statusCode ?? 502, copyHeaders(upstreamResponse.headers, headerOptions));
        upstreamResponse.pipe(response);
        return;
      }
      const chunks = [];
      let size = 0;
      upstreamResponse.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) {
          upstreamResponse.destroy();
          response.writeHead(502); response.end("Paperclip UI response exceeded the sidecar limit");
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on("end", () => {
        if (response.writableEnded) return;
        const original = Buffer.concat(chunks).toString("utf8");
        const existingTag = /<script\b[^>]*\bsrc=["']\/paperclip-zh\/overlay\.js[^"']*["'][^>]*><\/script>/i;
        const injected = existingTag.test(original)
          ? original.replace(existingTag, scriptTag)
          : original.includes("</head>")
            ? original.replace("</head>", `  ${scriptTag}\n</head>`)
            : original;
        const body = Buffer.from(injected);
        response.writeHead(upstreamResponse.statusCode ?? 200, {
          ...copyHeaders(upstreamResponse.headers, { ...headerOptions, html: true }),
          "content-length": body.length,
          "x-paperclip-zh": injected === original ? "unchanged" : "injected",
        });
        response.end(body);
      });
      upstreamResponse.on("error", () => {
        if (response.writableEnded) return;
        if (response.headersSent) response.destroy();
        else { response.writeHead(502); response.end(); }
      });
    });
    upstreamRequest.on("error", () => {
      if (response.writableEnded) return;
      if (response.headersSent) response.destroy();
      else { response.writeHead(502); response.end("Paperclip upstream unavailable"); }
    });
    request.pipe(upstreamRequest);
  });
  server.on("upgrade", (request, socket, head) => {
    request.headers["x-forwarded-host"] = external?.host ?? request.headers.host;
    request.headers["x-forwarded-proto"] = external ? external.protocol.slice(0, -1) : "http";
    request.headers.host = external?.host ?? upstream.host;
    wsProxy.ws(request, socket, head);
  });
  return { server, version, listen: () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(bindPort), bindHost, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  }) };
}

export async function startChineseProxy({ aliasPort = null, ...options } = {}) {
  const primary = createChineseProxy(options);
  await primary.listen();
  let alias = null;
  if (aliasPort !== null && Number(aliasPort) !== primary.server.address().port) {
    alias = createChineseProxy({ ...options, bindPort: Number(aliasPort) });
    try { await alias.listen(); }
    catch (error) {
      await new Promise((resolve) => primary.server.close(resolve));
      throw error;
    }
  }
  return { primary, alias };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const endpoints = await startChineseProxy({
    upstreamUrl: process.env.PAPERCLIP_UPSTREAM_URL ?? "http://127.0.0.1:3100",
    assetsDir: process.env.PAPERCLIP_ZH_ASSETS_DIR ?? defaultAssetsDir,
    bindHost: process.env.PAPERCLIP_ZH_BIND_HOST ?? "127.0.0.1",
    bindPort: Number(process.env.PAPERCLIP_ZH_BIND_PORT ?? 3101),
    aliasPort: process.env.PAPERCLIP_ZH_ALIAS_PORT == null ? null : Number(process.env.PAPERCLIP_ZH_ALIAS_PORT),
    publicOrigin: process.env.PAPERCLIP_ZH_PUBLIC_ORIGIN ?? null,
  });
  const ports = [endpoints.primary, endpoints.alias].filter(Boolean).map((endpoint) => endpoint.server.address().port);
  process.stdout.write(`paperclip-zh-sidecar listening on 127.0.0.1:${ports.join(",")}\n`);
}
