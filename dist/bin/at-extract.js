#!/usr/bin/env node
import { runCommand } from '../cli.js';
runCommand('extract', process.argv.slice(2)).catch((err) => {
    console.error('Error:', err?.message || err);
    process.exit(1);
});
//# sourceMappingURL=at-extract.js.map