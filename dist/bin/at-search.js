#!/usr/bin/env node
import { runCommand } from '../cli.js';
runCommand('search', process.argv.slice(2)).catch((e) => {
    console.error('Error:', e?.message || e);
    process.exit(1);
});
//# sourceMappingURL=at-search.js.map