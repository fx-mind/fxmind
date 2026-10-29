"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readProjectEnv } = require("./lib/project-env");
const { prepareImage, integer, checkExtension, MAX_DIMENSION, MAX_INPUT_BYTES, DEFAULT_MAX_BYTES } = require("./lib/image-tools");

let s3Sdk;
function getS3Sdk() {
  if (s3Sdk) return s3Sdk;
  try {
    s3Sdk = require("@aws-sdk/client-s3");
  } catch (error) {
    const err = new Error(
      "@aws-sdk/client-s3 is required for storage tools — run: npm install @aws-sdk/client-s3 (in the fxmind package)",
    );
    err.cause = error;
    throw err;
  }
  return s3Sdk;
}

function httpUrl(value, name) {
  if (value === undefined || value === "") return undefined;
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTP(S) URL.`); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query or fragment.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function objectKey(value, name = "key") {
  if (typeof value !== "string" || !value || /[\\\x00-\x1f\x7f]/.test(value) ||
      value.split("/").some((segment) => !segment || segment === "." || segment === "..") || Buffer.byteLength(value) > 1024) {
    throw new Error(`${name} must be a relative S3 key of at most 1024 bytes, without empty/dot segments or backslashes.`);
  }
  return value;
}

function configFromEnvironment(root, env) {
  const file = path.join(root, ".fxmind", "storage.json");
  let config = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
    } catch { throw new Error("Invalid .fxmind/storage.json: expected a JSON object."); }
  }
  const get = (name, variable) => env[variable] ?? config[name];
  const bucket = get("bucket", "FXMIND_S3_BUCKET");
  if (bucket !== undefined && (typeof bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))) {
    throw new Error("Invalid S3 bucket name.");
  }
  const endpoint = httpUrl(get("endpoint", "FXMIND_S3_ENDPOINT"), "endpoint");
  const publicBaseUrl = httpUrl(get("publicBaseUrl", "FXMIND_S3_PUBLIC_URL"), "publicBaseUrl");
  let forcePathStyle = get("forcePathStyle", "FXMIND_S3_FORCE_PATH_STYLE") ?? Boolean(endpoint);
  if (typeof forcePathStyle === "string" && /^(true|false|1|0)$/i.test(forcePathStyle)) forcePathStyle = /^(true|1)$/i.test(forcePathStyle);
  if (typeof forcePathStyle !== "boolean") throw new Error("forcePathStyle must be a boolean.");
  const prefix = get("prefix", "FXMIND_S3_PREFIX") ?? "images";
  if (prefix !== "") objectKey(prefix, "prefix");
  const region = get("region", "FXMIND_S3_REGION") || env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1";
  if (typeof region !== "string" || !/^[a-zA-Z0-9-]+$/.test(region)) throw new Error("Invalid S3 region.");
  return {
    bucket, endpoint, publicBaseUrl, forcePathStyle, prefix, region,
    maxWidth: integer(config.maxWidth, "maxWidth", 2048, MAX_DIMENSION),
    maxHeight: integer(config.maxHeight, "maxHeight", 2048, MAX_DIMENSION),
    maxBytes: integer(config.maxBytes, "maxBytes", DEFAULT_MAX_BYTES, MAX_INPUT_BYTES),
  };
}

function readConfig(root, env = process.env) {
  return configFromEnvironment(root, readProjectEnv(root, env));
}

function status(root, env = process.env) {
  try {
    const config = readConfig(root, env);
    return {
      ok: true, configured: Boolean(config.bucket), ...config,
      credentials: "Project .env / process environment, or AWS SDK default credential chain; not probed",
      ...(config.bucket ? {} : { hint: "Set FXMIND_S3_BUCKET in the project .env or .fxmind/storage.json. Put AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in .env." }),
    };
  } catch (error) {
    return { ok: false, configured: false, error: error.message };
  }
}

async function uploadImage(root, args = {}) {
  const env = readProjectEnv(root);
  const config = configFromEnvironment(root, env);
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("Set both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the project .env (or process environment).");
  }
  const credentials = accessKeyId && secretAccessKey ? {
    accessKeyId, secretAccessKey,
    ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
  } : undefined;
  if (!config.bucket) throw new Error("S3 storage is not configured. Set FXMIND_S3_BUCKET or .fxmind/storage.json; call fxmind_storage_status for details.");
  if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") throw new Error("overwrite must be a boolean.");
  const prepared = await prepareImage(root, args, config);
  const extension = prepared.image.format === "jpeg" ? "jpg" : prepared.image.format;
  const stem = path.parse(prepared.inputPath).name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "image";
  let key = args.key === undefined ? `${stem}-${randomUUID()}.${extension}` : objectKey(args.key);
  if (!path.posix.extname(key)) key += `.${extension}`;
  checkExtension(key, prepared.image.format);
  key = objectKey(config.prefix ? `${config.prefix}/${key}` : key);
  const { S3Client, PutObjectCommand } = getS3Sdk();
  const client = new S3Client({
    region: config.region, endpoint: config.endpoint, forcePathStyle: config.forcePathStyle,
    ...(credentials ? { credentials } : {}),
    requestChecksumCalculation: "WHEN_REQUIRED",
    maxAttempts: 2,
  });
  try {
    const result = await client.send(new PutObjectCommand({
      Bucket: config.bucket, Key: key, Body: prepared.data,
      ContentType: prepared.contentType, ContentLength: prepared.data.length,
      ...(args.overwrite === true ? {} : { IfNoneMatch: "*" }),
    }), { abortSignal: AbortSignal.timeout(60_000) });
    return {
      ok: true, bucket: config.bucket, key, s3Uri: `s3://${config.bucket}/${key}`,
      publicUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}` : null,
      etag: result.ETag, ...prepared.image, contentType: prepared.contentType, original: prepared.original,
    };
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 412 || error.name === "PreconditionFailed") {
      throw new Error("Object already exists. Choose another key, or use overwrite=true only when replacement is intended.");
    }
    // Do not echo SDK/provider messages: they may contain signed URLs or credentials.
    throw new Error(`S3 upload failed (${error.$metadata?.httpStatusCode || "connection/authentication error"}). Check endpoint, credentials and PutObject permission.`, { cause: error });
  } finally {
    client.destroy();
  }
}

module.exports = { readConfig, status, uploadImage };
