import { randomUUID } from 'node:crypto';
import { ExtractedDocument, TranscriptionFile } from '@sefer/shared';

/**
 * Turns a manual transcription (typed in the UI or imported as JSON) into an ExtractedDocument.
 * If it is applied to an uploaded PDF, the PDF's SHA-256 must match the one recorded in the
 * transcription, so a transcription cannot silently be attached to a different file.
 */
export function documentFromTranscription(input: unknown, target?: Pick<ExtractedDocument, 'id' | 'sha256' | 'fileName'>): ExtractedDocument {
  const t = TranscriptionFile.parse(input);
  const warnings = [`Manual transcription: ${t.transcribedBy}`, t.transcriptionNote].filter(Boolean);
  if (target && target.sha256 && t.document.sha256 && target.sha256 !== t.document.sha256) {
    throw new Error(`The transcription was made for a different file (SHA-256 ${t.document.sha256.slice(0, 12)}…) than "${target.fileName}" (${target.sha256.slice(0, 12)}…).`);
  }
  return ExtractedDocument.parse({
    id: target?.id ?? randomUUID(),
    fileName: target?.fileName ?? t.document.fileName,
    sha256: target?.sha256 ?? t.document.sha256,
    docType: t.document.docType,
    docTypeSource: 'user',
    method: 'manual_transcription',
    pageCount: t.document.pageCount,
    fields: t.document.fields,
    lines: t.document.lines,
    containers: t.document.containers,
    textLines: t.document.textLines,
    warnings,
  });
}
