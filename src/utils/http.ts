// src/utils/http.ts
// Shared zero-dependency HTTP client with manual redirect following, per-engine
// cookie jars, TLS drop retry, circuit breaker, LRU caching, and universal
// HTTP/HTTPS/SOCKS5 proxy + proxy-rotation support.

import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as zlib from 'node:zlib';

export const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const API_UA =
  'AgentToolsPack/1.0 (+https://southasia-one.kognare.com; Linux x86_64)';

export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': DEFAULT_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="140", "Google Chrome";v="140", "Not;A=Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Linux"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

export class EngineError extends Error {
  reason: string;
  status: number;
  constructor(reason: string, status = 0, message?: string) {
    super(message || reason);
    this.name = 'EngineError';
    this.reason = reason;
    this.status = status;
  }
}

export const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
export const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(u);
export const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};

export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

// ── Universal Proxy Configuration & Transport ───────────────────────────────
export type ProxyInput = string | string[] | null | undefined;

export interface ParsedProxy {
  raw: string;
  url: string;
  protocol: 'http:' | 'https:' | 'socks5:' | 'socks5h:' | 'socks4:' | 'socks:';
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Proxy server URL without credentials, suitable for Chromium --proxy-server */
  serverArg: string;
}

let globalProxyConfig: ProxyInput = undefined;
let proxyRotationCursor = 0;

/**
 * Set or clear a process-wide default proxy (single URL, host:port, or rotation list).
 */
export function setGlobalProxy(proxy: ProxyInput): void {
  globalProxyConfig = proxy;
}

export function getGlobalProxy(): ProxyInput {
  return globalProxyConfig;
}

/**
 * Normalize a single proxy string into a ParsedProxy object.
 * Supports:
 * - http://host:port, https://host:port, socks5://host:port
 * - http://user:pass@host:port, socks5://user:pass@host:port
 * - host:port (defaults to http://host:port)
 * - user:pass@host:port (defaults to http://user:pass@host:port)
 * - host:port:user:pass (common proxy provider shorthand -> http://user:pass@host:port)
 */
export function parseProxyString(rawInput: string): ParsedProxy | null {
  const raw = rawInput.trim();
  if (!raw || /^(direct|none|off|false)$/i.test(raw)) return null;

  let normalized = raw;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    const parts = normalized.split(':');
    if (parts.length === 4 && !normalized.includes('@') && /^\d+$/.test(parts[1])) {
      const [h, p, u, pass] = parts;
      normalized = `http://${encodeURIComponent(u)}:${encodeURIComponent(pass)}@${h}:${p}`;
    } else {
      normalized = `http://${normalized}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new EngineError('invalid_proxy', 0, `Invalid proxy URL: ${raw}`);
  }

  const proto = parsed.protocol.toLowerCase();
  if (!['http:', 'https:', 'socks5:', 'socks5h:', 'socks4:', 'socks:'].includes(proto)) {
    throw new EngineError('invalid_proxy', 0, `Unsupported proxy protocol "${proto}" in ${raw}`);
  }

  const host = parsed.hostname;
  const port = Number(parsed.port) || (proto === 'https:' ? 443 : proto.startsWith('socks') ? 1080 : 8080);
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new EngineError('invalid_proxy', 0, `Invalid proxy host/port in ${raw}`);
  }

  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const serverProto = proto === 'socks:' || proto === 'socks5h:' ? 'socks5:' : proto;
  const bracketHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const serverArg = `${serverProto}//${bracketHost}:${port}`;
  const authPart = username
    ? `${encodeURIComponent(username)}${password !== undefined ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  const url = `${serverProto}//${authPart}${bracketHost}:${port}`;

  return {
    raw,
    url,
    protocol: proto as ParsedProxy['protocol'],
    host,
    port,
    username,
    password,
    serverArg,
  };
}

/**
 * Resolve the list of candidate proxies from explicit input, global config, or env vars.
 * Rotates the starting position round-robin when multiple proxies are supplied.
 */
export function resolveProxyCandidates(override?: ProxyInput): ParsedProxy[] {
  if (override !== undefined) {
    const rawStr = Array.isArray(override) ? override.join(',') : String(override).trim();
    if (/^(direct|none|off|false)$/i.test(rawStr)) return [];
  }

  const source: ProxyInput =
    override !== undefined
      ? override
      : globalProxyConfig !== undefined
        ? globalProxyConfig
        : process.env.TUXSCOUT_PROXY ||
          process.env.ALL_PROXY ||
          process.env.HTTPS_PROXY ||
          process.env.HTTP_PROXY ||
          process.env.https_proxy ||
          process.env.http_proxy;

  if (!source) return [];

  const tokens = (Array.isArray(source) ? source : [source])
    .flatMap((item) => String(item).split(/[\s,;]+/))
    .map((s) => s.trim())
    .filter(Boolean);

  const parsed: ParsedProxy[] = [];
  for (const t of tokens) {
    const p = parseProxyString(t);
    if (p) parsed.push(p);
  }

  if (parsed.length <= 1) return parsed;
  const start = proxyRotationCursor++ % parsed.length;
  return [...parsed.slice(start), ...parsed.slice(0, start)];
}

/**
 * Resolve a single active proxy (next in rotation if a list was provided) or null if direct.
 */
export function resolveProxy(override?: ProxyInput): ParsedProxy | null {
  const list = resolveProxyCandidates(override);
  return list[0] || null;
}

function readExactBytes(socket: net.Socket, count: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Proxy handshake timeout'));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= count) {
        cleanup();
        const result = buf.subarray(0, count);
        const rest = buf.subarray(count);
        if (rest.length > 0) socket.unshift(rest);
        resolve(result);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Proxy socket closed during handshake'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function openSocks5Tunnel(
  proxy: ParsedProxy,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<net.Socket> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host: proxy.host, port: proxy.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error(`SOCKS5 connect timeout to ${proxy.host}:${proxy.port}`));
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  try {
    const hasAuth = Boolean(proxy.username);
    const greeting = hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
    socket.write(greeting);
    const methodChoice = await readExactBytes(socket, 2, timeoutMs);
    if (methodChoice[0] !== 0x05) {
      throw new Error(`Invalid SOCKS version: ${methodChoice[0]}`);
    }
    if (methodChoice[1] === 0x02) {
      const uBuf = Buffer.from(proxy.username || '', 'utf8');
      const pBuf = Buffer.from(proxy.password || '', 'utf8');
      const authReq = Buffer.concat([
        Buffer.from([0x01, uBuf.length]),
        uBuf,
        Buffer.from([pBuf.length]),
        pBuf,
      ]);
      socket.write(authReq);
      const authRes = await readExactBytes(socket, 2, timeoutMs);
      if (authRes[1] !== 0x00) {
        throw new Error('SOCKS5 proxy authentication failed');
      }
    } else if (methodChoice[1] !== 0x00) {
      throw new Error(`SOCKS5 proxy rejected authentication methods (code ${methodChoice[1]})`);
    }

    const hostBuf = Buffer.from(targetHost, 'utf8');
    const portBuf = Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]);
    const connectReq = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
      hostBuf,
      portBuf,
    ]);
    socket.write(connectReq);

    const head = await readExactBytes(socket, 4, timeoutMs);
    if (head[1] !== 0x00) {
      throw new Error(`SOCKS5 CONNECT failed with code ${head[1]}`);
    }
    const atyp = head[3];
    if (atyp === 0x01) {
      await readExactBytes(socket, 6, timeoutMs); // IPv4 (4) + port (2)
    } else if (atyp === 0x04) {
      await readExactBytes(socket, 18, timeoutMs); // IPv6 (16) + port (2)
    } else if (atyp === 0x03) {
      const lenBuf = await readExactBytes(socket, 1, timeoutMs);
      await readExactBytes(socket, lenBuf[0] + 2, timeoutMs);
    }
    return socket;
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

async function openHttpConnectTunnel(
  proxy: ParsedProxy,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const isHttpsProxy = proxy.protocol === 'https:';
    const socket = isHttpsProxy
      ? tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host, rejectUnauthorized: false })
      : net.connect({ host: proxy.host, port: proxy.port });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`HTTP proxy CONNECT timeout to ${proxy.host}:${proxy.port}`));
    }, timeoutMs);

    const authHeader = proxy.username
      ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}\r\n`
      : '';

    let headerBuf = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const endIdx = headerBuf.indexOf('\r\n\r\n');
      if (endIdx === -1) return;

      cleanup();
      const headerText = headerBuf.subarray(0, endIdx).toString('latin1');
      const rest = headerBuf.subarray(endIdx + 4);
      if (rest.length > 0) socket.unshift(rest);

      const firstLine = headerText.split('\r\n')[0] || '';
      const statusMatch = firstLine.match(/^HTTP\/1\.[01]\s+(\d{3})/i);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
      if (statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT returned HTTP ${statusCode || firstLine}`));
        return;
      }
      resolve(socket);
    };

    const onError = (err: Error) => {
      cleanup();
      socket.destroy();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Proxy closed connection before CONNECT completed'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    socket.on('error', onError);
    socket.on('close', onClose);
    const connectEvent = isHttpsProxy ? 'secureConnect' : 'connect';
    socket.once(connectEvent, () => {
      socket.on('data', onData);
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${targetHost}:${targetPort}\r\n` +
          authHeader +
          `Proxy-Connection: Keep-Alive\r\n\r\n`,
      );
    });
  });
}

function decompressBody(buf: Buffer, encoding: string | undefined): Buffer {
  if (!encoding || buf.length === 0) return buf;
  const enc = encoding.toLowerCase().trim();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf);
    if (enc === 'deflate') return zlib.inflateSync(buf);
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
  } catch {
    return buf;
  }
  return buf;
}

async function fetchViaSingleProxy(
  urlStr: string,
  proxy: ParsedProxy,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const targetUrl = new URL(urlStr);
  const isHttpsTarget = targetUrl.protocol === 'https:';
  const targetPort = Number(targetUrl.port) || (isHttpsTarget ? 443 : 80);
  const isSocks = proxy.protocol.startsWith('socks');

  const reqHeaders: Record<string, string> = {
    'Accept-Encoding': 'gzip, deflate, br',
  };
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        reqHeaders[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) reqHeaders[k] = v;
    } else {
      Object.assign(reqHeaders, init.headers);
    }
  }

  let bodyBuffer: Buffer | null = null;
  if (init?.body) {
    if (typeof init.body === 'string') bodyBuffer = Buffer.from(init.body);
    else if (Buffer.isBuffer(init.body)) bodyBuffer = init.body;
    else if (init.body instanceof Uint8Array) bodyBuffer = Buffer.from(init.body);
    else if (init.body instanceof ArrayBuffer) bodyBuffer = Buffer.from(init.body);
    if (bodyBuffer && !reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
      reqHeaders['Content-Length'] = String(bodyBuffer.length);
    }
  }

  // Case 1: Plain HTTP target over HTTP/HTTPS proxy (direct proxy forward)
  if (!isHttpsTarget && !isSocks) {
    if (proxy.username) {
      reqHeaders['Proxy-Authorization'] =
        `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}`;
    }
    reqHeaders['Host'] = targetUrl.host;

    return new Promise<Response>((resolve, reject) => {
      const reqFn = proxy.protocol === 'https:' ? https.request : http.request;
      const req = reqFn(
        {
          host: proxy.host,
          port: proxy.port,
          method: init?.method || 'GET',
          path: targetUrl.toString(),
          headers: reqHeaders,
          timeout: timeoutMs,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const decoded = decompressBody(raw, res.headers['content-encoding']);
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v === undefined) continue;
              if (k.toLowerCase() === 'content-encoding' || k.toLowerCase() === 'transfer-encoding') continue;
              if (Array.isArray(v)) {
                for (const item of v) headers.append(k, item);
              } else {
                headers.set(k, v);
              }
            }
            resolve(new Response(new Uint8Array(decoded), { status: res.statusCode || 200, statusText: res.statusMessage || '', headers }));
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error('Proxy request timeout'));
      });
      req.on('error', reject);
      if (init?.signal) {
        if (init.signal.aborted) {
          req.destroy(new Error('Aborted'));
          return;
        }
        init.signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
      }
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });
  }

  // Case 2: Tunnel required (HTTPS target over HTTP/HTTPS proxy, or any target over SOCKS5)
  const rawSocket = isSocks
    ? await openSocks5Tunnel(proxy, targetUrl.hostname, targetPort, timeoutMs)
    : await openHttpConnectTunnel(proxy, targetUrl.hostname, targetPort, timeoutMs);

  const streamSocket: net.Socket = isHttpsTarget
    ? await new Promise<tls.TLSSocket>((resolve, reject) => {
        const tlsSock = tls.connect({
          socket: rawSocket,
          servername: targetUrl.hostname,
          rejectUnauthorized: false,
        });
        const timer = setTimeout(() => {
          tlsSock.destroy();
          reject(new Error(`TLS handshake timeout with ${targetUrl.hostname}`));
        }, timeoutMs);
        tlsSock.once('secureConnect', () => {
          clearTimeout(timer);
          resolve(tlsSock);
        });
        tlsSock.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      })
    : rawSocket;

  return new Promise<Response>((resolve, reject) => {
    reqHeaders['Host'] = targetUrl.host;
    reqHeaders['Connection'] = 'close';

    const req = http.request(
      {
        host: targetUrl.hostname,
        port: targetPort,
        method: init?.method || 'GET',
        path: (targetUrl.pathname || '/') + (targetUrl.search || ''),
        headers: reqHeaders,
        agent: false,
        createConnection: () => streamSocket,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          streamSocket.destroy();
          const raw = Buffer.concat(chunks);
          const decoded = decompressBody(raw, res.headers['content-encoding']);
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            if (k.toLowerCase() === 'content-encoding' || k.toLowerCase() === 'transfer-encoding') continue;
            if (Array.isArray(v)) {
              for (const item of v) headers.append(k, item);
            } else {
              headers.set(k, v);
            }
          }
          resolve(new Response(new Uint8Array(decoded), { status: res.statusCode || 200, statusText: res.statusMessage || '', headers }));
        });
        res.on('error', (err) => {
          streamSocket.destroy();
          reject(err);
        });
      },
    );

    req.on('timeout', () => {
      streamSocket.destroy();
      req.destroy(new Error('Proxy tunnel request timeout'));
    });
    req.on('error', (err) => {
      streamSocket.destroy();
      reject(err);
    });
    if (init?.signal) {
      if (init.signal.aborted) {
        streamSocket.destroy();
        req.destroy(new Error('Aborted'));
        return;
      }
      init.signal.addEventListener(
        'abort',
        () => {
          streamSocket.destroy();
          req.destroy(new Error('Aborted'));
        },
        { once: true },
      );
    }
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Drop-in replacement for global `fetch()` that honors explicit, global, or
 * environment-configured HTTP/HTTPS/SOCKS5 proxies (including proxy rotation pools).
 */
export async function proxyFetch(
  url: string,
  init?: RequestInit & { proxy?: ProxyInput; timeoutMs?: number },
): Promise<Response> {
  const candidates = resolveProxyCandidates(init?.proxy);
  const timeoutMs = init?.timeoutMs ?? 15_000;

  if (candidates.length === 0) {
    return fetch(url, init);
  }

  let lastErr: unknown;
  for (const proxy of candidates) {
    try {
      return await fetchViaSingleProxy(url, proxy, init, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── Cookie Jar + Manual Redirects ───────────────────────────────────────────
const jars = new Map<string, Map<string, string>>();

export function absorbCookies(jarName: string, res: Response): void {
  let jar = jars.get(jarName);
  if (!jar) {
    jar = new Map();
    jars.set(jarName, jar);
  }
  const headers = res.headers as unknown as { getSetCookie?: () => string[] };
  const list: string[] = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(';')[0];
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

export function cookieHeader(jarName: string): string {
  const jar = jars.get(jarName);
  if (!jar || !jar.size) return '';
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function clearCookieJar(jarName: string): void {
  jars.delete(jarName);
}

export function hasCookies(jarName: string): boolean {
  return (jars.get(jarName)?.size ?? 0) > 0;
}

export async function fetchTextWithJar(
  jarName: string,
  startUrl: string,
  deadline: number,
  headers: Record<string, string> = BROWSER_HEADERS,
  proxyOrOpts?: ProxyInput,
  maybeProxy?: ProxyInput,
): Promise<{ status: number; text: string; url: string; contentType: string }> {
  const proxy = maybeProxy ?? proxyOrOpts;
  let url = startUrl;
  let transportRetries = 1;

  for (let hop = 0; hop < 6; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) {
      throw new EngineError('timeout', 0, 'time budget exhausted');
    }
    const cookie = cookieHeader(jarName);
    let res: Response;
    try {
      res = await proxyFetch(url, {
        headers: cookie ? { ...headers, Cookie: cookie } : headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        timeoutMs: remaining,
        proxy,
      });
    } catch (err) {
      const e = err as Error & { cause?: { message?: string } };
      if (e instanceof EngineError && e.reason === 'invalid_proxy') throw e;
      const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'transport';
      if (reason === 'transport' && transportRetries > 0 && deadline - Date.now() > 1_000) {
        transportRetries -= 1;
        hop -= 1;
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      const cause = e?.cause?.message ? ` (${clean(e.cause.message)})` : '';
      let host = 'unknown';
      try {
        host = new URL(url).hostname;
      } catch { /* ignore */ }
      throw new EngineError(reason, 0, `${host}: ${clean(e?.message)}${cause}`.slice(0, 200));
    }

    absorbCookies(jarName, res);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      url = new URL(location, url).toString();
      continue;
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text().catch(() => '');
    return { status: res.status, text, url, contentType };
  }

  throw new EngineError('redirect_loop', 0, 'too many redirects');
}

export async function fetchBytesWithJar(
  jarName: string,
  startUrl: string,
  deadline: number,
  headers: Record<string, string> = BROWSER_HEADERS,
  maxBytes = 50 * 1024 * 1024,
  proxy?: ProxyInput,
): Promise<{ status: number; buffer: Buffer; url: string; contentType: string }> {
  let url = startUrl;
  let transportRetries = 1;

  for (let hop = 0; hop < 6; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) {
      throw new EngineError('timeout', 0, 'download time budget exhausted');
    }
    const cookie = cookieHeader(jarName);
    let res: Response;
    try {
      res = await proxyFetch(url, {
        headers: cookie ? { ...headers, Cookie: cookie } : headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        timeoutMs: remaining,
        proxy,
      });
    } catch (err) {
      const e = err as Error & { cause?: { message?: string } };
      if (e instanceof EngineError && e.reason === 'invalid_proxy') throw e;
      const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'transport';
      if (reason === 'transport' && transportRetries > 0 && deadline - Date.now() > 1_000) {
        transportRetries -= 1;
        hop -= 1;
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      throw new EngineError(reason, 0, clean(e?.message).slice(0, 200));
    }

    absorbCookies(jarName, res);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      url = new URL(location, url).toString();
      continue;
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new EngineError('too_large', res.status, `Content-Length ${contentLength} exceeds maxBytes ${maxBytes}`);
    }

    const contentType = res.headers.get('content-type') || '';
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new EngineError('too_large', res.status, `Payload ${ab.byteLength} exceeds maxBytes ${maxBytes}`);
    }
    return { status: res.status, buffer: Buffer.from(ab), url, contentType };
  }

  throw new EngineError('redirect_loop', 0, 'too many redirects');
}

// ── Per-Engine Circuit Breaker ──────────────────────────────────────────────
const DEFAULT_COOLDOWN_LADDER_MS = [30_000, 120_000, 300_000, 900_000];

export class CircuitBreaker {
  private health = new Map<string, { failures: number; until: number }>();
  private ladder: number[];

  constructor(ladder: number[] = DEFAULT_COOLDOWN_LADDER_MS) {
    this.ladder = ladder;
  }

  isCooled(name: string): boolean {
    const h = this.health.get(name);
    return !!h && h.until > Date.now();
  }

  reportOk(name: string): void {
    this.health.delete(name);
  }

  reportFail(name: string, reason: string): void {
    const h = this.health.get(name) || { failures: 0, until: 0 };
    h.failures += reason === 'timeout' || reason === 'transport' ? 0.5 : 1;
    const idx = Math.min(Math.max(0, Math.ceil(h.failures) - 1), this.ladder.length - 1);
    h.until = Date.now() + this.ladder[idx];
    this.health.set(name, h);
  }

  order<T extends { name: string }>(engines: T[], only?: string): T[] {
    if (only) {
      const pinned = engines.filter((e) => e.name === only);
      if (pinned.length) return pinned;
    }
    const fresh = engines.filter((e) => !this.isCooled(e.name));
    const cooled = engines.filter((e) => this.isCooled(e.name));
    return fresh.concat(cooled);
  }

  status(): Record<string, { failures: number; cooledRemainingMs: number }> {
    const out: Record<string, { failures: number; cooledRemainingMs: number }> = {};
    const now = Date.now();
    for (const [k, v] of this.health.entries()) {
      out[k] = { failures: v.failures, cooledRemainingMs: Math.max(0, v.until - now) };
    }
    return out;
  }
}

// ── Simple In-Memory LRU Cache ──────────────────────────────────────────────
export class LruCache<T> {
  private map = new Map<string, { at: number; val: T }>();
  constructor(
    private maxEntries = 300,
    private ttlMs = 10 * 60_000,
  ) {}

  get(key: string): T | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.val;
  }

  set(key: string, val: T): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { at: Date.now(), val });
  }

  clear(): void {
    this.map.clear();
  }
}
