# Approach: evidence-first entry drafting

**Problem.** A customs broker turns an invoice, a packing list and a bill of lading into a CBP entry, filed through software such as
NetCHB. The documents rarely agree perfectly, and many entry values (classification, valuation, importer identity, bond) are broker
decisions, not facts on paper. A useful tool must therefore extract what the documents say, show where they disagree, and produce
NetCHB-shaped XML without inventing anything.

**Research first.** NetCHB publishes an entry schema (`entry.xsd` + `data_type.xsd`) and a sample. I vendored both schemas unmodified and
verified them by hash. They define the required elements, formats and ordering. NetCHB's comments add conditional rules (e.g. vessel and
voyage for ocean shipments), and CBP sources supplied codes (mode 11, Tacoma 3002, Schedule K 55224) and valuation rules (19 U.S.C. §1401a).
NetCHB's own sample fails its own schema, and the upload endpoint is behind a login. The integration is therefore **not production-verified**,
and the app only generates and validates XML for download, with no `<transmit/>`.

**Architecture.** A TypeScript npm workspace:

- **React + Vite UI**: documents, a guided review queue, full issue and field lists, XML/report.
- **Stateless Express API**: documents are processed in memory and nothing is persisted.
- **Shared Zod schemas**, so the browser and the server validate the same contracts. Malformed extraction data is rejected with field paths.

**Extraction: transcribe, don't decide.** Every value is stored exactly as printed, with page and verbatim quote. For the text-layer
invoice, pdf.js positions are used to rebuild rows; a label-based parser reads header fields and party blocks, and goods rows are read
right-to-left (amount, price, unit, quantity, HS code). On the sample it reproduces every field and line exactly, including the wrong
amount `6,480.00`. Scanned pages are read by **local OCR** (tesseract.js in WebAssembly, English model installed with the app, no runtime
download, no paid API) and then by label- and column-aware readers for packing lists and bills of lading. **OCR is treated as a reading,
not a fact**: each value keeps its OCR text and confidence and stays *unverified* (and out of the XML, behind a blocking issue) until a
person confirms, corrects or rejects it. On the sample scans OCR read 16 of 18 packing-list and 17 of 25 B/L fields exactly; the five B/L
misreads (e.g. "WN" for "VN") stay visible as unverified, and the handwritten container correction is not read. Users upload PDFs only;
transcription JSON is optional. D2 uses the reviewed transcriptions, i.e. the values after human verification.

**Validation: deterministic and explainable.**

- **Review rules** are generic (no sample values in the code). They cover: arithmetic and totals; per-style quantities; fibre percentages;
  weights, packages, vessel and voyage across documents; ISO 6346 container check digits; assist, no-commercial-value and CIF indicators;
  line vs document origin; invoice-number pattern; ambiguous dates; missing or unread documents; and broker-only data (10-digit HTSUS, MID, parties).
- **Each issue** carries the approved state, evidence from every source, the required action and the fields it withholds.
- **The XML** contains only consistent extracted values, deterministic derivations (mode 11), and values the user typed or explicitly
  confirmed. Proposals (e.g. port 3002, invoice number `KBASNB26-0912`) are never used silently.
- **Validation** combines libxml2 (WebAssembly, so it runs on Windows) against the official XSD with the documented conditional rules.
  The status is `NOT_READY_TO_FILE` unless the XSD passes, every required or conditional field is present, and every blocking issue is
  **resolved** (its affected values confirmed, or a written decision where no entry field is affected) or explicitly **waived** with a
  note (optional values only). Reviewing an issue never confirms a value. Even then, it reads "passes local checks: broker review still required". Every XSD error is traced to the fields
  that cause it, and one shared summary plus an input fingerprint keep the UI, report and XML consistent.

**Key trade-offs.**

- Local OCR plus mandatory human verification instead of a cloud vision model: free and offline, misreads cannot reach the XML, but each scan needs a review step and OCR quality depends on the scan.
- Conservative withholding: line values stay blank while totals disagree. That is safer, but it needs more broker input.
- One B/L per entry, no currency conversion, no duty, fee or PGA data: scope kept to the 24-hour budget.
- A full draft is always produced, but it is labelled inside the file itself, so it cannot be mistaken for a filing.

**Guided review.** A queue groups the open work: (A) suggestions (one action for the same suggestion on five lines), (B) conflicts,
resolved by choosing a source value with a decision note, (C) broker data, (D) classification and valuation, (E) validation. It only
writes the existing decisions, so the server re-validates and rebuilds the XML after every step. A check that cannot run (OCR misses the
packing-list goods table) becomes a blocking issue, never a silent skip.

**Results.**

- 134 automated tests (no credentials): schemas, text and OCR extraction, the twelve sample issue groups, confirmation and resolution
  rules, review-queue choices, XML/XSD, API failures and synthetic unseen shipments. End-to-end: 43 API checks and 55 checks in a real
  headless Chrome (PDF-only upload with OCR, OCR review, review queue, issues, waiver, downloads, reload, errors).
- Audits fixed real gaps, e.g. acknowledging every issue had let the sample "pass" with unconfirmed values, and the quantity check was
  silently skipped when OCR left the packing list without rows.
- The clean synthetic shipment reaches `PASSES_LOCAL_CHECKS` with a schema-valid XML once broker input is complete.
- The sample draft (D2) is honestly `NOT READY TO FILE`: 16 issues (15 blocking) and 10 XSD errors, all caused by missing broker data.

**Limitations and next steps.**

- Production verification needs NetCHB API documentation and credentials.
- Read the packing-list goods table from OCR (column detection), and handle handwriting (e.g. a vision model whose output is still verified).
- Broader invoice-layout support.
- `<foreign-currency>`, statistical quantities and multiple B/Ls.
- Run the browser checks in CI, and add cross-browser and accessibility testing.
