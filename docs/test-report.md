# Test report (Phase 6)

- **Date:** 2026-10-10/11 (final runs 2026-10-11, after the review queue was added; times below are IST)
- **Environment:** Windows 11, Node 24.18.0, npm 11.16.0
- **Credentials:** none (all tests run offline; no paid APIs; OCR is local with its model installed by npm)

## Commands and actual results

| Command | Result |
|---|---|
| `npm test` (`vitest run`) | **11 files, 134 tests passed, 0 failed** (includes real OCR of the two sample scans; baseline before this phase: 10 files, 125 passed) |
| `npm run typecheck` | exit 0 (shared source, shared tests, server, web; 02:17 IST). See the correction note below |
| `npm run build` | Vite production build succeeded (JS 348 kB, 105 kB gzip; 02:17 IST) |
| `npm run e2e:api` (against `npm start` on :3001) | **43/43 passed**: scans read by OCR with every reading unverified; unverified OCR blocks readiness and stays out of the XML; then the optional reviewed transcriptions; summary/fingerprint/report consistency, XSD errors traced, withheld vs missing vs proposed, reviewed conflicts stay blocking; upload, classification, evidence, transcription binding (409 on wrong PDF), C-1 … C-12, proposals and approvals, acknowledgements never fill values, format errors, committed D2 = live output, API error paths |
| `npm run e2e:browser` | **55/55 passed** in real headless Chrome, **PDFs only, no JSON** (14 new review-queue checks: sections A–E; one action confirms a suggestion on 5 lines; source choices disabled until a note is written; choosing a value resolves exactly that issue and reaches the XML; the unread packing-list table is a blocking item; a recorded decision without a value keeps a valuation issue blocking; no waiver for schema-required values; one action applies a typed MID to 5 lines; reload restores and re-analyses the queue decisions; the draft stays NOT READY): the 3 PDFs are read in ≈6.3 s (2 by OCR); OCR progress message; readings shown unverified with confidence; page preview toggle; downloads disabled while OCR is unverified; correct / reject / confirm / confirm-all; OCR issues disappear and verified values reach the XML; reviewing keeps a conflict blocking, waiver disabled until a note is written, waiver closes it, report fingerprint = screen, reload restores the review, clear removes it; upload via the file input, transcription import, issue cards and acknowledgement, invoice-number approval, XML tab, all three downloads, non-PDF and duplicate uploads, no console errors |
| `npm run sample` (D2; regenerated in the review-queue phase. The XML body is identical to the previous D2: only the input fingerprint and timestamp changed, because the transcription note was reworded. The report now also lists each conflict's source values as choices) | `NOT_READY_TO_FILE`; 16 issues, 15/15 blocking unresolved; 32 of 41 field checks failed; XSD ran, invalid, 10 errors, all traced to missing data; C-1 … C-12 all detected. Regenerated 2026-10-11 after the audit fixes: compared with the previous D2, no element or value changed, only comments |
| `node server/scripts/xsd-spike.mjs` | A–C fail as expected (https import / no catalog support). D1 valid; D2 exactly 3 expected errors; D3 official sample fails at line 758 `dea-drug-code` |
| Manual API smoke test (`npm start` + curl) | Health OK; 3 PDFs classified; non-PDF rejected per file; malformed JSON/body → 400; wrong transcription → 409; full analysis 200 |
| Dev-mode check (`npm run dev -w server` and `npm run dev -w web`) | UI served on :5173; `/api/health` 200 directly and through the Vite proxy |

During development, one test failed on first run and was fixed in the code: the `MISSING` comment for `<entry-no>` contained the literal
text `<system-generated/>`. It now reads "system-generated option".

**Correction (re-run at Checkpoint C, 2026-10-10).** An earlier version of this report said `npm run typecheck` exited 0. That was
wrong for the code at the time: the re-run exited **2**. The errors were all in test code (application source type-checked cleanly). Vitest
does not type-check, so all 91 tests still passed.

- `shared/test/schemas.test.ts` uses Node APIs, but `shared/tsconfig.json` loads no Node types. Fix: `shared/tsconfig.json` now covers
  `src` only, so browser-facing shared code still cannot use Node APIs. The new `shared/tsconfig.test.json` (with Node types) covers
  the tests, and the `typecheck` script runs both.
- `server/test/helpers.ts`: the `doc()` helper's `opts` type combined the document's own `lines` field with the helper's plain-string
  `lines`. Fix: `lines` is now left out of the inherited part of the type. Runtime behaviour is unchanged.

After the fix, `npm run typecheck` exited 0, `npm test` passed 91/91 and `npm run build` succeeded. No application code, shipment values,
XML rules or sample output changed.

**End-to-end session (2026-10-10 evening).** Running the app and driving it through the API and a real browser found four defects. All
are fixed, and the first three have regression tests:

| Defect | Fix | Test |
|---|---|---|
| Optional values withheld by an unresolved issue (gross weight C-4, container number C-5, hoodie quantity C-2, MIDs, SCACs) were omitted from the XML without a marker, although the README promised every gap is marked | XML builder adds `WITHHELD (unresolved issue)` comments; values, status and XSD result unchanged; D2 regenerated (only these 10 comments differ) | `sample.test.ts` |
| Upload limits returned raw codes (`Upload rejected (LIMIT_FILE_COUNT)`) | Plain-language messages for too many files and a wrong form field | `api.test.ts` |
| Unknown `/api/*` routes returned an HTML 404 page | JSON `404 {"error":"Unknown API endpoint."}` | `api.test.ts` |
| The same PDF selected twice in one upload was added twice (only earlier uploads were de-duplicated); a missing favicon logged a browser 404 | De-duplicate within the selection by SHA-256 id; empty inline favicon | `e2e:browser` |

**Audit and correctness fixes (2026-10-11).** Each item was reproduced before it was fixed; regression tests are listed.

| # | Severity | Defect (reproduced) | Root cause | Fix | Test |
|---|---|---|---|---|---|
| D-1 | High | With every issue acknowledged and the required values typed, the sample reached `PASSES_LOCAL_CHECKS` although gross weight (C-4), container number (C-5), MIDs and the ultimate consignee's tax ID were never confirmed | Readiness counted an acknowledged blocking issue as closed | Issue resolution derived on the server: open / reviewed-pending / resolved / waived. Waivers need a note and only cover optional values | `resolution.test.ts`, `e2e:api`, `e2e:browser` |
| D-2 | High (UX) | A browser refresh lost all documents and decisions | State only in React memory | Autosave to local storage, validated restore, "Clear saved review" | `e2e:browser` (reload, clear) |
| D-3 | Medium | Downloads could come from a result older than the latest change | No pending state | "Updating…" state; downloads disabled until current | Code review; `e2e:browser` downloads |
| D-4 | Medium | Nothing tied the UI, report and XML to one input state; counts were computed in several places | No shared summary or fingerprint | Server-side `summary` + `inputFingerprint` in the result, report and XML header | `resolution.test.ts`, both E2E |
| D-5 | Medium | XSD errors were not linked to responsible fields | Raw messages only | Errors traced through field-path markers; untraceable ones flagged "unexplained" | `resolution.test.ts` |
| D-6 | Medium | A value held back by a conflict looked the same as one no document provides | Single `missing` provenance | New `withheld` provenance | `resolution.test.ts`, `e2e:api` |
| D-7 | Low | C-12 arithmetic not checked; C-6 stated value only in the evidence quote | Not implemented | Goods + freight + insurance vs printed total; stated value quoted as printed; nothing adjusted | `resolution.test.ts` |
| D-8 | Low | Report did not list what was left out of the XML, or why | — | "Not written to the XML" section (withheld / proposals / missing) | Report review |

Two existing tests changed **because the semantics were corrected, not to make them pass**. The clean synthetic shipment's "complete"
broker input now also supplies the ultimate consignee's tax ID; without it the importer/consignee issue correctly stays pending. The
XML-marker assertions now check the more precise comments, which include the field path. No assertion was removed or loosened.

**Final independent audit (2026-10-11).** Probes of the highest-risk logic found four more defects, each fixed with a regression test:

| # | Severity | Defect (reproduced) | Fix | Test |
|---|---|---|---|---|
| A-1 | High | A blocking issue that affects no entry field (C-11 ambiguous date; an unread scan) was "resolved" by an acknowledgement with an empty note | Such issues need a non-empty resolution note; the UI shows that next step | `resolution.test.ts` |
| A-2 | Medium | If the builder dropped a required element that had a value, next to a genuine gap in the same element, the XSD error was labelled `missing_data`, hiding the bug | Builder self-check: every confirmed value must appear in the XML; otherwise a generator-defect reason is raised and no XSD error is attributed to missing data | `resolution.test.ts` |
| A-3 | Low | The CIF arithmetic check was silently skipped for amounts such as `USD 3,850.00` or `23.235,00`, and would have summed negative or bracketed amounts | The explanation states that the check was not made and why; no format or sign is guessed | `resolution.test.ts` |
| A-4 | Low | The "out of date" flag was set in an effect, after paint, so for one frame an older result had enabled downloads | Each result records the inputs it was computed for; staleness is checked during render | `e2e:browser` (downloads), code review |

Also checked and found correct: older asynchronous responses are discarded (request counter); restore validates the saved data against the
API request schema and "Clear saved review" removes it (browser test); the committed D2 XML and report are identical to the current
generator output (timestamps aside); no secrets, machine paths (other than in the protected `CLAUDE.md`) or external network calls in the
application; server logs record only error types.

**OCR workflow (2026-10-11).** Scanned PDFs are now read by local OCR (tesseract.js 7.0.0, approved by the user); see the README for the
design. Measured on the sample scans against the manual transcriptions: packing list 16/18 fields exact, B/L 17/25 exact, 5 misread (kept
unverified), 3 not read; the goods table of the packing list and the handwritten container correction are not read. Defects found and fixed
while testing it, each with a test:

| Defect | Fix | Test |
|---|---|---|
| The sample loader applied the reviewed transcriptions only to "unavailable" documents, so after OCR the sample tests ran on raw OCR | The loader skips OCR where a reviewed transcription exists (D2 stays reproducible) | `sample.test.ts` (all green again) |
| The container-number pattern also matched B/L numbers of the same length | Pattern requires the ISO 6346 equipment-category letter (U, J or Z) | `ocr.test.ts` (synthetic B/L) |
| Page previews were never created: the upload handler read the file list after the input had been reset | Copy the list first | `e2e:browser` (previews) |
| A low-confidence reading that was deliberately not used was labelled "unverified" | Labelled "not used (low confidence)" | `e2e:browser` |
| The page preview beside the table squeezed the OCR-text column into very tall rows | Preview is a toggle; long OCR quotes are clipped (full text on hover and in the OCR-text list) | Screenshot review |

Expectations changed **because behaviour changed, not to make tests pass**: "scans are not read" became "scans are read by OCR" (the
not-read path is still tested with OCR switched off); the schema test's example of an invalid method changed from `ocr` (now valid) to
`vision`; the health endpoint now reports `ocr: true`. No safety assertion was removed or loosened.

**Review-queue phase (2026-10-11).** Defects found while driving the three real PDFs through the new queue, each fixed with a test:

| Defect | Fix | Test |
|---|---|---|
| With the PDF-only workflow the packing list has no goods rows (OCR does not read the table), and the quantity and fibre comparison was **skipped silently**: C-2 and C-3 simply did not appear | New blocking issue `PACKING_LIST_ROWS_NOT_READ`: "Invoice lines could not be compared with the packing list", resolved by entering the rows (the checks then run) or by a recorded decision | `queue.test.ts`, `ocr.test.ts`, `e2e:browser` |
| A container number OCR could not read was described as `null (unknown): not a well-formed ISO 6346 number` | Described as "no reliable reading (source text: …)" | `ocr.test.ts` |
| The upload hint still said scanned PDFs "cannot be read automatically in this build" | Text updated to the OCR workflow | `e2e:browser` (visual) |
| The sample transcriptions' note said "no OCR/vision configured", which became untrue when OCR was added (it appeared in the D2 report) | Note reworded: typed by hand before OCR existed; they stand in for verified OCR readings. Values unchanged; D2 XML body unchanged | `e2e:api` (D2 comparison) |

No safety assertion was removed or loosened. The e2e step that expected a quantity conflict on the PDF-only path was replaced, because on
that path the conflict cannot be detected; the new step checks that this is reported as a blocking item instead.

## Test files

| File | Tests | Covers |
|---|---|---|
| `shared/test/schemas.test.ts` | 15 | Zod contracts; rejects malformed extraction data and unknown keys; null vs genuine zero; schema patterns |
| `server/test/normalize.test.ts` | 14 | Number, date, composition parsing; ambiguous dates; ISO 6346 (standard example + sample); reference tables |
| `server/test/extraction.test.ts` | 14 | Text-layer extraction of the sample invoice (exact values); scans → not read; invalid files; classification; parser on a synthetic alternative layout; transcription hash guard |
| `server/test/ocr.test.ts` | 15 | OCR of both sample scans (local model path; type from OCR text; values, page, quote, confidence; all unverified; low-confidence reading withheld; misreads kept as read; container never read as certain); OCR_UNVERIFIED blocks and withholds; acknowledging does not verify; confirm/correct/reject re-evaluate; all verified → issue gone; OCR failure reported as not read; packing-list and B/L readers on a synthetic layout |
| `server/test/queue.test.ts` | 8 | Source values offered as choices in the field's format (gross weight, quantity, line amount, origin, container with a warning on the struck-through number); none applied; choosing with a note resolves exactly that issue and reaches the XML; a value without a decision leaves the conflict open; a decision without a value keeps a valuation issue blocking and cannot waive a schema-required value; one action confirming a suggestion on 5 lines changes only those fields; broker to-do marks appear in the report and change nothing else; the packing-list comparison is never skipped silently |
| `server/test/resolution.test.ts` | 15 | Acknowledging is not confirming (D-1 regression); typed values resolve; waivers need a note and only cover optional values; pass only after resolve/waive; withheld vs missing vs proposed; identical results for identical input; fingerprint; summary = issues/checks/XSD and = report; every XSD error traced; CIF arithmetic; stated assist value |
| `server/test/sample.test.ts` | 17 | Regression for C-1 … C-12 with the approved states; nothing withheld is written, and withheld values are marked in the XML; source documents unchanged; NOT READY status |
| `server/test/workflow.test.ts` | 7 | Invoice-number transformation needs approval; proposals are per field; typed values and format errors; acknowledging never fills values; entry-number options |
| `server/test/xml.test.ts` | 8 | Element order; escaping; well-formed comments; no placeholders; no `<transmit/>`; XSD positive/negative; official sample failure (RL-5); schema hashes |
| `server/test/unseen.test.ts` | 11 | Synthetic shipments: a clean one (reaches `PASSES_LOCAL_CHECKS`), missing documents/fields, no documents, an unread scan, EUR, two invoices, an extra line, a bad check digit, conflicting vessel names and package counts |
| `server/test/api.test.ts` | 10 | Upload, per-file errors, no files, 413 size limit, plain-language limit messages, JSON 404, 400 malformed/invalid JSON, analysis + report |

## Extraction Validation Checklist (prompt.md §8): sample shipment

**Document handling**
- [x] Every uploaded document is identified correctly. The invoice is recognised by its content. The two scans are guessed from their file names, and the UI asks the user to confirm.
- [x] Text is read completely: both invoice pages and all 5 lines. The scans have no text layer, which is reported, not hidden.
- [x] Unreadable or unsupported files produce a clear error message (non-PDF, empty, corrupt, over 20 MB).

**Field extraction**
- [x] Every required entry field is either extracted or flagged as missing: rule checks plus `MISSING` comments in the XML.
- [x] Each extracted value records its source document, page and quote.
- [x] Extracted invoice values match the confirmed Field Mapping Table. ⚠️ The scanned documents' values come from **manual transcription**, not automatic extraction.
- [x] Numbers keep their units and currency. Nothing is converted; non-USD invoices are flagged.
- [x] Dates are parsed only when unambiguous; `12/09/2026` is flagged with both readings.
- [x] Multi-line invoices produce the correct number of line items (5).
- [x] Line-item totals reconcile with the invoice total, or the mismatch is flagged (C-1).

**Issue detection**
- [x] Missing values are flagged with a recommended next step.
- [x] Conflicts show every conflicting value and its source.
- [x] Uncertain values are flagged and never treated as confirmed.
- [x] No value is invented or defaulted without being visibly flagged; proposals require explicit confirmation.

**XML output**
- [x] XML is well-formed (parsed by libxml2 in every test).
- [x] Only elements from the verified schema are used.
- [x] XML is validated against the official schema. The sample draft fails only on missing broker data; a complete synthetic entry passes.
- [x] Unresolved fields are left out and marked, never filled with guesses.
- [x] Special characters are escaped correctly, and comments are kept well-formed.

**Generalization**
- [x] Tested with several shipment variations beyond the sample (synthetic fixtures).
- [x] No logic is hard-coded to the sample's values or layout. The sample-specific C-1 … C-12 mapping lives only in `server/src/sample.ts`, which is used for the report and the regression test.

## Known limitations found in testing

- The invoice parser is proven on the sample layout and on one synthetic alternative layout only. Unfamiliar layouts may need manual entry.
- No OCR or vision extraction. Scanned documents always require manual entry or a transcription file.
- For `xsd:all` content, libxml2 reports only the first missing child of each element. The rule checks list every missing field.
- The UI was verified by a scripted headless-Chrome run (`npm run e2e:browser`, 55 checks) and screenshot review. Headless Chrome does not
  render the PDF page preview (the frame is blank), so the preview's appearance was not verified. It is not part of `npm test`
  (it needs the running app), and there is no cross-browser, accessibility or visual-regression testing.
- Local validation is structural only. NetCHB or CBP acceptance is untested (endpoint and authentication unavailable).
