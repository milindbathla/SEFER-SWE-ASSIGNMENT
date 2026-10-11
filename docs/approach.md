# Approach: evidence-first entry drafting

**Problem.** A broker turns an invoice, packing list and bill of lading into a CBP entry filed through NetCHB. The documents rarely
agree, and many values (classification, valuation, importer) are broker decisions. The tool must extract what the documents say, show
where they disagree, and produce NetCHB-shaped XML without inventing anything.

**Research first.** NetCHB publishes an entry schema (`entry.xsd` + `data_type.xsd`) and a sample. I vendored both schemas unmodified
(hash-checked); they define the required elements, formats and order. NetCHB's comments add conditional rules, and CBP sources supplied
codes (mode 11, Tacoma 3002, Schedule K 55224, provisional for Cat Lai) and valuation rules (19 U.S.C. §1401a). NetCHB's own sample fails its schema at one element
(`dea-drug-code`) and the upload endpoint is behind a login, so the integration is **not production-verified**: the app generates and validates XML for download
only, with no `<transmit/>`.

**Architecture.** React + Vite UI, stateless Express API, shared Zod schemas; all TypeScript.

**Extraction: transcribe, don't decide.** Every value is kept exactly as printed, with page and verbatim quote. The text-layer invoice
(pdf.js positions) is reproduced exactly, including the wrong amount `6,480.00`. Scans are read
by **local OCR** (tesseract.js, model installed with the app, no paid API). **OCR is a reading, not a fact**: each value keeps its
confidence and stays *unverified*, out of the XML behind a blocking issue, until a person confirms, corrects or rejects it. The ruled
packing-list table lost its number cells in OCR layout analysis, so it is read in a second pass with the ruling lines erased, and a row
counts only where cartons × pieces per carton = total pieces. On the sample scans: 16/18 packing-list fields, 5/5 goods rows (one style withheld)
and 17/25 B/L fields read correctly; misreads (e.g. "WN" for "VN") stay visible and unverified; handwriting is not read.

**Validation: deterministic and explainable.**

- **Generic review rules** (no sample values in code): arithmetic and totals, per-style quantity and fibre, weights, packages and vessel
  across documents, ISO 6346 check digits, assist / no-commercial-value / CIF indicators, origin, ambiguous dates, unread documents and
  broker-only data (HTSUS, MID, parties). Each issue carries evidence from every source, the required action and the fields it withholds.
  If the packing-list comparison cannot run, that is a blocking issue, never a silent skip.
- **The XML** holds only consistent extracted values, deterministic derivations and values the user typed or confirmed; proposals
  (e.g. port 3002) are never used silently.
- **Status** comes from libxml2 against the official XSD plus the conditional rules. It is `NOT_READY_TO_FILE` unless the XSD passes,
  required fields are present and every blocking issue is resolved (values confirmed, or a written decision) or, for optional values
  only, waived with a note. Reviewing an issue never confirms a value; even a pass reads "broker review still required". Every XSD error is
  traced to its fields; one summary and input fingerprint keep the UI, report and XML consistent.

**Guided review.** A queue groups the open work: suggestions, conflicts (choose a source value, with a note), broker data,
classification and valuation, validation. The XML is rebuilt and re-validated after every step.

**Trade-offs.** Local OCR with mandatory human verification instead of a cloud vision model (free, offline, unverified readings cannot reach the
XML, but every scan needs review). Conservative withholding (safer, more broker input). Scope fits the 24-hour budget: one B/L per entry, no
currency conversion, duty or PGA data. Drafts are labelled inside the file, so they are not mistaken for a filing.

**Results.** 153 automated tests (no credentials) plus 43 API and 58 headless-Chrome end-to-end checks on the real PDFs. A clean synthetic
shipment reaches `PASSES_LOCAL_CHECKS` with schema-valid XML. The sample draft (D2, made in the app from the three PDFs with recorded
review decisions) is honestly `NOT READY TO FILE`: 12 of 15 blocking issues unresolved, 7 XSD errors, all from missing data.

**Next steps.** NetCHB API access for production verification; more document layouts; handwriting; `<foreign-currency>`, multiple B/Ls.
