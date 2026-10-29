"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 8192;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MIME = { webp: "image/webp", png: "image/png", jpeg: "image/jpeg" };

let sharp;
function getSharp() {
  if (sharp) return sharp;
  try {
    sharp = require("sharp");
  } catch (error) {
    const err = new Error(
      "sharp is required for image tools — run: npm install sharp (in the fxmind package)",
    );
    err.cause = error;
    throw err;
  }
  return sharp;
}

function integer(value, name, fallback, max) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}.`);
  }
  return resolved;
}

function localPath(root, value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required (local file path).`);
  return path.resolve(root, value);
}

function checkExtension(file, format) {
  const ext = path.extname(file).toLowerCase();
  const allowed = format === "jpeg" ? [".jpg", ".jpeg"] : [`.${format}`];
  if (!allowed.includes(ext)) throw new Error(`Output extension must match format ${format}: ${allowed.join(" or ")}.`);
}

/** Decode raster input, orient it, strip metadata and encode within a byte budget. */
async function prepareImage(root, args = {}, defaults = {}) {
  const sharp = getSharp(); // Load native binaries only when an image tool is called.
  const inputPath = localPath(root, args.path, "path");
  const format = args.format === undefined ? "png" : args.format;
  if (!Object.hasOwn(MIME, format)) throw new Error("format must be webp, png or jpeg.");
  const fit = args.fit === undefined ? "inside" : args.fit;
  if (!["inside", "cover", "contain", "fill"].includes(fit)) throw new Error("fit must be inside, cover, contain or fill.");
  if (fit !== "inside" && (args.width === undefined || args.height === undefined)) {
    throw new Error("Exact-size fits (cover, contain, fill) require both width and height.");
  }
  const explicitSize = args.width !== undefined || args.height !== undefined;
  const width = args.width === undefined && explicitSize ? undefined : integer(args.width, "width", defaults.maxWidth || 2048, MAX_DIMENSION);
  const height = args.height === undefined && explicitSize ? undefined : integer(args.height, "height", defaults.maxHeight || 2048, MAX_DIMENSION);
  if (width && height && width * height > MAX_PIXELS) throw new Error(`Output exceeds ${MAX_PIXELS} pixels.`);
  const maxBytes = integer(args.maxBytes, "maxBytes", defaults.maxBytes || DEFAULT_MAX_BYTES, defaults.maxBytes || MAX_INPUT_BYTES);
  const quality = integer(args.quality, "quality", 80, 100);

  // Read through one handle and bound the allocation, including files that grow after stat.
  const file = await fs.open(inputPath, "r");
  let input;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error("Input must be a regular image file of at most 50 MiB.");
    input = Buffer.alloc(Math.min(stat.size + 1, MAX_INPUT_BYTES + 1));
    let length = 0;
    while (length < input.length) {
      const { bytesRead } = await file.read(input, length, input.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size || length > MAX_INPUT_BYTES) throw new Error("Input changed during reading or exceeds 50 MiB; retry with a stable file.");
    input = input.subarray(0, length);
  } finally {
    await file.close();
  }
  const options = { limitInputPixels: MAX_PIXELS, failOn: "warning" };
  const metadata = await sharp(input, options).metadata();
  if (!["jpeg", "png", "webp", "avif", "heif", "tiff", "gif"].includes(metadata.format)) {
    throw new Error("Only raster images are supported (no SVG/PDF).");
  }
  if ((metadata.pages || 1) > 1) throw new Error("Animated or multipage images are unsupported; select a single frame first.");
  const image = sharp(input, options).rotate().resize({
    width, height, fit,
    withoutEnlargement: fit === "inside",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (format === "jpeg") image.flatten({ background: "#ffffff" });
  // Preserve requested dimensions. If compression cannot meet the budget, fail before writing/uploading.
  for (let q = quality; ; q = Math.max(1, q - 10)) {
    const { data, info } = await image.clone().toFormat(format, {
      quality: q, ...(format === "png" ? { compressionLevel: 9 } : {}),
    }).toBuffer({ resolveWithObject: true });
    if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
      throw new Error(`Output exceeds ${MAX_DIMENSION} pixels on an axis. Specify both bounding dimensions.`);
    }
    if (data.length <= maxBytes) return {
      data, inputPath, contentType: MIME[format],
      image: { width: info.width, height: info.height, format, bytes: data.length },
      original: { width: metadata.width, height: metadata.height, format: metadata.format, bytes: input.length },
    };
    if (format === "png" || q <= Math.min(40, quality)) break;
  }
  throw new Error(`Image exceeds maxBytes (${maxBytes}) after compression. Reduce dimensions or use webp/jpeg; no file was written or uploaded.`);
}

async function resizeImage(root, args = {}) {
  const outputPath = localPath(root, args.outputPath, "outputPath");
  checkExtension(outputPath, args.format === undefined ? "png" : args.format);
  const prepared = await prepareImage(root, args);
  if (outputPath === prepared.inputPath) throw new Error("outputPath must differ from the source image.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  // Never overwrite an existing file or follow an output symlink.
  await fs.writeFile(outputPath, prepared.data, { flag: "wx" });
  return { ok: true, outputPath, ...prepared.image, original: prepared.original };
}

module.exports = { prepareImage, resizeImage, integer, checkExtension, MAX_DIMENSION, MAX_INPUT_BYTES, DEFAULT_MAX_BYTES };
