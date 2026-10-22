const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const sharp = require("sharp");
const storage = require("./fxmind-storage");
const { prepareImage, resizeImage, MAX_INPUT_BYTES } = require("./lib/image-tools");
const { listTools } = require("./mcp-server");

function mcp(root, overrides = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FXMIND_TARGET: root, FXMIND_MCP_READONLY: "0", ...overrides },
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response);
  });
  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`MCP timeout: ${method}`)); }, 15_000);
        pending.set(requestId, (response) => { clearTimeout(timer); pending.delete(requestId); resolve(response.result); });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
      });
    },
    async close() {
      lines.close();
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    },
  };
}

describe("S3 image tools", () => {
  let root, server, endpoint, requests, objects, savedEnv;
  const writeConfig = (config) => fs.writeFileSync(path.join(root, ".fxmind", "storage.json"), JSON.stringify(config));

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxstorage-"));
    fs.mkdirSync(path.join(root, ".fxmind"));
    await sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toFile(path.join(root, "source.png"));
    requests = [];
    objects = new Map();
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) if (key.startsWith("FXMIND_S3_")) delete process.env[key];
    process.env.AWS_ACCESS_KEY_ID = "test-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret-never-return";
    delete process.env.AWS_SESSION_TOKEN;
    server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      requests.push({ url: req.url, headers: req.headers, body, method: req.method });
      if (objects.has(req.url) && req.headers["if-none-match"] === "*") {
        res.writeHead(412, { "content-type": "application/xml" });
        return res.end("<Error><Code>PreconditionFailed</Code></Error>");
      }
      objects.set(req.url, body);
      res.writeHead(200, { ETag: '"test-etag"' });
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resizes to exact dimensions, preserves transparency, strips metadata and keeps the source intact", async () => {
    const original = fs.readFileSync(path.join(root, "source.png"));
    const result = await resizeImage(root, { path: "source.png", outputPath: "out/banner.png", width: 320, height: 320, fit: "cover" });
    assert.equal(result.width, 320);
    assert.equal(result.height, 320);
    const metadata = await sharp(fs.readFileSync(result.outputPath)).metadata();
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.format, "png");
    assert.equal(metadata.exif, undefined);
    assert.deepEqual(fs.readFileSync(path.join(root, "source.png")), original);
    await assert.rejects(resizeImage(root, { path: "source.png", outputPath: "out/banner.png" }), /EEXIST/);
  });

  it("fits without enlargement by default, supports one dimension and exact contain/fill", async () => {
    const narrow = await prepareImage(root, { path: "source.png", width: 200 });
    assert.equal(narrow.image.width, 200);
    assert.equal(narrow.image.height, 100);
    const small = await prepareImage(root, { path: "source.png" });
    assert.equal(small.image.width, 800);
    assert.equal(small.image.height, 400);
    assert.equal(small.image.format, "png");
    const webp = await prepareImage(root, { path: "source.png", format: "webp" });
    assert.equal(webp.image.format, "webp");
    for (const fit of ["contain", "fill"]) {
      const exact = await prepareImage(root, { path: "source.png", width: 900, height: 900, fit, format: "png" });
      assert.equal(exact.image.width, 900);
      assert.equal(exact.image.height, 900);
    }
  });

  it("applies EXIF orientation before resizing and strips it", async () => {
    await sharp({ create: { width: 120, height: 60, channels: 3, background: "red" } })
      .jpeg().withMetadata({ orientation: 6 }).toFile(path.join(root, "oriented.jpg"));
    const result = await prepareImage(root, { path: "oriented.jpg", height: 40 });
    assert.equal(result.image.width, 20);
    assert.equal(result.image.height, 40);
    assert.equal((await sharp(result.data).metadata()).orientation, undefined);
  });

  it("rejects invalid dimensions, formats, byte budgets and output paths before writing", async () => {
    for (const args of [{ width: 0 }, { width: 100.5 }, { height: 9000 }, { width: 8192, height: 8192 },
      { width: 20, fit: "cover" }, { fit: "bad" }, { format: "svg" }, { maxBytes: -1 }, { maxBytes: 1 }]) {
      await assert.rejects(resizeImage(root, { path: "source.png", outputPath: "out.png", ...args }));
    }
    await assert.rejects(resizeImage(root, { path: "source.png", outputPath: "wrong.jpg" }), /extension/);
    await assert.rejects(resizeImage(root, { path: "source.png", outputPath: "source.png", format: "png" }), /differ/);
    assert.equal(fs.existsSync(path.join(root, "out.png")), false);
  });

  it("refuses oversized inputs, SVG and non-images, even with a raster extension", async () => {
    fs.writeFileSync(path.join(root, "fake.png"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    await assert.rejects(prepareImage(root, { path: "fake.png" }), /raster/);
    fs.writeFileSync(path.join(root, "fake.png"), "not an image");
    await assert.rejects(prepareImage(root, { path: "fake.png" }));
    const large = path.join(root, "large.png");
    fs.closeSync(fs.openSync(large, "w"));
    fs.truncateSync(large, MAX_INPUT_BYTES + 1);
    await assert.rejects(prepareImage(root, { path: large }), /50 MiB/);
  });

  it("refuses animation instead of silently uploading its first frame", async () => {
    const red = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
    const blue = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
    await sharp([red, blue], { join: { animated: true } }).gif().toFile(path.join(root, "animated.gif"));
    writeConfig({ endpoint, bucket: "test-assets" });
    await assert.rejects(storage.uploadImage(root, { path: "animated.gif" }), /Animated or multipage/);
    assert.equal(requests.length, 0);
  });

  it("loads env overrides, hides secrets and reports missing/malformed configuration", () => {
    assert.equal(storage.status(root, {}).configured, false);
    writeConfig({ endpoint, bucket: "test-assets", region: "auto", prefix: "media", publicBaseUrl: "https://cdn.example.com" });
    const result = storage.status(root, { FXMIND_S3_BUCKET: "env-assets", FXMIND_S3_FORCE_PATH_STYLE: "false", AWS_SECRET_ACCESS_KEY: "secret" });
    assert.equal(result.bucket, "env-assets");
    assert.equal(result.forcePathStyle, false);
    assert.equal(result.region, "auto");
    assert.equal(JSON.stringify(result).includes("secret"), false);
    writeConfig({ endpoint: "https://user:password@example.com", bucket: "test-assets" });
    assert.equal(storage.status(root, {}).ok, false);
    assert.equal(JSON.stringify(storage.status(root, {})).includes("password"), false);
    fs.writeFileSync(path.join(root, ".fxmind", "storage.json"), "malformed SECRET");
    assert.equal(storage.status(root, {}).error.includes("SECRET"), false);
  });

  it("loads the target project's .env for MCP uploads without exposing or globally installing credentials", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    fs.writeFileSync(path.join(root, ".env"), [
      "# Credentials stay in the target project",
      'AWS_ACCESS_KEY_ID="dotenv-access-key"',
      'AWS_SECRET_ACCESS_KEY="dotenv-secret#with spaces"',
      "AWS_SESSION_TOKEN=dotenv-session-token",
      `FXMIND_S3_ENDPOINT=${endpoint}`,
      "FXMIND_S3_BUCKET=dotenv-assets # bucket comment",
      "FXMIND_S3_REGION=auto",
    ].join("\n"));
    const configured = storage.status(root);
    assert.equal(configured.configured, true);
    assert.equal(configured.bucket, "dotenv-assets");
    assert.equal(configured.region, "auto");
    assert.equal(/dotenv-access-key|dotenv-secret|dotenv-session-token/.test(JSON.stringify(configured)), false);
    assert.ok(listTools(root).some((tool) => tool.name === "fxmind_storage_upload_image"));
    const client = mcp(root);
    try {
      const uploaded = await client.call("tools/call", { name: "fxmind_storage_upload_image", arguments: { path: "source.png" } });
      assert.equal(uploaded.isError, false);
      assert.equal(JSON.parse(uploaded.content[0].text).bucket, "dotenv-assets");
      assert.match(requests[0].headers.authorization, /Credential=dotenv-access-key\//);
      assert.equal(requests[0].headers["x-amz-security-token"], "dotenv-session-token");
      assert.equal(process.env.AWS_ACCESS_KEY_ID, undefined);
      assert.equal(process.env.AWS_SESSION_TOKEN, undefined);
    } finally { await client.close(); }
  });

  it("gives process environment precedence over .env and rejects incomplete credentials", async () => {
    fs.writeFileSync(path.join(root, ".env"), [
      "AWS_ACCESS_KEY_ID=dotenv-access-key",
      "AWS_SECRET_ACCESS_KEY=dotenv-secret",
      `FXMIND_S3_ENDPOINT=${endpoint}`,
      "FXMIND_S3_BUCKET=dotenv-assets",
    ].join("\n"));
    process.env.FXMIND_S3_BUCKET = "process-assets";
    const uploaded = await storage.uploadImage(root, { path: "source.png" });
    assert.equal(uploaded.bucket, "process-assets");
    assert.match(requests[0].headers.authorization, /Credential=test-access-key\//);
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    fs.writeFileSync(path.join(root, ".env"), "AWS_ACCESS_KEY_ID=partial-secret");
    await assert.rejects(storage.uploadImage(root, { path: "source.png" }), (error) => {
      assert.match(error.message, /Set both/);
      assert.equal(error.message.includes("partial-secret"), false);
      return true;
    });
    assert.equal(requests.length, 1);
  });

  it("protects the target project's .env when installing ignore rules", () => {
    require("./lib/project-gitignore").ensureProjectGitignore(root);
    assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /^\.env$/m);
  });

  it("uploads real encoded bytes via signed S3 PutObject and refuses accidental replacement", async () => {
    writeConfig({ endpoint, bucket: "test-assets", publicBaseUrl: "https://cdn.example.com/assets", prefix: "media" });
    const result = await storage.uploadImage(root, { path: "source.png", key: "banners/a b.png", width: 160, height: 90, fit: "cover", maxBytes: 10000 });
    assert.equal(result.key, "media/banners/a b.png");
    assert.equal(result.publicUrl, "https://cdn.example.com/assets/media/banners/a%20b.png");
    assert.equal(requests[0].method, "PUT");
    assert.equal(requests[0].url, "/test-assets/media/banners/a%20b.png?x-id=PutObject");
    assert.match(requests[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access-key\//);
    assert.equal(requests[0].headers["content-type"], "image/png");
    assert.equal(requests[0].headers["content-length"], String(result.bytes));
    assert.equal(requests[0].headers["if-none-match"], "*");
    const metadata = await sharp(requests[0].body).metadata();
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 90);
    await assert.rejects(storage.uploadImage(root, { path: "source.png", key: "banners/a b.png" }), /already exists/);
    await storage.uploadImage(root, { path: "source.png", key: "banners/a b.png", overwrite: true });
    assert.equal(requests.at(-1).headers["if-none-match"], undefined);
  });

  it("enforces byte limits and key validation before any upload; generates unique keys without assuming public access", async () => {
    writeConfig({ endpoint, bucket: "test-assets", maxBytes: 50000 });
    for (const args of [{ maxBytes: 50001 }, { maxBytes: 1 }, { key: "../escape.png" }, { key: "wrong.webp" }, { overwrite: "false" }]) {
      await assert.rejects(storage.uploadImage(root, { path: "source.png", ...args }));
    }
    assert.equal(requests.length, 0);
    const a = await storage.uploadImage(root, { path: "source.png" });
    const b = await storage.uploadImage(root, { path: "source.png" });
    assert.notEqual(a.key, b.key);
    assert.ok(a.key.endsWith(".png"));
    assert.equal(a.contentType, "image/png");
    assert.equal(a.publicUrl, null);
    assert.ok(a.bytes <= 50000);
    assert.ok(!JSON.stringify(a).includes("test-secret"));
  });

  it("reports provider errors without echoing response secrets or signed URLs", async () => {
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      req.resume();
      res.writeHead(403, { "content-type": "application/xml" });
      res.end("<Error><Code>AccessDenied</Code><Message>test-secret-never-return signed-url-secret</Message></Error>");
    });
    writeConfig({ endpoint, bucket: "test-assets" });
    await assert.rejects(storage.uploadImage(root, { path: "source.png" }), (error) => {
      assert.match(error.message, /403/);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
  });

  it("lists upload only when configured, keeps local tools available and protects read-only hosts", async () => {
    const names = (env) => listTools(root, env).map((tool) => tool.name);
    assert.ok(names({}).includes("fxmind_image_resize"));
    assert.ok(names({}).includes("fxmind_storage_upload_image"));
    assert.ok(!names({ FXMIND_MCP_TOOLS: "auto" }).includes("fxmind_storage_upload_image"));
    assert.ok(names({ FXMIND_S3_BUCKET: "test-assets" }).includes("fxmind_storage_upload_image"));
    assert.ok(names({ FXMIND_MCP_TOOLS: "storage" }).includes("fxmind_storage_upload_image"));
    const readOnly = names({ FXMIND_MCP_READONLY: "1", FXMIND_MCP_TOOLS: "all" });
    assert.ok(readOnly.includes("fxmind_storage_status"));
    assert.ok(!readOnly.includes("fxmind_image_resize"));
    assert.ok(!readOnly.includes("fxmind_storage_upload_image"));
    const client = mcp(root, { FXMIND_MCP_READONLY: "1" });
    try {
      for (const name of ["fxmind_image_resize", "fxmind_storage_upload_image"]) {
        const result = await client.call("tools/call", { name, arguments: { path: "source.png", outputPath: "blocked.png" } });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /read-only/);
      }
      assert.equal(fs.existsSync(path.join(root, "blocked.png")), false);
      assert.equal(requests.length, 0);
    } finally { await client.close(); }
  });

  it("exercises initialize, listing, resize, upload and error propagation through public MCP stdio", async () => {
    writeConfig({ endpoint, bucket: "test-assets" });
    const client = mcp(root);
    try {
      assert.equal((await client.call("initialize", {})).serverInfo.name, "fxmind");
      assert.ok((await client.call("tools/list")).tools.some((tool) => tool.name === "fxmind_storage_upload_image"));
      const resized = await client.call("tools/call", { name: "fxmind_image_resize", arguments: { path: "source.png", outputPath: "local.png", width: 100 } });
      assert.equal(resized.isError, false);
      assert.equal(JSON.parse(resized.content[0].text).height, 50);
      const uploaded = await client.call("tools/call", { name: "fxmind_storage_upload_image", arguments: { path: "local.png", format: "jpeg", key: "banner.jpg" } });
      assert.equal(uploaded.isError, false);
      assert.equal(JSON.parse(uploaded.content[0].text).contentType, "image/jpeg");
      const failed = await client.call("tools/call", { name: "fxmind_storage_upload_image", arguments: { path: "local.png", maxBytes: 1 } });
      assert.equal(failed.isError, true);
      assert.equal(requests.length, 1);
    } finally { await client.close(); }
  });
});
