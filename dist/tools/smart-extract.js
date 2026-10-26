// src/tools/smart-extract.ts
// TuxScout Smart Extract — Zero-Browser Structured Data Router & Knowledge Extractor for AI Agents.
// Turns any URL or target (X/Twitter, Instagram, Reddit, GitHub, YouTube, HackerNews,
// StackOverflow, ArXiv, Wikipedia, IMDb, PDF documents, NPM, PyPI, TikTok, or any generic webpage)
// into concise, token-efficient structured JSON + Markdown without opening a browser window.
import * as zlib from 'node:zlib';
import { BROWSER_HEADERS, clean, DEFAULT_UA, fetchBytesWithJar, fetchTextWithJar, isHttpUrl, LruCache, proxyFetch, } from '../utils/http.js';
import { attr, decodeEntities, extractPageMetadata, extractTagBlocks, htmlToMarkdown, textOnly, } from '../utils/html.js';
import { socialIntel } from './social-intel.js';
import { newsIntel } from './news-intel.js';
import { extractVideoId, youtubeTool } from './yt-downloader.js';
import { isPdfUrl, searchPdf } from './web-search.js';
const cache = new LruCache(250, 10 * 60_000);
// ── 1. STACKOVERFLOW / STACKEXCHANGE EXTRACTOR ─────────────────────────────
export async function fetchStackOverflow(target, limit = 3, proxy) {
    const qIdMatch = /stackoverflow\.com\/questions\/(\d+)/i.exec(target);
    const apiBase = 'https://api.stackexchange.com/2.3';
    if (qIdMatch) {
        const qId = qIdMatch[1];
        const [qRes, aRes] = await Promise.all([
            proxyFetch(`${apiBase}/questions/${qId}?site=stackoverflow&filter=withbody`, {
                signal: AbortSignal.timeout(7_000),
                timeoutMs: 7_000,
                proxy,
            }),
            proxyFetch(`${apiBase}/questions/${qId}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody&pagesize=${Math.min(10, limit)}`, { signal: AbortSignal.timeout(7_000), timeoutMs: 7_000, proxy }),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qJson = await qRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const aJson = await aRes.json();
        const q = qJson?.items?.[0];
        if (!q)
            throw new Error(`StackOverflow question ${qId} not found`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const answers = (aJson?.items || []).slice(0, limit).map((a) => ({
            answerId: a.answer_id,
            score: a.score,
            isAccepted: Boolean(a.is_accepted),
            author: a.owner?.display_name,
            markdown: htmlToMarkdown(a.body || '', { onlyMainContent: false }).markdown,
        }));
        return {
            questionId: q.question_id,
            title: decodeEntities(q.title || ''),
            url: q.link,
            score: q.score,
            viewCount: q.view_count,
            tags: q.tags || [],
            isAnswered: Boolean(q.is_answered),
            questionMarkdown: htmlToMarkdown(q.body || '', { onlyMainContent: false }).markdown,
            answers,
        };
    }
    // Search query on StackOverflow
    const query = target.replace(/^so:/i, '').trim();
    const sRes = await proxyFetch(`${apiBase}/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&accepted=True&site=stackoverflow&pagesize=${Math.min(5, limit)}&filter=withbody`, { signal: AbortSignal.timeout(7_000), timeoutMs: 7_000, proxy });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sJson = await sRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const questions = (sJson?.items || []).slice(0, limit);
    const answerIds = questions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((q) => q.accepted_answer_id)
        .filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const answersById = new Map();
    if (answerIds.length) {
        const aRes = await proxyFetch(`${apiBase}/answers/${answerIds.join(';')}?site=stackoverflow&filter=withbody`, { signal: AbortSignal.timeout(7_000), timeoutMs: 7_000, proxy });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const aJson = await aRes.json();
        for (const a of aJson?.items || []) {
            answersById.set(a.answer_id, a);
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return questions.map((q) => {
        const acc = answersById.get(q.accepted_answer_id);
        return {
            questionId: q.question_id,
            title: decodeEntities(q.title || ''),
            url: q.link,
            score: q.score,
            tags: q.tags || [],
            questionExcerpt: htmlToMarkdown(q.body || '', {
                onlyMainContent: false,
                maxChars: 800,
            }).markdown,
            acceptedAnswer: acc
                ? {
                    score: acc.score,
                    author: acc.owner?.display_name,
                    markdown: htmlToMarkdown(acc.body || '', {
                        onlyMainContent: false,
                        maxChars: 2500,
                    }).markdown,
                }
                : null,
        };
    });
}
// ── 2. ARXIV PAPER EXTRACTOR ───────────────────────────────────────────────
export async function fetchArxiv(target, limit = 5, proxy) {
    const cleaned = target.replace(/^arxiv:/i, '').trim();
    const idMatch = /(?:arxiv\.org\/(?:abs|pdf)\/|^)(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(cleaned);
    const apiUrl = idMatch
        ? `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(idMatch[1])}`
        : `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(cleaned)}&sortBy=relevance&sortOrder=descending&max_results=${Math.min(15, limit)}`;
    const res = await proxyFetch(apiUrl, { signal: AbortSignal.timeout(8_000), timeoutMs: 8_000, proxy });
    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
    return entries.map((e) => {
        const idUrl = clean(e.match(/<id>([\s\S]*?)<\/id>/i)?.[1] || '');
        const arxivId = idUrl.split('/abs/').pop() || idUrl;
        const title = clean(e.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
        const summary = clean(e.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || '');
        const published = clean(e.match(/<published>([\s\S]*?)<\/published>/i)?.[1] || '');
        const updated = clean(e.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] || '');
        const authors = [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((a) => clean(a[1]));
        const categories = [...e.matchAll(/<category[^>]+term="([^"]+)"/gi)].map((c) => c[1]);
        return {
            arxivId,
            title,
            authors,
            publishedAt: published,
            updatedAt: updated,
            categories,
            absUrl: `https://arxiv.org/abs/${arxivId}`,
            pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
            abstract: summary,
        };
    });
}
// ── 3. WIKIPEDIA REST SUMMARY & EXTRACT ────────────────────────────────────
export async function fetchWikipediaSummary(target, proxy) {
    let title = target.replace(/^wiki:/i, '').trim();
    let lang = 'en';
    const urlMatch = /https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^?#]+)/i.exec(title);
    if (urlMatch) {
        lang = urlMatch[1];
        title = decodeURIComponent(urlMatch[2]);
    }
    const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    const res = await proxyFetch(apiUrl, {
        headers: { 'User-Agent': 'TuxScout/1.1 (+https://github.com/SuparvaCode/tuxscout)' },
        signal: AbortSignal.timeout(6_000),
        timeoutMs: 6_000,
        proxy,
    });
    if (!res.ok)
        throw new Error(`Wikipedia REST API returned HTTP ${res.status} for ${title}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await res.json();
    return {
        title: d.title,
        description: d.description || '',
        extract: d.extract || '',
        url: d.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        thumbnailUrl: d.thumbnail?.source,
        coordinates: d.coordinates,
        lastModified: d.timestamp,
    };
}
// ── 4. NPM & PYPI PACKAGE REGISTRY INSPECTORS ──────────────────────────────
export async function fetchNpmPackage(target, proxy) {
    let pkg = target.replace(/^npm:/i, '').trim();
    const m = /npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/i.exec(pkg);
    if (m)
        pkg = m[1];
    const [metaRes, dlRes] = await Promise.all([
        proxyFetch(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace(/%40/g, '@')}/latest`, {
            signal: AbortSignal.timeout(6_000),
            timeoutMs: 6_000,
            proxy,
        }),
        proxyFetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg).replace(/%40/g, '@')}`, {
            signal: AbortSignal.timeout(6_000),
            timeoutMs: 6_000,
            proxy,
        }).catch(() => null),
    ]);
    if (!metaRes.ok)
        throw new Error(`NPM package "${pkg}" not found (HTTP ${metaRes.status})`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await metaRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dl = dlRes && dlRes.ok ? await dlRes.json() : null;
    return {
        name: d.name,
        version: d.version,
        description: d.description || '',
        license: d.license || 'Unknown',
        homepage: d.homepage,
        repository: typeof d.repository === 'object' ? d.repository?.url : d.repository,
        weeklyDownloads: dl?.downloads ?? null,
        dependencies: Object.keys(d.dependencies || {}),
        peerDependencies: Object.keys(d.peerDependencies || {}),
        bin: d.bin ? Object.keys(d.bin) : [],
        keywords: d.keywords || [],
        npmUrl: `https://www.npmjs.com/package/${d.name}`,
    };
}
export async function fetchPypiPackage(target, proxy) {
    let pkg = target.replace(/^pypi:/i, '').trim();
    const m = /pypi\.org\/project\/([^/?#]+)/i.exec(pkg);
    if (m)
        pkg = m[1];
    const res = await proxyFetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
        signal: AbortSignal.timeout(6_000),
        timeoutMs: 6_000,
        proxy,
    });
    if (!res.ok)
        throw new Error(`PyPI package "${pkg}" not found (HTTP ${res.status})`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await res.json();
    const info = d.info || {};
    return {
        name: info.name,
        version: info.version,
        summary: info.summary || '',
        license: info.license || 'Unknown',
        requiresPython: info.requires_python || '',
        author: info.author || info.author_email || '',
        homepage: info.home_page || info.project_url,
        projectUrls: info.project_urls || {},
        dependencies: (info.requires_dist || []).slice(0, 25),
        pypiUrl: info.package_url || `https://pypi.org/project/${pkg}/`,
    };
}
// ── 5. IMDB MOVIE / TV / PERSON SEARCH & DOSSIER EXTRACTOR ─────────────────
function formatIsoDuration(iso) {
    if (!iso || typeof iso !== 'string')
        return undefined;
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
    if (!m)
        return iso;
    const parts = [];
    if (m[1])
        parts.push(`${m[1]}h`);
    if (m[2])
        parts.push(`${m[2]}m`);
    if (m[3] && !m[1])
        parts.push(`${m[3]}s`);
    return parts.join(' ') || iso;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNamesList(field) {
    if (!field)
        return [];
    const arr = Array.isArray(field) ? field : [field];
    return arr
        .map((item) => (typeof item === 'string' ? clean(item) : clean(item?.name || '')))
        .filter(Boolean);
}
async function fetchImdbEntityPage(imdbId, proxy) {
    const isPerson = imdbId.startsWith('nm');
    const pageUrl = isPerson
        ? `https://www.imdb.com/name/${imdbId}/`
        : `https://www.imdb.com/title/${imdbId}/`;
    try {
        const { status, text: html } = await fetchTextWithJar('imdb_page', pageUrl, Date.now() + 9_000, BROWSER_HEADERS, proxy);
        if (status >= 400 || !html)
            return null;
        const ldMatch = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
        if (!ldMatch)
            return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ld = JSON.parse(ldMatch[1].trim());
        const title = decodeEntities(clean(ld.name || ''));
        const originalTitle = ld.alternateName ? decodeEntities(clean(ld.alternateName)) : undefined;
        const plot = ld.description ? decodeEntities(clean(ld.description)) : undefined;
        const rating = ld.aggregateRating?.ratingValue ? Number(ld.aggregateRating.ratingValue) : undefined;
        const ratingCount = ld.aggregateRating?.ratingCount ? Number(ld.aggregateRating.ratingCount) : undefined;
        const genres = Array.isArray(ld.genre) ? ld.genre.map(clean) : ld.genre ? [clean(ld.genre)] : [];
        const keywords = typeof ld.keywords === 'string'
            ? ld.keywords.split(',').map((k) => clean(k)).filter(Boolean)
            : Array.isArray(ld.keywords)
                ? ld.keywords.map(clean)
                : [];
        const releaseDate = ld.datePublished || ld.birthDate || undefined;
        const yearMatch = releaseDate ? /^(\d{4})/.exec(String(releaseDate)) : null;
        return {
            imdbId,
            url: pageUrl,
            title: title || imdbId,
            ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
            type: ld['@type'] || (isPerson ? 'Person' : 'Title'),
            ...(yearMatch ? { year: Number(yearMatch[1]) } : {}),
            ...(releaseDate ? { releaseDate } : {}),
            ...(ld.contentRating ? { contentRating: clean(ld.contentRating) } : {}),
            ...(ld.duration ? { duration: formatIsoDuration(ld.duration) } : {}),
            ...(rating ? { rating } : {}),
            ...(ratingCount ? { ratingCount } : {}),
            ...(genres.length ? { genres } : {}),
            ...(plot ? { plot } : {}),
            directors: extractNamesList(ld.director),
            creators: extractNamesList(ld.creator),
            cast: extractNamesList(ld.actor),
            ...(keywords.length ? { keywords } : {}),
            ...(ld.image ? { posterUrl: typeof ld.image === 'string' ? ld.image : ld.image?.url } : {}),
            ...(ld.trailer?.embedUrl || ld.trailer?.url
                ? { trailerUrl: ld.trailer.embedUrl || ld.trailer.url }
                : {}),
        };
    }
    catch {
        return null;
    }
}
export async function fetchImdb(target, limit = 8, proxy) {
    const cleaned = target.replace(/^imdb:/i, '').trim();
    const directIdMatch = /(?:imdb\.com\/(?:title|name)\/|^)((?:tt|nm)\d{6,10})\b/i.exec(cleaned);
    const findQueryMatch = /imdb\.com\/find\/?\?[^#]*\bq=([^&#]+)/i.exec(cleaned);
    if (directIdMatch) {
        const imdbId = directIdMatch[1].toLowerCase();
        const details = await fetchImdbEntityPage(imdbId, proxy);
        return {
            query: imdbId,
            featured: details,
            results: details
                ? [
                    {
                        imdbId: details.imdbId,
                        title: details.title,
                        type: details.type || 'Title',
                        year: details.year,
                        stars: details.cast?.slice(0, 4).join(', '),
                        posterUrl: details.posterUrl,
                        url: details.url,
                    },
                ]
                : [],
        };
    }
    const searchQuery = findQueryMatch ? decodeURIComponent(findQueryMatch[1].replace(/\+/g, ' ')) : cleaned;
    const alnum = searchQuery.toLowerCase().replace(/[^a-z0-9]/g, '');
    const firstChar = alnum[0] || 'x';
    const slug = searchQuery.toLowerCase().replace(/\s+/g, '_').slice(0, 60);
    const sgUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(slug)}.json`;
    const sgRes = await proxyFetch(sgUrl, {
        headers: {
            'User-Agent': DEFAULT_UA,
            Accept: 'application/json',
            Referer: 'https://www.imdb.com/',
        },
        signal: AbortSignal.timeout(7_000),
        timeoutMs: 7_000,
        proxy,
    });
    if (!sgRes.ok) {
        throw new Error(`IMDb suggestion API returned HTTP ${sgRes.status}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sgJson = await sgRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems = Array.isArray(sgJson?.d) ? sgJson.d : [];
    const results = rawItems
        .filter((item) => item?.id && item?.l)
        .slice(0, limit)
        .map((item) => {
        const id = String(item.id);
        const isTitle = id.startsWith('tt');
        const isName = id.startsWith('nm');
        return {
            imdbId: id,
            title: clean(item.l),
            type: clean(item.q || item.qid || (isName ? 'Person' : 'Title')),
            ...(item.y ? { year: item.y } : item.yr ? { year: item.yr } : {}),
            ...(item.s ? { stars: clean(item.s) } : {}),
            ...(item.rank ? { rank: Number(item.rank) } : {}),
            ...(item.i?.imageUrl ? { posterUrl: item.i.imageUrl } : {}),
            url: isTitle
                ? `https://www.imdb.com/title/${id}/`
                : isName
                    ? `https://www.imdb.com/name/${id}/`
                    : `https://www.imdb.com/find/?q=${encodeURIComponent(item.l)}`,
        };
    });
    // Hydrate full details for the top title/person match
    const topEntity = results.find((r) => r.imdbId.startsWith('tt') || r.imdbId.startsWith('nm'));
    let featured = null;
    if (topEntity) {
        featured = await fetchImdbEntityPage(topEntity.imdbId, proxy);
        if (!featured) {
            featured = {
                imdbId: topEntity.imdbId,
                url: topEntity.url,
                title: topEntity.title,
                type: topEntity.type,
                year: topEntity.year,
                cast: topEntity.stars ? topEntity.stars.split(',').map((s) => clean(s)) : [],
                posterUrl: topEntity.posterUrl,
            };
        }
    }
    return {
        query: searchQuery,
        featured,
        results,
    };
}
// ── 6. PDF DOCUMENT EXTRACTOR & SEARCH ─────────────────────────────────────
function decodePdfLiteralString(raw) {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== '\\') {
            out += ch;
            continue;
        }
        i++;
        if (i >= raw.length)
            break;
        const next = raw[i];
        if (next === 'n')
            out += '\n';
        else if (next === 'r')
            out += '\r';
        else if (next === 't')
            out += '\t';
        else if (next === 'b')
            out += '\b';
        else if (next === 'f')
            out += '\f';
        else if (next === '(' || next === ')' || next === '\\')
            out += next;
        else if (next >= '0' && next <= '7') {
            let oct = next;
            if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7')
                oct += raw[++i];
            if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7')
                oct += raw[++i];
            const code = parseInt(oct, 8);
            if (code >= 32 && code <= 126)
                out += String.fromCharCode(code);
            else if (code === 10 || code === 13)
                out += '\n';
            else
                out += ' ';
        }
        else {
            out += next;
        }
    }
    return out;
}
function decodePdfHexString(hexRaw) {
    const hex = hexRaw.replace(/\s+/g, '');
    if (!hex)
        return '';
    if (hex.toUpperCase().startsWith('FEFF')) {
        // UTF-16BE
        let out = '';
        for (let i = 4; i + 3 < hex.length; i += 4) {
            const code = parseInt(hex.slice(i, i + 4), 16);
            if (code >= 32 && code !== 0xffff)
                out += String.fromCharCode(code);
        }
        return out;
    }
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16);
        if (code >= 32 && code <= 126)
            out += String.fromCharCode(code);
        else if (code === 10 || code === 13)
            out += '\n';
    }
    return out;
}
function extractTextFromPdfStream(content) {
    const blocks = content.match(/BT[\s\S]*?ET/g) || [content];
    const lines = [];
    for (const block of blocks) {
        let currentLine = '';
        // Match TJ arrays `[ (...) -120 (...) ] TJ` or single `(...) Tj` / `<...> Tj`
        const tokenRe = /\[([\s\S]*?)\]\s*TJ|\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|\b(Td|TD|T\*)\b/g;
        let m;
        // eslint-disable-next-line no-cond-assign
        while ((m = tokenRe.exec(block))) {
            if (m[1] !== undefined) {
                const arrContent = m[1];
                const subRe = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
                let sm;
                // eslint-disable-next-line no-cond-assign
                while ((sm = subRe.exec(arrContent))) {
                    if (sm[1] !== undefined) {
                        currentLine += decodePdfLiteralString(sm[1]);
                    }
                    else if (sm[2] !== undefined) {
                        currentLine += decodePdfHexString(sm[2]);
                    }
                    else if (sm[3] !== undefined) {
                        const kerning = Number(sm[3]);
                        if (kerning < -180 && !currentLine.endsWith(' '))
                            currentLine += ' ';
                    }
                }
            }
            else if (m[2] !== undefined) {
                currentLine += decodePdfHexString(m[2]);
            }
            else if (m[3] !== undefined) {
                if (currentLine.trim()) {
                    lines.push(clean(currentLine));
                    currentLine = '';
                }
            }
            else {
                const litMatch = /^\(((?:\\.|[^\\()])*)\)/.exec(m[0]);
                if (litMatch)
                    currentLine += decodePdfLiteralString(litMatch[1]);
            }
        }
        if (currentLine.trim()) {
            lines.push(clean(currentLine));
        }
    }
    return lines
        .map((l) => l.replace(/[^\x20-\x7E\u00A0-\u024F]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((l) => l.length >= 2 && /[a-zA-Z]{2,}/.test(l))
        .join('\n');
}
export function parsePdfBuffer(buffer, maxChars = 12_000) {
    const rawLatin1 = buffer.toString('latin1');
    const versionMatch = /^%PDF-(\d+\.\d+)/.exec(rawLatin1);
    const version = versionMatch ? versionMatch[1] : '1.x';
    const pageMatches = rawLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
    const pageCount = pageMatches ? pageMatches.length : 1;
    const extractInfoField = (field) => {
        const re = new RegExp(`\\/${field}\\s*(?:\\(((?:\\\\.|[^\\\\()])*)\\)|<([0-9A-Fa-f\\s]+)>)`, 'i');
        const m = re.exec(rawLatin1);
        if (!m)
            return undefined;
        const val = m[1] !== undefined ? decodePdfLiteralString(m[1]) : decodePdfHexString(m[2] || '');
        return clean(val) || undefined;
    };
    const title = extractInfoField('Title');
    const author = extractInfoField('Author');
    const subject = extractInfoField('Subject');
    const creator = extractInfoField('Creator') || extractInfoField('Producer');
    const extractedChunks = [];
    let totalChars = 0;
    let pos = 0;
    while (pos < buffer.length && totalChars < maxChars * 1.5) {
        const streamIdx = rawLatin1.indexOf('stream', pos);
        if (streamIdx === -1)
            break;
        // Ensure 'stream' is not part of 'endstream'
        if (streamIdx >= 3 && rawLatin1.slice(streamIdx - 3, streamIdx) === 'end') {
            pos = streamIdx + 6;
            continue;
        }
        const dictStart = Math.max(0, streamIdx - 350);
        const dictHeader = rawLatin1.slice(dictStart, streamIdx);
        let dataStart = streamIdx + 6;
        if (buffer[dataStart] === 0x0d && buffer[dataStart + 1] === 0x0a)
            dataStart += 2;
        else if (buffer[dataStart] === 0x0a || buffer[dataStart] === 0x0d)
            dataStart += 1;
        else {
            pos = streamIdx + 6;
            continue;
        }
        const endStreamIdx = rawLatin1.indexOf('endstream', dataStart);
        if (endStreamIdx === -1)
            break;
        pos = endStreamIdx + 9;
        // Skip image/font binary streams
        if (/\/Subtype\s*\/Image|\/FontFile|\/Type\s*\/XRef|\/Type\s*\/ObjStm/i.test(dictHeader)) {
            continue;
        }
        let streamEnd = endStreamIdx;
        if (buffer[streamEnd - 2] === 0x0d && buffer[streamEnd - 1] === 0x0a)
            streamEnd -= 2;
        else if (buffer[streamEnd - 1] === 0x0a || buffer[streamEnd - 1] === 0x0d)
            streamEnd -= 1;
        const slice = buffer.subarray(dataStart, streamEnd);
        if (slice.length === 0 || slice.length > 5 * 1024 * 1024)
            continue;
        let decodedStr = '';
        if (/\/FlateDecode/i.test(dictHeader)) {
            try {
                decodedStr = zlib.inflateSync(slice).toString('latin1');
            }
            catch {
                try {
                    decodedStr = zlib.inflateRawSync(slice).toString('latin1');
                }
                catch {
                    continue;
                }
            }
        }
        else if (!/\/Filter/i.test(dictHeader)) {
            decodedStr = slice.toString('latin1');
        }
        if (decodedStr && decodedStr.includes('BT')) {
            const text = extractTextFromPdfStream(decodedStr);
            if (text) {
                extractedChunks.push(text);
                totalChars += text.length;
            }
        }
    }
    const fullText = extractedChunks.join('\n\n').slice(0, maxChars);
    return {
        version,
        pageCount,
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),
        ...(subject ? { subject } : {}),
        ...(creator ? { creator } : {}),
        text: fullText,
    };
}
export async function fetchPdfDocument(target, maxChars = 10_000, limit = 8, proxy) {
    const cleaned = target.replace(/^pdf:/i, '').trim();
    // If target is a search query rather than a URL, run PDF search across Web + ArXiv + OpenAlex
    if (!isHttpUrl(cleaned)) {
        const searchRes = await searchPdf(cleaned, { n: limit, proxy });
        return {
            mode: 'search',
            query: cleaned,
            count: searchRes.sources.length,
            engines: searchRes.engines,
            sources: searchRes.sources,
        };
    }
    // Direct PDF URL download & extraction
    const deadline = Date.now() + 20_000;
    const { status, buffer, url, contentType } = await fetchBytesWithJar('pdf_fetch', cleaned, deadline, BROWSER_HEADERS, 30 * 1024 * 1024, proxy);
    if (status >= 400) {
        throw new Error(`PDF download failed with HTTP ${status} for ${cleaned}`);
    }
    const parsed = parsePdfBuffer(buffer, maxChars);
    // If this is an ArXiv PDF URL, also fetch official ArXiv metadata so title/authors/abstract are always crystal-clear
    const arxivMatch = /arxiv\.org\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(url);
    let arxivMeta;
    if (arxivMatch) {
        try {
            const papers = await fetchArxiv(arxivMatch[1], 1, proxy);
            arxivMeta = papers[0];
        }
        catch { /* ignore */ }
    }
    return {
        mode: 'document',
        url,
        status,
        contentType: contentType || 'application/pdf',
        byteLength: buffer.byteLength,
        pdfVersion: parsed.version,
        pageCount: parsed.pageCount,
        title: arxivMeta?.title || parsed.title || url.split('/').pop() || 'PDF Document',
        author: arxivMeta?.authors?.join(', ') || parsed.author,
        subject: arxivMeta?.abstract || parsed.subject,
        creator: parsed.creator,
        text: parsed.text || arxivMeta?.abstract || '',
    };
}
// ── 5. UNIVERSAL STRUCTURED WEBPAGE EXTRACTOR (JSON-LD + NextData + Tables + Meta) ──
function extractHtmlTablesAsJson(html) {
    const tables = extractTagBlocks(html, 'table').slice(0, 5);
    const parsedTables = [];
    for (const tbl of tables) {
        const rows = extractTagBlocks(tbl, 'tr');
        if (rows.length < 2)
            continue;
        const matrix = [];
        for (const r of rows) {
            const cells = [];
            const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
            let m;
            // eslint-disable-next-line no-cond-assign
            while ((m = cellRe.exec(r))) {
                cells.push(textOnly(m[2]));
            }
            if (cells.length)
                matrix.push(cells);
        }
        if (matrix.length < 2)
            continue;
        const headers = matrix[0].map((h, i) => h || `col_${i + 1}`);
        const records = [];
        for (const row of matrix.slice(1, 35)) {
            const obj = {};
            headers.forEach((h, i) => {
                if (row[i] !== undefined)
                    obj[h] = row[i];
            });
            records.push(obj);
        }
        if (records.length)
            parsedTables.push(records);
    }
    return parsedTables;
}
export async function extractStructuredWebpage(url, maxChars = 6000, proxy) {
    const deadline = Date.now() + 10_000;
    const res = await fetchTextWithJar('smart_web', url, deadline, BROWSER_HEADERS, proxy);
    const html = res.text;
    const meta = extractPageMetadata(html, res.url);
    // 1. Extract all JSON-LD blocks
    const jsonLd = [];
    const ldMatches = [
        ...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    ];
    for (const m of ldMatches) {
        try {
            jsonLd.push(JSON.parse(m[1].trim()));
        }
        catch {
            /* ignore malformed json-ld */
        }
    }
    // 2. Check for Next.js __NEXT_DATA__ hydration state
    let nextDataProps = undefined;
    const nextMatch = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (nextMatch) {
        try {
            const parsed = JSON.parse(nextMatch[1]);
            nextDataProps = parsed?.props?.pageProps
                ? JSON.parse(JSON.stringify(parsed.props.pageProps).slice(0, 15_000))
                : undefined;
        }
        catch {
            /* ignore */
        }
    }
    // 3. Discover RSS/Atom feeds & API endpoints
    const feeds = [];
    const linkRe = /<link\b[^>]*>/gi;
    let lm;
    // eslint-disable-next-line no-cond-assign
    while ((lm = linkRe.exec(html))) {
        const tag = lm[0];
        const type = attr(tag, 'type').toLowerCase();
        if (type.includes('rss') || type.includes('atom') || type.includes('feed')) {
            const href = attr(tag, 'href');
            if (href) {
                try {
                    feeds.push({
                        title: attr(tag, 'title') || 'Feed',
                        type,
                        url: new URL(href, res.url).toString(),
                    });
                }
                catch {
                    /* ignore */
                }
            }
        }
    }
    // 4. Convert HTML tables to structured JSON objects
    const tables = extractHtmlTablesAsJson(html);
    // 5. Convert main content to concise Markdown
    const md = htmlToMarkdown(html, {
        baseUrl: res.url,
        includeLinks: true,
        includeImages: false,
        onlyMainContent: true,
        maxChars,
    });
    return {
        url: res.url,
        status: res.status,
        metadata: meta,
        jsonLd: jsonLd.slice(0, 5),
        hasNextData: Boolean(nextMatch),
        nextDataSample: nextDataProps,
        feeds,
        tablesCount: tables.length,
        tables,
        linksCount: md.links.length,
        topLinks: md.links.slice(0, 20),
        markdown: md.markdown,
    };
}
// ── UNIFIED SMART EXTRACT ROUTER ───────────────────────────────────────────
export function detectExtractProvider(target) {
    const t = target.trim();
    if (/^imdb:/i.test(t) || /imdb\.com\//i.test(t) || /^(?:tt|nm)\d{7,10}$/i.test(t))
        return 'imdb';
    if (/^pdf:/i.test(t) || (isHttpUrl(t) && isPdfUrl(t) && !/arxiv\.org\/abs\//i.test(t)))
        return 'pdf';
    if (/(?:twitter\.com|x\.com)\//i.test(t) || /^(?:twitter|x):/i.test(t))
        return 'twitter';
    if (/instagram\.com\//i.test(t) || /^(?:ig|insta|instagram):/i.test(t))
        return 'instagram';
    if (/reddit\.com\//i.test(t) || /^\/?r\/[A-Za-z0-9_]+/i.test(t) || /^reddit:/i.test(t))
        return 'reddit';
    if (/github\.com\//i.test(t) || /^gh:/i.test(t))
        return 'github';
    if (/tiktok\.com\//i.test(t))
        return 'tiktok';
    if (/news\.ycombinator\.com/i.test(t) || /^hn:/i.test(t))
        return 'hackernews';
    if (/(?:youtube\.com|youtu\.be)\//i.test(t) || Boolean(extractVideoId(t)))
        return 'youtube';
    if (/stackoverflow\.com\//i.test(t) || /^so:/i.test(t))
        return 'stackoverflow';
    if (/arxiv\.org\//i.test(t) || /^arxiv:/i.test(t))
        return 'arxiv';
    if (/wikipedia\.org\/wiki\//i.test(t) || /^wiki:/i.test(t))
        return 'wikipedia';
    if (/npmjs\.com\/package\//i.test(t) || /^npm:/i.test(t))
        return 'npm';
    if (/pypi\.org\/project\//i.test(t) || /^pypi:/i.test(t))
        return 'pypi';
    return 'webpage';
}
export async function smartExtract(options) {
    const started = Date.now();
    const target = clean(options.target);
    const limit = Number(options.limit || 8);
    const maxChars = Number(options.maxChars || 6000);
    const provider = options.provider || detectExtractProvider(target);
    const proxy = options.proxy;
    const cacheKey = `extract:${provider}:${target}:${limit}:${maxChars}`;
    if (!options.noCache) {
        const hit = cache.get(cacheKey);
        if (hit)
            return { ...hit, cached: true, ms: Date.now() - started };
    }
    try {
        let structured = null;
        let markdown = '';
        if (provider === 'twitter' ||
            provider === 'instagram' ||
            provider === 'reddit' ||
            provider === 'github' ||
            provider === 'tiktok') {
            const res = await socialIntel({
                target,
                platform: provider,
                limit,
                noCache: options.noCache,
                proxy,
            });
            if (!res.ok)
                throw new Error(res.error || `${provider} extraction failed`);
            structured = res.data;
            markdown = res.markdown;
        }
        else if (provider === 'hackernews') {
            const q = target.replace(/^hn:/i, '').trim();
            const idMatch = /item\?id=(\d+)/i.exec(q) || /^(\d+)$/.exec(q);
            const res = await newsIntel({
                category: 'hn',
                hnItemId: idMatch ? idMatch[1] : undefined,
                query: !idMatch && q !== 'frontpage' && q !== 'top' ? q : undefined,
                limit,
                proxy,
            });
            structured = res.hnDiscussion || res.items;
            markdown = res.markdown;
        }
        else if (provider === 'youtube') {
            const res = await youtubeTool({
                input: target,
                mode: 'transcript',
                proxy,
            });
            structured = res;
            markdown = res.transcript?.markdown || JSON.stringify(res.metadata, null, 2);
        }
        else if (provider === 'imdb') {
            const imdb = await fetchImdb(target, limit, proxy);
            structured = imdb;
            const lines = [];
            if (imdb.featured) {
                const f = imdb.featured;
                lines.push(`# IMDb: ${f.title}${f.year ? ` (${f.year})` : ''} [${f.type || 'Title'}]`, `- **IMDb ID:** \`${f.imdbId}\` | **URL:** ${f.url}`);
                if (f.rating) {
                    lines.push(`- **Rating:** ⭐ ${f.rating}/10${f.ratingCount ? ` (${f.ratingCount.toLocaleString()} votes)` : ''}` +
                        `${f.contentRating ? ` | **Rated:** ${f.contentRating}` : ''}` +
                        `${f.duration ? ` | **Runtime:** ${f.duration}` : ''}`);
                }
                if (f.genres?.length)
                    lines.push(`- **Genres:** ${f.genres.join(', ')}`);
                if (f.directors?.length)
                    lines.push(`- **Director(s):** ${f.directors.join(', ')}`);
                if (f.creators?.length)
                    lines.push(`- **Creator(s):** ${f.creators.join(', ')}`);
                if (f.cast?.length)
                    lines.push(`- **Top Cast:** ${f.cast.join(', ')}`);
                if (f.releaseDate)
                    lines.push(`- **Release Date:** ${f.releaseDate}`);
                if (f.trailerUrl)
                    lines.push(`- **Trailer:** ${f.trailerUrl}`);
                if (f.plot) {
                    lines.push('', '## Plot Summary', f.plot);
                }
                if (f.keywords?.length) {
                    lines.push('', `- **Keywords:** ${f.keywords.slice(0, 15).join(', ')}`);
                }
            }
            if (imdb.results.length > 1) {
                lines.push('', `## Matching IMDb Results (${imdb.results.length})`, '');
                imdb.results.forEach((r, idx) => {
                    lines.push(`${idx + 1}. **[${r.title}](${r.url})** (\`${r.imdbId}\`)${r.year ? ` — ${r.year}` : ''} [${r.type}]` +
                        `${r.stars ? ` · *${r.stars}*` : ''}${r.rank ? ` · Rank #${r.rank}` : ''}`);
                });
            }
            else if (!imdb.featured && imdb.results.length === 0) {
                lines.push(`# IMDb Search: ${imdb.query}`, '', '_No matching titles or names found._');
            }
            markdown = lines.join('\n');
        }
        else if (provider === 'pdf') {
            const pdfData = await fetchPdfDocument(target, maxChars, limit, proxy);
            structured = pdfData;
            if (pdfData.mode === 'search') {
                const lines = [
                    `# PDF Document Search: "${pdfData.query}" (${pdfData.count} results)`,
                    `- **Engines:** ${pdfData.engines.join(', ') || 'none'}`,
                    '',
                ];
                pdfData.sources.forEach((s, idx) => {
                    lines.push(`## ${idx + 1}. ${s.title}`, `- **PDF URL:** ${s.url}`, `- **Engine:** ${s.engine || 'web'}${s.year ? ` | **Year:** ${s.year}` : ''}`, s.description ? `\n${s.description}` : '', '');
                });
                markdown = lines.join('\n');
            }
            else {
                const lines = [
                    `# PDF Document: ${pdfData.title}`,
                    `- **URL:** ${pdfData.url}`,
                    `- **Pages:** ~${pdfData.pageCount} | **Size:** ${(pdfData.byteLength / 1024).toFixed(1)} KB | **PDF Version:** ${pdfData.pdfVersion}`,
                ];
                if (pdfData.author)
                    lines.push(`- **Author(s):** ${pdfData.author}`);
                if (pdfData.creator)
                    lines.push(`- **Creator/Producer:** ${pdfData.creator}`);
                if (pdfData.subject)
                    lines.push('', '## Abstract / Subject', pdfData.subject);
                lines.push('', '## Extracted PDF Text', '', pdfData.text || '_No uncompressed/FlateDecode text streams could be extracted from this PDF._');
                markdown = lines.join('\n');
            }
        }
        else if (provider === 'stackoverflow') {
            const so = await fetchStackOverflow(target, limit, proxy);
            structured = so;
            if (Array.isArray(so)) {
                const lines = [`# StackOverflow Results (${so.length})\n`];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                so.forEach((item, i) => {
                    lines.push(`## ${i + 1}. ${item.title} (Score: ${item.score})`, `- **URL:** ${item.url}`, `- **Tags:** ${item.tags.join(', ')}`, '', item.acceptedAnswer
                        ? `### Accepted Answer (Score: ${item.acceptedAnswer.score} by ${item.acceptedAnswer.author})\n${item.acceptedAnswer.markdown}`
                        : item.questionExcerpt, '');
                });
                markdown = lines.join('\n');
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const q = so;
                const lines = [
                    `# StackOverflow Question: ${q.title}`,
                    `- **URL:** ${q.url} | **Score:** ${q.score} | **Views:** ${q.viewCount?.toLocaleString()}`,
                    `- **Tags:** ${q.tags.join(', ')}`,
                    '',
                    q.questionMarkdown,
                    '',
                    `## Top Answers (${q.answers.length})`,
                    '',
                ];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                q.answers.forEach((a, i) => {
                    lines.push(`### ${i + 1}. ${a.isAccepted ? '✅ ACCEPTED ' : ''}Answer (Score: ${a.score} by ${a.author})`, a.markdown, '');
                });
                markdown = lines.join('\n');
            }
        }
        else if (provider === 'arxiv') {
            const papers = await fetchArxiv(target, limit, proxy);
            structured = papers;
            const lines = [`# ArXiv Papers (${papers.length})\n`];
            papers.forEach((p, i) => {
                lines.push(`## ${i + 1}. ${p.title}`, `- **ArXiv ID:** \`${p.arxivId}\` | **Published:** ${p.publishedAt}`, `- **Authors:** ${p.authors.join(', ')}`, `- **Categories:** ${p.categories.join(', ')}`, `- **Links:** [Abstract](${p.absUrl}) | [PDF](${p.pdfUrl})`, '', p.abstract, '');
            });
            markdown = lines.join('\n');
        }
        else if (provider === 'wikipedia') {
            const wiki = await fetchWikipediaSummary(target, proxy);
            structured = wiki;
            markdown = [
                `# Wikipedia: ${wiki.title}`,
                wiki.description ? `*${wiki.description}*` : '',
                `- **URL:** ${wiki.url}`,
                '',
                wiki.extract,
            ]
                .filter(Boolean)
                .join('\n');
        }
        else if (provider === 'npm') {
            const pkg = await fetchNpmPackage(target, proxy);
            structured = pkg;
            markdown = [
                `# NPM Package: ${pkg.name}@${pkg.version}`,
                `- **Description:** ${pkg.description}`,
                `- **Weekly Downloads:** ${pkg.weeklyDownloads !== null ? pkg.weeklyDownloads.toLocaleString() : 'N/A'}`,
                `- **License:** ${pkg.license} | **NPM:** ${pkg.npmUrl}`,
                pkg.homepage ? `- **Homepage:** ${pkg.homepage}` : '',
                pkg.repository ? `- **Repository:** ${pkg.repository}` : '',
                pkg.bin.length ? `- **CLI Binaries:** \`${pkg.bin.join('`, `')}\`` : '',
                pkg.dependencies.length
                    ? `- **Dependencies (${pkg.dependencies.length}):** ${pkg.dependencies.join(', ')}`
                    : '- **Dependencies:** Zero dependencies',
            ]
                .filter(Boolean)
                .join('\n');
        }
        else if (provider === 'pypi') {
            const pkg = await fetchPypiPackage(target, proxy);
            structured = pkg;
            markdown = [
                `# PyPI Package: ${pkg.name} (${pkg.version})`,
                `- **Summary:** ${pkg.summary}`,
                `- **Requires Python:** ${pkg.requiresPython || 'Any'}`,
                `- **License:** ${pkg.license} | **PyPI:** ${pkg.pypiUrl}`,
                pkg.homepage ? `- **Homepage:** ${pkg.homepage}` : '',
                pkg.dependencies.length
                    ? `- **Dependencies (${pkg.dependencies.length}):** ${pkg.dependencies.slice(0, 15).join(', ')}`
                    : '',
            ]
                .filter(Boolean)
                .join('\n');
        }
        else {
            const web = await extractStructuredWebpage(target, maxChars, proxy);
            structured = web;
            const lines = [
                `# Structured Page: ${web.metadata.title || web.url}`,
                `- **URL:** ${web.url}`,
            ];
            if (web.metadata.description)
                lines.push(`- **Description:** ${web.metadata.description}`);
            if (web.metadata.author || web.metadata.publishedTime) {
                lines.push(`- **Author:** ${web.metadata.author || 'N/A'} | **Published:** ${web.metadata.publishedTime || 'N/A'}`);
            }
            if (web.jsonLd.length) {
                lines.push('', `## Structured JSON-LD (${web.jsonLd.length} schema blocks)`, '```json', JSON.stringify(web.jsonLd, null, 2).slice(0, 2000), '```');
            }
            if (web.tables.length) {
                lines.push('', `## Extracted Tables (${web.tables.length})`, '```json', JSON.stringify(web.tables, null, 2).slice(0, 2000), '```');
            }
            lines.push('', '## Main Content', '', web.markdown);
            markdown = lines.join('\n');
        }
        const result = {
            ok: true,
            provider,
            target,
            structured,
            markdown,
            ms: Date.now() - started,
        };
        cache.set(cacheKey, result);
        return { ...result, cached: false };
    }
    catch (err) {
        return {
            ok: false,
            provider,
            target,
            structured: null,
            markdown: '',
            cached: false,
            ms: Date.now() - started,
            error: err?.message || String(err),
        };
    }
}
//# sourceMappingURL=smart-extract.js.map