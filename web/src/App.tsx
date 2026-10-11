import { useEffect, useRef, useState } from 'react';
import { AnalyzeRequest, emptyBrokerInput, isUnresolvedBlocker, type AnalysisResult, type BrokerInput, type ExtractedDocument } from '@sefer/shared';
import { analyze, uploadDocuments } from './api';
import { DocumentPanel } from './components/DocumentPanel';
import { FieldsPanel } from './components/FieldsPanel';
import { IssuesPanel } from './components/IssuesPanel';
import { ResultPanel, StatusBanner } from './components/ResultPanel';
import { ReviewQueue } from './components/ReviewQueue';

type Tab = 'documents' | 'queue' | 'issues' | 'fields' | 'xml';

/**
 * The review (documents + every decision) is saved in this browser only, so a refresh does not lose work.
 * It is validated against the same schema as an API request before it is restored.
 */
const STORAGE_KEY = 'sefer-entry-review-v1';

function loadSaved(): { documents: ExtractedDocument[]; broker: BrokerInput } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = AnalyzeRequest.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.documents.length ? { documents: parsed.data.documents, broker: parsed.data.brokerInput } : null;
  } catch {
    return null;
  }
}

export function App() {
  const [saved] = useState(loadSaved);
  const [documents, setDocuments] = useState<ExtractedDocument[]>(saved?.documents ?? []);
  const [broker, setBroker] = useState<BrokerInput>(saved?.broker ?? emptyBrokerInput());
  const [restored, setRestored] = useState(Boolean(saved));
  const [saveError, setSaveError] = useState<string | null>(null);
  // Each result remembers the exact inputs it was computed for, so a result for older inputs is recognisable as stale.
  const [analysis, setAnalysis] = useState<{ result: AnalysisResult; reportMarkdown: string; forDocuments: ExtractedDocument[]; forBroker: BrokerInput } | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Page previews (object URLs of the uploaded PDFs). Kept in memory only: not saved with the review.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('documents');
  const request = useRef(0);

  // Re-run the deterministic review whenever documents or broker input change; results from older requests are discarded.
  useEffect(() => {
    if (documents.length === 0) {
      setAnalysis(null);
      setPending(false);
      return;
    }
    const id = ++request.current;
    setPending(true);
    const timer = setTimeout(async () => {
      try {
        const r = await analyze(documents, broker);
        if (id === request.current) {
          setAnalysis({ ...r, forDocuments: documents, forBroker: broker });
          setError(null);
        }
      } catch (e) {
        if (id === request.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === request.current) setPending(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [documents, broker]);

  // Autosave (best effort: storage can be unavailable or full).
  useEffect(() => {
    try {
      if (documents.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ documents, brokerInput: broker }));
      setSaveError(null);
    } catch {
      setSaveError('This review could not be saved in the browser (storage unavailable or full). It will be lost on refresh.');
    }
  }, [documents, broker]);

  const clearReview = () => {
    if (!window.confirm('Remove all documents and decisions from this page and from this browser?')) return;
    setDocuments([]);
    setBroker(emptyBrokerInput());
    setUploadErrors([]);
    setError(null);
    setRestored(false);
    setTab('documents');
  };

  const onFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    // Copy now: the input is reset right after this call starts, which empties the live FileList.
    const files = [...fileList];
    setBusy(true);
    setError(null);
    try {
      const r = await uploadDocuments(files);
      // Same content = same id (SHA-256), whether already loaded or repeated within this selection.
      const known = new Set(documents.map((d) => d.id));
      const added: ExtractedDocument[] = [];
      const duplicates: ExtractedDocument[] = [];
      for (const d of r.documents) {
        if (known.has(d.id)) duplicates.push(d);
        else { known.add(d.id); added.push(d); }
      }
      // Map each returned document to the file it came from (by name), so its pages can be shown next to its values.
      const urls: Record<string, string> = {};
      for (const d of r.documents) {
        const file = files.find((f) => f.name === d.fileName);
        if (file && !previews[d.id]) urls[d.id] = URL.createObjectURL(file);
      }
      setPreviews({ ...previews, ...urls });
      setDocuments([...documents, ...added]);
      setUploadErrors([...r.errors, ...duplicates.map((d) => ({ fileName: d.fileName, message: 'This file is already loaded (same SHA-256); the duplicate was ignored.' }))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const result = analysis?.result;
  // Out of date unless the shown result was computed for exactly the current inputs (checked during render, so there is no
  // window before the effect runs), no newer request is pending, and the last request did not fail.
  const stale = !analysis || analysis.forDocuments !== documents || analysis.forBroker !== broker || pending || Boolean(error);
  // Downloads also wait until every OCR reading is verified (or a decision is recorded): a draft built while readings
  // are still unchecked would leave out values the user is about to confirm.
  const unverifiedOcr = result?.issues.filter((i) => i.rule === 'OCR_UNVERIFIED' && isUnresolvedBlocker(i)) ?? [];

  return (
    <main>
      <header className="top">
        <h1>Entry Draft Builder</h1>
        <p className="muted">
          Shipment documents in → evidence-backed NetCHB entry XML draft out. Local review and download only: nothing is submitted, and no <code>&lt;transmit/&gt;</code> is generated.
        </p>
      </header>

      <section className="card">
        <label className="upload">
          <strong>Upload shipment documents (PDF)</strong>: commercial invoice, packing list, bill of lading
          <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} disabled={busy} />
        </label>
        <p className="muted small">
          Text-based PDFs are read from their text layer; scanned PDFs are read by local OCR on this computer (nothing is uploaded elsewhere). Every OCR value must be
          confirmed, corrected or rejected before it is used. Then work through <em>2. Review queue</em>.
        </p>
        {busy && <p role="status" className="busy">Reading documents… Scanned pages are read by OCR on this computer, which takes about 5–10 seconds per page.</p>}
        {restored && documents.length > 0 && (
          <p className="muted small">Restored your saved review from this browser ({documents.length} document(s) and your decisions).</p>
        )}
        {documents.length > 0 && (
          <p className="small">
            <button className="link" onClick={clearReview}>Clear saved review</button>
            <span className="muted"> · Documents and decisions are kept only in this browser's local storage.</span>
          </p>
        )}
        {saveError && <p className="error">{saveError}</p>}
        {uploadErrors.length > 0 && <ul className="error">{uploadErrors.map((e, i) => <li key={i}><strong>{e.fileName}</strong>: {e.message}</li>)}</ul>}
        {error && <p className="error">Analysis failed: {error} The results below are out of date.</p>}
      </section>

      {result && <StatusBanner result={result} stale={stale} />}

      {documents.length > 0 && (
        <nav className="tabs">
          {([
            ['documents', `1. Documents (${documents.length})`],
            ['queue', '2. Review queue'],
            ['issues', `3. All issues (${result ? `${result.summary.unresolvedBlocking} blocking unresolved` : '…'})`],
            ['fields', '4. All entry fields'],
            ['xml', '5. XML & validation report'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
          ))}
        </nav>
      )}

      {tab === 'documents' && documents.map((d) => (
        <DocumentPanel
          key={d.id}
          doc={d}
          previewUrl={previews[d.id]}
          onChange={(next) => setDocuments(documents.map((x) => (x.id === d.id ? next : x)))}
          onRemove={() => setDocuments(documents.filter((x) => x.id !== d.id))}
        />
      ))}
      {tab === 'queue' && result && <ReviewQueue result={result} broker={broker} onBroker={setBroker} onOpenTab={setTab} />}
      {tab === 'issues' && result && <IssuesPanel issues={result.issues} fields={result.fields} summary={result.summary} broker={broker} onBroker={setBroker} />}
      {tab === 'fields' && result && <FieldsPanel fields={result.fields} broker={broker} onBroker={setBroker} />}
      {tab === 'xml' && analysis && <ResultPanel result={analysis.result} reportMarkdown={analysis.reportMarkdown} stale={stale} blockedReason={unverifiedOcr.length ? `Verify the OCR readings first (${unverifiedOcr.map((i) => i.title).join('; ')}).` : null} />}
    </main>
  );
}
