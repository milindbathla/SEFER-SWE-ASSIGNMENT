import { useState } from 'react';
import {
  DOC_TYPES, DOC_TYPE_LABELS, FIELDS_BY_TYPE, LINE_CELLS_BY_TYPE, emptyField, isUnverifiedOcr,
  type ContainerReading, type DocType, type ExtractedDocument, type SourceField, type TranscriptionFile,
} from '@sefer/shared';
import { applyTranscription, download } from '../api';

const METHOD_LABELS: Record<ExtractedDocument['method'], string> = {
  text_layer: 'Extracted from PDF text layer',
  ocr: 'Read by OCR (scanned): verify every value',
  manual_transcription: 'Manual entry / transcription',
  unavailable: 'Not read: enter values manually',
};

const REVIEW_LABELS: Record<NonNullable<SourceField['verification']>, string> = {
  unverified: 'unverified',
  confirmed: 'confirmed',
  corrected: 'corrected',
  rejected: 'rejected',
};

export const humanize = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

interface Props {
  doc: ExtractedDocument;
  /** Object URL of the uploaded PDF, when it is still available in this browser tab. */
  previewUrl?: string;
  onChange: (doc: ExtractedDocument) => void;
  onRemove: () => void;
}

export function DocumentPanel({ doc, previewUrl, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(doc.method !== 'text_layer');
  const [error, setError] = useState<string | null>(null);
  const [showPage, setShowPage] = useState(false);
  const ocr = doc.method === 'ocr';
  const editable = doc.method === 'manual_transcription' || ocr;
  const fieldKeys = FIELDS_BY_TYPE[doc.docType];
  const cellKeys = LINE_CELLS_BY_TYPE[doc.docType];
  /** In an OCR document anything the user types is their own value: it counts as a correction, never as OCR. */
  const typedReview = (value: string | null): Partial<SourceField> => (ocr ? { verification: value ? 'corrected' : 'rejected' } : {});

  const unverifiedCount = Object.values(doc.fields).filter((f) => isUnverifiedOcr(doc.method, f)).length
    + doc.lines.reduce((n, l) => n + Object.values(l.cells).filter((f) => isUnverifiedOcr(doc.method, f)).length, 0)
    + doc.containers.reduce((n, c) => n + (isUnverifiedOcr(doc.method, c.number) ? 1 : 0) + (isUnverifiedOcr(doc.method, c.seal) ? 1 : 0), 0);

  const changeType = (docType: DocType) => {
    const allowed = new Set(FIELDS_BY_TYPE[docType]);
    const cells = new Set(LINE_CELLS_BY_TYPE[docType]);
    onChange({
      ...doc,
      docType,
      docTypeSource: 'user',
      fields: Object.fromEntries(Object.entries(doc.fields).filter(([k]) => allowed.has(k))),
      lines: doc.lines.map((l) => ({ cells: Object.fromEntries(Object.entries(l.cells).filter(([k]) => cells.has(k))) })),
      containers: docType === 'bill_of_lading' ? doc.containers : [],
    });
  };

  const setField = (key: string, patch: Partial<SourceField>) => {
    const current = doc.fields[key] ?? emptyField();
    const next = { ...current, ...patch };
    const fields = { ...doc.fields };
    if (!next.value && !next.quote && !ocr) delete fields[key];
    else fields[key] = { ...next, value: next.value || null, quote: next.quote || null, page: next.page ?? 1 };
    onChange({ ...doc, fields });
  };

  const setCell = (row: number, key: string, value: string) => {
    const lines = doc.lines.map((l, i) => {
      if (i !== row) return l;
      const cells = { ...l.cells };
      if (value) cells[key] = { ...cells[key], value, page: cells[key]?.page ?? 1, quote: cells[key]?.quote ?? value, ...typedReview(value) };
      else delete cells[key];
      return { cells };
    });
    onChange({ ...doc, lines });
  };

  const setContainer = (idx: number, patch: Partial<ContainerReading> & { numberValue?: string; sealValue?: string; numberReview?: SourceField['verification']; sealReview?: SourceField['verification'] }) => {
    const containers = doc.containers.map((c, i) => {
      if (i !== idx) return c;
      const { numberValue, sealValue, numberReview, sealReview, ...rest } = patch;
      const typed = (f: SourceField | undefined, v: string): SourceField => ({ ...(f ?? emptyField()), value: v || null, page: f?.page ?? 1, quote: f?.quote ?? (v || null), ...typedReview(v || null) });
      let number = numberValue !== undefined ? typed(c.number, numberValue) : c.number;
      let seal = sealValue !== undefined ? typed(c.seal, sealValue) : c.seal;
      if (numberReview) number = { ...number, verification: numberReview, ...(numberReview === 'rejected' ? { value: null } : {}) };
      if (sealReview && seal) seal = { ...seal, verification: sealReview, ...(sealReview === 'rejected' ? { value: null } : {}) };
      return { ...c, ...rest, number, ...(seal ? { seal } : {}) };
    });
    onChange({ ...doc, containers });
  };

  const confirmAll = () => {
    if (!window.confirm(`Confirm all ${unverifiedCount} remaining OCR readings? Only do this after comparing every value with the page.`)) return;
    const ok = (f: SourceField): SourceField => (isUnverifiedOcr(doc.method, f) ? { ...f, verification: 'confirmed' } : f);
    onChange({
      ...doc,
      fields: Object.fromEntries(Object.entries(doc.fields).map(([k, f]) => [k, ok(f)])),
      lines: doc.lines.map((l) => ({ cells: Object.fromEntries(Object.entries(l.cells).map(([k, f]) => [k, ok(f)])) })),
      containers: doc.containers.map((c) => ({ ...c, number: ok(c.number), ...(c.seal ? { seal: ok(c.seal) } : {}) })),
    });
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const parsed = JSON.parse(await file.text());
      onChange(await applyTranscription(parsed, doc));
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportTranscription = () => {
    const t: TranscriptionFile = {
      format: 'sefer-transcription/v1',
      transcribedBy: ocr ? 'OCR readings reviewed in the Entry Draft Builder UI' : 'Manual entry in the Entry Draft Builder UI',
      transcriptionNote: 'Typed or reviewed by a person from the source document. Verify against the original.',
      document: { fileName: doc.fileName, sha256: doc.sha256, docType: doc.docType, pageCount: Math.max(doc.pageCount, 1), fields: doc.fields, lines: doc.lines, containers: doc.containers, textLines: doc.textLines },
    };
    download(`${doc.fileName.replace(/\.pdf$/i, '')}.transcription.json`, JSON.stringify(t, null, 2), 'application/json');
  };

  const jsonOptions = (
    <details className="optional">
      <summary className="small">Optional: save or load a transcription file (JSON). Not needed for the normal PDF workflow.</summary>
      <div className="row">
        <label className="button">Load transcription JSON<input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
        {editable && <button onClick={exportTranscription}>Save transcription JSON</button>}
      </div>
    </details>
  );

  /** Review controls for one OCR reading. */
  const review = (f: SourceField | undefined, onReview: (v: NonNullable<SourceField['verification']>) => void) => {
    if (!ocr || !f || (f.value === null && f.verification !== 'rejected' && f.confidence === undefined)) return null;
    const state = f.verification ?? 'unverified';
    // A low-confidence reading that was not used has no value to confirm: say so instead of "unverified".
    const notUsed = f.value === null && state === 'unverified';
    return (
      <span className="review">
        {f.confidence !== undefined && <span className={`badge conf ${f.confidence < 70 ? 'low' : ''}`} title="OCR confidence">{f.confidence}%</span>}
        {notUsed ? <span className="badge review-rejected">not used (low confidence)</span> : <span className={`badge review-${state}`}>{REVIEW_LABELS[state]}</span>}
        {isUnverifiedOcr(doc.method, f) && <button className="small" onClick={() => onReview('confirmed')}>Confirm</button>}
        {f.value !== null && state !== 'rejected' && <button className="small link" onClick={() => onReview('rejected')}>Reject</button>}
      </span>
    );
  };

  const values = (
    <div className="doc-values">
      {editable && (
        <p className="muted small">
          {ocr ? 'Compare each OCR reading with the page. Confirm it, correct it by typing, or reject it. The OCR text stays as evidence.' : 'Type values exactly as printed. Leave unclear values blank and add a note.'}
        </p>
      )}
      {!editable && <p className="muted">Text-layer values are read-only so that source evidence is never altered. Use the entry fields to supply confirmed values.</p>}
      {ocr && unverifiedCount > 0 && (
        <p className="row"><span className="badge review-unverified">{unverifiedCount} unverified</span><button onClick={confirmAll}>Confirm all remaining readings…</button></p>
      )}
      <table className="grid">
        <thead><tr><th>Field</th><th>Value (as printed)</th>{ocr && <th>Review</th>}<th>Page</th><th>{ocr ? 'OCR text (evidence)' : 'Evidence / quote'}</th><th>Note</th></tr></thead>
        <tbody>
          {fieldKeys.map((k) => {
            const f = doc.fields[k];
            return (
              <tr key={k} className={isUnverifiedOcr(doc.method, f) ? 'unverified' : ''}>
                <td>{humanize(k)}</td>
                <td>{editable ? <input aria-label={humanize(k)} value={f?.value ?? ''} onChange={(e) => setField(k, { value: e.target.value, ...typedReview(e.target.value || null) })} /> : f?.value ?? <span className="muted">not found</span>}</td>
                {ocr && <td>{review(f, (v) => setField(k, { verification: v, ...(v === 'rejected' ? { value: null } : {}) }))}</td>}
                <td>{editable ? <input className="narrow" type="number" min={1} value={f?.page ?? ''} onChange={(e) => setField(k, { page: e.target.value ? Number(e.target.value) : null })} /> : f?.page ?? ''}</td>
                <td className="quote">{editable && !ocr ? <input value={f?.quote ?? ''} onChange={(e) => setField(k, { quote: e.target.value })} /> : <span className="clip" title={f?.quote ?? ''}>{f?.quote ?? ''}</span>}</td>
                <td>{editable ? <input value={f?.note ?? ''} onChange={(e) => setField(k, { note: e.target.value || undefined })} /> : f?.note ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {cellKeys.length > 0 && (
        <>
          <h4>Lines ({doc.lines.length})</h4>
          <div className="scroll">
            <table className="grid">
              <thead><tr>{cellKeys.map((c) => <th key={c}>{humanize(c)}</th>)}{editable && <th />}</tr></thead>
              <tbody>
                {doc.lines.map((l, i) => (
                  <tr key={i}>
                    {cellKeys.map((c) => (
                      <td key={c} className={`${c === 'description' ? 'desc' : ''} ${isUnverifiedOcr(doc.method, l.cells[c]) ? 'unverified' : ''}`}>
                        {editable ? (c === 'description'
                          ? <textarea rows={2} value={l.cells[c]?.value ?? ''} onChange={(e) => setCell(i, c, e.target.value)} />
                          : <input value={l.cells[c]?.value ?? ''} onChange={(e) => setCell(i, c, e.target.value)} />)
                          : <span title={l.cells[c]?.quote ?? ''}>{l.cells[c]?.value ?? ''}</span>}
                        {ocr && l.cells[c] && review(l.cells[c], (v) => {
                          const lines = doc.lines.map((x, j) => (j !== i ? x : { cells: { ...x.cells, [c]: { ...x.cells[c], verification: v, ...(v === 'rejected' ? { value: null } : {}) } } }));
                          onChange({ ...doc, lines });
                        })}
                      </td>
                    ))}
                    {editable && <td><button className="link" onClick={() => onChange({ ...doc, lines: doc.lines.filter((_, j) => j !== i) })}>remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && <button onClick={() => onChange({ ...doc, lines: [...doc.lines, { cells: {} }] })}>Add line</button>}
        </>
      )}

      {doc.docType === 'bill_of_lading' && (
        <>
          <h4>Container readings</h4>
          <p className="muted">Record a corrected number as two readings: the struck-through one, then the correction.{ocr && ' OCR cannot tell printed, handwritten or struck-through numbers apart: check the page and set these yourself.'}</p>
          <table className="grid">
            <thead><tr><th>Container number</th><th>Seal</th><th>Marking</th><th>Struck through</th>{editable && <th />}</tr></thead>
            <tbody>
              {doc.containers.map((c, i) => (
                <tr key={i}>
                  <td>{editable ? <input aria-label={`Container ${i + 1} number`} value={c.number.value ?? ''} onChange={(e) => setContainer(i, { numberValue: e.target.value })} /> : c.number.value}
                    {review(c.number, (v) => setContainer(i, { numberReview: v }))}{ocr && c.number.note && <div className="small muted">{c.number.note}</div>}</td>
                  <td>{editable ? <input value={c.seal?.value ?? ''} onChange={(e) => setContainer(i, { sealValue: e.target.value })} /> : c.seal?.value}
                    {review(c.seal, (v) => setContainer(i, { sealReview: v }))}</td>
                  <td>{editable ? (
                    <select value={c.marking} onChange={(e) => setContainer(i, { marking: e.target.value as ContainerReading['marking'] })}>
                      <option value="printed">printed</option><option value="handwritten">handwritten</option><option value="unknown">unknown</option>
                    </select>) : c.marking}</td>
                  <td>{editable ? <input type="checkbox" checked={c.struckThrough} onChange={(e) => setContainer(i, { struckThrough: e.target.checked })} /> : c.struckThrough ? 'yes' : 'no'}</td>
                  {editable && <td><button className="link" onClick={() => onChange({ ...doc, containers: doc.containers.filter((_, j) => j !== i) })}>remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {editable && <button onClick={() => onChange({ ...doc, containers: [...doc.containers, { number: { ...emptyField(), ...(ocr ? { verification: 'corrected' as const } : {}) }, marking: 'printed', struckThrough: false }] })}>Add container reading</button>}
        </>
      )}

      {doc.textLines.length > 0 && (
        <details>
          <summary>{ocr ? 'OCR text of every line' : 'Notes, remarks and other text'} ({doc.textLines.length} lines; scanned by the review rules)</summary>
          <ul className="textlines">{doc.textLines.map((t, i) => <li key={i}><span className="muted">p.{t.page}{t.confidence !== undefined ? ` · ${t.confidence}%` : ''}</span> {t.text}</li>)}</ul>
        </details>
      )}
      {editable && (
        <label className="block">
          Add a note / remark line (e.g. "Made in …", buyer-supplied material, FOC):
          <TextLineAdder onAdd={(text) => onChange({ ...doc, textLines: [...doc.textLines, { page: 1, text }] })} />
        </label>
      )}
      {jsonOptions}
    </div>
  );

  return (
    <section className="card">
      <div className="row space">
        <div>
          <strong>{doc.fileName}</strong>{' '}
          <span className={`badge method-${doc.method}`}>{METHOD_LABELS[doc.method]}</span>{' '}
          <span className="muted">{doc.pageCount} page(s)</span>
        </div>
        <div className="row">
          <label>
            Type{' '}
            <select value={doc.docType} onChange={(e) => changeType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          {doc.docTypeSource === 'file_name_guess' && <span className="badge warn">guessed from file name: confirm</span>}
          <button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} values</button>
          {previewUrl && open && <button aria-pressed={showPage} onClick={() => setShowPage(!showPage)}>{showPage ? 'Hide page' : 'Show page beside values'}</button>}
          <button className="link" onClick={onRemove}>Remove</button>
        </div>
      </div>
      {doc.warnings.length > 0 && <ul className="warnings">{doc.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {error && <p className="error">{error}</p>}

      {doc.method === 'unavailable' && (
        <div className="callout">
          <p><strong>This document could not be read automatically</strong> (see the message above). Enter its values from the page.</p>
          <div className="row">
            <button onClick={() => { onChange({ ...doc, method: 'manual_transcription', docTypeSource: doc.docType === 'unknown' ? doc.docTypeSource : 'user', warnings: [...doc.warnings, 'Values entered manually from the source document.'] }); setOpen(true); }}>Start manual entry</button>
          </div>
          {jsonOptions}
        </div>
      )}

      {open && doc.method !== 'unavailable' && (
        previewUrl && showPage ? (
          <div className="doc-review">
            {values}
            <div className="preview">
              <iframe src={previewUrl} title={`Page preview: ${doc.fileName}`} />
            </div>
          </div>
        ) : (
          <>
            {values}
            {!previewUrl && <p className="muted small">Page preview is available for PDFs uploaded in this browser tab (re-upload the PDF to see it after a reload).</p>}
          </>
        )
      )}
    </section>
  );
}

function TextLineAdder({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <span className="row">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text exactly as printed" />
      <button disabled={!text.trim()} onClick={() => { onAdd(text.trim()); setText(''); }}>Add</button>
    </span>
  );
}
