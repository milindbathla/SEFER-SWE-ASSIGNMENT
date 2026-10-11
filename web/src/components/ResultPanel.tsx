import type { AnalysisResult } from '@sefer/shared';
import { download } from '../api';

export function StatusBanner({ result, stale }: { result: AnalysisResult; stale: boolean }) {
  const ready = result.status === 'PASSES_LOCAL_CHECKS';
  return (
    <div className={`banner ${ready ? 'banner-ok' : 'banner-bad'}`} role="status" aria-live="polite">
      <strong>{ready ? 'Passes local checks: broker review still required' : 'DRAFT: NOT READY TO FILE'}</strong>
      {stale && <span className="muted"> · Updating for your latest changes…</span>}
      <ul>{result.statusReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <div className="small muted">Validated {result.generatedAt} · input {result.inputFingerprint.slice(0, 16)}</div>
    </div>
  );
}

export function ResultPanel({ result, reportMarkdown, stale, blockedReason = null }: { result: AnalysisResult; reportMarkdown: string; stale: boolean; blockedReason?: string | null }) {
  const failed = result.ruleChecks.filter((c) => !c.passed);
  const stamp = result.generatedAt.replace(/[:.]/g, '-');
  const s = result.summary;
  const blocked = stale || Boolean(blockedReason);
  const blockedTitle = stale ? 'Wait until the analysis reflects your latest changes' : blockedReason ?? undefined;
  return (
    <div>
      <div className="row">
        <button disabled={blocked} title={blockedTitle} onClick={() => download(`entry-draft-${stamp}.xml`, result.xml, 'application/xml')}>Download XML</button>
        <button disabled={blocked} title={blockedTitle} onClick={() => download(`validation-report-${stamp}.md`, reportMarkdown, 'text/markdown')}>Download report (.md)</button>
        <button disabled={blocked} title={blockedTitle} onClick={() => download(`analysis-${stamp}.json`, JSON.stringify(result, null, 2), 'application/json')}>Download full analysis (.json)</button>
        {stale && <span className="muted">Updating…</span>}
        {!stale && blockedReason && <span className="error small">{blockedReason}</span>}
      </div>
      <ul className="disclaimers">{result.disclaimers.map((d, i) => <li key={i}>{d}</li>)}</ul>

      <section className="card">
        <h4>Summary</h4>
        <table className="grid summary">
          <tbody>
            <tr><td>Blocking issues still unresolved</td><td><strong>{s.unresolvedBlocking}</strong> of {s.blocking}</td><td className="small">Not reviewed, or reviewed but still waiting for confirmed values. Resolved {s.resolved}, waived {s.waived}.</td></tr>
            <tr><td>Required/conditional field checks failed</td><td><strong>{s.failedRuleChecks}</strong> of {s.ruleChecks}</td><td className="small">Fields the schema or NetCHB's documented rules require that have no confirmed value or an invalid format.</td></tr>
            <tr><td>XSD errors</td><td><strong>{s.xsdErrors}</strong></td><td className="small">Structural errors in this exact XML against the official schema (libxml2 reports only the first missing child per element).</td></tr>
          </tbody>
        </table>
        <p className="muted small">Validated {result.generatedAt}. Input fingerprint {result.inputFingerprint} (the downloaded report and XML carry the same value).</p>
      </section>

      <section className="card">
        <h4>XSD validation (structural)</h4>
        <p>
          {result.xsd.ran ? (result.xsd.valid ? '✅ Valid against the vendored NetCHB entry.xsd.' : `❌ Invalid: ${result.xsd.errors.length} error(s).`) : '⚠️ Not run. Only rule checks are shown; this is NOT XSD validation.'}
        </p>
        <p className="muted small">{result.xsd.validator}. {result.xsd.limitation}</p>
        {result.xsd.errors.length > 0 && (
          <table className="grid"><thead><tr><th>XML line</th><th>Error</th><th>Cause</th></tr></thead>
            <tbody>{result.xsd.errors.map((e, i) => (
              <tr key={i}>
                <td>{e.line}</td>
                <td className="quote">{e.message}</td>
                <td className="small">{e.cause === 'missing_data' ? <>Missing data: {(e.relatedFields ?? []).join(', ')}</> : <strong>Unexplained: not traced to a missing field (possible generator defect)</strong>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h4>Required / conditional field checks: {failed.length} failed of {result.ruleChecks.length}</h4>
        {failed.length > 0 && (
          <table className="grid"><thead><tr><th>Check</th><th>Source</th><th>Detail</th></tr></thead>
            <tbody>{failed.map((c) => <tr key={c.id}><td>{c.description}</td><td className="small">{c.source}</td><td>{c.detail}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h4>XML preview</h4>
        <pre className="xml">{result.xml}</pre>
      </section>
    </div>
  );
}
