import type { AnalysisResult, BrokerInput, ExtractedDocument } from '@sefer/shared';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({ error: `Unexpected response (${res.status}).` }));
  if (!res.ok) {
    const details = Array.isArray(body.details) ? ` ${body.details.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join('; ')}` : '';
    throw new Error(`${body.error ?? `Request failed (${res.status}).`}${details}`);
  }
  return body as T;
}

export async function uploadDocuments(files: File[]): Promise<{ documents: ExtractedDocument[]; errors: { fileName: string; message: string }[] }> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  return json(await fetch('/api/documents', { method: 'POST', body: form }));
}

export async function applyTranscription(transcription: unknown, target?: ExtractedDocument): Promise<ExtractedDocument> {
  const r = await json<{ document: ExtractedDocument }>(
    await fetch('/api/transcriptions/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcription, target }) }),
  );
  return r.document;
}

export async function analyze(documents: ExtractedDocument[], brokerInput: BrokerInput): Promise<{ result: AnalysisResult; reportMarkdown: string }> {
  return json(await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents, brokerInput }) }));
}

export function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
