import http from 'node:http';
export interface ServerOptions {
    port?: number;
    host?: string;
    secret?: string;
}
export declare function startServer(options?: ServerOptions): Promise<http.Server>;
//# sourceMappingURL=server.d.ts.map