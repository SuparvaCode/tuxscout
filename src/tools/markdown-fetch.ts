// src/tools/markdown-fetch.ts
// Fast HTTP Website-to-Markdown fetcher with Readability-style main content extraction,
// metadata parsing, automatic SPA/JS-wall detection, optional seamless escalation
// to the ultra-low-memory Puppeteer JS fetcher, and parallel batch fetching.

import {
  BROWSER_HEADERS,
  clean,
  fetchTextWithJar,
  hostOf,
  isHttpUrl,
  LruCache,
} from '../utils/http.js';
import {
  detectJsRequirement,
  extractPageMetadata,
  htmlToMarkdown,
  type PageMetadata,
  textOnly,
} from '../utils/html.js';
import { fetchWithPuppeteer } from './puppeteer-fetch.js';
import { smartExtract, detectExtractProvider } from './smart-extract.js';

export interface MarkdownFetchOptions {
  url: string;
  timeoutMs?: number;
  maxChars?: number;
  includeLinks?: boolean;
  includeImages?: boolean;
  onlyMainContent?: boolean;
  autoPuppeteer?: boolean;
  forcePuppeteer?: boolean;
  noCache?: boolean;
  headers?: Record<string, string>;
}

export interface MarkdownFetchResult {
  url: string;
  finalUrl: string;
  domain: string;
  status: number;
  ok: boolean;
  method: 'http' | 'puppeteer' | 'api';
  escalatedReason?: string;
  title: string;
  metadata: PageMetadata;
  markdown: string;
  textContent: string;
  wordCount: number;
  charCount: number;
  links: Array<{ text: string; url: string }>;
  images: Array<{ alt: string; url: string }>;
  needsJs: boolean;
  cached: boolean;
  ms: number;
  error?: string;
}

const pageCache = new LruCache<Omit<MarkdownFetchResult, 'cached'>>(200, 15 * 60_000);

function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

export async function fetchMarkdown(
  options: MarkdownFetchOptions,
): Promise<MarkdownFetchResult> {
  const started = Date.now();
  const targetUrl = clean(options.url);
  if (!isHttpUrl(targetUrl)) {
    throw new Error(`Invalid http(s) URL: ${targetUrl}`);
  }

  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxChars = options.maxChars ?? 0;
  const includeLinks = options.includeLinks ?? true;
  const includeImages = options.includeImages ?? false;
  const onlyMainContent = options.onlyMainContent ?? true;
  const autoPuppeteer = options.autoPuppeteer ?? true;

  const cacheKey = `${targetUrl}|${maxChars}|${includeLinks}|${includeImages}|${onlyMainContent}|${Boolean(
    options.forcePuppeteer,
  )}`;
  if (!options.noCache) {
    const hit = pageCache.get(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  // Zero-browser Smart Extract interception for social media & structured platforms
  if (!options.forcePuppeteer) {
    const provider = detectExtractProvider(targetUrl);
    if (
      provider === 'twitter' ||
      provider === 'instagram' ||
      provider === 'reddit' ||
      provider === 'stackoverflow' ||
      provider === 'arxiv' ||
      provider === 'tiktok'
    ) {
      try {
        const apiRes = await smartExtract({
          target: targetUrl,
          maxChars: maxChars || 8000,
          noCache: options.noCache,
        });
        if (apiRes.ok && apiRes.markdown) {
          const md = maxChars > 0 ? apiRes.markdown.slice(0, maxChars) : apiRes.markdown;
          const firstHeading = /^#\s+(.+)$/m.exec(md)?.[1] || targetUrl;
          const body: Omit<MarkdownFetchResult, 'cached'> = {
            url: targetUrl,
            finalUrl: targetUrl,
            domain: hostOf(targetUrl),
            status: 200,
            ok: true,
            method: 'api',
            title: firstHeading,
            metadata: {
              title: firstHeading,
              description: `Structured ${provider} extraction via TuxScout Smart Extract`,
              author: '',
              publishedTime: '',
              siteName: provider,
              canonicalUrl: targetUrl,
              language: 'en',
            },
            markdown: md,
            textContent: md,
            wordCount: countWords(md),
            charCount: md.length,
            links: [],
            images: [],
            needsJs: false,
            ms: Date.now() - started,
          };
          pageCache.set(cacheKey, body);
          return { ...body, cached: false };
        }
      } catch {
        /* fallback to standard HTTP/Puppeteer */
      }
    }
  }

  // If forcePuppeteer is requested, go straight to low-memory headless Chromium
  if (options.forcePuppeteer) {
    const pup = await fetchWithPuppeteer({
      url: targetUrl,
      timeoutMs: Math.max(timeoutMs, 18_000),
      includeLinks,
      includeImages,
      maxChars,
      onlyMainContent,
      extraHeaders: options.headers,
    });
    const body: Omit<MarkdownFetchResult, 'cached'> = {
      url: targetUrl,
      finalUrl: pup.finalUrl,
      domain: hostOf(pup.finalUrl),
      status: pup.status,
      ok: pup.status >= 200 && pup.status < 400 && pup.markdown.length > 0,
      method: 'puppeteer',
      escalatedReason: 'force_puppeteer',
      title: pup.title,
      metadata: pup.metadata,
      markdown: pup.markdown,
      textContent: pup.textContent,
      wordCount: countWords(pup.textContent),
      charCount: pup.markdown.length,
      links: pup.links,
      images: pup.images,
      needsJs: false,
      ms: Date.now() - started,
    };
    if (body.ok) pageCache.set(cacheKey, body);
    return { ...body, cached: false };
  }

  // Fast HTTP path first
  let status = 0;
  let rawText = '';
  let finalUrl = targetUrl;
  let contentType = '';
  let httpError: string | undefined;

  try {
    const jarName = `fetch:${hostOf(targetUrl)}`;
    const res = await fetchTextWithJar(
      jarName,
      targetUrl,
      started + timeoutMs,
      options.headers ? { ...BROWSER_HEADERS, ...options.headers } : BROWSER_HEADERS,
    );
    status = res.status;
    rawText = res.text;
    finalUrl = res.url;
    contentType = res.contentType.toLowerCase();
  } catch (err) {
    httpError = (err as Error)?.message || String(err);
  }

  // Handle non-HTML content types cleanly (JSON, plain text, markdown, XML)
  if (!httpError && status >= 200 && status < 400 && rawText) {
    if (contentType.includes('application/json')) {
      let formattedJson = rawText;
      try {
        formattedJson = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        /* keep raw */
      }
      const md = `\`\`\`json\n${
        maxChars > 0 ? formattedJson.slice(0, maxChars) : formattedJson
      }\n\`\`\``;
      const body: Omit<MarkdownFetchResult, 'cached'> = {
        url: targetUrl,
        finalUrl,
        domain: hostOf(finalUrl),
        status,
        ok: true,
        method: 'http',
        title: finalUrl,
        metadata: {
          title: finalUrl,
          description: 'JSON response',
          author: '',
          publishedTime: '',
          siteName: hostOf(finalUrl),
          canonicalUrl: finalUrl,
          language: '',
        },
        markdown: md,
        textContent: formattedJson.slice(0, maxChars || 100_000),
        wordCount: countWords(formattedJson),
        charCount: md.length,
        links: [],
        images: [],
        needsJs: false,
        ms: Date.now() - started,
      };
      pageCache.set(cacheKey, body);
      return { ...body, cached: false };
    }

    if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
      const md = maxChars > 0 ? rawText.slice(0, maxChars) : rawText;
      const body: Omit<MarkdownFetchResult, 'cached'> = {
        url: targetUrl,
        finalUrl,
        domain: hostOf(finalUrl),
        status,
        ok: true,
        method: 'http',
        title: finalUrl,
        metadata: {
          title: finalUrl,
          description: '',
          author: '',
          publishedTime: '',
          siteName: hostOf(finalUrl),
          canonicalUrl: finalUrl,
          language: '',
        },
        markdown: md,
        textContent: md,
        wordCount: countWords(md),
        charCount: md.length,
        links: [],
        images: [],
        needsJs: false,
        ms: Date.now() - started,
      };
      pageCache.set(cacheKey, body);
      return { ...body, cached: false };
    }
  }

  // Check if JS rendering via Puppeteer is needed
  const jsCheck = httpError
    ? { needsJs: true, reason: `http_transport_error: ${httpError}` }
    : detectJsRequirement(status, rawText);

  if (jsCheck.needsJs && autoPuppeteer) {
    try {
      const pup = await fetchWithPuppeteer({
        url: targetUrl,
        timeoutMs: Math.max(timeoutMs, 18_000),
        includeLinks,
        includeImages,
        maxChars,
        onlyMainContent,
        extraHeaders: options.headers,
      });
      if (pup.markdown.length > 80 || !rawText) {
        const body: Omit<MarkdownFetchResult, 'cached'> = {
          url: targetUrl,
          finalUrl: pup.finalUrl,
          domain: hostOf(pup.finalUrl),
          status: pup.status,
          ok: pup.status >= 200 && pup.status < 400 && pup.markdown.length > 0,
          method: 'puppeteer',
          escalatedReason: jsCheck.reason,
          title: pup.title,
          metadata: pup.metadata,
          markdown: pup.markdown,
          textContent: pup.textContent,
          wordCount: countWords(pup.textContent),
          charCount: pup.markdown.length,
          links: pup.links,
          images: pup.images,
          needsJs: false,
          ms: Date.now() - started,
        };
        if (body.ok) pageCache.set(cacheKey, body);
        return { ...body, cached: false };
      }
    } catch (pupErr) {
      // If Puppeteer fails (e.g. no Chromium installed), fall through to return HTTP result/error
      if (httpError) {
        return {
          url: targetUrl,
          finalUrl,
          domain: hostOf(finalUrl),
          status: 0,
          ok: false,
          method: 'http',
          escalatedReason: jsCheck.reason,
          title: '',
          metadata: extractPageMetadata('', finalUrl),
          markdown: '',
          textContent: '',
          wordCount: 0,
          charCount: 0,
          links: [],
          images: [],
          needsJs: true,
          cached: false,
          ms: Date.now() - started,
          error: `${httpError}; Puppeteer fallback failed: ${(pupErr as Error)?.message}`,
        };
      }
    }
  }

  if (httpError) {
    return {
      url: targetUrl,
      finalUrl,
      domain: hostOf(finalUrl),
      status: 0,
      ok: false,
      method: 'http',
      title: '',
      metadata: extractPageMetadata('', finalUrl),
      markdown: '',
      textContent: '',
      wordCount: 0,
      charCount: 0,
      links: [],
      images: [],
      needsJs: jsCheck.needsJs,
      cached: false,
      ms: Date.now() - started,
      error: httpError,
    };
  }

  const metadata = extractPageMetadata(rawText, finalUrl);
  const { markdown, links, images } = htmlToMarkdown(rawText, {
    baseUrl: finalUrl,
    includeLinks,
    includeImages,
    maxChars,
    onlyMainContent,
  });
  const plainText = textOnly(rawText);

  const body: Omit<MarkdownFetchResult, 'cached'> = {
    url: targetUrl,
    finalUrl,
    domain: hostOf(finalUrl),
    status,
    ok: status >= 200 && status < 400 && markdown.length > 0,
    method: 'http',
    title: metadata.title,
    metadata,
    markdown,
    textContent: maxChars > 0 ? plainText.slice(0, maxChars) : plainText,
    wordCount: countWords(plainText),
    charCount: markdown.length,
    links,
    images,
    needsJs: jsCheck.needsJs,
    ms: Date.now() - started,
  };

  if (body.ok && !body.needsJs) {
    pageCache.set(cacheKey, body);
  }
  return { ...body, cached: false };
}

export async function fetchMarkdownBatch(
  urls: string[],
  options: Omit<MarkdownFetchOptions, 'url'> & { concurrency?: number } = {},
): Promise<MarkdownFetchResult[]> {
  const concurrency = Math.max(1, Math.min(10, options.concurrency ?? 5));
  const results: MarkdownFetchResult[] = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const i = cursor++;
      const url = urls[i];
      try {
        results[i] = await fetchMarkdown({ ...options, url });
      } catch (err) {
        results[i] = {
          url,
          finalUrl: url,
          domain: hostOf(url),
          status: 0,
          ok: false,
          method: 'http',
          title: '',
          metadata: extractPageMetadata('', url),
          markdown: '',
          textContent: '',
          wordCount: 0,
          charCount: 0,
          links: [],
          images: [],
          needsJs: false,
          cached: false,
          ms: 0,
          error: (err as Error)?.message || String(err),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length || 1) }, () => worker()),
  );
  return results;
}
