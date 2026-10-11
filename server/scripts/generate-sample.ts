/**
 * Deliverable D2: runs the full pipeline on the supplied sample shipment with NO broker input
 * (no approvals, no proposals accepted) and writes the XML draft plus its validation report.
 *
 *   npm run sample
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { emptyBrokerInput } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { renderReport } from '../src/report.js';
import { REPO_ROOT, SAMPLE_RULE_TO_RESEARCH_ID, loadSampleDocuments } from '../src/sample.js';

const outDir = `${REPO_ROOT}output/sample/`;
mkdirSync(outDir, { recursive: true });

const documents = await loadSampleDocuments();
const result = await analyzeShipment(documents, emptyBrokerInput());
const issueMap = Object.fromEntries(result.issues.filter((i) => SAMPLE_RULE_TO_RESEARCH_ID[i.rule]).map((i) => [i.id, SAMPLE_RULE_TO_RESEARCH_ID[i.rule]]));

writeFileSync(`${outDir}sample-entry-draft.xml`, result.xml, 'utf8');
writeFileSync(`${outDir}sample-validation-report.md`, renderReport(result, { title: 'Sample shipment KBAS/NB/26-0912: entry draft validation report', issueMap }), 'utf8');
writeFileSync(`${outDir}sample-analysis.json`, JSON.stringify(result, null, 2), 'utf8');

const groups = [...new Set(Object.values(issueMap))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
console.log(`Status: ${result.status}`);
for (const r of result.statusReasons) console.log(`  - ${r}`);
console.log(`XSD: ran=${result.xsd.ran} valid=${result.xsd.valid} errors=${result.xsd.errors.length}`);
console.log(`Issues: ${result.issues.length} (research groups detected: ${groups.join(', ')})`);
console.log(`Wrote ${outDir}sample-entry-draft.xml, sample-validation-report.md, sample-analysis.json`);
