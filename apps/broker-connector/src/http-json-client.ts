import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

export type GatewayHttpMethod = "DELETE" | "GET" | "POST";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

let cachedCa: Buffer | undefined;
let cachedCaPath = "";

function gatewayCa() {
  const configuredPath = (process.env.IBKR_GATEWAY_CA_CERT_PATH ?? "").trim();
  if (!configuredPath) return undefined;
  if (configuredPath === cachedCaPath && cachedCa) return cachedCa;
  try {
    cachedCa = readFileSync(configuredPath);
    cachedCaPath = configuredPath;
    return cachedCa;
  } catch {
    throw new Error("IBKR Gateway CA 证书无法读取");
  }
}

export function assertLocalGatewayBaseUrl(baseUrl: string, label: string) {
  const parsed = new URL(baseUrl);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`${label}地址无效`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label}地址不得包含用户名、密码、查询令牌或片段`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
    throw new Error(`${label}仅允许本机回环地址`);
  }
  return baseUrl.replace(/\/+$/, "");
}

export function requestGatewayJson<T>(input: {
  baseUrl: string;
  body?: unknown;
  method: GatewayHttpMethod;
  path: string;
  timeoutMs: number;
}): Promise<T> {
  const target = new URL(`${input.baseUrl}${input.path}`);
  const payload = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body));
  const ca = target.protocol === "https:" ? gatewayCa() : undefined;
  const transport = target.protocol === "https:" ? https : http;

  return new Promise<T>((resolve, reject) => {
    const request = transport.request(
      target,
      {
        ca,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Length": String(payload.length),
                "Content-Type": "application/json",
              }
            : {}),
        },
        method: input.method,
        rejectUnauthorized: true,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("IBKR Gateway 响应超过安全上限"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`IBKR Gateway 返回 ${status}`));
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8").trim();
          if (!text) {
            resolve({} as T);
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new Error("IBKR Gateway 返回了无效 JSON"));
          }
        });
      },
    );
    request.setTimeout(input.timeoutMs, () => request.destroy(new Error("IBKR Gateway 请求超时")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}
