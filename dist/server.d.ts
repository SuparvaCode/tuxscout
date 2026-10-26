import http from 'node:http';
import { type ProxyInput } from './utils/http.js';
export interface ServerOptions {
    port?: number;
    host?: string;
    secret?: string;
    proxy?: ProxyInput;
}
export declare function startServer(options?: ServerOptions): Promise<http.Server>;
//# sourceMappingURL=server.d.ts.map