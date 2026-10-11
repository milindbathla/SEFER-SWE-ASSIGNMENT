import { PROVENANCE_LABELS, type BrokerInput, type ResolvedField } from '@sefer/shared';
import { EvidenceList } from './IssuesPanel';

interface Props {
  fields: ResolvedField[];
  broker: BrokerInput;
  onBroker: (b: BrokerInput) => void;
}

const GROUPS: { key: ResolvedField['group']; title: string }[] = [
  { key: 'entry', title: 'Entry number' },
  { key: 'header', title: 'Entry header' },
  { key: 'manifest', title: 'Manifest (bill of lading)' },
  { key: 'containers', title: 'Containers' },
  { key: 'invoice', title: 'Invoice' },
  { key: 'line', title: 'Line items' },
];

const REQUIREMENT_LABELS: Record<ResolvedField['requirement'], string> = { schema_required: 'Required (schema)', conditional: 'Conditional', optional: 'Optional' };

export function FieldsPanel({ fields, broker, onBroker }: Props) {
  const setValue = (path: string, value: string) => {
    const values = { ...broker.values };
    if (value) values[path] = value;
    else delete values[path];
    onBroker({ ...broker, values });
  };
  const toggle = (list: 'acceptedProposals' | 'approvedTransformations', path: string, on: boolean) => {
    const set = new Set(broker[list]);
    if (on) set.add(path);
    else set.delete(path);
    onBroker({ ...broker, [list]: [...set] });
  };

  return (
    <div>
      <div className="card">
        <h4>Entry number (&lt;entry-no&gt;)</h4>
        <p className="muted">
          entry.xsd requires either a user-specified entry number (filer code + number) or the NetCHB option <code>&lt;system-generated/&gt;</code>, which asks NetCHB to assign the number on upload.
          Whether system-generated numbering suits a broker's workflow must be confirmed by the broker. It is off by default.
        </p>
        {(['not_set', 'system_generated', 'user_specified'] as const).map((m) => (
          <label key={m} className="radio">
            <input type="radio" name="entryNumberMode" checked={broker.entryNumberMode === m} onChange={() => onBroker({ ...broker, entryNumberMode: m })} />{' '}
            {m === 'not_set' ? 'Not chosen (draft stays incomplete)' : m === 'system_generated' ? 'Use NetCHB <system-generated/> (broker confirmed)' : 'Enter filer code and entry number'}
          </label>
        ))}
      </div>

      {GROUPS.map((g) => {
        const list = fields.filter((f) => f.group === g.key && f.path !== 'entry-no');
        if (!list.length) return null;
        return (
          <section key={g.key} className="card">
            <h4>{g.title}</h4>
            <table className="grid fields">
              <thead><tr><th>Field</th><th>Value in XML</th><th>Status</th><th>Confirm / enter value</th></tr></thead>
              <tbody>
                {list.map((f) => {
                  const typed = broker.values[f.path] ?? '';
                  const isTransform = f.path.endsWith('/invoice-no') && f.proposal !== null;
                  const accepted = isTransform ? broker.approvedTransformations.includes(f.path) : broker.acceptedProposals.includes(f.path);
                  return (
                    <tr key={f.path} className={`prov-${f.provenance}`}>
                      <td>
                        <div><strong>{f.label}</strong></div>
                        <div className="muted"><code>{f.xmlPath}</code> · {REQUIREMENT_LABELS[f.requirement]}</div>
                        <div className="muted small">{f.requirementNote}</div>
                      </td>
                      <td>{f.value !== null ? <code>{f.value}</code> : <span className="muted">not written</span>}</td>
                      <td>
                        <span className={`badge prov-${f.provenance}`}>{PROVENANCE_LABELS[f.provenance]}</span>
                        {f.brokerOnly && f.value === null && <div className="badge broker">Missing: broker input required</div>}
                        {f.issueIds.length > 0 && <div className="muted small">Linked issues: {f.issueIds.length}</div>}
                        {f.formatError && <div className="error small">{f.formatError}</div>}
                      </td>
                      <td>
                        {f.proposal && !typed && (
                          <div className="proposal">
                            {isTransform ? (
                              <>
                                <div><strong>Proposed transformation:</strong> original <code>{f.evidence[0]?.value}</code> → <code>{f.proposal}</code></div>
                                <div className="small">{f.proposalReason}</div>
                                <label><input type="checkbox" checked={accepted} onChange={(e) => toggle('approvedTransformations', f.path, e.target.checked)} /> I approve using the transformed number in the XML</label>
                              </>
                            ) : (
                              <>
                                <div><strong>Proposal:</strong> <code>{f.proposal}</code></div>
                                <div className="small">{f.proposalReason}</div>
                                <label><input type="checkbox" checked={accepted} onChange={(e) => toggle('acceptedProposals', f.path, e.target.checked)} /> Confirm this proposal</label>
                              </>
                            )}
                          </div>
                        )}
                        <input className="wide" placeholder={f.value !== null && !typed ? 'Override with a confirmed value' : 'Enter confirmed value'} value={typed} onChange={(e) => setValue(f.path, e.target.value)} />
                        {f.inputHint && <div className="muted small">{f.inputHint}</div>}
                        {f.evidence.length > 0 && (
                          <details><summary className="small">Evidence ({f.evidence.length})</summary><EvidenceList evidence={f.evidence} /></details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
