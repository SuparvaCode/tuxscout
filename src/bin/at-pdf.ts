#!/usr/bin/env node
import { runCommand } from '../cli.js';
runCommand('pdf', process.argv.slice(2)).catch((err) => {
  console.error('Error:', (err as Error)?.message || err);
  process.exit(1);
});
