import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { AnalyzeRequest, ExtractedDocument } from '@sefer/shared';
import { z, ZodError } from 'zod';
import { analyzeShipment } from './analyze.js';
import { MAX_FILE_BYTES, UnsupportedFileError, extractDocument } from './extraction/index.js';
import { documentFromTranscription } from './extraction/transcription.js';
import { renderReport } from './report.js';

const MAX_FILES = 10;

/**
 * Stateless API: uploaded files are processed in memory and never written to disk.
 * The browser keeps the extracted documents and sends them back with each analysis request.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, extraction: { textLayer: true, ocr: true, vision: false, note: 'Scanned pages are read by local OCR (tesseract.js, English). OCR readings must be verified by a person; no external inference service is used.' } });
  });

  app.post('/api/documents', upload.array('files', MAX_FILES), async (req, res, next) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No files received. Upload one or more PDF documents in the "files" field.' });
        return;
      }
      const documents: ExtractedDocument[] = [];
      const errors: { fileName: string; message: string }[] = [];
      for (const f of files) {
        const fileName = Buffer.from(f.originalname, 'latin1').toString('utf8');
        try {
          documents.push(await extractDocument(fileName, new Uint8Array(f.buffer)));
        } catch (err) {
          if (err instanceof UnsupportedFileError) errors.push({ fileName, message: err.message });
          else errors.push({ fileName, message: 'The file could not be processed.' });
        }
      }
      res.json({ documents, errors });
    } catch (err) {
      next(err);
    }
  });

  const ApplyTranscription = z.object({ transcription: z.unknown(), target: ExtractedDocument.optional() });
  app.post('/api/transcriptions/apply', (req, res, next) => {
    try {
      const body = ApplyTranscription.parse(req.body);
      res.json({ document: documentFromTranscription(body.transcription, body.target) });
    } catch (err) {
      if (err instanceof Error && !(err instanceof ZodError) && /different file/.test(err.message)) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  app.post('/api/analyze', async (req, res, next) => {
    try {
      const body = AnalyzeRequest.parse(req.body);
      const result = await analyzeShipment(body.documents, body.brokerInput);
      res.json({ result, reportMarkdown: renderReport(result, { brokerRequests: body.brokerInput.brokerRequests }) });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  const webDist = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(`${webDist}index.html`));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'The request data is malformed.', details: err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) });
      return;
    }
    if (err instanceof multer.MulterError) {
      const messages: Partial<Record<string, string>> = {
        LIMIT_FILE_SIZE: `A file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`,
        LIMIT_FILE_COUNT: `Too many files: upload at most ${MAX_FILES} documents at a time.`,
        LIMIT_UNEXPECTED_FILE: 'Upload rejected: send the PDF documents in the "files" field.',
      };
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: messages[err.code] ?? `Upload rejected (${err.code}).` });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'The request body is not valid JSON.' });
      return;
    }
    // Do not echo internals (or any document content) back to the client or into logs.
    console.error('Unhandled error:', err instanceof Error ? err.name : typeof err);
    res.status(500).json({ error: 'Internal error.' });
  });

  return app;
}
