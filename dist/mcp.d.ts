export declare const MCP_TOOLS: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            queries: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            n: {
                type: string;
                description: string;
            };
            engine: {
                type: string;
                description: string;
            };
            searchType: {
                type: string;
                enum: string[];
                description: string;
            };
            site: {
                type: string;
                description: string;
            };
            excludeSite: {
                type: string;
                description: string;
            };
            filetype: {
                type: string;
                description: string;
            };
            pdfOnly: {
                type: string;
                description: string;
            };
            intitle: {
                type: string;
                description: string;
            };
            inurl: {
                type: string;
                description: string;
            };
            exactPhrase: {
                type: string;
                description: string;
            };
            excludeTerms: {
                type: string;
                description: string;
            };
            timeRange: {
                type: string;
                enum: string[];
                description: string;
            };
            region: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            n: {
                type: string;
                description: string;
            };
            safe: {
                type: string;
                enum: string[];
                description: string;
            };
            engine: {
                type: string;
                description: string;
            };
            verifyUrls: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            queries?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            images: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            outputDir: {
                type: string;
                description: string;
            };
            count: {
                type: string;
                description: string;
            };
            safe: {
                type: string;
                enum: string[];
                description?: undefined;
            };
            proxy: {
                type: string;
                description: string;
            };
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            verifyUrls?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            url: {
                type: string;
                description: string;
            };
            maxChars: {
                type: string;
                description: string;
            };
            includeLinks: {
                type: string;
                description: string;
            };
            includeImages: {
                type: string;
                description: string;
            };
            autoPuppeteer: {
                type: string;
                description: string;
            };
            forcePuppeteer: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            query?: undefined;
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            url: {
                type: string;
                description: string;
            };
            waitUntil: {
                type: string;
                enum: string[];
                description: string;
            };
            waitForSelector: {
                type: string;
                description: string;
            };
            scrollToBottom: {
                type: string;
                description: string;
            };
            evaluateScript: {
                type: string;
                description: string;
            };
            screenshotPath: {
                type: string;
                description: string;
            };
            maxChars: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            query?: undefined;
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            input: {
                type: string;
                description: string;
            };
            mode: {
                type: string;
                enum: string[];
                description: string;
            };
            videoType: {
                type: string;
                enum: string[];
                description: string;
            };
            outputDir: {
                type: string;
                description: string;
            };
            audioFormat: {
                type: string;
                enum: string[];
                description: string;
            };
            maxHeight: {
                type: string;
                description: string;
            };
            searchLimit: {
                type: string;
                description: string;
            };
            subLang: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            query?: undefined;
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            count?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            subQueries: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            depth: {
                type: string;
                enum: string[];
                description: string;
            };
            maxPages: {
                type: string;
                description: string;
            };
            includeImages: {
                type: string;
                description: string;
            };
            includeYoutube: {
                type: string;
                description: string;
            };
            includePdf: {
                type: string;
                description: string;
            };
            searchType: {
                type: string;
                enum: string[];
                description: string;
            };
            site: {
                type: string;
                description: string;
            };
            timeRange: {
                type: string;
                enum: string[];
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            limit?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            target: {
                type: string;
                description: string;
            };
            platform: {
                type: string;
                enum: string[];
                description: string;
            };
            action: {
                type: string;
                enum: string[];
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            sort: {
                type: string;
                description: string;
            };
            language: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            query?: undefined;
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
            provider?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            category: {
                type: string;
                enum: string[];
                description: string;
            };
            when: {
                type: string;
                enum: string[];
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            hnItemId: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            url?: undefined;
            maxChars?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            target?: undefined;
            platform?: undefined;
            action?: undefined;
            sort?: undefined;
            language?: undefined;
            provider?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            target: {
                type: string;
                description: string;
            };
            provider: {
                type: string;
                enum: string[];
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            maxChars: {
                type: string;
                description: string;
            };
            proxy: {
                type: string;
                description: string;
            };
            query?: undefined;
            queries?: undefined;
            n?: undefined;
            engine?: undefined;
            searchType?: undefined;
            site?: undefined;
            excludeSite?: undefined;
            filetype?: undefined;
            pdfOnly?: undefined;
            intitle?: undefined;
            inurl?: undefined;
            exactPhrase?: undefined;
            excludeTerms?: undefined;
            timeRange?: undefined;
            region?: undefined;
            safe?: undefined;
            verifyUrls?: undefined;
            images?: undefined;
            outputDir?: undefined;
            count?: undefined;
            url?: undefined;
            includeLinks?: undefined;
            includeImages?: undefined;
            autoPuppeteer?: undefined;
            forcePuppeteer?: undefined;
            waitUntil?: undefined;
            waitForSelector?: undefined;
            scrollToBottom?: undefined;
            evaluateScript?: undefined;
            screenshotPath?: undefined;
            input?: undefined;
            mode?: undefined;
            videoType?: undefined;
            audioFormat?: undefined;
            maxHeight?: undefined;
            searchLimit?: undefined;
            subLang?: undefined;
            subQueries?: undefined;
            depth?: undefined;
            maxPages?: undefined;
            includeYoutube?: undefined;
            includePdf?: undefined;
            platform?: undefined;
            action?: undefined;
            sort?: undefined;
            language?: undefined;
            category?: undefined;
            when?: undefined;
            hnItemId?: undefined;
        };
        required: string[];
    };
})[];
export declare function startMcpServer(): void;
//# sourceMappingURL=mcp.d.ts.map