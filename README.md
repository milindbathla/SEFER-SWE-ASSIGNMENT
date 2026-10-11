# Entry Draft Builder: shipment documents → evidence-backed NetCHB entry XML (draft)

A small TypeScript web app (React + Express) for the Sefer SWE intern take-home. It:

1. accepts shipment documents (commercial invoice, packing list, bill of lading);
2. extracts the relevant values **with evidence** (file, page, verbatim quote) from text-layer PDFs and, by **local OCR**, from scanned PDFs;
3. reconciles the documents and flags **missing**, **conflicting** and **uncertain** values;
4. generates **NetCHB entry XML** using only elements from NetCHB's published schema;
5. validates it locally (official XSD + documented conditional rules) and shows missing information and next steps.

> ⚠️ **Status: not production-verified.** The XML is generated for **local review and download only**. Nothing is submitted, no
> `<transmit/>` is ever generated, and passing local checks is **structural validation only**. It does not mean NetCHB or CBP will accept the
> entry. The public schema's currency is unconfirmed, NetCHB's own sample fails that schema, and the upload endpoint and authentication
> were not available (see [`docs/research-log.md`](docs/research-log.md), RL-5 and RL-7).

---

## Quick start

Requirements: **Node.js** (developed and tested on Node 24.18 with npm 11.16 on Windows 11; other versions untested, and the
browser E2E script needs Node ≥ 22 for its built-in WebSocket). No API keys, databases or native builds are needed; OCR runs locally in
WebAssembly with its English model installed by `npm install` (nothing is downloaded at runtime).

```bash
npm install          # project-local dependencies only
npm run dev          # API on http://127.0.0.1:3001 + UI on http://127.0.0.1:5173 (Ctrl+C stops both)
npm test             # 134 unit/integration tests, including OCR of the two sample scans (no credentials needed)
npm run typecheck    # tsc for shared (source and tests), server and web
npm run sample       # regenerates deliverable D2 in output/sample/
npm run build && npm start   # production build; UI served by the API at http://127.0.0.1:3001
```

**Open http://127.0.0.1:5173** after `npm run dev`. To run the two processes in separate terminals instead, use
`npm run dev -w server` (API, port 3001) and `npm run dev -w web` (UI, port 5173; it proxies `/api` to the API). Stop each with Ctrl+C.
`GET http://127.0.0.1:3001/api/health` answers `{"ok":true,…}` when the API is up.

**End-to-end checks against the running app** (start `npm run dev` first):

```bash
npm run e2e:api       # 43 API checks through the UI's proxy, using the sample documents
npm run e2e:browser   # 55 checks in a real headless Chrome/Edge: PDF upload + OCR (no JSON), OCR review, review queue, issues/waiver, approvals, XML tab, downloads, reload, errors
```

Both accept a base URL, e.g. `node scripts/e2e/api-e2e.mjs http://127.0.0.1:3001` after `npm run build && npm start` (one process, less memory).

The browser script drives Chrome or Edge through the DevTools protocol with no extra packages (set `CHROME_PATH` if the browser is not in a
standard location). Screenshots and downloaded files go to the OS temp folder (`sefer-browser-e2e`).

### Try it with the supplied sample

1. `npm run dev`, then open http://127.0.0.1:5173.
2. Upload the three PDFs from [`sample-docs/`](sample-docs/). That is all the input needed: **no JSON file is involved**.
3. The **invoice** is read from its PDF text layer. The **packing list** and **bill of lading** are scans, so they are read by **local OCR**
   (about 3 seconds per page). Every OCR value is shown with its confidence and marked **unverified**. In *1. Documents*, compare each value
   with the page (**Show page beside values**) and **Confirm**, correct (type over it) or **Reject** it; *Confirm all remaining readings…*
   is available after checking. Until then a blocking "OCR readings not yet verified" issue keeps those values out of the XML, and the
   downloads wait. The packing list's goods table is not read by OCR: a blocking issue says the invoice lines were **not** compared with
   it; add its rows from the page (*Add line*) to run the quantity and fibre checks, or record what you compared.
4. Work through **2. Review queue** (see below). **3. All issues** and **4. All entry fields** show the complete lists, and
   **5. XML & validation report** shows the summary, the XSD errors with their cause, the XML preview and the downloads.
5. The review (documents and every decision) is saved in this browser's local storage and restored after a refresh. **Clear saved review**
   removes it. A restored review is re-analysed on the server; nothing from storage is trusted as validated.

### The review queue

One page, five sections, built only from the server's analysis result. Every action changes the broker decisions, after which the server
re-validates and rebuilds the XML.

| Section | What it shows | Actions |
|---|---|---|
| **A. Confirm suggested values** | Proposals that rest on agreeing document evidence (ports, state, B/L unit, container size, country of export, export date), with the reason and the evidence; the same proposal on several lines is one row; OCR documents still to verify; the invoice-number transformation | Confirm one row (one or all lines); *Confirm all listed suggestions…* (asks first; never includes conflicts or unverified OCR); approve the transformation with a note; undo |
| **B. Resolve conflicting or uncertain documents** | Each open conflict with the sources side by side (OCR confidence included), the explanation and the source values converted to the field's format (e.g. `1,888.00 KGS` → `1888`) | Choose a source value (needs a decision note first), type another value, record a decision, waive optional values with a note |
| **C. Supply broker / importer information** | Entry-number option and every broker-only field that is missing (importer, entry type and date, processing port, MIDs, …) | Type values; for line fields, *Use this value for all lines…* (asks first, for facts that are the same on every line); mark a field *Waiting for broker* (listed in the report; supplies nothing) |
| **D. Tariff classification and valuation** | Per line: the invoice's HS digits, printed amount and quantity as evidence; HTSUS number and value inputs; valuation issues (arithmetic, totals, assist, free-of-charge goods, CIF terms) | Type the broker's HTSUS number and value; record decisions |
| **E. Final XML validation** | Status, unresolved blockers, failed checks and XSD errors | Open the XML and report |

Recording a decision never fills a value: an issue is resolved only when every field it affects holds a confirmed value (or, where no field
is affected, when a note records the decision). Schema-required fields cannot be waived.

---

## Deliverables

| ID | Deliverable | Where |
|---|---|---|
| D1 | TypeScript frontend and backend, README | this repository (`web/`, `server/`, `shared/`) |
| D2 | XML generated for the sample shipment | [`output/sample/sample-entry-draft.xml`](output/sample/sample-entry-draft.xml) with [`sample-validation-report.md`](output/sample/sample-validation-report.md). `npm run sample` also writes the full machine-readable analysis to `output/sample/sample-analysis.json` (git-ignored, reproducible) |
| D3 | Complete AI chat history | exported separately from the Claude Code session (not generated by this code) |
| D4 | One-page approach write-up | [`docs/approach.md`](docs/approach.md) |

Supporting documents: [`docs/research-log.md`](docs/research-log.md) (NetCHB research, field mapping, issues C-1 to C-12) and
[`docs/test-report.md`](docs/test-report.md) (test results and the completed checklists).

**D2 is intentionally a draft marked `NOT READY TO FILE`.** It contains only values found consistently in the documents. Broker-only data
(importer tax ID, entry type and date, 10-digit HTSUS, MIDs, …) and every unresolved discrepancy are left out, marked in the XML with comments
naming the element and the field path (`MISSING` for required, conditional or broker-only elements; `WITHHELD` for elements held back by an
unresolved conflict or an unconfirmed proposal) and listed in the report's "Not written to the XML" section.

---

## Architecture

```
Browser (React + Vite)                          Express API (stateless, in-memory)
┌──────────────────────────────┐   PDFs   ┌──────────────────────────────────────────────────────┐
│ 1 Documents  (evidence view, │ ───────▶ │ extraction/  PDF text layer (pdf.js via unpdf), or   │
│   OCR review, manual entry)  │          │              local OCR (tesseract.js) + readers      │
│ 2 Review queue (A–E)         │  docs +  │ analysis/    context → rules → issues (with evidence)│
│ 3 All issues · 4 All fields  │  broker  │              fields: extracted / calculated /        │
│   (complete lists)           │  input   │              proposed / user-supplied / missing      │
│ 5 XML & report (download)    │ ───────▶ │ entry/       XML builder (schema order) + XSD check  │
└──────────────────────────────┘ ◀─────── │ analyze.ts   business-rule checks + readiness status │
                                  result  └──────────────────────────────────────────────────────┘
                 shared/ : TypeScript types + Zod schemas used by both sides
```

```
shared/src/            documents.ts (extraction contract), analysis.ts (issues, fields, broker input), netchb.ts (schema constraints)
server/src/extraction  pdfText.ts, ocr.ts, classify.ts, layout.ts, invoiceParser.ts, documentParsers.ts, transcription.ts
server/src/analysis    context.ts, rules.ts (all review rules), fields.ts (field catalogue + resolution)
server/src/entry       xmlBuilder.ts, xsdValidator.ts
server/src/            analyze.ts (pipeline), report.ts (Markdown report), app.ts (HTTP), reference.ts (ports, countries), iso6346.ts
server/schemas/netchb  entry.xsd, data_type.xsd (unmodified official copies, SOURCE.md with hashes), reference/entry_sample.xml
server/test/           tests (sample regression, synthetic unseen shipments, XML/XSD, API, workflow)
scripts/e2e/           api-e2e.mjs, browser-e2e.mjs (end-to-end checks against the running app)
fixtures/              reviewed transcriptions of the two scanned sample documents (D2 input; optional in the app)
web/src/               App.tsx, components/ (DocumentPanel, ReviewQueue, IssuesPanel, FieldsPanel, ResultPanel)
```

### Data model (the core idea)

- Every document value is a `SourceField`: `{ value (as printed), page, quote, note }`. Extraction **transcribes**; it never computes or corrects.
- Deterministic code parses numbers and dates, cross-checks documents, and creates **issues**. Each issue has a state, evidence from every
  source, an explanation, the required action, the fields it affects, and whether it blocks filing.
- Each NetCHB element the app can write is a **resolved field** with a provenance:
  `extracted` · `calculated` · `proposed (awaiting confirmation)` · `user/broker-supplied` · `confirmed proposal` · `approved transformation` ·
  `withheld` (the documents disagree or are uncertain) · `missing` (no document provides it). Only the first two and the user-confirmed ones
  are ever written to the XML. The original document values stay attached as evidence.
- Each issue also has a **resolution**, derived on the server from the user's decisions and the affected fields:

  | Resolution | Meaning | Blocks readiness? |
  |---|---|---|
  | Open | Not reviewed | Yes, if the issue is blocking |
  | Reviewed: confirmed values still needed | Acknowledged, but at least one affected field has no confirmed value. **Reviewing never confirms a value.** | Yes, if the issue is blocking |
  | Resolved | Acknowledged, and every affected field now holds a confirmed value (typed, or an approved proposal/transformation). A blocking issue that affects no entry field (e.g. an ambiguous date, an unread document) needs a non-empty resolution note instead | No |
  | Waived | Acknowledged with a note, and the user explicitly chose to leave the remaining values out. Allowed only when none of them is schema-required | No |

- Decisions are keyed by deterministic ids (document SHA-256, field paths, issue ids), so removing and re-adding a document, or re-running
  the analysis, keeps them; nothing accumulates across runs. Every result carries an **input fingerprint** (SHA-256 of documents +
  decisions) and server-computed **summary counts**, shown identically in the UI, the report and the XML header comment.
- Issue states use the approved wording: **Missing — broker input required**, **Conflicting source documents — confirmation required**,
  **Uncertain — confirmation required**, **Provisional — confirmation required**, **Confirmation required (transformation approval)**.

### Readiness status

`PASSES_LOCAL_CHECKS` only if **all** of the following hold. Otherwise the draft is `NOT_READY_TO_FILE`, and the label is written into the
XML file itself.

- the XSD validation ran and passed;
- every schema-required and documented conditional field is present and correctly formatted;
- every blocking issue is resolved or validly waived (acknowledging alone is not enough).

Even then, the label says "broker review still required; not NetCHB/CBP acceptance".

The report separates three different measures: **blocking issues** (cross-document findings that need a decision), **required/conditional
field checks** (entry fields the schema or NetCHB's documented rules require), and **XSD errors** (structural errors in this exact XML).
Each XSD error is traced to the missing fields that cause it; an error that cannot be traced is flagged as *unexplained* (a possible
generator defect). The builder also checks that every confirmed value really appears in the XML; if one does not, that is reported as a
generator defect and no XSD error is attributed to missing data. For the sample, all 10 XSD errors are traced to missing broker data.

---

## Extraction strategy (no paid API key; local OCR)

| Document kind | What happens |
|---|---|
| Invoice with a text layer | Text read locally with pdf.js, x/y positions kept. A deterministic parser recognises common labels (`Invoice No.:`, `Terms of Delivery:`, `Vessel / Voyage:`, …), party blocks and goods-table rows (read right-to-left: amount, price, unit, quantity, HS code). |
| Packing list / B/L with a text layer | Same text reading, then document-specific readers: label patterns (`P/L No.`, `TOTAL G.W.`, `SEAL`, `SCAC`, …) and column grids (`Ocean Vessel / Voy. No.`, `Port of Discharge`, …). |
| Scanned PDF (no text layer) | The page image is taken from the PDF (pdf.js), upscaled 2× when small, and read by **tesseract.js 7.0.0** (WebAssembly, English model from `@tesseract.js-data/eng`, loaded from `node_modules`: no download, no cache files). The OCR lines go through the same classifier and readers. Limits: one page at a time on one worker, at most 5 pages per document, 60 s per page. If OCR fails, the document is reported as **not read, with the reason**, never as an empty successful read. |
| Anything that cannot be read | Manual entry in the form. Saving or loading a transcription JSON is optional (for saving work or for tests); the normal workflow never needs it. A transcription is accepted only for the PDF whose SHA-256 it records. |

**OCR is not ground truth.** Every OCR value keeps its page, the OCR text it came from and the engine's confidence, and starts as
`unverified`. Readings below 50% confidence are not offered as values (the OCR text stays as evidence). A blocking `OCR_UNVERIFIED` issue per
scanned document keeps every entry field that rests on an unverified reading **withheld**, including proposals derived from it, until the
user confirms, corrects or rejects the reading. Cross-document comparisons still run on OCR readings and label them as OCR evidence, so
conflicts are visible immediately but nothing is resolved automatically. Handwriting, stamps and strike-throughs are not read reliably;
container readings from OCR are never classed as printed, handwritten or struck through.

**Measured on the sample scans** (OCR output compared with the manual transcriptions, `server/test/ocr.test.ts` pins this engine's output):

| Document | Fields read exactly | Read but wrong (all left unverified) | Not read |
|---|---|---|---|
| Packing list (≈140 dpi) | 16 of 18 | 0 | 2 (shipper below 50% confidence; shipping marks not parsed); the goods table is not read |
| Bill of lading (≈150 dpi) | 17 of 25 | 5: port of loading "…, WN" (VN), place of delivery "(DODR)" (DOOR), on-board date "24 SEP 206", HS codes and freight terms only partly | 3 (master B/L, notify party, marks); the struck-through container number was read as `BRLU3841728` at 0% confidence and not used; the handwritten correction is not read |

The invoice parser is proven on the sample's text layer and on one synthetic alternative layout; the packing-list and B/L readers on the
sample scans and one synthetic layout each. Other layouts may leave more fields empty: the user then enters them in the form.

**D2 is built from the reviewed values.** For the two scans these are the manual transcriptions in `fixtures/sample-transcriptions/`,
which stand for what a user has after confirming and correcting every OCR reading; this keeps the deliverable reproducible.

---

## Validation

- **XSD:** the official `entry.xsd` + `data_type.xsd`, **unmodified**, validated with libxml2 compiled to WebAssembly (`xmllint-wasm`), so it
  runs the same on Windows, macOS and Linux. `entry.xsd` imports `data_type.xsd` from an `https://` URL that WebAssembly cannot fetch, so a
  small wrapper schema of ours imports the local copy first (the spike is in `server/scripts/xsd-spike.mjs`). The same validator reproduces
  the research finding that NetCHB's own sample fails at line 758 (`dea-drug-code`).
- **Documented conditional rules** (NetCHB comments, RL-9; CBP, RL-10), checked in code: importer tax ID unless type 86; state of destination
  and mode of transport for formal entries (treated as applicable until the broker says otherwise); vessel, voyage, unlading port, country of
  export and lading port for ocean shipments; B/L number for vessel modes.
- **Format checks** on typed values, mirroring the schema patterns and enumerations, for early feedback.
- For `xsd:all` content, libxml2 reports only the **first** missing child of each element. The rule checks list every missing field.

### Review rules (generic, not tied to the sample)

Line arithmetic and invoice totals · invoice vs packing list quantity per style (and a blocking issue when the packing list has no rows to
compare, so the check is never skipped silently) · fibre-composition numbers · gross weight, package count,
volume, vessel and voyage across documents · packing-list internal sums · container numbers (corrections, ISO 6346 check digit) · assist
indicators (buyer-supplied materials, CMT) · no-commercial-value goods · CIF/CIP-type terms with freight or insurance · currency · line vs
document origin · importer and ultimate-consignee identity · invoice-number format · ambiguous dates · missing documents · documents not read
· 10-digit HTSUS and MID (broker input).

---

## Sample shipment results (D2)

All twelve issue groups recorded in the research log are detected automatically and kept unresolved:

| Research ID | Rule(s) | State |
|---|---|---|
| C-1 line 1 arithmetic / totals | `LINE_ARITHMETIC`, `INVOICE_TOTALS` | Conflicting source documents — confirmation required |
| C-2 hoodie quantity 1,200 vs 1,176 | `QUANTITY_MISMATCH` | Conflicting source documents — confirmation required |
| C-3 hoodie fibre 60/40 vs TC 65/35 | `FIBRE_MISMATCH` | Conflicting source documents — confirmation required |
| C-4 gross weight 1,888.00 vs 1,930.000 kg | `GROSS_WEIGHT_MISMATCH` | Conflicting source documents — confirmation required |
| C-5 container OPLU3041728 → OPLU3041722 | `CONTAINER_NUMBER` | Provisional — confirmation required |
| C-6 buyer-supplied fabric (assist) | `ASSIST_INDICATOR` | Missing — broker input required |
| C-7 sample origin Bangladesh vs Vietnam | `ORIGIN_CONFLICT` | Conflicting source documents — confirmation required |
| C-8 FOC samples, value "for customs" | `NO_COMMERCIAL_VALUE` | Missing — broker input required |
| C-9 importer / ultimate consignee | `PARTIES_UNRESOLVED` | Missing — broker input required |
| C-10 invoice number `KBAS/NB/26-0912` | `INVOICE_NUMBER_FORMAT` | Confirmation required (transformation approval) |
| C-11 invoice date 12/09/2026 | `AMBIGUOUS_DATE` | Uncertain — confirmation required |
| C-12 CIF freight and insurance | `CIF_DEDUCTIONS` | Missing — broker input required |

Also raised: `HTS_INCOMPLETE` and `MID_MISSING` (blocking), and `CARRIER_CODE_UNRESOLVED` (non-blocking).

**Proposals offered, not used until confirmed:** entry and unlading port 3002; state WA; B/L unit CTN; container OPLU3041722 and size 20 ft;
invoice number KBASNB26-0912; country of export VN; lading port 55224; export date 2026-09-24.

---

## Key decisions

| Decision | Why | Alternatives | Trade-off |
|---|---|---|---|
| Evidence on every value | Makes conflicts visible and every value auditable | Bare values | Larger data model |
| Extraction transcribes, code reasons | Repeatable, testable; the source is never "fixed" | Let a model infer or correct | More rule code |
| Text layer + local OCR, every OCR value verified by a person | Free, offline, no credentials; scans no longer need typing, and misreads cannot slip into the XML | Cloud OCR or vision model; manual entry only | About 46 MB of dependencies (engine + English model); a review step per scanned document |
| Official XSD via WebAssembly libxml2 | Objective check; no native build on Windows | Hand-written checks only; Java or native validators | One small dependency; public schema may lag production |
| Proposals need explicit confirmation | Port roles, units and export country are broker determinations | Auto-fill "likely" values | More clicks |
| Draft is always produced, clearly labelled | Shows progress and the exact gaps | Refuse to generate until complete | The draft must never be mistaken for a filing |
| Stateless server, nothing persisted | Simplest and safest for uploaded trade documents | Database or sessions | The review is kept in the browser's local storage (one browser, one user) |
| Reviewing ≠ confirming; waivers only for optional values, with a note | A blocker must not disappear because someone ticked a box | Treat acknowledgement as resolution | More explicit steps for the user |
| `<system-generated/>` is opt-in | Documented NetCHB option, but a broker workflow choice | Default it on | One extra choice for the user |

## Assumptions, limitations and unresolved items

- ❓ **NetCHB submission endpoint and authentication:** not available, so not implemented (RL-7). ❓ **Schema currency:** the public
  `entry.xsd` may differ from production (RL-5). ❓ **Unit of `<gross-weight>`:** not stated by the schema.
- ❓ **Which SCAC** belongs in `carrier-code` and `master-scac` is not inferred.
- 🔶 The Cat Lai → 55224 mapping is provisional (Schedule K lists Ho Chi Minh City only). The port table contains only the two researched codes.
- 🔶 Conditional "formal entry" rules are treated as applicable until the broker confirms otherwise.
- **Extraction:** the invoice, packing-list and B/L readers are proven on the sample layouts and one synthetic layout each; other layouts
  may need manual entry. OCR quality depends on the scan (the samples are ≈140–150 dpi); handwriting, stamps and strike-throughs are not
  read reliably, the packing list's goods table is not read by OCR (its OCR text drops style codes and quantities, so no row reader was
  built on it; the app reports the comparison as not performed), and a scanned invoice would go through the text parser on OCR text
  (not tested on a real scanned invoice). English model only.
- **Scope:** one bill of lading per entry; no `<foreign-currency>` element (non-USD invoices are flagged, never converted); no statistical
  quantities (`quantity1` / `unit-of-measure1`), duty, fees, PGA data, bond amount or other broker-only sections.
- Review rules are heuristics designed to **flag**, not decide. For example, "assist" indicators are keyword-based and fibre comparison
  checks only the percentages.
- The UI was checked with a scripted headless-Chrome run of the sample workflow (`npm run e2e:browser`) and by reviewing its screenshots.
  Headless Chrome does not render the PDF page preview, so the preview itself was not visually verified.
  There is no cross-browser, accessibility or visual-regression testing, and the browser script is not part of `npm test` (it needs the app running).

## Third-party and sample material

- **NetCHB schema files** (`server/schemas/netchb/entry.xsd`, `data_type.xsd`, `reference/entry_sample.xml`) are unmodified copies of files
  publicly served by NetCHB at the URLs listed, with SHA-256 hashes, in [`SOURCE.md`](server/schemas/netchb/SOURCE.md). NetCHB's website shows
  "© 2026 The Descartes Systems Group Inc". No licence or redistribution terms for these files were found, so **permission to redistribute
  them has not been confirmed**. They are included unchanged, solely for local validation, and will be removed on request. Without them, XSD
  validation cannot run (the app then says so) and the XSD-dependent tests fail (8 when measured on 2026-10-10).
- **Sample shipment documents** (`sample-docs/`) were supplied by Sefer for this assignment and are included for review of this private
  submission only. Their redistribution terms have not been confirmed, so they should not be republished. The transcriptions in
  `fixtures/sample-transcriptions/` reproduce their contents. The sample-based tests and `npm run sample` need both folders.

## Security and privacy

- No secrets are used in this build. `.env` files are git-ignored. Vite only exposes variables prefixed `SEFER_PUBLIC_`, and the production
  bundle was scanned for key or `process.env` references (none).
- Uploads are processed in memory and never written to disk by the server. The API logs no document content, and error responses do not
  echo internals.
- The browser keeps the current review (extracted document data, OCR text and decisions, not the PDFs) in its local storage until **Clear
  saved review** is used. On a shared computer, clear it after use.
- OCR runs on the local server; page images are processed in memory and nothing is sent to an external service.
- The servers bind to `127.0.0.1` by default.

## Dependencies (exact versions; each release at least two weeks old when installed)

Runtime: `express` 5.2.1, `multer` 2.4.0, `unpdf` 1.8.1 (pdf.js), `tesseract.js` 7.0.0 (Apache-2.0, with `tesseract.js-core` 7.0.0),
`@tesseract.js-data/eng` 1.0.0 (MIT package; model data from Google's tessdata, Apache-2.0), `xmlbuilder2` 4.0.3, `xmllint-wasm` 5.3.0,
`zod` 4.6.5, `react` / `react-dom` 19.3.0. The OCR packages were installed with `--ignore-scripts` (their only install script prints a
sponsorship message).
Development: `typescript` 6.0.3, `vite` 8.3.1, `@vitejs/plugin-react` 6.1.1, `vitest` 5.0.2, `tsx` 4.23.15, `supertest` 7.3.0, `concurrently` 10.0.5, type packages.
