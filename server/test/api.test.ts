import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { emptyBrokerInput } from '@sefer/shared';
import { createApp } from '../src/app.js';
import { shutdownOcr } from '../src/extraction/ocr.js';

const app = createApp();
afterAll(() => shutdownOcr());
const sample = (name: string) => readFileSync(new URL(`../../sample-docs/${name}`, import.meta.url));

describe('HTTP API', () => {
  it('reports local OCR and no external vision service', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.extraction).toMatchObject({ textLayer: true, ocr: true, vision: false });
  });

  it('reads a scanned PDF through the upload endpoint by OCR, with every value unverified (no JSON involved)', async () => {
    const r = await request(app).post('/api/documents').attach('files', sample('SPG-PL-2609-117_Packing_List.pdf'), 'SPG-PL-2609-117_Packing_List.pdf');
    expect(r.status).toBe(200);
    const [d] = r.body.documents;
    expect(d).toMatchObject({ method: 'ocr', docType: 'packing_list', docTypeSource: 'content' });
    expect(d.fields.totalGrossWeight).toMatchObject({ value: '1,888.00 KGS', verification: 'unverified' });
    expect(typeof d.fields.totalGrossWeight.confidence).toBe('number');
  }, 60_000);

  it('extracts uploaded PDFs and reports invalid files per file', async () => {
    const r = await request(app)
      .post('/api/documents')
      .attach('files', sample('KBAS-NB-26-0912_Commercial_Invoice.pdf'), 'KBAS-NB-26-0912_Commercial_Invoice.pdf')
      .attach('files', Buffer.from('not a pdf'), 'notes.txt');
    expect(r.status).toBe(200);
    expect(r.body.documents).toHaveLength(1);
    expect(r.body.documents[0].lines).toHaveLength(5);
    expect(r.body.errors).toEqual([{ fileName: 'notes.txt', message: expect.stringMatching(/not a PDF/) }]);
  });

  it('rejects requests without files', async () => {
    expect((await request(app).post('/api/documents')).status).toBe(400);
  });

  it('rejects files over the size limit with 413', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x20);
    big.write('%PDF-');
    const r = await request(app).post('/api/documents').attach('files', big, 'big.pdf');
    expect(r.status).toBe(413);
  });

  it('explains upload limits and a wrong form field in plain language', async () => {
    let req = request(app).post('/api/documents');
    for (let i = 0; i < 11; i++) req = req.attach('files', Buffer.from('%PDF-'), `f${i}.pdf`);
    const many = await req;
    expect(many.status).toBe(400);
    expect(many.body.error).toMatch(/at most 10 documents/);
    const wrongField = await request(app).post('/api/documents').attach('document', Buffer.from('%PDF-'), 'x.pdf');
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error).toMatch(/"files" field/);
  });

  it('returns JSON 404 for unknown API endpoints', async () => {
    const r = await request(app).get('/api/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'Unknown API endpoint.' });
  });

  it('rejects malformed analysis requests with 400 and field paths', async () => {
    const r = await request(app).post('/api/analyze').send({ documents: [{ id: 'x' }], brokerInput: emptyBrokerInput() });
    expect(r.status).toBe(400);
    expect(r.body.details[0].path).toMatch(/^documents\.0\./);
  });

  it('rejects invalid JSON with 400', async () => {
    const r = await request(app).post('/api/analyze').set('Content-Type', 'application/json').send('{bad');
    expect(r.status).toBe(400);
  });

  it('returns analysis and a Markdown report', async () => {
    const r = await request(app).post('/api/analyze').send({ documents: [], brokerInput: emptyBrokerInput() });
    expect(r.status).toBe(200);
    expect(r.body.result.status).toBe('NOT_READY_TO_FILE');
    expect(r.body.reportMarkdown).toMatch(/NOT READY TO FILE/);
  });
});
