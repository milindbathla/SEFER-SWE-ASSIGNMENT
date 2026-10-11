# CLAUDE.md: Project Guide for the AI Assistant

This file tells the AI assistant (Claude) how to work on this project. Read it before every working session.
The phase-by-phase workflow, research log format, and checklists are in [`prompt.md`](./prompt.md).

---

## 1. Project Overview (Beginner-Friendly)

### What is Sefer?
Sefer turns raw shipping documents into US customs entries that are ready to file.

### The problem, in plain language
When goods are imported into the United States, a **customs broker** files an **entry** with U.S. Customs and Border Protection (CBP). The entry describes what is being imported, who is importing it, where it came from, how much it is worth, and how it is classified.

The information for an entry is spread across several shipping documents:

| Document | What it usually contains (in general terms) |
|---|---|
| **Commercial Invoice** | Seller, buyer, item descriptions, quantities, prices, currency, country of origin |
| **Packing List** | Packages, weights, dimensions, how goods are packed |
| **Bill of Lading (B/L)** | Carrier, vessel/voyage, ports of loading and discharge, shipper, consignee, container details |

**NetCHB** is customs brokerage software that brokers use to prepare and transmit entries to CBP. Our application should produce XML that NetCHB will accept.

> 🔶 **Assumption (from the assignment brief):** NetCHB accepts entry data as **XML**. This is pending verification against official NetCHB documentation in Phase 2 and must not be treated as a verified fact until then.

> The table above is a general description only. The actual fields in the sample shipment must be confirmed in Phase 3 by reading the documents. Nothing in it is a verified fact about the samples.

### What we are building
A **simple web application** that:
1. Accepts shipment documents (commercial invoice, packing list, bill of lading).
2. Extracts the relevant information from them.
3. Flags **missing**, **conflicting**, or **uncertain** values.
4. Generates a **NetCHB-ready customs entry in XML**, based only on verified NetCHB requirements.
5. Shows the user the missing information and recommended next steps.

### Sample shipment documents
https://drive.google.com/drive/folders/17tYnBbvy4qjzrn3773L6Kh_4yBjV1A7p?usp=drive_link

### Deliverables
| ID | Deliverable |
|---|---|
| **D1** | A **GitHub repository** with a **TypeScript frontend and backend**, plus a **README** |
| **D2** | The **XML generated** for the provided sample shipment |
| **D3** | The **complete AI chat history** (this conversation) |
| **D4** | A **one-page write-up** explaining the approach |

### Time budget
- Assignment deadline window: **48 hours**. Committed working time: **about 24 hours**.
- **Start:** [TO BE CONFIRMED]
- **Due:** 11 October 2026, 2:00 PM (confirmed by the user)
- **Time zone:** Asia/Kolkata (IST, UTC+05:30)
- Do not invent or estimate the remaining unconfirmed value (Start). The user will fill it in from the original assignment instructions.
- Every plan must fit inside this budget. Choose the simplest approach that meets the requirements.

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

## 2. Golden Rules (Non-Negotiable)

### 2.1 Approval gates
- **No implementation or code** until the user has explicitly approved the research findings (**Checkpoint A**) and the proposed plan (**Checkpoint B**).
- **No Git actions without explicit approval.** Do not initialize Git or commit until **Checkpoint C**. Do not create a GitHub repository, push, or publish code anywhere until **Checkpoint D**.
- Approval for one action does not carry over to another. Ask again at each gate.

### 2.2 No invention
Never invent or guess any of the following:
- XML tags, element names, attributes, namespaces, or schemas
- API endpoints or integration methods
- Customs rules, field requirements, code lists, or validation logic
- Values extracted from shipment documents
- Capabilities of NetCHB, CBP systems, or any library or tool

If something cannot be verified from reliable evidence, it must stay **explicitly unresolved**. Do not present it as fact.

### 2.3 Never guess shipment details
- If a value in a shipment document is unclear, missing, unreadable, or conflicting, **stop and ask the user for confirmation**.
- Never fill gaps with "typical" or "likely" values.
- In the application itself, unresolved values must appear as flagged items, never as silently filled defaults.

### 2.4 Label every claim
Every important statement must be clearly labeled as one of these:

| Label | Meaning |
|---|---|
| ✅ **Verified Fact** | Confirmed from a cited, trustworthy source or directly from the sample documents |
| 🔶 **Assumption** | Believed reasonable but not verified; must say why it is assumed and what would confirm it |
| ❓ **Unresolved Question** | Not known; needs research or a decision from the user |
| 🛠️ **Implementation Decision** | A choice we made about how to build something, with the reason |

### 2.5 Preserve the conversation
- The full AI conversation is a submission deliverable.
- Do **not** clear, reset, compact on purpose, or replace the conversation as a substitute for keeping its history.
- Do not suggest starting a fresh session to "clean up". If the context becomes very large, tell the user and let them decide.

---

## 3. Research Before Coding

### 3.1 Research comes first
Before any design or code:
1. Identify **official and trustworthy sources** for NetCHB XML requirements.
2. Record each finding in the **Research Log** (format in `prompt.md`).
3. Continue directly from Phase 2 (NetCHB research) into Phase 3 (shipment analysis). There is **no separate approval gate after Phase 2**.
4. Present the Phase 2 and Phase 3 findings together for approval at **Checkpoint A**, at the end of Phase 3.
5. Exception: any unclear shipment value is still confirmed with the user as soon as it is found (the **Ongoing** confirmation rule).

### 3.2 Source trust levels
| Level | Examples | How to use |
|---|---|---|
| **Tier 1 – Authoritative** | Official NetCHB documentation, XML schemas (XSD), or sample files published or provided by NetCHB; official CBP sources (cbp.gov, ACE / CATAIR technical documentation); the official HTS (hts.usitc.gov); the Code of Federal Regulations (19 CFR) | Can support ✅ Verified Facts |
| **Tier 2 – Supporting** | Material provided by Sefer as part of this assignment; documentation from established customs-industry organizations | Can support facts if consistent with Tier 1; cite it clearly |
| **Tier 3 – Unverified** | Blogs, forums, third-party tutorials, AI-generated content, memory | May only produce 🔶 Assumptions or ❓ Questions, **never facts** |

- Always cite the exact source (URL, document name, section, and access date).
- If NetCHB's XML specification is not publicly available, **say so plainly**. Mark the related requirements ❓ Unresolved and ask the user how to proceed (for example, whether Sefer can provide the spec). Do not reconstruct the schema from guesswork.

---

## 4. How to Respond (Communication Style)

### 4.1 Structure
- Use headings, numbered steps, tables, and short bullet points.
- Start with a brief summary of what was done or found.
- End with **next steps** and any **questions or approvals needed**.
- Keep responses professional; the conversation will be submitted.

### 4.2 Work step by step
- Follow the phases in `prompt.md` in order. Do not skip ahead.
- State which phase and step is being worked on.
- Finish one step, report it, then move on.

### 4.3 Explain for a beginner and for an interview
- Explain technical terms the first time they appear.
- For each important technical decision, give:
  1. **What** we chose
  2. **Why** we chose it
  3. **Alternatives** considered and why they were rejected
  4. **Trade-offs and risks**
- Keep explanations simple enough that the user can confidently explain and defend them in an interview.

---

## 5. Solution Principles

### 5.1 Keep it simple
- Simple, clean, basic UI. Function matters more than visual polish.
- Prefer few, well-understood dependencies.
- Avoid over-engineering: no features beyond the requirements unless the user approves them.
- Scope must be achievable within about **24 working hours**.

### 5.2 Technology constraints
- **TypeScript** for both frontend and backend (a deliverable requirement).
- Any other technology choices (frameworks, extraction method, libraries) are proposed in Phase 4 and **require user approval**.

### 5.3 Handling uncertainty inside the app
The application must clearly separate:
- Values **extracted with confidence**
- Values that are **missing**
- Values that **conflict** between documents (show both sources)
- Values that are **uncertain** (low confidence or ambiguous)
- **Recommended next steps** for the user to resolve each issue

---

## 6. Testing Requirements

- **Test against the provided sample shipment.** The generated XML for the sample is deliverable **D2**.
- **Plan for unseen shipments.** The solution must not be hard-coded to the sample documents. Consider different layouts, missing documents, multiple line items, different currencies or units, and conflicting values.
- **Validate the XML** against the verified NetCHB requirements (and the official schema, if one is obtained).
- Use the **Extraction Validation Checklist** in `prompt.md`.
- Report test results honestly, including failures and known limitations.

---

## 7. Approval Checkpoints (Summary)

| Checkpoint | Gate | When |
|---|---|---|
| **A** | Research approval (NetCHB requirements, field mapping) | End of Phase 3 |
| **B** | Plan approval (architecture and project plan) | End of Phase 4, before implementation |
| **C** | Git initialization approval | Before running `git init` or any commit |
| **D** | GitHub publication approval | Before creating a remote repository, pushing, or publishing |
| **Ongoing** | Confirmation of unclear shipment values | Whenever one is found |

Full details are in `prompt.md`.

---

## 8. Workspace Notes

- Project folder: `C:\Users\milin\OneDrive\Desktop\Sefer-SWE-Assignment`
- ⚠️ This folder currently sits inside a Git repository rooted at the user's home directory (`C:\Users\milin`). **Never** run `git add`, `git commit`, or other Git write commands from this folder until the user approves creating a separate repository for the project.
- An `AGENTS.md` in the user's home directory relates to Amazon Devices development and does **not** apply to this project.
