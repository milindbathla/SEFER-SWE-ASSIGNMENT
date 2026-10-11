import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExtractedDocument } from '@sefer/shared';
import { extractDocument } from './extraction/index.js';
import { documentFromTranscription } from './extraction/transcription.js';

/**
 * Loads the supplied sample shipment exactly as a user would in the UI:
 *  - the invoice through text-layer extraction;
 *  - the two scanned PDFs (no text layer) through the manual transcription files in
 *    fixtures/sample-transcriptions, matched to the uploaded PDFs by SHA-256.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const SAMPLE_FILES = [
  { pdf: 'sample-docs/KBAS-NB-26-0912_Commercial_Invoice.pdf', transcription: null },
  { pdf: 'sample-docs/SPG-PL-2609-117_Packing_List.pdf', transcription: 'fixtures/sample-transcriptions/SPG-PL-2609-117_Packing_List.transcription.json' },
  { pdf: 'sample-docs/BMLVHCM26090418_House_BL.pdf', transcription: 'fixtures/sample-transcriptions/BMLVHCM26090418_House_BL.transcription.json' },
] as const;

export async function loadSampleDocuments(): Promise<ExtractedDocument[]> {
  const docs: ExtractedDocument[] = [];
  for (const f of SAMPLE_FILES) {
    const data = new Uint8Array(readFileSync(REPO_ROOT + f.pdf));
    // D2 is built from the REVIEWED values: for the two scans that is the manual transcription (what a user has after
    // confirming and correcting every OCR reading), so OCR is skipped where a transcription exists. This keeps D2 reproducible.
    const extracted = await extractDocument(f.pdf.split('/').pop()!, data, { ocr: !f.transcription });
    if (f.transcription && extracted.method === 'unavailable') {
      const json = JSON.parse(readFileSync(REPO_ROOT + f.transcription, 'utf8'));
      docs.push(documentFromTranscription(json, extracted));
    } else {
      docs.push(extracted);
    }
  }
  return docs;
}

/**
 * Maps the generic rule names to the issue groups C-1 … C-12 recorded for this sample in
 * docs/research-log.md §4. Used only for the sample report and the regression test.
 */
export const SAMPLE_RULE_TO_RESEARCH_ID: Record<string, string> = {
  LINE_ARITHMETIC: 'C-1',
  INVOICE_TOTALS: 'C-1',
  QUANTITY_MISMATCH: 'C-2',
  FIBRE_MISMATCH: 'C-3',
  GROSS_WEIGHT_MISMATCH: 'C-4',
  CONTAINER_NUMBER: 'C-5',
  ASSIST_INDICATOR: 'C-6',
  ORIGIN_CONFLICT: 'C-7',
  NO_COMMERCIAL_VALUE: 'C-8',
  PARTIES_UNRESOLVED: 'C-9',
  INVOICE_NUMBER_FORMAT: 'C-10',
  AMBIGUOUS_DATE: 'C-11',
  CIF_DEDUCTIONS: 'C-12',
};
