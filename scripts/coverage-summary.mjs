// Prints a markdown coverage table for the CI job summary.
import { readFileSync } from 'node:fs';

const path = './coverage/coverage-summary.json';
let total;
try {
  total = JSON.parse(readFileSync(path, 'utf8')).total;
} catch {
  console.log('_No coverage summary found._');
  process.exit(0);
}

const metrics = ['lines', 'statements', 'branches', 'functions'];
const rows = metrics.map((m) => {
  const pct = total[m].pct;
  const mark = pct >= 80 ? 'pass' : 'FAIL';
  return `| ${m} | ${pct}% | ${mark} |`;
});

console.log('| metric | coverage | 80% gate |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
