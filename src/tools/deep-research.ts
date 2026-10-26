// src/tools/deep-research.ts
// Multi-Parallel Stage Search & Deep Research Pipeline for AI Agents.
//
// Pipeline Stages:
//   Stage 1: Intent Classification & Multi-Angle Query Expansion
//   Stage 2: Concurrent Multi-Engine Web Discovery (+ Optional Image & YouTube Discovery)
//            with Round-Robin Rank Merging & Domain-Diversity Selection
//   Stage 3: Parallel Tiered Page Fetching (Fast HTTP Markdown -> Low-RAM Puppeteer JS Escalation)
//            with Backup URL Top-Up if primary URLs fail
//   Stage 4: Semantic Passage Ranking, Key Fact Extraction & Citation-Backed Markdown Synthesis

import { clean, hostOf, type ProxyInput } from '../utils/http.js';
import {
  classifyIntent,
  type Intent,
  queryTerms,
  type SearchTimeRange,
  type SearchVertical,
  subjectTerms,
  webSearch,
  type WebSource,
} from './web-search.js';
import { fetchMarkdownBatch, type MarkdownFetchResult } from './markdown-fetch.js';
import { imageSearch, type ImageItem } from './image-search.js';
import { youtubeTool, type YtVideoMetadata } from './yt-downloader.js';

export type ResearchDepth = 'quick' | 'standard' | 'deep';

export interface DeepResearchOptions {
  /** Primary research question, topic, or agent goal */
  query: string;
  /** Optional explicit sub-queries / angles to run in parallel */
  subQueries?: string[];
  /** 'quick' (2 angles, 3 pages), 'standard' (3 angles, 5 pages), 'deep' (4 angles, 8 pages) */
  depth?: ResearchDepth;
  /** Override number of top web pages to deeply fetch and convert to Markdown */
  maxPages?: number;
  /** Max characters of extracted content to keep per page (default 6000) */
  maxCharsPerPage?: number;
  /** Max pages allowed from the same domain to ensure source diversity (default 2) */
  maxPerDomain?: number;
  /** Automatically escalate JS-walled pages to low-memory Puppeteer (default true) */
  autoPuppeteer?: boolean;
  /** Allow fetching and extracting text from PDF URLs discovered during search (default true) */
  includePdf?: boolean;
  /** Optional search vertical preset ('general' | 'pdf' | 'imdb' | 'academic' | 'code' | 'docs' | 'books') */
  searchType?: SearchVertical;
  /** Optional domain filter (e.g. 'arxiv.org' or ['github.com', 'docs.rs']) */
  site?: string | string[];
  /** Optional recency filter ('day' | 'week' | 'month' | 'year' | 'any') */
  timeRange?: SearchTimeRange;
  /** Also run parallel image search for visual context (default false) */
  includeImages?: boolean;
  /** Also search YouTube and optionally pull top video transcript (default false) */
  includeYoutube?: boolean;
  /** Total timeout budget in ms (default 45_000) */
  timeoutMs?: number;
  /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
  proxy?: ProxyInput;
}

export interface RankedEvidencePage {
  citationIndex: number;
  title: string;
  url: string;
  domain: string;
  publishedTime?: string;
  author?: string;
  fetchMethod: 'http' | 'puppeteer' | 'api';
  escalatedReason?: string;
  relevanceScore: number;
  wordCount: number;
  searchSnippet: string;
  topPassages: string[];
  fullMarkdown: string;
}

export interface ResearchStageTelemetry {
  stage1_queryExpansionMs: number;
  stage2_parallelDiscoveryMs: number;
  stage3_parallelContentFetchMs: number;
  stage4_synthesisMs: number;
  totalMs: number;
  queriesExecuted: string[];
  enginesUsed: string[];
  totalCandidatesFound: number;
  pagesAttempted: number;
  pagesSucceeded: number;
  puppeteerEscalations: number;
}

export interface DeepResearchResult {
  query: string;
  intent: Intent;
  depth: ResearchDepth;
  reportMarkdown: string;
  keyHighlights: string[];
  evidencePages: RankedEvidencePage[];
  allDiscoveredSources: WebSource[];
  images?: ImageItem[];
  youtubeVideos?: YtVideoMetadata[];
  youtubeTranscriptSnippet?: string;
  telemetry: ResearchStageTelemetry;
}

// ── Stage 1: Multi-Angle Query Expansion ────────────────────────────────────
export function expandQueryAngles(
  query: string,
  subQueries: string[] | undefined,
  depth: ResearchDepth,
): { angles: string[]; intent: Intent } {
  const base = clean(query);
  const intent = classifyIntent(base);
  const maxAngles = depth === 'quick' ? 2 : depth === 'deep' ? 4 : 3;

  if (Array.isArray(subQueries) && subQueries.length > 0) {
    const custom = [base, ...subQueries.map((q) => clean(q)).filter(Boolean)];
    return {
      angles: [...new Set(custom)].slice(0, Math.max(maxAngles, subQueries.length)),
      intent,
    };
  }

  const subj = subjectTerms(base).join(' ') || base;
  const year = new Date().getFullYear();
  const angles: string[] = [base];

  if (intent === 'news') {
    angles.push(`${subj} official announcement blog release notes`);
    angles.push(`${subj} latest news updates ${year}`);
    angles.push(`${subj} changelog features review`);
  } else if (intent === 'navigational') {
    angles.push(`${subj} official documentation overview`);
    angles.push(`${subj} features pricing guide`);
  } else {
    // Evergreen / technical / analytical research
    angles.push(`${subj} technical overview architecture guide`);
    angles.push(`${subj} latest developments benchmarks ${year}`);
    angles.push(`${subj} comparison best practices examples`);
  }

  return {
    angles: [...new Set(angles.map((a) => clean(a)))].slice(0, maxAngles),
    intent,
  };
}

// ── Stage 2 Helper: Domain-Diverse Source Selection ─────────────────────────
function selectDiverseSources(
  sources: WebSource[],
  limit: number,
  maxPerDomain: number,
  includePdf = true,
): { primary: WebSource[]; backups: WebSource[] } {
  const domainCounts = new Map<string, number>();
  const primary: WebSource[] = [];
  const backups: WebSource[] = [];

  for (const src of sources) {
    const dom = hostOf(src.url);
    if (!dom) continue;
    // Skip binary archive/media links; allow PDFs when includePdf is enabled
    if (/\.(zip|tar|gz|exe|dmg|iso|mp4|mp3)(?:$|[?#])/i.test(src.url)) {
      continue;
    }
    if (!includePdf && /\.pdf(?:$|[?#])/i.test(src.url)) {
      continue;
    }
    const count = domainCounts.get(dom) || 0;
    if (primary.length < limit && count < maxPerDomain) {
      domainCounts.set(dom, count + 1);
      primary.push(src);
    } else {
      backups.push(src);
    }
  }
  return { primary, backups };
}

// ── Stage 4 Helper: Passage Scoring & Key Fact Extraction ───────────────────
function extractTopPassages(
  markdown: string,
  terms: string[],
  maxPassages = 6,
  maxTotalChars = 4500,
): { passages: string[]; score: number } {
  if (!markdown) return { passages: [], score: 0 };

  // Split by double newline or headings into coherent blocks
  const rawBlocks = markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 45);

  if (!rawBlocks.length) {
    return { passages: [markdown.slice(0, maxTotalChars)], score: 0.2 };
  }

  const scored = rawBlocks.map((block, idx) => {
    // Penalize pure link-menu / table-of-contents blocks where most lines are just `- [Title](url)`
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const linkOnlyLines = lines.filter((l) => /^(-|\*|\d+\.)?\s*\[[^\]]+\]\([^)]+\)$/.test(l));
    if (lines.length >= 3 && linkOnlyLines.length / lines.length > 0.6) {
      return { block, idx, score: -1 };
    }

    const lower = block.toLowerCase();
    let termHits = 0;
    for (const t of terms) {
      if (lower.includes(t)) termHits += 1;
    }
    const termRatio = terms.length ? termHits / terms.length : 0.5;
    // Bonus for data-rich blocks (numbers, percentages, dates, code blocks, tables)
    const hasNumbers = /\b\d+(?:\.\d+)?%?\b/.test(block) ? 0.15 : 0;
    const isCodeOrTable = /^```|\|.*\|/.test(block) ? 0.2 : /^#+\s/.test(block) ? 0.1 : 0;
    // Slight preference for earlier paragraphs (lead summary)
    const positionBonus = Math.max(0, 0.15 * (1 - idx / Math.max(1, rawBlocks.length)));
    const totalScore = termRatio + hasNumbers + isCodeOrTable + positionBonus;
    return { block, idx, score: totalScore };
  });

  const filtered = scored.filter((s) => s.score >= 0);
  const pool = filtered.length ? filtered : scored;
  pool.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const top = pool.slice(0, maxPassages);
  // Restore document reading order for the selected passages
  top.sort((a, b) => a.idx - b.idx);

  const out: string[] = [];
  let charBudget = 0;
  for (const item of top) {
    if (charBudget + item.block.length > maxTotalChars && out.length > 0) break;
    out.push(item.block);
    charBudget += item.block.length;
  }

  const avgScore =
    top.length > 0
      ? Math.round((top.reduce((s, x) => s + x.score, 0) / top.length) * 100) / 100
      : 0;

  return { passages: out, score: avgScore };
}

// ── Main Multi-Stage Deep Research Execution ────────────────────────────────
export async function deepResearch(options: DeepResearchOptions): Promise<DeepResearchResult> {
  const tStart = Date.now();
  const query = clean(options.query);
  if (!query) {
    throw new Error('deepResearch requires a non-empty "query" string.');
  }

  const depth: ResearchDepth = options.depth || 'standard';
  const defaultMaxPages = depth === 'quick' ? 3 : depth === 'deep' ? 8 : 5;
  const maxPages = Math.max(1, Math.min(15, options.maxPages ?? defaultMaxPages));
  const maxCharsPerPage = options.maxCharsPerPage ?? 6_000;
  const maxPerDomain = options.maxPerDomain ?? (maxPages <= 4 ? 1 : 2);
  const autoPuppeteer = options.autoPuppeteer ?? true;

  // ── STAGE 1: Query Expansion ──────────────────────────────────────────────
  const tStage1 = Date.now();
  const { angles, intent } = expandQueryAngles(query, options.subQueries, depth);
  const stage1Ms = Date.now() - tStage1;

  // ── STAGE 2: Parallel Multi-Engine Discovery ──────────────────────────────
  const tStage2 = Date.now();
  const searchLimit = Math.min(25, Math.max(maxPages * 3, 12));

  const webPromise = webSearch({
    queries: angles,
    n: searchLimit,
    searchType: options.searchType,
    site: options.site,
    timeRange: options.timeRange,
    proxy: options.proxy,
  });

  const imagesPromise = options.includeImages
    ? imageSearch({ query, n: 8, proxy: options.proxy }).catch(() => null)
    : Promise.resolve(null);

  const ytPromise = options.includeYoutube
    ? youtubeTool({ input: query, mode: 'search', searchLimit: 3, proxy: options.proxy }).catch(
        () => null,
      )
    : Promise.resolve(null);

  const [webRes, imgRes, ytRes] = await Promise.all([webPromise, imagesPromise, ytPromise]);
  const stage2Ms = Date.now() - tStage2;

  const { primary: primaryTargets, backups: backupTargets } = selectDiverseSources(
    webRes.sources,
    maxPages,
    maxPerDomain,
    options.includePdf !== false,
  );

  // ── STAGE 3: Parallel Tiered Content Extraction (HTTP -> Puppeteer) ───────
  const tStage3 = Date.now();
  const snippetMap = new Map<string, string>();
  for (const s of webRes.sources) {
    snippetMap.set(s.url, s.description || '');
  }

  let fetchedPages: MarkdownFetchResult[] = [];
  let pagesAttempted = 0;

  if (primaryTargets.length > 0) {
    pagesAttempted += primaryTargets.length;
    fetchedPages = await fetchMarkdownBatch(
      primaryTargets.map((s) => s.url),
      {
        concurrency: Math.min(6, primaryTargets.length),
        maxChars: maxCharsPerPage * 2,
        autoPuppeteer,
        onlyMainContent: true,
        timeoutMs: 14_000,
        proxy: options.proxy,
      },
    );
  }

  // Stage 3b: If some primary pages failed or returned ultra-thin content, top up from backup URLs
  const validFetched = fetchedPages.filter((p) => p.ok && p.wordCount >= 40);
  const deficit = maxPages - validFetched.length;
  if (deficit > 0 && backupTargets.length > 0) {
    const topUpUrls = backupTargets.slice(0, deficit + 1).map((s) => s.url);
    pagesAttempted += topUpUrls.length;
    const extraFetched = await fetchMarkdownBatch(topUpUrls, {
      concurrency: topUpUrls.length,
      maxChars: maxCharsPerPage * 2,
      autoPuppeteer,
      onlyMainContent: true,
      timeoutMs: 12_000,
      proxy: options.proxy,
    });
    fetchedPages.push(...extraFetched);
  }

  // Optional YouTube transcript on top video if includeYoutube is enabled
  let ytTranscriptSnippet: string | undefined;
  if (options.includeYoutube && ytRes?.searchResults?.[0]?.url) {
    try {
      const tr = await youtubeTool({
        input: ytRes.searchResults[0].url,
        mode: 'transcript',
        timeoutMs: 20_000,
        proxy: options.proxy,
      });
      if (tr.ok && tr.transcript?.fullText) {
        ytTranscriptSnippet = tr.transcript.fullText.slice(0, 2500);
      }
    } catch {
      /* optional */
    }
  }
  const stage3Ms = Date.now() - tStage3;

  // ── STAGE 4: Passage Ranking, Evidence Synthesis & Markdown Report ────────
  const tStage4 = Date.now();
  const allTerms = [...new Set(angles.flatMap((a) => queryTerms(a)))];

  const usablePages = fetchedPages
    .filter((p) => p.ok && p.markdown.length >= 80)
    .slice(0, maxPages);

  const evidencePages: RankedEvidencePage[] = usablePages.map((p, i) => {
    const { passages, score } = extractTopPassages(
      p.markdown,
      allTerms,
      6,
      maxCharsPerPage,
    );
    return {
      citationIndex: i + 1,
      title: p.title || p.url,
      url: p.finalUrl || p.url,
      domain: p.domain || hostOf(p.url),
      publishedTime: p.metadata.publishedTime || undefined,
      author: p.metadata.author || undefined,
      fetchMethod: p.method,
      escalatedReason: p.escalatedReason,
      relevanceScore: score,
      wordCount: p.wordCount,
      searchSnippet: snippetMap.get(p.url) || p.metadata.description || '',
      topPassages: passages,
      fullMarkdown: p.markdown.slice(0, maxCharsPerPage),
    };
  });

  // Sort evidence pages by relevanceScore descending, re-assigning citation numbers [1..N]
  evidencePages.sort((a, b) => b.relevanceScore - a.relevanceScore);
  evidencePages.forEach((p, idx) => {
    p.citationIndex = idx + 1;
  });

  // Build key highlights from top passages and search snippets
  const keyHighlights: string[] = [];
  for (const ep of evidencePages) {
    if (ep.searchSnippet) {
      keyHighlights.push(`[${ep.citationIndex}] **${ep.title}** (${ep.domain}): ${ep.searchSnippet}`);
    } else if (ep.topPassages[0]) {
      keyHighlights.push(
        `[${ep.citationIndex}] **${ep.title}** (${ep.domain}): ${ep.topPassages[0].slice(0, 280)}`,
      );
    }
  }
  // If no pages could be fetched directly, still include web search snippets so the agent always gets answers
  if (keyHighlights.length === 0 && webRes.sources.length > 0) {
    webRes.sources.slice(0, 6).forEach((s, i) => {
      keyHighlights.push(`[S${i + 1}] **${s.title}** (${hostOf(s.url)}): ${s.description}`);
    });
  }

  const puppeteerEscalations = fetchedPages.filter((p) => p.method === 'puppeteer').length;
  const stage4Ms = Date.now() - tStage4;
  const totalMs = Date.now() - tStart;

  const telemetry: ResearchStageTelemetry = {
    stage1_queryExpansionMs: stage1Ms,
    stage2_parallelDiscoveryMs: stage2Ms,
    stage3_parallelContentFetchMs: stage3Ms,
    stage4_synthesisMs: stage4Ms,
    totalMs,
    queriesExecuted: angles,
    enginesUsed: webRes.engines,
    totalCandidatesFound: webRes.sources.length,
    pagesAttempted,
    pagesSucceeded: evidencePages.length,
    puppeteerEscalations,
  };

  // Assemble structured Markdown Research Dossier
  const mdSections: string[] = [
    `# Deep Research Report: ${query}`,
    `> **Intent:** \`${intent}\` | **Depth:** \`${depth}\` | **Angles:** ${angles.length} | **Sources Analyzed:** ${evidencePages.length}/${webRes.sources.length} | **Time:** ${(totalMs / 1000).toFixed(2)}s`,
    '',
    '## 1. Search Angles Executed',
    ...angles.map((a, i) => `${i + 1}. \`${a}\``),
    '',
    '## 2. Executive Synthesis & Key Highlights',
    ...(keyHighlights.length ? keyHighlights.map((h) => `- ${h}`) : ['- No results found.']),
    '',
    '## 3. Extracted Deep Evidence by Source',
  ];

  for (const ep of evidencePages) {
    const metaBadges = [
      `Domain: \`${ep.domain}\``,
      `Method: \`${ep.fetchMethod}\``,
      ep.publishedTime ? `Published: \`${ep.publishedTime}\`` : '',
      `Words: \`${ep.wordCount}\``,
      `Score: \`${ep.relevanceScore}\``,
    ]
      .filter(Boolean)
      .join(' | ');

    mdSections.push(
      `### [${ep.citationIndex}] ${ep.title}`,
      `**URL:** ${ep.url}  `,
      `**Meta:** ${metaBadges}`,
      '',
      ep.topPassages.join('\n\n'),
      '',
      '---',
    );
  }

  if (ytRes?.searchResults?.length) {
    mdSections.push('## 4. Related YouTube Videos');
    for (const v of ytRes.searchResults) {
      mdSections.push(
        `- **[${v.title}](${v.url})** — ${v.channel} (${v.durationString}, ${v.viewCount.toLocaleString()} views)`,
      );
    }
    if (ytTranscriptSnippet) {
      mdSections.push('', '### Top Video Transcript Excerpt', `> ${ytTranscriptSnippet}`, '');
    }
  }

  if (imgRes?.images?.length) {
    mdSections.push('## 5. Relevant Visual Sources');
    for (const img of imgRes.images.slice(0, 5)) {
      mdSections.push(`- **${img.title || 'Image'}**: ${img.imageUrl} (via ${img.sourceSite})`);
    }
  }

  mdSections.push(
    '',
    '## Citations Index',
    ...evidencePages.map((ep) => `- **[${ep.citationIndex}]** [${ep.title}](${ep.url})`),
  );

  return {
    query,
    intent,
    depth,
    reportMarkdown: mdSections.join('\n'),
    keyHighlights,
    evidencePages,
    allDiscoveredSources: webRes.sources,
    images: imgRes?.images,
    youtubeVideos: ytRes?.searchResults,
    youtubeTranscriptSnippet: ytTranscriptSnippet,
    telemetry,
  };
}
