import { type Intent, type WebSource } from './web-search.js';
import { type ImageItem } from './image-search.js';
import { type YtVideoMetadata } from './yt-downloader.js';
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
    /** Also run parallel image search for visual context (default false) */
    includeImages?: boolean;
    /** Also search YouTube and optionally pull top video transcript (default false) */
    includeYoutube?: boolean;
    /** Total timeout budget in ms (default 45_000) */
    timeoutMs?: number;
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
export declare function expandQueryAngles(query: string, subQueries: string[] | undefined, depth: ResearchDepth): {
    angles: string[];
    intent: Intent;
};
export declare function deepResearch(options: DeepResearchOptions): Promise<DeepResearchResult>;
//# sourceMappingURL=deep-research.d.ts.map