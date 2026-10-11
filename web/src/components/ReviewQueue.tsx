import { useState } from 'react';
import { PROVENANCE_LABELS, RESOLUTION_LABELS, isUnresolvedBlocker, type AnalysisResult, type BrokerInput, type Issue, type ResolvedField } from '@sefer/shared';
import { EvidenceList } from './IssuesPanel';

/**
 * Guided review queue. Everything shown is derived from the server's analysis result (the single authoritative model);
 * every action writes only to the existing BrokerInput (typed values, accepted proposals, approved transformations,
 * acknowledgements with notes, waivers), so the server re-validates and rebuilds the XML after each step.
 */
interface Props {
  result: AnalysisResult;
  broker: BrokerInput;
  onBroker: (b: BrokerInput) => void;
  onOpenTab: (tab: 'documents' | 'issues' | 'fields' | 'xml') => void;
}

const VALUATION_RULES = new Set(['LINE_ARITHMETIC', 'INVOICE_TOTALS', 'ASSIST_INDICATOR', 'NO_COMMERCIAL_VALUE', 'CIF_DEDUCTIONS', 'HTS_INCOMPLETE', 'CURRENCY_MISSING', 'FOREIGN_CURRENCY']);
const SUGGESTION_RULES = new Set(['INVOICE_NUMBER_FORMAT']);
const LINE_RE = /^(invoice\[\d+\])\/line\[(\d+)\]\/(.+)$/;
const isOpen = (i: Issue) => i.resolution === 'open' || i.resolution === 'acknowledged';

type Section = 'A' | 'B' | 'C' | 'D';
function sectionOf(i: Issue): Section {
  if (i.rule === 'OCR_UNVERIFIED' || SUGGESTION_RULES.has(i.rule)) return 'A';
  if (VALUATION_RULES.has(i.rule)) return 'D';
  if (i.kind === 'missing_broker') return 'C';
  return 'B';
}

export function ReviewQueue({ result, broker, onBroker, onOpenTab }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const byPath = new Map(result.fields.map((f) => [f.path, f]));
  const label = (p: string) => byPath.get(p)?.label ?? p;
  const openIssues = result.issues.filter(isOpen);
  const issuesIn = (s: Section) => openIssues.filter((i) => sectionOf(i) === s);
  const openIssueIds = new Set(openIssues.map((i) => i.id));

  // ----- BrokerInput updates (the only state this component changes) -----
  const setValue = (path: string, value: string, b: BrokerInput = broker): BrokerInput => {
    const values = { ...b.values };
    if (value.trim()) values[path] = value;
    else delete values[path];
    return { ...b, values };
  };
  const setList = (b: BrokerInput, list: 'acceptedProposals' | 'approvedTransformations', paths: string[], on: boolean): BrokerInput => {
    const set = new Set(b[list]);
    for (const p of paths) (on ? set.add(p) : set.delete(p));
    return { ...b, [list]: [...set] };
  };
  const acknowledge = (b: BrokerInput, id: string, note: string, waive = false): BrokerInput => ({
    ...b, acknowledgements: { ...b.acknowledgements, [id]: waive && note.trim() ? { note, waive: true } : { note } },
  });
  const toggleRequest = (path: string) => {
    const set = new Set(broker.brokerRequests ?? []);
    if (set.has(path)) set.delete(path);
    else set.add(path);
    onBroker({ ...broker, brokerRequests: [...set] });
  };

  // ----- A. suggestions that rest on agreeing document evidence and are not disputed by an open issue -----
  const proposed = result.fields.filter((f) => f.provenance === 'proposed' && f.proposal !== null && !broker.values[f.path]);
  const simple = proposed.filter((f) => !f.issueIds.some((id) => openIssueIds.has(id)) && !f.path.endsWith('/invoice-no'));
  // Same element and same proposed value on several lines: one explicit action for all of them.
  const groups = new Map<string, ResolvedField[]>();
  for (const f of simple) {
    const m = LINE_RE.exec(f.path);
    const key = m ? `${m[1]}|${m[3]}|${f.proposal}` : f.path;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const confirmed = result.fields.filter((f) => f.provenance === 'approved_proposal' || f.provenance === 'approved_transformation');
  const ocrIssues = issuesIn('A').filter((i) => i.rule === 'OCR_UNVERIFIED');
  const transformIssues = issuesIn('A').filter((i) => i.rule !== 'OCR_UNVERIFIED');

  const confirmAllSimple = () => {
    if (!window.confirm(`Confirm all ${simple.length} suggestion(s) listed in section A? Each was shown with its source and reason. Suggestions linked to a conflict, and unverified OCR readings, are not included.`)) return;
    onBroker(setList(broker, 'acceptedProposals', simple.map((f) => f.path), true));
  };

  // ----- C. broker / importer data -----
  const handledElsewhere = (f: ResolvedField) => /\/(tariff-no|value)$/.test(f.path) || f.path === 'entry-no';
  const brokerMissing = result.fields.filter((f) => f.value === null && f.provenance === 'missing' && !handledElsewhere(f) && (f.brokerOnly || f.requirement !== 'optional'));
  const lineBroker = brokerMissing.filter((f) => LINE_RE.test(f.path));
  const headerBroker = brokerMissing.filter((f) => !LINE_RE.test(f.path));
  const lineBrokerGroups = new Map<string, ResolvedField[]>();
  for (const f of lineBroker) {
    const m = LINE_RE.exec(f.path)!;
    lineBrokerGroups.set(`${m[1]}|${m[3]}`, [...(lineBrokerGroups.get(`${m[1]}|${m[3]}`) ?? []), f]);
  }

  // ----- D. tariff classification and valuation per line -----
  const lines = [...new Set(result.fields.map((f) => LINE_RE.exec(f.path)).filter((m): m is RegExpExecArray => m !== null).map((m) => `${m[1]}/line[${m[2]}]`))];

  // ----- E. final validation -----
  const s = result.summary;
  const unresolvedBlocking = result.issues.filter(isUnresolvedBlocker);

  const counts = {
    A: groups.size + ocrIssues.length + transformIssues.length,
    B: issuesIn('B').length,
    C: headerBroker.length + lineBrokerGroups.size + issuesIn('C').length + (broker.entryNumberMode === 'not_set' ? 1 : 0),
    D: lines.filter((l) => byPath.get(`${l}/tariff-no`)?.value === null || byPath.get(`${l}/value`)?.value === null).length + issuesIn('D').length,
  };

  const valueInput = (f: ResolvedField, placeholder = 'Enter confirmed value') => (
    <>
      <input className="wide" aria-label={`Value for ${f.label}`} placeholder={placeholder} value={broker.values[f.path] ?? ''} onChange={(e) => onBroker(setValue(f.path, e.target.value))} />
      {f.formatError && <div className="error small">{f.formatError}</div>}
    </>
  );
  const requestToggle = (f: ResolvedField) => (
    <label className="small">
      <input type="checkbox" checked={(broker.brokerRequests ?? []).includes(f.path)} onChange={() => toggleRequest(f.path)} /> Waiting for broker
    </label>
  );
  const status = (f: ResolvedField | undefined) => f && <span className={`badge prov-${f.provenance}`}>{f.value !== null ? <>in XML: <code>{f.value}</code></> : PROVENANCE_LABELS[f.provenance]}</span>;

  /** One open issue: evidence side by side, source values as choices, a decision note, and only the actions the rules allow. */
  // A render function, not a nested component: a nested component would remount on every render and lose input focus.
  const issueItem = (i: Issue) => {
    const ack = broker.acknowledgements[i.id];
    const note = drafts[i.id] ?? ack?.note ?? '';
    const hasNote = note.trim().length > 0;
    const waivable = i.pendingFields.length > 0 && i.pendingFields.every((p) => byPath.get(p)?.requirement !== 'schema_required');
    const choices = (i.choices ?? []).filter((c) => i.pendingFields.includes(c.field) || broker.values[c.field] === c.value);
    const choose = (field: string, value: string) => onBroker(acknowledge(setValue(field, value), i.id, note));
    return (
      <article key={i.id} className={`issue kind-${i.kind}`} data-issue={i.id}>
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
        <p><strong>Why this needs a decision:</strong> {i.requiredAction}</p>
        {choices.length > 0 && (
          <div className="choices">
            <strong>Values stated by the sources</strong> <span className="muted small">(none is applied automatically; choosing one records your note as the decision)</span>
            <table className="grid">
              <thead><tr><th>Field</th><th>Value</th><th>Source</th><th /></tr></thead>
              <tbody>
                {choices.map((c, k) => {
                  const chosen = broker.values[c.field] === c.value;
                  return (
                    <tr key={k}>
                      <td>{label(c.field)}</td>
                      <td><code>{c.value}</code></td>
                      <td>{c.source}{c.caution && <div className="error small">⚠ {c.caution}</div>}</td>
                      <td>
                        {chosen ? <span className="badge review-confirmed">chosen</span> : (
                          <button disabled={!hasNote} title={hasNote ? undefined : 'Write a decision note first'} onClick={() => choose(c.field, c.value)}>Use this value</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {i.pendingFields.length > 0 && (
          <div className="small">
            <strong>Still without a confirmed value:</strong>{' '}
            {i.pendingFields.map((p) => (
              <span key={p} className="pending-field">
                {label(p)}
                {!(i.choices ?? []).some((c) => c.field === p) && byPath.get(p) && <> {valueInput(byPath.get(p)!, 'Enter the confirmed value')}</>}
              </span>
            ))}
          </div>
        )}
        <div className="row">
          <input className="wide" aria-label={`Decision note for ${i.title}`} placeholder="Decision note: who confirmed what (required to choose a value or record a decision)" value={note}
            onChange={(e) => {
              setDrafts({ ...drafts, [i.id]: e.target.value });
              if (ack) onBroker(acknowledge(broker, i.id, e.target.value, Boolean(ack.waive)));
            }} />
          {!ack && <button disabled={!hasNote} onClick={() => onBroker(acknowledge(broker, i.id, note))}>Record decision</button>}
        </div>
        {ack && i.resolution === 'acknowledged' && (
          <div className="callout next-step small">
            Decision recorded, but this issue stays {i.blocking ? 'blocking' : 'open'} until
            {i.pendingFields.length ? <> every affected field has a confirmed value ({i.pendingFields.map(label).join(', ')}).</> : <> a decision note is written.</>}
            {i.pendingFields.some((p) => byPath.get(p)?.requirement === 'schema_required') && <> Schema-required fields cannot be waived.</>}
          </div>
        )}
        {ack && waivable && (
          <label className="small">
            <input type="checkbox" checked={Boolean(ack.waive)} disabled={!hasNote} onChange={(e) => onBroker(acknowledge(broker, i.id, note, e.target.checked))} />{' '}
            Leave these optional values out of the XML (explicit waiver, with the note above as the reason)
          </label>
        )}
      </article>
    );
  };

  return (
    <div className="queue">
      <p className="muted">
        Work through the sections in order. Every action is re-validated on the server and the XML is rebuilt from the result. Recording a decision never fills a value,
        and a suggestion is used only after you confirm it.
      </p>
      <nav className="row small">
        {(['A', 'B', 'C', 'D'] as const).map((k) => <a key={k} href={`#queue-${k}`}>{k}: {counts[k]} to do</a>)}
        <a href="#queue-E">E: validation</a>
      </nav>

      <section className="card" id="queue-A">
        <h3>A. Confirm suggested values ({counts.A})</h3>
        {ocrIssues.map((i) => (
          <div key={i.id} className="callout">
            <strong>{i.title}.</strong> Values that depend on these readings are withheld until each reading is confirmed, corrected or rejected beside the page.{' '}
            <button onClick={() => onOpenTab('documents')}>Verify OCR readings</button>
          </div>
        ))}
        {transformIssues.map((i) => {
          const path = i.affects[0];
          const f = byPath.get(path);
          const note = drafts[i.id] ?? broker.acknowledgements[i.id]?.note ?? '';
          return (
            <div key={i.id} className="issue kind-transformation" data-issue={i.id}>
              <strong>{i.title}</strong>
              <p className="small">{f?.proposalReason ?? i.explanation}</p>
              {f?.proposal && (
                <div className="row">
                  <span>Original <code>{f.evidence[0]?.value}</code> → proposed <code>{f.proposal}</code></span>
                  <input className="wide" aria-label={`Decision note for ${i.title}`} placeholder="Decision note (required)" value={note} onChange={(e) => setDrafts({ ...drafts, [i.id]: e.target.value })} />
                  <button disabled={!note.trim()} onClick={() => onBroker(acknowledge(setList(broker, 'approvedTransformations', [path], true), i.id, note))}>Approve transformation</button>
                </div>
              )}
              {f && <div className="small">Or enter the number exactly as it should appear: {valueInput(f)}</div>}
            </div>
          );
        })}
        {groups.size > 0 && (
          <table className="grid queue-table">
            <thead><tr><th>Field</th><th>Suggested value</th><th>Why, and the evidence</th><th>Action</th></tr></thead>
            <tbody>
              {[...groups.values()].map((list) => {
                const f = list[0];
                const many = list.length > 1;
                const name = many ? `${f.label.replace(/^Line \S+( \S+)?: /, '')} (${list.length} lines)` : f.label;
                return (
                  <tr key={list.map((x) => x.path).join()}>
                    <td><strong>{name}</strong><div className="muted small">{f.requirement.replace('_', ' ')}</div></td>
                    <td><code>{f.proposal}</code></td>
                    <td className="small">
                      {f.proposalReason}
                      {f.evidence.length > 0 && <details><summary>Evidence ({f.evidence.length})</summary><EvidenceList evidence={f.evidence} /></details>}
                      {many && <details><summary>Lines</summary>{list.map((x) => <div key={x.path}>{x.label}</div>)}</details>}
                    </td>
                    <td>
                      <button onClick={() => onBroker(setList(broker, 'acceptedProposals', list.map((x) => x.path), true))}>{many ? `Confirm for all ${list.length} lines` : 'Confirm'}</button>
                      <div className="small muted">or type a different value in <button className="link" onClick={() => onOpenTab('fields')}>Entry fields</button></div>
                      {requestToggle(f)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {simple.length > 1 && <p><button onClick={confirmAllSimple}>Confirm all {simple.length} suggestions listed above…</button> <span className="muted small">Asks first. Never includes conflicts or unverified OCR readings.</span></p>}
        {counts.A === 0 && <p className="muted">No suggestion is waiting for confirmation.</p>}
        {confirmed.length > 0 && (
          <details>
            <summary className="small">Confirmed suggestions ({confirmed.length}): undo</summary>
            <ul className="small">
              {confirmed.map((f) => (
                <li key={f.path}>{f.label}: <code>{f.value}</code>{' '}
                  <button className="link" onClick={() => onBroker(setList(broker, f.provenance === 'approved_transformation' ? 'approvedTransformations' : 'acceptedProposals', [f.path], false))}>undo</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card" id="queue-B">
        <h3>B. Resolve conflicting or uncertain documents ({counts.B})</h3>
        {issuesIn('B').length === 0 ? <p className="muted">No open conflict.</p> : issuesIn('B').map(issueItem)}
      </section>

      <section className="card" id="queue-C">
        <h3>C. Supply broker / importer information ({counts.C})</h3>
        <p className="muted small">These facts are not on the shipping documents. They are never inferred.</p>
        <div className="row">
          <strong>Entry number (&lt;entry-no&gt;)</strong>
          <select aria-label="Entry number option" value={broker.entryNumberMode} onChange={(e) => onBroker({ ...broker, entryNumberMode: e.target.value as BrokerInput['entryNumberMode'] })}>
            <option value="not_set">Not chosen (draft stays incomplete)</option>
            <option value="system_generated">NetCHB &lt;system-generated/&gt; (broker confirmed)</option>
            <option value="user_specified">Filer code + entry number</option>
          </select>
        </div>
        <table className="grid queue-table">
          <thead><tr><th>Field</th><th>Status</th><th>Value</th></tr></thead>
          <tbody>
            {[...result.fields.filter((f) => f.path.startsWith('entry-no/') && f.value === null), ...headerBroker].map((f) => (
              <tr key={f.path}>
                <td><strong>{f.label}</strong><div className="muted small">{f.requirement.replace('_', ' ')} · {f.requirementNote}</div></td>
                <td>{status(f)}</td>
                <td>{valueInput(f)}{f.inputHint && <div className="muted small">{f.inputHint}</div>}{requestToggle(f)}</td>
              </tr>
            ))}
            {[...lineBrokerGroups.values()].map((list) => {
              const first = list.find((f) => broker.values[f.path]?.trim());
              const element = list[0].label.replace(/^Line \S+( \S+)?: /, '');
              return (
                <tr key={list[0].path}>
                  <td><strong>{element} ({list.length} lines)</strong><div className="muted small">{list[0].requirement.replace('_', ' ')} · {list[0].requirementNote}</div></td>
                  <td>{list.filter((f) => f.value === null).length} without a value</td>
                  <td>
                    {list.map((f) => <div key={f.path} className="row small"><span className="line-label">{f.label.split(':')[0]}</span>{valueInput(f)}</div>)}
                    {first && (
                      <button className="small" onClick={() => {
                        if (!window.confirm(`Use "${broker.values[first.path]}" for ${element} on all ${list.length} lines? Only do this if the same fact applies to every line (e.g. one manufacturer made all of them).`)) return;
                        onBroker(list.reduce((b, f) => setValue(f.path, broker.values[first.path], b), broker));
                      }}>Use "{broker.values[first.path]}" for all {list.length} lines…</button>
                    )}
                    {requestToggle(list[0])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {issuesIn('C').map(issueItem)}
      </section>

      <section className="card" id="queue-D">
        <h3>D. Tariff classification and valuation ({counts.D})</h3>
        <p className="muted small">Classification and the entered value are broker decisions. The invoice's HS digits and amounts are shown as evidence only; they are not complete HTSUS numbers or entered values.</p>
        <table className="grid queue-table">
          <thead><tr><th>Line</th><th>Invoice evidence</th><th>HTSUS number (10 digits)</th><th>Tariff value (USD)</th></tr></thead>
          <tbody>
            {lines.map((l) => {
              const tariff = byPath.get(`${l}/tariff-no`);
              const value = byPath.get(`${l}/value`);
              const desc = byPath.get(`${l}/commercial-description`);
              const qty = byPath.get(`${l}/invoice-quantity`);
              const lineIssues = openIssues.filter((i) => i.affects.some((a) => a.startsWith(`${l}/`)) && VALUATION_RULES.has(i.rule));
              return (
                <tr key={l}>
                  <td><strong>{tariff?.label.split(':')[0]}</strong><div className="small">{desc?.value ?? ''}</div></td>
                  <td className="small">
                    {tariff?.evidence.map((e, k) => <div key={k}>HS on invoice: <code>{e.value}</code></div>)}
                    {value?.evidence.filter((e) => e.value).map((e, k) => <div key={k}>Printed amount: <code>{e.value}</code></div>)}
                    {qty?.evidence.filter((e) => e.value).slice(0, 1).map((e, k) => <div key={k}>Quantity: <code>{e.value}</code></div>)}
                    {lineIssues.length > 0 && <div className="error">Open valuation issue(s): {lineIssues.map((i) => i.rule).join(', ')}</div>}
                  </td>
                  <td>{tariff && <>{status(tariff)}{valueInput(tariff)}{requestToggle(tariff)}</>}</td>
                  <td>{value && <>{status(value)}{value.proposal && !broker.values[value.path] && value.value === null && <div className="small">Suggested: <code>{value.proposal}</code> (see section A)</div>}{valueInput(value)}{requestToggle(value)}</>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {issuesIn('D').map(issueItem)}
      </section>

      <section className="card" id="queue-E">
        <h3>E. Final XML validation</h3>
        <p><strong>{result.status === 'PASSES_LOCAL_CHECKS' ? 'Passes local checks (broker review still required; not NetCHB/CBP acceptance)' : 'NOT READY TO FILE'}</strong></p>
        <table className="grid summary">
          <tbody>
            <tr><td>Blocking issues unresolved</td><td><strong>{s.unresolvedBlocking}</strong> of {s.blocking}</td></tr>
            <tr><td>Required/conditional field checks failed</td><td><strong>{s.failedRuleChecks}</strong> of {s.ruleChecks}</td></tr>
            <tr><td>XSD errors (local schema)</td><td><strong>{s.xsdErrors}</strong>{result.xsd.errors.some((e) => e.cause === 'unexplained') && <span className="error"> including unexplained errors (possible generator defect)</span>}</td></tr>
          </tbody>
        </table>
        {unresolvedBlocking.length > 0 && (
          <details><summary className="small">Unresolved blocking issues ({unresolvedBlocking.length})</summary>
            <ul className="small">{unresolvedBlocking.map((i) => <li key={i.id}>{i.title} <span className="muted">({sectionOf(i)})</span></li>)}</ul>
          </details>
        )}
        <button onClick={() => onOpenTab('xml')}>Open XML &amp; validation report</button>
      </section>
    </div>
  );
}
