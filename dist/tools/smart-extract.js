// src/tools/smart-extract.ts
// TuxScout Smart Extract — Zero-Browser Structured Data Router & Knowledge Extractor for AI Agents.
// Turns any URL or target (X/Twitter, Instagram, Reddit, GitHub, YouTube, HackerNews,
// StackOverflow, ArXiv, Wikipedia, NPM, PyPI, TikTok, or any generic webpage) into
// concise, token-efficient structured JSON + Markdown without opening a browser window.
import { BROWSER_HEADERS, clean, fetchTextWithJar, LruCache } from '../utils/http.js';
import { attr, decodeEntities, extractPageMetadata, extractTagBlocks, htmlToMarkdown, textOnly, } from '../utils/html.js';
import { socialIntel } from './social-intel.js';
import { newsIntel } from './news-intel.js';
import { extractVideoId, youtubeTool } from './yt-downloader.js';
const cache = new LruCache(250, 10 * 60_000);
// ── 1. STACKOVERFLOW / STACKEXCHANGE EXTRACTOR ─────────────────────────────
export async function fetchStackOverflow(target, limit = 3) {
    const qIdMatch = /stackoverflow\.com\/questions\/(\d+)/i.exec(target);
    const apiBase = 'https://api.stackexchange.com/2.3';
    if (qIdMatch) {
        const qId = qIdMatch[1];
        const [qRes, aRes] = await Promise.all([
            fetch(`${apiBase}/questions/${qId}?site=stackoverflow&filter=withbody`, {
                signal: AbortSignal.timeout(7_000),
            }),
            fetch(`${apiBase}/questions/${qId}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody&pagesize=${Math.min(10, limit)}`, { signal: AbortSignal.timeout(7_000) }),
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
    const sRes = await fetch(`${apiBase}/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&accepted=True&site=stackoverflow&pagesize=${Math.min(5, limit)}&filter=withbody`, { signal: AbortSignal.timeout(7_000) });
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
        const aRes = await fetch(`${apiBase}/answers/${answerIds.join(';')}?site=stackoverflow&filter=withbody`, { signal: AbortSignal.timeout(7_000) });
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
export async function fetchArxiv(target, limit = 5) {
    const cleaned = target.replace(/^arxiv:/i, '').trim();
    const idMatch = /(?:arxiv\.org\/(?:abs|pdf)\/|^)(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(cleaned);
    const apiUrl = idMatch
        ? `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(idMatch[1])}`
        : `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(cleaned)}&sortBy=relevance&sortOrder=descending&max_results=${Math.min(15, limit)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8_000) });
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
export async function fetchWikipediaSummary(target) {
    let title = target.replace(/^wiki:/i, '').trim();
    let lang = 'en';
    const urlMatch = /https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^?#]+)/i.exec(title);
    if (urlMatch) {
        lang = urlMatch[1];
        title = decodeURIComponent(urlMatch[2]);
    }
    const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'TuxScout/1.1 (+https://github.com/SuparvaCode/tuxscout)' },
        signal: AbortSignal.timeout(6_000),
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
export async function fetchNpmPackage(target) {
    let pkg = target.replace(/^npm:/i, '').trim();
    const m = /npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/i.exec(pkg);
    if (m)
        pkg = m[1];
    const [metaRes, dlRes] = await Promise.all([
        fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace(/%40/g, '@')}/latest`, {
            signal: AbortSignal.timeout(6_000),
        }),
        fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg).replace(/%40/g, '@')}`, {
            signal: AbortSignal.timeout(6_000),
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
export async function fetchPypiPackage(target) {
    let pkg = target.replace(/^pypi:/i, '').trim();
    const m = /pypi\.org\/project\/([^/?#]+)/i.exec(pkg);
    if (m)
        pkg = m[1];
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
        signal: AbortSignal.timeout(6_000),
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
export async function extractStructuredWebpage(url, maxChars = 6000) {
    const deadline = Date.now() + 10_000;
    const res = await fetchTextWithJar('smart_web', url, deadline, BROWSER_HEADERS);
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
    const provider = detectExtractProvider(target);
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
            });
            structured = res.hnDiscussion || res.items;
            markdown = res.markdown;
        }
        else if (provider === 'youtube') {
            const res = await youtubeTool({
                input: target,
                mode: 'transcript',
            });
            structured = res;
            markdown = res.transcript?.markdown || JSON.stringify(res.metadata, null, 2);
        }
        else if (provider === 'stackoverflow') {
            const so = await fetchStackOverflow(target, limit);
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
            const papers = await fetchArxiv(target, limit);
            structured = papers;
            const lines = [`# ArXiv Papers (${papers.length})\n`];
            papers.forEach((p, i) => {
                lines.push(`## ${i + 1}. ${p.title}`, `- **ArXiv ID:** \`${p.arxivId}\` | **Published:** ${p.publishedAt}`, `- **Authors:** ${p.authors.join(', ')}`, `- **Categories:** ${p.categories.join(', ')}`, `- **Links:** [Abstract](${p.absUrl}) | [PDF](${p.pdfUrl})`, '', p.abstract, '');
            });
            markdown = lines.join('\n');
        }
        else if (provider === 'wikipedia') {
            const wiki = await fetchWikipediaSummary(target);
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
            const pkg = await fetchNpmPackage(target);
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
            const pkg = await fetchPypiPackage(target);
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
            const web = await extractStructuredWebpage(target, maxChars);
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