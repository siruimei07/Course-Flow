import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  validationError,
  type InspectedSourceObject,
  type SourceObjectStore,
} from "@courseflow/core";
import { createHash, createHmac } from "node:crypto";
import type { RuntimeConfig } from "./config";
import { createS3Client } from "./dependencies";

const targetLifetimeSeconds = 15 * 60;
const maximumAssetBytes = 50 * 1024 * 1024;

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function createSignedS3Url(
  config: RuntimeConfig,
  method: "GET" | "PUT",
  storageKey: string,
  response?: Readonly<{ disposition: string; mimeType: string }>,
): string {
  const now = new Date();
  const timestamp = amzDate(now);
  const datestamp = timestamp.slice(0, 8);
  const endpoint = new URL(config.OBJECT_STORE_ENDPOINT);
  const encodedKey = storageKey.split("/").map(awsEncode).join("/");
  if (config.OBJECT_STORE_FORCE_PATH_STYLE) {
    const prefix = endpoint.pathname.replace(/\/$/u, "");
    endpoint.pathname = `${prefix}/${awsEncode(config.OBJECT_STORE_BUCKET)}/${encodedKey}`;
  } else {
    endpoint.hostname = `${config.OBJECT_STORE_BUCKET}.${endpoint.hostname}`;
    const prefix = endpoint.pathname.replace(/\/$/u, "");
    endpoint.pathname = `${prefix}/${encodedKey}`;
  }
  const credentialScope = `${datestamp}/${config.OBJECT_STORE_REGION}/s3/aws4_request`;
  const parameters = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.OBJECT_STORE_ACCESS_KEY}/${credentialScope}`],
    ["X-Amz-Date", timestamp],
    ["X-Amz-Expires", String(targetLifetimeSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ]);
  if (response !== undefined) {
    parameters.set("response-content-disposition", response.disposition);
    parameters.set("response-content-type", response.mimeType);
  }
  const canonicalQuery = [...parameters]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalUri = endpoint.pathname;
  const canonicalHeaders = `host:${endpoint.host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${config.OBJECT_STORE_SECRET_KEY}`, datestamp);
  const regionKey = hmac(dateKey, config.OBJECT_STORE_REGION);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  endpoint.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return endpoint.toString();
}

function unsupportedFile(): never {
  throw validationError("文件内容无法安全读取。", [
    {
      code: "UNSUPPORTED_FILE_CONTENT",
      message: "只接受结构可读的 PDF、PNG、JPEG 或 WebP。",
      path: "/assets",
    },
  ]);
}

function readPngSize(bytes: Uint8Array): Readonly<{ height: number; width: number }> {
  if (bytes.length < 24) unsupportedFile();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) unsupportedFile();
  return { height, width };
}

function readJpegSize(bytes: Uint8Array): Readonly<{ height: number; width: number }> {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) unsupportedFile();
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) unsupportedFile();
    if (
      marker !== undefined &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width < 1 || height < 1) unsupportedFile();
      return { height, width };
    }
    offset += length;
  }
  return unsupportedFile();
}

function readWebpSize(bytes: Uint8Array): Readonly<{ height: number; width: number }> {
  if (bytes.length < 30) unsupportedFile();
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return { height, width };
  }
  return unsupportedFile();
}

function inspectBytes(bytes: Uint8Array): Omit<InspectedSourceObject, "byteSize" | "sha256"> {
  const prefix = bytes.slice(0, 12);
  const asciiPrefix = new TextDecoder("latin1").decode(prefix);
  if (asciiPrefix.startsWith("%PDF-")) {
    const text = new TextDecoder("latin1").decode(bytes);
    if (!text.slice(-2_048).includes("%%EOF") || /\/Encrypt\b/u.test(text)) unsupportedFile();
    const pageCount = Math.max(1, [...text.matchAll(/\/Type\s*\/Page\b/gu)].length);
    return { height: null, pageCount, sniffedMimeType: "application/pdf", width: null };
  }
  if (
    prefix[0] === 0x89 &&
    prefix[1] === 0x50 &&
    prefix[2] === 0x4e &&
    prefix[3] === 0x47 &&
    prefix[4] === 0x0d &&
    prefix[5] === 0x0a &&
    prefix[6] === 0x1a &&
    prefix[7] === 0x0a
  ) {
    const size = readPngSize(bytes);
    return { ...size, pageCount: 1, sniffedMimeType: "image/png" };
  }
  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    const size = readJpegSize(bytes);
    return { ...size, pageCount: 1, sniffedMimeType: "image/jpeg" };
  }
  if (asciiPrefix.startsWith("RIFF") && asciiPrefix.slice(8, 12) === "WEBP") {
    const size = readWebpSize(bytes);
    return { ...size, pageCount: 1, sniffedMimeType: "image/webp" };
  }
  return unsupportedFile();
}

export function createS3SourceObjectStore(
  config: RuntimeConfig,
): SourceObjectStore & Readonly<{ close(): void }> {
  const client = createS3Client(config);
  const bucket = config.OBJECT_STORE_BUCKET;

  return {
    close() {
      client.destroy();
    },
    async createPreviewTarget(storageKey, filename, mimeType) {
      const expiresAt = new Date(Date.now() + targetLifetimeSeconds * 1_000).toISOString();
      const url = createSignedS3Url(config, "GET", storageKey, {
        disposition: `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        mimeType,
      });
      return { expiresAt, filename, mimeType, url };
    },
    async createUploadTarget(storageKey, mimeType) {
      const expiresAt = new Date(Date.now() + targetLifetimeSeconds * 1_000).toISOString();
      const url = createSignedS3Url(config, "PUT", storageKey);
      return { expiresAt, headers: { "content-type": mimeType }, url };
    },
    async deleteMany(storageKeys) {
      if (storageKeys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: storageKeys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
    hashText(value) {
      return createHash("sha256").update(value).digest("hex");
    },
    async inspect(storageKey) {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey }));
      const byteSize = head.ContentLength;
      if (byteSize === undefined || byteSize < 1 || byteSize > maximumAssetBytes) {
        throw validationError("文件大小无法通过校验。", [
          {
            code: "INVALID_STORED_FILE_SIZE",
            message: "文件必须存在且小于等于 50 MB。",
            path: "/assets",
          },
        ]);
      }
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
      if (object.Body === undefined) unsupportedFile();
      const bytes = await object.Body.transformToByteArray();
      if (bytes.byteLength !== byteSize) unsupportedFile();
      const inspection = inspectBytes(bytes);
      return {
        ...inspection,
        byteSize,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  };
}
