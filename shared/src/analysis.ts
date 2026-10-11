import { z } from 'zod';
import { DocType, ExtractedDocument } from './documents.js';

/** Review states, using the wording approved at Checkpoint A. */
export const ISSUE_STATES = {
  missing_broker: 'Missing — broker input required',
  conflict: 'Conflicting source documents — confirmation required',
  uncertain: 'Uncertain — confirmation required',
  provisional: 'Provisional — confirmation required',
  transformation: 'Confirmation required (transformation approval)',
  invalid: 'Invalid format — correction required',
} as const;
export type IssueKind = keyof typeof ISSUE_STATES;

export const Evidence = z.object({
  documentId: z.string(),
  fileName: z.string(),
  docType: DocType,
  page: z.number().nullable(),
  /** What this source says, as printed. */
  value: z.string().nullable(),
  quote: z.string().nullable(),
  label: z.string().optional(),
  /** Present when the value was read by OCR: its confidence and whether a person has verified it. */
  ocr: z.object({ confidence: z.number().nullable(), verified: z.boolean() }).optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Issue = z.object({
  /** Stable id, e.g. "LINE_ARITHMETIC:inv1:line1". */
  id: z.string(),
  rule: z.string(),
  kind: z.enum(['missing_broker', 'conflict', 'uncertain', 'provisional', 'transformation', 'invalid']),
  state: z.string(),
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(Evidence),
  requiredAction: z.string(),
  /** Blocking issues keep the draft NOT READY TO FILE until acknowledged by the user. */
  blocking: z.boolean(),
  /** Entry field paths whose values this issue withholds or affects. */
  affects: z.array(z.string()),
  /** Optional reference to a verified source (research-log entry or regulation). */
  reference: z.string().optional(),
  acknowledged: z.boolean(),
  acknowledgementNote: z.string().optional(),
  /**
   * Derived on the server from the acknowledgement and the affected fields:
   * open (not reviewed) · acknowledged (reviewed, but affected values are still unconfirmed: still blocking) ·
   * resolved (reviewed and every affected value is now a confirmed value; for a blocking issue that affects no field, a non-empty note is required) ·
   * waived (reviewed, and the user explicitly chose, with a note, to leave the remaining OPTIONAL values out).
   */
  resolution: z.enum(['open', 'acknowledged', 'resolved', 'waived']),
  /** Affected field paths that still have no confirmed value. */
  pendingFields: z.array(z.string()),
  /**
   * For a disagreement between sources: each source's value for an affected field, converted to that field's format
   * (e.g. "1,888.00 KGS" → "1888"). Never applied automatically; the user may pick one, with a resolution note.
   */
  choices: z.array(z.object({ field: z.string(), value: z.string(), source: z.string(), caution: z.string().optional() })).optional(),
});
export type Issue = z.infer<typeof Issue>;
export type IssueResolution = Issue['resolution'];

export const RESOLUTION_LABELS: Record<IssueResolution, string> = {
  open: 'Open: not reviewed',
  acknowledged: 'Reviewed: confirmed values (or a resolution note) still needed',
  resolved: 'Resolved: confirmed values entered',
  waived: 'Waived: optional values deliberately left out',
};

/** An issue blocks readiness while it is blocking and neither resolved nor (validly) waived. */
export function isUnresolvedBlocker(i: Pick<Issue, 'blocking' | 'resolution'>): boolean {
  return i.blocking && (i.resolution === 'open' || i.resolution === 'acknowledged');
}

export const PROVENANCE_LABELS = {
  extracted: 'Extracted from documents',
  calculated: 'Calculated deterministically',
  proposed: 'Proposed — awaiting confirmation',
  user_supplied: 'Supplied by user / broker',
  approved_proposal: 'Proposal confirmed by user',
  approved_transformation: 'Transformation approved by user',
  system_option: 'NetCHB option selected by user',
  withheld: 'Withheld: disputed or uncertain, needs confirmation',
  missing: 'Missing: no value available',
} as const;
export type Provenance = keyof typeof PROVENANCE_LABELS;

export const ResolvedField = z.object({
  path: z.string(),
  label: z.string(),
  /** Element path in the NetCHB XML, e.g. "header/entry-date". */
  xmlPath: z.string(),
  group: z.enum(['entry', 'header', 'manifest', 'containers', 'invoice', 'line']),
  requirement: z.enum(['schema_required', 'conditional', 'optional']),
  requirementNote: z.string(),
  /** Value that will be written to the XML (null = omitted). */
  value: z.string().nullable(),
  provenance: z.enum(['extracted', 'calculated', 'proposed', 'user_supplied', 'approved_proposal', 'approved_transformation', 'system_option', 'withheld', 'missing']),
  /** A candidate value that is NOT used until the user confirms it. */
  proposal: z.string().nullable(),
  proposalReason: z.string().nullable(),
  evidence: z.array(Evidence),
  issueIds: z.array(z.string()),
  /** A local format problem with the value the user typed (value is then withheld). */
  formatError: z.string().nullable(),
  brokerOnly: z.boolean(),
  inputHint: z.string(),
});
export type ResolvedField = z.infer<typeof ResolvedField>;

export const BrokerInput = z.object({
  /** Values typed by the user/broker, keyed by field path. Empty strings are ignored. */
  values: z.record(z.string(), z.string()),
  /** Field paths whose proposal the user explicitly accepted. */
  acceptedProposals: z.array(z.string()),
  /** Issue ids the user reviewed, with an optional note. */
  acknowledgements: z.record(z.string(), z.object({
    note: z.string(),
    /** Explicit decision to leave the issue's remaining OPTIONAL values out of the XML. Requires a non-empty note. */
    waive: z.boolean().optional(),
  })),
  /** Explicit approval of the proposed invoice-number transformation, per invoice field path. */
  approvedTransformations: z.array(z.string()),
  /** NetCHB documented choice for <entry-no>. Default: not chosen. */
  entryNumberMode: z.enum(['not_set', 'system_generated', 'user_specified']),
  /** Field paths the user marked as waiting for the broker (a to-do list for the report; never a value, never a resolution). */
  brokerRequests: z.array(z.string()).optional(),
});
export type BrokerInput = z.infer<typeof BrokerInput>;

export function emptyBrokerInput(): BrokerInput {
  return { values: {}, acceptedProposals: [], acknowledgements: {}, approvedTransformations: [], entryNumberMode: 'not_set' };
}

export const XsdResult = z.object({
  ran: z.boolean(),
  valid: z.boolean().nullable(),
  errors: z.array(z.object({
    line: z.number().nullable(),
    message: z.string(),
    /** missing_data: explained by entry fields that have no confirmed value; unexplained: not traced to a field (possible generator defect). */
    cause: z.enum(['missing_data', 'unexplained']).optional(),
    relatedFields: z.array(z.string()).optional(),
  })),
  validator: z.string(),
  schemaFiles: z.array(z.object({ file: z.string(), sha256: z.string(), source: z.string() })),
  limitation: z.string().nullable(),
});
export type XsdResult = z.infer<typeof XsdResult>;

export const RuleCheck = z.object({
  id: z.string(),
  description: z.string(),
  source: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type RuleCheck = z.infer<typeof RuleCheck>;

export const ReadinessStatus = z.enum(['NOT_READY_TO_FILE', 'PASSES_LOCAL_CHECKS']);
export type ReadinessStatus = z.infer<typeof ReadinessStatus>;

export const AnalysisResult = z.object({
  generatedAt: z.string(),
  status: ReadinessStatus,
  statusReasons: z.array(z.string()),
  documents: z.array(
    z.object({ id: z.string(), fileName: z.string(), docType: DocType, method: z.string(), pageCount: z.number(), warnings: z.array(z.string()) }),
  ),
  issues: z.array(Issue),
  fields: z.array(ResolvedField),
  xml: z.string(),
  xsd: XsdResult,
  ruleChecks: z.array(RuleCheck),
  disclaimers: z.array(z.string()),
  /** SHA-256 of the canonical analysis input (documents + broker decisions): identifies exactly which state was validated. */
  inputFingerprint: z.string(),
  /** Counts derived once on the server; the UI and the report display these, never their own recount. */
  summary: z.object({
    issues: z.number(),
    blocking: z.number(),
    unresolvedBlocking: z.number(),
    open: z.number(),
    acknowledgedPending: z.number(),
    resolved: z.number(),
    waived: z.number(),
    ruleChecks: z.number(),
    failedRuleChecks: z.number(),
    xsdErrors: z.number(),
  }),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

export const AnalyzeRequest = z.object({
  documents: z.array(ExtractedDocument),
  brokerInput: BrokerInput,
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;
