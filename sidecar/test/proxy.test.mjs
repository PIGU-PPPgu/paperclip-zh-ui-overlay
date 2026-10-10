import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createChineseProxy } from "../proxy.mjs";

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

test("only loopback origins are accepted", () => {
  assert.throws(() => createChineseProxy({ upstreamUrl: "https://example.com", assetsDir }), /loopback HTTP/);
  assert.throws(() => createChineseProxy({ bindHost: "0.0.0.0", assetsDir }), /loopback host/);
});

test("injects Chinese UI without changing API responses or POST bodies", async () => {
  const upstream = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", version: "2026.916.1" }));
      return;
    }
    if (request.url === "/api/echo") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), forwardedHost: request.headers["x-forwarded-host"] }));
      });
      return;
    }
    if (request.url === "/plain") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>no head</body></html>");
      return;
    }
    if (request.url === "/old") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<html><head><script defer src="/paperclip-zh/overlay.js?v=old"></script></head><body>old</body></html>');
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `http://127.0.0.1:${upstream.address().port}/CMP/issues` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-cache" });
    response.end("<!doctype html><html><head><title>Paperclip</title></head><body>Tasks</body></html>");
  });
  const upstreamPort = await listen(upstream);
  const proxy = createChineseProxy({ upstreamUrl: `http://127.0.0.1:${upstreamPort}`, assetsDir, bindPort: 0 });
  const address = await proxy.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(`${origin}/CMP/issues`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-paperclip-zh"), "injected");
    assert.match(await page.text(), /<script defer src="\/paperclip-zh\/overlay\.js\?v=[a-f0-9]{12}"><\/script>/);
    const asset = await fetch(`${origin}/paperclip-zh/overlay.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /paperclip\.ui\.locale/);
    const health = await fetch(`${origin}/_paperclip_zh/health`);
    assert.deepEqual((await health.json()).status, "ok");
    const rawHealth = await fetch(`${origin}/api/health`);
    assert.deepEqual(await rawHealth.json(), { status: "ok", version: "2026.916.1" });
    const post = await fetch(`${origin}/api/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hello" }) });
    assert.deepEqual((await post.json()).body, '{"message":"hello"}');
    const plain = await fetch(`${origin}/plain`);
    assert.equal(plain.headers.get("x-paperclip-zh"), "unchanged");
    assert.equal(await plain.text(), "<html><body>no head</body></html>");
    const old = await fetch(`${origin}/old`);
    const oldBody = await old.text();
    assert.equal((oldBody.match(/paperclip-zh\/overlay\.js/g) ?? []).length, 1);
    assert.doesNotMatch(oldBody, /v=old/);
    const redirect = await fetch(`${origin}/redirect`, { redirect: "manual" });
    assert.equal(redirect.headers.get("location"), `${origin}/CMP/issues`);
  } finally {
    await close(proxy.server);
    await close(upstream);
  }
});
