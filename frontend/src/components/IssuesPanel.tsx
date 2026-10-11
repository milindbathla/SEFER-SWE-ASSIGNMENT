import { DOC_TYPE_LABELS, RESOLUTION_LABELS, type AnalysisResult, type BrokerInput, type Evidence, type Issue, type ResolvedField } from '@sefer/shared';

interface Props {
  issues: Issue[];
  fields: ResolvedField[];
  summary: AnalysisResult['summary'];
  broker: BrokerInput;
  onBroker: (b: BrokerInput) => void;
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <table className="grid evidence">
      <thead><tr><th>Source</th><th>Page</th><th>What it says</th><th>Verbatim evidence</th>{evidence.some((e) => e.ocr) && <th>OCR</th>}</tr></thead>
      <tbody>
        {evidence.map((e, i) => (
          <tr key={i}>
            <td>{e.fileName}<div className="muted">{DOC_TYPE_LABELS[e.docType]}{e.label ? ` · ${e.label}` : ''}</div></td>
            <td>{e.page ?? ''}</td>
            <td>{e.value ?? ''}</td>
            <td className="quote">{e.quote && e.quote !== e.value ? e.quote : ''}</td>
            {evidence.some((x) => x.ocr) && (
              <td className="small">{e.ocr ? <>{e.ocr.confidence !== null ? `${Math.round(e.ocr.confidence)}%` : '?'} · {e.ocr.verified ? 'verified' : <strong>unverified</strong>}</> : 'not OCR'}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function IssuesPanel({ issues, fields, summary, broker, onBroker }: Props) {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const needsAction = issues.filter((i) => i.resolution === 'open' || i.resolution === 'acknowledged');
  const closed = issues.filter((i) => i.resolution === 'resolved' || i.resolution === 'waived');

  const setAck = (id: string, ack: boolean, patch: { note?: string; waive?: boolean } = {}) => {
    const acknowledgements = { ...broker.acknowledgements };
    if (ack) {
      const current = acknowledgements[id] ?? { note: '' };
      const next = { ...current, ...patch };
      // A waiver is only kept while a note explains it (the server enforces the same rule).
      acknowledgements[id] = next.waive && next.note.trim() ? next : { note: next.note };
    } else delete acknowledgements[id];
    onBroker({ ...broker, acknowledgements });
  };

  const label = (p: string) => byPath.get(p)?.label ?? p;

  const card = (i: Issue) => {
    const ack = broker.acknowledgements[i.id];
    const note = ack?.note ?? '';
    const waivable = i.pendingFields.length > 0 && i.pendingFields.every((p) => byPath.get(p)?.requirement !== 'schema_required');
    const requiredPending = i.pendingFields.filter((p) => byPath.get(p)?.requirement === 'schema_required');
    return (
      <article key={i.id} className={`issue kind-${i.kind} resolution-${i.resolution}`}>
        <header className="row space">
          <div>
            <span className={`badge kind-${i.kind}`}>{i.state}</span>
            {i.blocking && <span className="badge block">blocking</span>}
            <span className={`badge resolution-${i.resolution}`}>{RESOLUTION_LABELS[i.resolution]}</span> <strong>{i.title}</strong>
          </div>
          <code className="muted">{i.rule}</code>
        </header>
        <p>{i.explanation}</p>
        <EvidenceList evidence={i.evidence} />
        <p><strong>Required action:</strong> {i.requiredAction}</p>
        {i.affects.length > 0 && <p className="muted">Affects: {i.affects.map(label).join(', ')}</p>}
        {i.reference && <p className="muted">Reference: {i.reference}</p>}
        <div className="row">
          <label>
            <input type="checkbox" checked={i.acknowledged} onChange={(e) => setAck(i.id, e.target.checked, { note })} />{' '}
            I have reviewed this issue
          </label>
          {i.acknowledged && (
            <input className="wide" aria-label={`Resolution note for ${i.title}`} placeholder="Resolution note: who confirmed what, and the decision" value={note} onChange={(e) => setAck(i.id, true, { note: e.target.value })} />
          )}
        </div>
        {i.acknowledged && i.pendingFields.length > 0 && i.resolution !== 'waived' && (
          <div className="callout next-step">
            <strong>Next step:</strong> reviewing does not fill any value. Enter confirmed values in <em>2. Review queue</em> or <em>4. All entry fields</em> for:{' '}
            {i.pendingFields.map(label).join(', ')}.
            {requiredPending.length > 0 && <div className="small">Required by the schema, so these cannot be waived: {requiredPending.map(label).join(', ')}.</div>}
            {waivable && (
              <div>
                <label>
                  <input type="checkbox" checked={Boolean(ack?.waive)} disabled={!note.trim()} onChange={(e) => setAck(i.id, true, { waive: e.target.checked })} />{' '}
                  Leave these optional values out of the XML (explicit waiver){!note.trim() && <span className="muted small"> (write a resolution note first)</span>}
                </label>
              </div>
            )}
          </div>
        )}
        {i.resolution === 'acknowledged' && i.affects.length === 0 && (
          <div className="callout next-step">
            <strong>Next step:</strong> no entry field holds this value, so the issue is resolved only by a recorded decision. Write a resolution note
            (who confirmed what) above.
          </div>
        )}
        {i.resolution === 'waived' && <p className="muted">Waived: {i.pendingFields.map(label).join(', ')} will be left out of the XML. Untick the waiver to enter values instead.</p>}
      </article>
    );
  };

  return (
    <div>
      <p className="muted">
        {summary.unresolvedBlocking} blocking issue(s) unresolved · {summary.open} not reviewed · {summary.acknowledgedPending} reviewed but waiting for confirmed values ·{' '}
        {summary.resolved} resolved · {summary.waived} waived. Source values are never corrected automatically; reviewing an issue never confirms a value.
      </p>
      {needsAction.length === 0 && <p>No issue needs action.</p>}
      {needsAction.map(card)}
      {closed.length > 0 && (
        <details>
          <summary>Resolved or waived issues ({closed.length})</summary>
          {closed.map(card)}
        </details>
      )}
    </div>
  );
}
