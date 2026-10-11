# prompt.md: Assignment Brief and Phase-Wise Workflow

This is the working brief for the Sefer SWE Intern take-home assignment. It defines **what** to build and **how** to proceed.
Working rules for the AI assistant are in [`CLAUDE.md`](./CLAUDE.md).

---

## 1. Assignment Context

Sefer turns raw shipping documents into US customs entries that are ready to file.

The assignment is to build a **simple web application** that accepts shipment documents and produces a **NetCHB-ready customs entry**, together with **missing information** and **recommended next steps**.

The application should:
- **Extract** relevant information from **commercial invoices**, **packing lists**, and **bills of lading**.
- **Identify** missing, conflicting, or uncertain values.
- **Generate** the appropriate entry **XML** based on **verified NetCHB requirements**.

### Sample shipment documents
https://drive.google.com/drive/folders/17tYnBbvy4qjzrn3773L6Kh_4yBjV1A7p?usp=drive_link

### Time budget
- Assignment deadline window: **48 hours**. Committed working time: **about 24 hours**.
- **Start:** [TO BE CONFIRMED]
- **Due:** 11 October 2026, 2:00 PM (confirmed by the user)
- **Time zone:** Asia/Kolkata (IST, UTC+05:30)
- The remaining unconfirmed value (Start) is filled in by the user from the original assignment instructions; it must not be invented or estimated.

#### Provisional allocation (~24 working hours)
| Phases | Scope | Hours |
|---|---|---|
| 1–4 | Access, research, shipment analysis, planning | 6 |
| 5 | Implementation | 11 |
| 6 | Testing | 4 |
| 7 | Final deliverables and review | 3 |
| | **Total** | **24** |

- These estimates are **flexible**. Verifying NetCHB requirements and producing a working, tested submission take priority over sticking rigidly to the allocation.
- **Flag schedule risks early:** as soon as a phase looks likely to overrun, tell the user and propose options (for example, reducing scope).

---

## 2. Requirements

| ID | Requirement |
|---|---|
| R1 | Web application with a **TypeScript frontend** and a **TypeScript backend** |
| R2 | Accept shipment documents as input (commercial invoice, packing list, bill of lading) |
| R3 | Extract the fields needed for a customs entry from those documents |
| R4 | Detect and report **missing** values |
| R5 | Detect and report **conflicting** values between documents |
| R6 | Detect and report **uncertain** values (ambiguous or low-confidence) |
| R7 | Generate entry XML that follows **verified** NetCHB requirements |
| R8 | Show **recommended next steps** for resolving each issue |
| R9 | Simple, clean, basic UI |
| R10 | Work correctly on the provided sample and be designed for unseen shipments |

---

## 3. Deliverables

| # | Deliverable | Notes |
|---|---|---|
| D1 | GitHub repository (TypeScript frontend + backend) with README | Published **only after explicit user approval** |
| D2 | XML generated for the provided sample shipment | Committed in the repository |
| D3 | Complete AI chat history | This conversation, preserved in full |
| D4 | One-page write-up explaining the approach | Concise; covers approach, decisions, limitations |

---

## 4. Ground Rule on Unverified Requirements

> **Any requirement, XML tag, schema rule, field definition, code list, or customs rule that has not been verified from reliable evidence must remain explicitly marked as UNRESOLVED. It must never be presented as fact.**

Every claim is labeled as one of: ✅ Verified Fact · 🔶 Assumption · ❓ Unresolved Question · 🛠️ Implementation Decision (definitions in `CLAUDE.md` §2.4).

---

## 5. Phase-Wise Workflow

Each phase ends with a short **phase report**: what was done, findings, open questions, and next step.

### Phase 1: Inspect the Environment and Obtain the Sample Documents
**Goal:** Know what tools are available and have the sample documents locally.
1. Confirm the project folder and installed tools (Node.js, npm, TypeScript, etc.).
2. Obtain the sample documents from the Google Drive link. If they cannot be downloaded automatically, ask the user to download them into a folder the user specifies.
3. List each document: file name, type (PDF, image, spreadsheet, etc.), page count, and whether its text can be selected or it needs OCR (optical character recognition).

**Output:** Environment summary and document inventory.

---

### Phase 2: Research Official NetCHB Documentation and Determine Verified XML Requirements
**Goal:** Know exactly what XML NetCHB expects, backed by evidence.
1. Search for official NetCHB documentation on XML entry import, schemas (XSD), and sample files.
2. Search for related official CBP references (for example, ACE / CATAIR entry data requirements, 19 CFR) that define the meaning of entry fields.
3. Record each finding in the **Research Log** (§7).
4. Produce a **Verified XML Requirements** list: element/field, meaning, required or optional, format, source.
5. List every requirement that could **not** be verified as ❓ Unresolved and propose how to resolve it (for example, ask Sefer for the NetCHB spec).

**Output:** Research Log + Verified XML Requirements + Unresolved list.

> ℹ️ There is **no approval gate after Phase 2**. Continue directly into Phase 3. Phase 2 and Phase 3 findings are presented together at **Checkpoint A**.

---

### Phase 3: Analyze the Shipment Documents and Map Source Fields to Required Entry Fields
**Goal:** Know where each required entry field comes from.
1. Read each sample document and record the values present, with document and location.
2. Build a **Field Mapping Table**:

| Entry Field | Source Document(s) | Source Location / Label | Extracted Value | Status (Found / Missing / Conflict / Uncertain) | Notes |
|---|---|---|---|---|---|

3. Identify conflicts between documents (for example, weight on the packing list vs. the B/L).
4. **Ask the user to confirm** any unclear, unreadable, or conflicting value. Never guess.
5. Note which fields can never come from these documents (for example, values a broker must supply) and how the app should handle them.

**Output:** Field Mapping Table + list of confirmations requested.

> 🛑 **CHECKPOINT A: Research Approval (End of Phase 3)**
> Present the Phase 2 and Phase 3 results together. **Do not proceed until the user explicitly approves the research.**

---

### Phase 4: Propose the Architecture, Extraction Approach, Validation Strategy, and Project Plan
**Goal:** Agree on a simple, defensible design that fits 24 hours.
1. **Architecture:** frontend, backend, data flow, folder structure (with a simple diagram).
2. **Extraction approach:** how text and fields are pulled from documents, with alternatives and trade-offs.
3. **Validation strategy:** how missing, conflicting, and uncertain values are detected; how XML is checked against verified requirements.
4. **Unseen shipments:** how the design generalizes beyond the sample.
5. **Project plan:** ordered tasks with time estimates, a minimum viable version first, and optional improvements after.
6. **Risks and mitigations.**
7. Each major decision explained as What / Why / Alternatives / Trade-offs.

**Output:** Architecture and Plan document.

> 🛑 **CHECKPOINT B: Plan Approval (Before Implementation)**
> **No implementation begins until the user explicitly approves this plan.**

---

### Phase 5: Implement the Approved Plan Incrementally
**Goal:** Build the approved plan in small, working steps.
1. Implement one task at a time in the approved order.
2. After each task, report what changed and how to run or check it.
3. Do not add unapproved features. If the plan needs to change, stop and ask.

> 🛑 **CHECKPOINT C: Git Initialization Approval**
> Ask before running `git init` or making any commits. The project folder currently sits inside a home-directory Git repository; a separate project repository must be approved first.

---

### Phase 6: Test Extraction, Missing/Conflicting Information Handling, and XML Validity
**Goal:** Prove it works and be honest about limits.
1. Run extraction on the sample shipment and compare results against the confirmed Field Mapping Table.
2. Test missing, conflicting, and uncertain cases (including modified or synthetic test inputs).
3. Validate the generated XML against the verified requirements (and the schema, if available).
4. Complete the **Extraction Validation Checklist** (§8).
5. Record known limitations.

**Output:** Test report + completed checklist.

---

### Phase 7: Generate Sample Shipment XML and Prepare README, Write-Up, and Submission Checklist
**Goal:** Package everything for submission.
1. Generate the final XML for the sample shipment and save it in the repository.
2. Write the README (setup, run, usage, structure, limitations).
3. Write the one-page approach write-up.
4. Complete the **Final Deliverables Checklist** (§9).

> 🛑 **CHECKPOINT D: GitHub Publication Approval**
> **No GitHub repository creation, push, or publication without the user's explicit approval.**

---

## 6. Approval Checkpoints Summary

| Checkpoint | Gate | When |
|---|---|---|
| **A** | Research approval (NetCHB requirements, field mapping) | End of Phase 3 |
| **B** | Plan approval (architecture and project plan) | End of Phase 4, before implementation |
| **C** | Git initialization approval | Before running `git init` or any commit |
| **D** | GitHub publication approval | Before creating a remote repository, pushing, or publishing |
| **Ongoing** | Confirmation of unclear shipment values | Whenever one is found |

---

## 7. Research Log Format

Record every research finding as an entry in this format:

```markdown
### RL-<number>: <Short title>
- **Date:** YYYY-MM-DD
- **Question:** What are we trying to find out?
- **Source:** Name, URL / document, section or page, access date
- **Source Tier:** Tier 1 (Authoritative) / Tier 2 (Supporting) / Tier 3 (Unverified)
- **Evidence:** Exact quote, excerpt, or precise description of what the source says
- **Conclusion:** What we conclude, labeled ✅ Verified Fact / 🔶 Assumption / ❓ Unresolved
- **Remaining Uncertainty:** What is still unknown, and how it could be resolved
```

Rules:
- One question per entry.
- Tier 3 sources can never produce a ✅ Verified Fact.
- If no reliable source is found, record that as the result and keep the item ❓ Unresolved.

---

## 8. Extraction Validation Checklist

Use for the sample shipment and for every test shipment.

**Document handling**
- [ ] Every uploaded document is identified correctly (invoice / packing list / B/L / unknown)
- [ ] Text is read completely (no missing pages or truncated content)
- [ ] Unreadable or unsupported files produce a clear error message

**Field extraction**
- [ ] Every required entry field (from the verified requirements) is either extracted or flagged as missing
- [ ] Each extracted value records its source document and location
- [ ] Extracted values match the confirmed values in the Field Mapping Table
- [ ] Numbers keep their units and currency (no silent conversion)
- [ ] Dates are parsed correctly and in an unambiguous format
- [ ] Multi-line-item invoices produce the correct number of line items
- [ ] Line-item totals reconcile with the invoice total (or a mismatch is flagged)

**Issue detection**
- [ ] Missing values are flagged with a recommended next step
- [ ] Conflicts between documents show all conflicting values and their sources
- [ ] Uncertain values are flagged and are not silently treated as confirmed
- [ ] No value is invented or defaulted without being visibly flagged

**XML output**
- [ ] XML is well-formed
- [ ] Only verified elements and structure are used
- [ ] XML validates against the official schema (if obtained)
- [ ] Unresolved fields are handled as agreed in the plan (not filled with guesses)
- [ ] Special characters are escaped correctly

**Generalization**
- [ ] Tested with at least one shipment variation beyond the sample
- [ ] No logic is hard-coded to the sample's specific values or layout

---

## 9. Final Deliverables Checklist

**Repository (D1)**
- [ ] TypeScript frontend works
- [ ] TypeScript backend works
- [ ] README covers: overview, setup, how to run, how to use, project structure, assumptions, limitations, unresolved items
- [ ] No secrets, API keys, or personal files committed
- [ ] User approved Git initialization (Checkpoint C)
- [ ] User approved GitHub publication (Checkpoint D)

**Sample XML (D2)**
- [ ] XML generated by the application from the sample shipment
- [ ] Saved in the repository at a clearly named path
- [ ] Accompanied by the list of missing / conflicting / uncertain items for the sample

**AI chat history (D3)**
- [ ] Complete conversation preserved; nothing cleared or replaced
- [ ] Exported in the format the submission requires

**One-page write-up (D4)**
- [ ] Explains the problem and approach
- [ ] Explains key technical decisions and trade-offs
- [ ] States verified facts vs. assumptions vs. unresolved questions
- [ ] Lists limitations and next steps
- [ ] Fits on one page

**Final review**
- [ ] All Research Log entries complete
- [ ] Extraction Validation Checklist complete
- [ ] All unresolved items clearly listed (not presented as facts)
- [ ] Submitted within the 48-hour window
