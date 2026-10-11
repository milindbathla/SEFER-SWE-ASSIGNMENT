# Sample shipment KBAS/NB/26-0912: entry draft validation report

Generated: 2026-10-11T02:15:57.393Z  
Input fingerprint (SHA-256 of documents + broker decisions): `ff6f9bda0c70efdf1bc4c566b24075bfe6e6031afbd7b6a9f49c5f3745647c85`

## Status: ❌ NOT READY TO FILE

- 15 blocking issue(s) are not yet reviewed.
- 32 required/conditional field check(s) failed.
- XSD validation failed with 10 error(s).

### Summary

| Measure | Count | Meaning |
|---|---|---|
| Issues | 16 | Findings from the cross-document review (conflicts, uncertain readings, broker-only data). |
| Blocking issues still unresolved | 15 of 15 | Blocking issues that are open (16 open in total, including non-blocking) or reviewed but still waiting for confirmed values (0). Resolved: 0; waived: 0. |
| Required/conditional field checks failed | 32 of 41 | Entry fields the schema or NetCHB's documented rules require that have no confirmed value or an invalid format. |
| XSD errors | 10 | Structural errors from validating this exact XML against the official schema. libxml2 reports only the first missing child per element. |

### Disclaimers

- Generated for local review and download only. Nothing is submitted to NetCHB or CBP, and no <transmit/> instruction is included.
- Integration is NOT production-verified: the public NetCHB schema may not match production, the official NetCHB sample itself fails that schema, and the upload endpoint/authentication were not available (docs/research-log.md RL-5, RL-7).
- Passing local XSD and rule checks is structural validation only. It does not mean NetCHB or CBP will accept the entry.
- Classification, valuation, origin, party identity and bond decisions are broker responsibilities; the tool never makes them.

## Documents

| File | Type | Extraction method | Pages | Warnings |
|---|---|---|---|---|
| KBAS-NB-26-0912_Commercial_Invoice.pdf | Commercial invoice | text_layer | 2 |  |
| SPG-PL-2609-117_Packing_List.pdf | Packing list | manual_transcription | 1 | Manual transcription: Manual transcription prepared during development (read from the scanned image in the recorded AI chat session and checked against the field mapping approved at Checkpoint A, docs/research-log.md §3). Typed by hand during development, before local OCR was added; these are the reviewed values that stand in for a user's verified OCR readings (the app's own OCR output for this scan is tested separately). Values are copied exactly as printed. Verify against the scanned PDF before relying on them. |
| BMLVHCM26090418_House_BL.pdf | Bill of lading | manual_transcription | 1 | Manual transcription: Manual transcription prepared during development (read from the scanned image in the recorded AI chat session and checked against the field mapping approved at Checkpoint A, docs/research-log.md §3). Typed by hand during development, before local OCR was added; these are the reviewed values that stand in for a user's verified OCR readings (the app's own OCR output for this scan is tested separately). Values are copied exactly as printed or handwritten. The container number has a struck-through typed value and a handwritten correction; both are recorded. Verify against the scanned PDF before relying on them. |

## XSD validation

- Validator: libxml2 via xmllint-wasm 5.3.0 (official entry.xsd + data_type.xsd, unmodified, loaded through a local wrapper schema)
- Schema: `server/schemas/netchb/entry.xsd` (source https://www.netchb.com/xml/entry/entry.xsd, SHA-256 `1bef18d4121f83f7f09a7346fa9d4a1a37310730363b66e6724908a3e5dc7132`)
- Schema: `server/schemas/netchb/data_type.xsd` (source https://www.netchb.com/xml/data/data_type.xsd, SHA-256 `c1c529ad31045c37f794a4ec230975868d788b5d661348794aa4ffe9b3eb45fc`)
- Ran: yes; result: **invalid** (10 error(s))
- Limitation: Structural validation against the public NetCHB schema only. It does not prove NetCHB will accept the entry (the public schema's currency is unconfirmed and NetCHB applies further business rules).

| XML line | Error | Cause |
|---|---|---|
| 4 | Schemas validity error : Element 'entry-no': Missing child element(s). Expected is one of ( user-specified, system-generated ). | Missing data: `entry-no` |
| 7 | Schemas validity error : Element 'header': Missing child element(s). Expected is one of ( importer-tax-id, importer-name, ultimate-consignee, processing-port, entry-port, entry-date, entry-type, bond-type, payment-type, statement-date ). | Missing data: `header/importer-tax-id`, `header/processing-port`, `header/entry-port`, `header/entry-date`, `header/entry-type` |
| 22 | Schemas validity error : Element 'bill-of-lading': Missing child element(s). Expected is one of ( inbond-no, master-scac, sub-house-bill, unit, split-shipments ). | Missing data: `manifest/bill-of-lading/unit` |
| 50 | Schemas validity error : Element 'tariff': Missing child element(s). Expected is one of ( tariff-no, value, duty, quantity1, unit-of-measure1, quantity2, unit-of-measure2, quantity3, unit-of-measure3, special-program ). | Missing data: `invoice[1]/line[1]/tariff-no`, `invoice[1]/line[1]/value` |
| 65 | Schemas validity error : Element 'tariff': Missing child element(s). Expected is one of ( tariff-no, value, duty, quantity1, unit-of-measure1, quantity2, unit-of-measure2, quantity3, unit-of-measure3, special-program ). | Missing data: `invoice[1]/line[2]/tariff-no`, `invoice[1]/line[2]/value` |
| 80 | Schemas validity error : Element 'tariff': Missing child element(s). Expected is one of ( tariff-no, value, duty, quantity1, unit-of-measure1, quantity2, unit-of-measure2, quantity3, unit-of-measure3, special-program ). | Missing data: `invoice[1]/line[3]/tariff-no`, `invoice[1]/line[3]/value` |
| 95 | Schemas validity error : Element 'tariff': Missing child element(s). Expected is one of ( tariff-no, value, duty, quantity1, unit-of-measure1, quantity2, unit-of-measure2, quantity3, unit-of-measure3, special-program ). | Missing data: `invoice[1]/line[4]/tariff-no`, `invoice[1]/line[4]/value` |
| 110 | Schemas validity error : Element 'tariff': Missing child element(s). Expected is one of ( tariff-no, value, duty, quantity1, unit-of-measure1, quantity2, unit-of-measure2, quantity3, unit-of-measure3, special-program ). | Missing data: `invoice[1]/line[5]/tariff-no`, `invoice[1]/line[5]/value` |
| 101 | Schemas validity error : Element 'line-item': Missing child element(s). Expected is one of ( export-date, country-origin, manufacturer-id, related-party, delivered-to, sold-to, exporter, ace-cargo-release-parties, fees, cargo-sanctions ). | Missing data: `invoice[1]/line[5]/country-origin` |
| 38 | Schemas validity error : Element 'invoice': Missing child element(s). Expected is one of ( invoice-no, aii-supplier-id, ultimate-consignee-tax-id, ultimate-consignee-info, related-party, foreign-currency, proration-amount, precalculated-prorated-lines ). | Missing data: `invoice[1]/invoice-no` |

## Required and conditional field checks (32 failed of 41)

| Result | Check | Source | Detail |
|---|---|---|---|
| ❌ | Entry number option is present | Required by entry.xsd: a choice of <user-specified> (filer code + entry number) or <system-generated/>. | Missing (no confirmed value). |
| ❌ | Processing port is present | Required by entry.xsd (headerType). | Missing (no confirmed value). |
| ❌ | Entry port is present | Required by entry.xsd (headerType). | Missing (proposal awaiting confirmation). |
| ❌ | Entry date is present | Required by entry.xsd (headerType). | Missing (no confirmed value). |
| ❌ | Entry type is present | Required by entry.xsd (data:entryType). | Missing (no confirmed value). |
| ❌ | B/L unit is present | Required in every <bill-of-lading> (entry.xsd, max 5 characters). | Missing (proposal awaiting confirmation). |
| ❌ | Invoice 1 number is present | Required in every <invoice> (data:invoiceNoType [A-Za-z\d\-]{1,17}). | Missing (proposal awaiting confirmation). |
| ❌ | Line 1 NB-T101: HTSUS number is present | Required in every <tariff> (data:tariffNoType \d{5,10}); the full 10-digit HTSUS number must be reported (RL-14). | Missing (no confirmed value). |
| ❌ | Line 1 NB-T101: tariff value (USD) is present | Required in every <tariff> (data:dollarAmountType). | Missing (no confirmed value). |
| ❌ | Line 2 NB-H205: HTSUS number is present | Required in every <tariff> (data:tariffNoType \d{5,10}); the full 10-digit HTSUS number must be reported (RL-14). | Missing (no confirmed value). |
| ❌ | Line 2 NB-H205: tariff value (USD) is present | Required in every <tariff> (data:dollarAmountType). | Missing (no confirmed value). |
| ❌ | Line 3 NB-C330: HTSUS number is present | Required in every <tariff> (data:tariffNoType \d{5,10}); the full 10-digit HTSUS number must be reported (RL-14). | Missing (no confirmed value). |
| ❌ | Line 3 NB-C330: tariff value (USD) is present | Required in every <tariff> (data:dollarAmountType). | Missing (no confirmed value). |
| ❌ | Line 4 W-B220: HTSUS number is present | Required in every <tariff> (data:tariffNoType \d{5,10}); the full 10-digit HTSUS number must be reported (RL-14). | Missing (no confirmed value). |
| ❌ | Line 4 W-B220: tariff value (USD) is present | Required in every <tariff> (data:dollarAmountType). | Missing (no confirmed value). |
| ❌ | Line 5 NB-P118S: country of origin is present | Required in every <line-item> (data:countryCodeType). | Missing (no confirmed value). |
| ❌ | Line 5 NB-P118S: HTSUS number is present | Required in every <tariff> (data:tariffNoType \d{5,10}); the full 10-digit HTSUS number must be reported (RL-14). | Missing (no confirmed value). |
| ❌ | Line 5 NB-P118S: tariff value (USD) is present | Required in every <tariff> (data:dollarAmountType). | Missing (no confirmed value). |
| ❌ | Importer tax ID present unless entry type is 86 | entry.xsd: "Required unless the entry type is 86" | Missing (entry type not yet set). |
| ❌ | State of destination present (formal entry) | NetCHB: "required for formal entries". Treated as applicable until the broker confirms the entry is not formal. | Missing. |
| ❌ | Port of unlading present (ocean shipment) | NetCHB: "port of unlading is required for ocean shipments" | Missing. |
| ❌ | Line 1 NB-T101: country of export present (ocean shipment) | NetCHB: "required for ocean/air shipments" | Missing. |
| ❌ | Line 1 NB-T101: foreign port of lading present (ocean shipment) | NetCHB: "required for ocean shipments" | Missing. |
| ❌ | Line 2 NB-H205: country of export present (ocean shipment) | NetCHB: "required for ocean/air shipments" | Missing. |
| ❌ | Line 2 NB-H205: foreign port of lading present (ocean shipment) | NetCHB: "required for ocean shipments" | Missing. |
| ❌ | Line 3 NB-C330: country of export present (ocean shipment) | NetCHB: "required for ocean/air shipments" | Missing. |
| ❌ | Line 3 NB-C330: foreign port of lading present (ocean shipment) | NetCHB: "required for ocean shipments" | Missing. |
| ❌ | Line 4 W-B220: country of export present (ocean shipment) | NetCHB: "required for ocean/air shipments" | Missing. |
| ❌ | Line 4 W-B220: foreign port of lading present (ocean shipment) | NetCHB: "required for ocean shipments" | Missing. |
| ❌ | Line 5 NB-P118S: country of export present (ocean shipment) | NetCHB: "required for ocean/air shipments" | Missing. |
| ❌ | Line 5 NB-P118S: foreign port of lading present (ocean shipment) | NetCHB: "required for ocean shipments" | Missing. |
| ❌ | Entry number option chosen | entry.xsd: <entry-no> must contain <user-specified> or <system-generated/> | Not chosen. |
| ✅ | B/L quantity is present | Required in every <bill-of-lading> (entry.xsd). | Present. |
| ✅ | Line 1 NB-T101: country of origin is present | Required in every <line-item> (data:countryCodeType). | Present. |
| ✅ | Line 2 NB-H205: country of origin is present | Required in every <line-item> (data:countryCodeType). | Present. |
| ✅ | Line 3 NB-C330: country of origin is present | Required in every <line-item> (data:countryCodeType). | Present. |
| ✅ | Line 4 W-B220: country of origin is present | Required in every <line-item> (data:countryCodeType). | Present. |
| ✅ | Mode of transportation present (formal entry) | NetCHB: "required for formal entries or cargo release processing". Treated as applicable until the broker confirms the entry is not formal. | Present. |
| ✅ | Vessel name present (ocean shipment) | NetCHB: "required for ocean shipments or 06 entry types" | Present. |
| ✅ | Voyage number present (ocean shipment) | NetCHB: "voyage/flight-no is required for air or ocean shipments" | Present. |
| ✅ | Bill of lading number reported (vessel modes 10/11) | CBP Form 7501 / ACE Entry Summary instructions (research log RL-10) | Master or house bill number. |

## Issues (16; 15 blocking and unresolved)

### [C-1] Invoice 1, line 1 (NB-T101): quantity × unit price ≠ printed amount

- **State:** Conflicting source documents — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[1]/value`
- **Rule:** `LINE_ARITHMETIC`
- **Explanation:** 2,400 × 2.85 = 6840.00, but the invoice prints 6,480.00. The source amount is NOT corrected; the line value is withheld from the XML.
- **Required action:** Confirm the correct line amount with the seller or broker and enter the confirmed line value.
- **Affects:** `invoice[1]/line[1]/value`
- **Values stated by the sources** (offered as choices; none is applied automatically):
  - `invoice[1]/line[1]/value` = `6480.00`: Amount printed on the invoice (6,480.00) ⚠️ Other valuation issues on this line (price terms, assists) still need their own decision.
  - `invoice[1]/line[1]/value` = `6840.00`: Calculated: 2,400 × 2.85 ⚠️ Other valuation issues on this line (price terms, assists) still need their own decision.
- **Evidence:**
  - **quantity**: "2,400" (quote: "1  NB-T101  MEN'S CREW NECK SHORT SLEEVE T-SHIRT  6109.10  2,400  PCS  2.85  6,480.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **unit price**: "2.85" (quote: "1  NB-T101  MEN'S CREW NECK SHORT SLEEVE T-SHIRT  6109.10  2,400  PCS  2.85  6,480.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **amount**: "6,480.00" (quote: "1  NB-T101  MEN'S CREW NECK SHORT SLEEVE T-SHIRT  6109.10  2,400  PCS  2.85  6,480.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1

### [C-1] Invoice 1: totals do not reconcile with the printed line amounts

- **State:** Conflicting source documents — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[1]/value`, `invoice[1]/line[2]/value`, `invoice[1]/line[3]/value`, `invoice[1]/line[4]/value`, `invoice[1]/line[5]/value`
- **Rule:** `INVOICE_TOTALS`
- **Explanation:** Sub-total 21,975.00 ≠ sum of the printed line amounts on pages ≤ 1 (21615.00); it equals the sum of quantity × unit price (21975.00). Total goods value 23,235.00 ≠ sum of the printed commercial line amounts (22875.00); it equals the sum of quantity × unit price (23235.00). No value has been changed.
- **Required action:** Confirm which figures are correct (line amounts or totals) before values are used.
- **Affects:** `invoice[1]/line[1]/value`, `invoice[1]/line[2]/value`, `invoice[1]/line[3]/value`, `invoice[1]/line[4]/value`, `invoice[1]/line[5]/value`
- **Evidence:**
  - **sub-total**: "21,975.00" (quote: "SUB-TOTAL CARRIED FORWARD (USD): 21,975.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **total goods value**: "23,235.00" (quote: "TOTAL FOB VALUE (Items 1 - 4): 23,235.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2

### [C-2] Invoice 1, line 2 (NB-H205): invoice quantity ≠ packing-list quantity

- **State:** Conflicting source documents — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[2]/invoice-quantity`, `invoice[1]/line[2]/value`
- **Rule:** `QUANTITY_MISMATCH`
- **Explanation:** Invoice: 1,200 PCS; packing list: 1,176. Quantity and value for this line are withheld until confirmed.
- **Required action:** Confirm the quantity actually shipped (and the invoice value that corresponds to it).
- **Affects:** `invoice[1]/line[2]/invoice-quantity`, `invoice[1]/line[2]/value`
- **Values stated by the sources** (offered as choices; none is applied automatically):
  - `invoice[1]/line[2]/invoice-quantity` = `1200`: Invoice quantity (1,200)
  - `invoice[1]/line[2]/invoice-quantity` = `1176`: Packing-list quantity (1,176)
- **Evidence:**
  - **invoice quantity**: "1,200" (quote: "2  NB-H205  WOMEN'S PULLOVER HOODIE W/ KANGAROO POCKET  6110.20  1,200  PCS  7.40  8,880.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **packing-list quantity**: "1,176" (quote: "49 24 1,176"). SPG-PL-2609-117_Packing_List.pdf, p.1

### [C-3] Invoice 1, line 2 (NB-H205): fibre composition differs between invoice and packing list

- **State:** Conflicting source documents — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[2]/tariff-no`
- **Rule:** `FIBRE_MISMATCH`
- **Explanation:** Composition percentages on the invoice (60/40) differ from the packing list (65/35). Only the numbers are compared; fibre names and abbreviations are not interpreted. Fibre content can affect classification, so classification for this line must not be finalised until confirmed.
- **Required action:** Confirm the actual fibre composition (e.g. from the seller or a test report) before classifying this line.
- **Affects:** `invoice[1]/line[2]/tariff-no`
- **Evidence:**
  - **invoice description**: "WOMEN'S PULLOVER HOODIE W/ KANGAROO POCKET / 60% Cotton 40% Polyester brushed fleece, 280 GSM, knitted / Colours: Oatmeal / Sage / Size ratio XS-S-M-L-XL : 1-2-3-3-3". KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **packing-list description**: "LADIES PULLOVER HOODIE / TC 65/35 FLEECE 280GSM" (quote: "LADIES PULLOVER HOODIE TC 65/35 FLEECE 280GSM"). SPG-PL-2609-117_Packing_List.pdf, p.1

### [C-4] Gross weight differs between documents

- **State:** Conflicting source documents — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `header/gross-weight`
- **Rule:** `GROSS_WEIGHT_MISMATCH`
- **Explanation:** Packing list total G.W.: 1,888.00 KGS; B/L gross weight: 1,930.000 KGS. Neither value is preferred automatically.
- **Required action:** Confirm the correct gross weight (e.g. with the carrier or shipper).
- **Affects:** `header/gross-weight`
- **Values stated by the sources** (offered as choices; none is applied automatically):
  - `header/gross-weight` = `1888`: Packing list total G.W. (1,888.00 KGS)
  - `header/gross-weight` = `1930`: B/L gross weight (1,930.000 KGS)
- **Evidence:**
  - **Packing list total G.W.**: "1,888.00 KGS" (quote: "TOTAL G.W.: 1,888.00 KGS"). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **B/L gross weight**: "1,930.000 KGS" (quote: "Gross Weight: 1,930.000 KGS"). BMLVHCM26090418_House_BL.pdf, p.1

### [C-5] Container 1: number was corrected by hand

- **State:** Provisional — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `containers/container[1]/container-number`
- **Rule:** `CONTAINER_NUMBER`
- **Explanation:** OPLU3041728 (printed, struck through): ISO 6346 check digit expected 2, printed 8 → INVALID; OPLU3041722 (handwritten): ISO 6346 check digit expected 2, printed 2 → valid. The check digit supports, but does not prove, the corrected reading.
- **Required action:** Confirm the container number with the carrier (e.g. the master B/L or arrival notice) before accepting it.
- **Affects:** `containers/container[1]/container-number`
- **Values stated by the sources** (offered as choices; none is applied automatically):
  - `containers/container[1]/container-number` = `OPLU3041728`: printed, struck through reading "OPLU3041728" ⚠️ Struck through on the document. ISO 6346 check digit does NOT match.
  - `containers/container[1]/container-number` = `OPLU3041722`: handwritten reading "OPLU3041722"
- **Evidence:**
  - **struck-through reading**: "OPLU3041728". BMLVHCM26090418_House_BL.pdf, p.1
  - **handwritten reading**: "OPLU3041722" (quote: "OPLU 304172 2"). BMLVHCM26090418_House_BL.pdf, p.1

### [C-6] Invoice 1, line 4 (W-B220): possible assist (buyer-supplied materials / CMT pricing)

- **State:** Missing — broker input required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[4]/value`
- **Rule:** `ASSIST_INDICATOR` · Reference: docs/research-log.md RL-13; 19 U.S.C. §1401a(b)(1)(C)
- **Explanation:** The documents indicate materials supplied by the buyer or a cut-make-trim price. Value stated in the documents (as printed, not added to anything): "value USD 4,180.00". Under 19 U.S.C. §1401a(b)(1)(C) the value of an assist is added to the transaction value. Whether any stated amount is the assist value, and how to apportion it, is a broker decision, so the line value is withheld.
- **Required action:** Broker to determine the assist value and apportionment, then enter the line value.
- **Affects:** `invoice[1]/line[4]/value`
- **Evidence:**
  - **invoice line description**: "WOMEN'S LONG SLEEVE BLOUSE, V-NECK / 100% Polyester crepe de chine, woven / Colours: Ivory / Black / Size ratio XS-S-M-L-XL : 1-2-3-3-1 / CMT price, see note (*)". KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **packing-list description**: "LADIES L/S V-NECK BLOUSE / 100% POLY CREPE (BUYER FABRIC)" (quote: "LADIES L/S V-NECK BLOUSE 100% POLY CREPE (BUYER FABRIC)"). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **note / remark**:  (quote: "(*) Style W-B220: Price is CMT (cut, make & trim) only. Main fabric (100% polyester crepe de chine, 1,450 m) supplied free of charge by buyer under buyer's fabric P.O. NB-26-0918F, value USD 4,180.00, not included in this invoice."). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **note / remark**:  (quote: "2. Style W-B220 sewn from buyer-supplied fabric (Ref. NB-26-0918F)."). SPG-PL-2609-117_Packing_List.pdf, p.1

### [C-8] Invoice 1, line 5 (NB-P118S): free-of-charge / no-commercial-value goods

- **State:** Missing — broker input required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[5]/value`
- **Rule:** `NO_COMMERCIAL_VALUE` · Reference: docs/research-log.md RL-13
- **Explanation:** The line is described as free of charge or of no commercial value and its price/amount is printed in parentheses ((1.00) / (24.00)). A stated "value for customs" is not automatically the entered value.
- **Required action:** Broker to determine the value to declare for these goods and enter it.
- **Affects:** `invoice[1]/line[5]/value`
- **Evidence:**
  - **description**: "WOMEN'S SHORT SLEEVE POLO SHIRT - SAMPLES / 100% Cotton pique, knitted / FOC SAMPLES - NO COMMERCIAL VALUE / Value for customs purpose only USD 1.00/pc / (Origin: Bangladesh)". KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **unit price**: "(1.00)" (quote: "5  NB-P118S  WOMEN'S SHORT SLEEVE POLO SHIRT - SAMPLES  6106.10  24  PCS  (1.00)  (24.00)"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **amount**: "(24.00)" (quote: "5  NB-P118S  WOMEN'S SHORT SLEEVE POLO SHIRT - SAMPLES  6106.10  24  PCS  (1.00)  (24.00)"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2

### [C-12] Invoice 1: price terms include international freight and/or insurance

- **State:** Missing — broker input required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[1]/value`, `invoice[1]/line[2]/value`, `invoice[1]/line[3]/value`, `invoice[1]/line[4]/value`, `invoice[1]/line[5]/value`
- **Rule:** `CIF_DEDUCTIONS` · Reference: docs/research-log.md RL-13; 19 U.S.C. §1401a(b)(4)(A)
- **Explanation:** Terms: CIF TACOMA, WA (INCOTERMS 2020); freight 3,850.00; insurance 185.00. Arithmetic check: goods 23,235.00 + 3,850.00 + 185.00 = 27270.00, which equals the printed invoice total 27,270.00. Under 19 U.S.C. §1401a(b)(4)(A) international freight and insurance are excluded from transaction value, and deductions must be actual costs. The treatment is a broker decision: no amount is deducted or adjusted automatically, and each line value must be entered by the broker.
- **Required action:** Broker to confirm the entered value basis for each line (and whether the freight/insurance figures are actual costs).
- **Affects:** `invoice[1]/line[1]/value`, `invoice[1]/line[2]/value`, `invoice[1]/line[3]/value`, `invoice[1]/line[4]/value`, `invoice[1]/line[5]/value`
- **Evidence:**
  - **terms**: "CIF TACOMA, WA (INCOTERMS 2020)" (quote: "Incoterms: CIF TACOMA, WA (INCOTERMS 2020)"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **total goods value**: "23,235.00" (quote: "TOTAL FOB VALUE (Items 1 - 4): 23,235.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **freight**: "3,850.00" (quote: "Ocean Freight (Cat Lai - Tacoma): 3,850.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **insurance**: "185.00" (quote: "Marine Insurance Premium: 185.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **invoice total**: "27,270.00" (quote: "TOTAL CIF TACOMA, WA (USD): 27,270.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2

### [C-7] Invoice 1, line 5 (NB-P118S): line origin differs from the document-level origin

- **State:** Conflicting source documents — confirmation required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[5]/country-origin`
- **Rule:** `ORIGIN_CONFLICT`
- **Explanation:** The line states origin "Bangladesh" (BD), while the document-level origin is "VIETNAM" on KBAS-NB-26-0912_Commercial_Invoice.pdf, "VIETNAM" on BMLVHCM26090418_House_BL.pdf. Origin statements found: 10. The origin for this line is not finalised.
- **Required action:** Confirm the country of origin for this line (and how carton marks and the origin declaration apply to it).
- **Affects:** `invoice[1]/line[5]/country-origin`
- **Values stated by the sources** (offered as choices; none is applied automatically):
  - `invoice[1]/line[5]/country-origin` = `BD`: Line origin ("Bangladesh")
  - `invoice[1]/line[5]/country-origin` = `VN`: Document-level origin on KBAS-NB-26-0912_Commercial_Invoice.pdf ("VIETNAM"); Document-level origin on BMLVHCM26090418_House_BL.pdf ("VIETNAM")
- **Evidence:**
  - **line origin**: "Bangladesh" (quote: "(Origin: Bangladesh)"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **document-level origin**: "VIETNAM" (quote: "Country of Origin: VIETNAM"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **document-level origin**: "VIETNAM" (quote: "Point and Country of Origin of Goods: VIETNAM"). BMLVHCM26090418_House_BL.pdf, p.1
  - **origin statement**:  (quote: "Port of Loading:  CAT LAI, HO CHI MINH CITY, VN  Country of Origin:  VIETNAM"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **origin statement**:  (quote: "described, that all particulars are true and correct, and that the goods are of  Vietnam  origin.  A  P"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **origin statement**:  (quote: "WOMEN'S SHORT SLEEVE POLO SHIRT - SAMPLES 100% Cotton pique, knitted FOC SAMPLES - NO COMMERCIAL VALUE Value for customs purpose only USD 1.00/pc (Origin: Bangladesh)"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **origin statement**:  (quote: "Country of Origin: VIETNAM"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **origin statement**:  (quote: "SHIPPING MARKS: NORTHBOUND OUTFITTERS PO#: NB-26-0918 STYLE#: COLOUR / SIZE: QTY: PCS C/NO.: 1 - 138 MADE IN VIETNAM"). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **origin statement**:  (quote: "3. ** Carton No. 138: FOC samples (ladies polo NB-P118S) produced at our sister unit SP Garments Dhaka Ltd., Plot 41, Gazipur, Bangladesh. Made in Bangladesh. Hand-carried to Cat Lai CFS for consolidation."). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **origin statement**:  (quote: "TELEX RELEASED ORIGINALS SURRENDERED AT ORIGIN 25-SEP-2026 BML-HCM"). BMLVHCM26090418_House_BL.pdf, p.1
  - **origin statement**:  (quote: "Point and Country of Origin of Goods: VIETNAM"). BMLVHCM26090418_House_BL.pdf, p.1
  - **origin statement**:  (quote: "N/M: NORTHBOUND OUTFITTERS PO#: NB-26-0918 C/NO.: 1-138 MADE IN VIETNAM"). BMLVHCM26090418_House_BL.pdf, p.1
  - **origin statement**:  (quote: "OCEAN FREIGHT PREPAID THC ORIGIN PREPAID DESTINATION CHGS COLLECT AS ARRANGED"). BMLVHCM26090418_House_BL.pdf, p.1

### [C-9] Importer of record and ultimate consignee not identified

- **State:** Missing — broker input required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `header/importer-tax-id`, `header/ultimate-consignee/tax-id`
- **Rule:** `PARTIES_UNRESOLVED`
- **Explanation:** The documents name 2 different parties (buyer, consignee, notify, deliver-to) and contain no IRS/EIN/CBP-assigned tax IDs. Which party is the importer of record and which is the ultimate consignee is a broker determination.
- **Required action:** Broker to identify the importer of record and ultimate consignee and enter their tax IDs.
- **Affects:** `header/importer-tax-id`, `header/ultimate-consignee/tax-id`
- **Evidence:**
  - **invoice sold to**: "NORTHBOUND OUTFITTERS, INC." (quote: "NORTHBOUND OUTFITTERS, INC. / 2150 NW Raleigh Street, Suite 300 / Portland, OR 97210, U.S.A. / Attn: Megan Holt, Sourcing Dept. / Tel: +1 503 555 0148"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **invoice ship to**: "CASCADE FULFILLMENT PARTNERS LLC" (quote: "CASCADE FULFILLMENT PARTNERS LLC / 21820 76th Avenue South, Dock 4 / Kent, WA 98032, U.S.A. / For account of: Northbound Outfitters, Inc. / Receiving: +1 253 555 0193"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **packing-list consignee/buyer**: "NORTHBOUND OUTFITTERS, INC." (quote: "CONSIGNEE / BUYER: NORTHBOUND OUTFITTERS, INC. 2150 NW Raleigh St., Suite 300, Portland, OR 97210, USA"). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **packing-list deliver to**: "Cascade Fulfillment Partners LLC" (quote: "Deliver to: Cascade Fulfillment Partners LLC, 21820 76th Ave S, Kent, WA 98032, USA"). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **B/L consignee**: "CASCADE FULFILLMENT PARTNERS LLC" (quote: "CASCADE FULFILLMENT PARTNERS LLC 21820 76TH AVENUE SOUTH, DOCK 4 KENT, WA 98032, USA ATTN: RECEIVING TEL: +1 253 555 0193"). BMLVHCM26090418_House_BL.pdf, p.1
  - **B/L notify party**: "NORTHBOUND OUTFITTERS, INC." (quote: "NORTHBOUND OUTFITTERS, INC. 2150 NW RALEIGH ST, SUITE 300 PORTLAND, OR 97210, USA TEL: +1 503 555 0148 ATTN: M. HOLT ALSO NOTIFY: CUSTOMS BROKER (TBA)"). BMLVHCM26090418_House_BL.pdf, p.1

### [C-10] Invoice 1: invoice number "KBAS/NB/26-0912" does not fit the NetCHB format

- **State:** Confirmation required (transformation approval) · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/invoice-no`
- **Rule:** `INVOICE_NUMBER_FORMAT` · Reference: entry.xsd / data_type.xsd invoiceNoType
- **Explanation:** NetCHB data:invoiceNoType only allows [A-Za-z\d\-]{1,17}. Proposed transformation: remove every character outside A–Z, a–z, 0–9 and "-" → "KBASNB26-0912". The original number is preserved in the report. The transformed value is used only after explicit approval.
- **Required action:** Approve the proposed transformation, or enter the invoice number exactly as it should appear in NetCHB.
- **Affects:** `invoice[1]/invoice-no`
- **Evidence:**
  - **invoice number as printed**: "KBAS/NB/26-0912" (quote: "Invoice No.: KBAS/NB/26-0912"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1

### [C-11] KBAS-NB-26-0912_Commercial_Invoice.pdf: invoice date "12/09/2026" is ambiguous

- **State:** Uncertain — confirmation required · **blocking**
- **Resolution:** Open: not reviewed
- **Rule:** `AMBIGUOUS_DATE`
- **Explanation:** Possible readings: 2026-09-12 or 2026-12-09 (day-first vs month-first). Other dates in the documents are shown for context only; they make one reading plausible but do not confirm it.
- **Required action:** Confirm the invoice date with the issuer.
- **Evidence:**
  - **invoice date**: "12/09/2026" (quote: "Invoice Date: 12/09/2026"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **ETD (context only)**: "24-SEP-2026" (quote: "ETD / ETA: 24-SEP-2026 / 14-OCT-2026"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **ETA (context only)**: "14-OCT-2026" (quote: "ETD / ETA: 24-SEP-2026 / 14-OCT-2026"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **packing-list date (context only)**: "20-Sep-2026" (quote: "P/L No.: SPG-PL-2609-117 Date: 20-Sep-2026"). SPG-PL-2609-117_Packing_List.pdf, p.1
  - **shipped-on-board date (context only)**: "24 SEP 2026" (quote: "SHIPPED ON BOARD DATE: 24 SEP 2026 CAT LAI, HCMC VSL: PACIFIC ARGOS"). BMLVHCM26090418_House_BL.pdf, p.1

### Full 10-digit HTSUS numbers are not on the documents

- **State:** Missing — broker input required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[1]/tariff-no`, `invoice[1]/line[2]/tariff-no`, `invoice[1]/line[3]/tariff-no`, `invoice[1]/line[4]/tariff-no`, `invoice[1]/line[5]/tariff-no`
- **Rule:** `HTS_INCOMPLETE` · Reference: docs/research-log.md RL-14 (USITC HTS FAQ)
- **Explanation:** 5 line(s) carry only 6-digit HS codes. The full 10-digit HTSUS number must be reported; the remaining digits are a classification decision and are never generated by this tool.
- **Required action:** Broker to classify each line and enter the 10-digit HTSUS number.
- **Affects:** `invoice[1]/line[1]/tariff-no`, `invoice[1]/line[2]/tariff-no`, `invoice[1]/line[3]/tariff-no`, `invoice[1]/line[4]/tariff-no`, `invoice[1]/line[5]/tariff-no`
- **Evidence:**
  - **Invoice 1, line 1 (NB-T101) HS code**: "6109.10" (quote: "1  NB-T101  MEN'S CREW NECK SHORT SLEEVE T-SHIRT  6109.10  2,400  PCS  2.85  6,480.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **Invoice 1, line 2 (NB-H205) HS code**: "6110.20" (quote: "2  NB-H205  WOMEN'S PULLOVER HOODIE W/ KANGAROO POCKET  6110.20  1,200  PCS  7.40  8,880.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **Invoice 1, line 3 (NB-C330) HS code**: "6203.42" (quote: "3  NB-C330  MEN'S SLIM FIT CHINO TROUSERS  6203.42  900  PCS  6.95  6,255.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.1
  - **Invoice 1, line 4 (W-B220) HS code**: "6206.40" (quote: "4  W-B220  WOMEN'S LONG SLEEVE BLOUSE, V-NECK  6206.40  600  PCS  2.10 *  1,260.00"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2
  - **Invoice 1, line 5 (NB-P118S) HS code**: "6106.10" (quote: "5  NB-P118S  WOMEN'S SHORT SLEEVE POLO SHIRT - SAMPLES  6106.10  24  PCS  (1.00)  (24.00)"). KBAS-NB-26-0912_Commercial_Invoice.pdf, p.2

### Manufacturer identification codes (MID) not provided

- **State:** Missing — broker input required · **blocking**
- **Resolution:** Open: not reviewed · values still unconfirmed: `invoice[1]/line[1]/manufacturer-id`, `invoice[1]/line[2]/manufacturer-id`, `invoice[1]/line[3]/manufacturer-id`, `invoice[1]/line[4]/manufacturer-id`, `invoice[1]/line[5]/manufacturer-id`
- **Rule:** `MID_MISSING` · Reference: docs/research-log.md RL-15
- **Explanation:** No document states an MID. MIDs are built from the manufacturer that performs the origin-conferring operations (CBP Directive 3550-055); identifying that manufacturer is a broker task, so no MID is constructed automatically.
- **Required action:** Broker to enter the MID for each line.
- **Affects:** `invoice[1]/line[1]/manufacturer-id`, `invoice[1]/line[2]/manufacturer-id`, `invoice[1]/line[3]/manufacturer-id`, `invoice[1]/line[4]/manufacturer-id`, `invoice[1]/line[5]/manufacturer-id`

### Which carrier code (SCAC) to report is unresolved

- **State:** Uncertain — confirmation required
- **Resolution:** Open: not reviewed · values still unconfirmed: `header/carrier-code`, `manifest/bill-of-lading/master-scac`
- **Rule:** `CARRIER_CODE_UNRESOLVED`
- **Explanation:** The house B/L issuer and the ocean carrier are different companies. Which code belongs in header carrier-code (and whether the carrier's code printed in parentheses is its SCAC) is not inferred.
- **Required action:** Broker to enter the carrier code (and master SCAC, if used).
- **Affects:** `header/carrier-code`, `manifest/bill-of-lading/master-scac`
- **Evidence:**
  - **B/L issuer SCAC**: "BMLV" (quote: "BLUE MERIDIAN LOGISTICS (VIETNAM) CO., LTD. ... FMC NVOCC No. 029415N SCAC: BMLV"). BMLVHCM26090418_House_BL.pdf, p.1
  - **ocean carrier**: "ORIENT PACIFIC LINES (OPLU)" (quote: "CARRIER: ORIENT PACIFIC LINES (OPLU)"). BMLVHCM26090418_House_BL.pdf, p.1

## Not written to the XML

Elements the XML does not contain, and why. Required ones are also marked with a comment inside the XML; optional ones are marked when an issue concerns them.

### Withheld: the documents disagree or are uncertain (11)

- `header/carrier-code` (Carrier code (SCAC); optional); issues: `CARRIER_CODE_UNRESOLVED`
- `header/gross-weight` (Gross weight; optional); issues: `GROSS_WEIGHT_MISMATCH`
- `manifest/bill-of-lading/master-scac` (Master SCAC; optional); issues: `CARRIER_CODE_UNRESOLVED`
- `invoice[1]/line[1]/value` (Line 1 NB-T101: tariff value (USD); schema required); issues: `LINE_ARITHMETIC:invoice[1]/line[1]`, `INVOICE_TOTALS:invoice[1]`, `CIF_DEDUCTIONS:invoice[1]`
- `invoice[1]/line[2]/tariff-no` (Line 2 NB-H205: HTSUS number; schema required); issues: `FIBRE_MISMATCH:invoice[1]/line[2]`, `HTS_INCOMPLETE`
- `invoice[1]/line[2]/value` (Line 2 NB-H205: tariff value (USD); schema required); issues: `INVOICE_TOTALS:invoice[1]`, `QUANTITY_MISMATCH:invoice[1]/line[2]`, `CIF_DEDUCTIONS:invoice[1]`
- `invoice[1]/line[2]/invoice-quantity` (Line 2 NB-H205: invoice quantity; optional); issues: `QUANTITY_MISMATCH:invoice[1]/line[2]`
- `invoice[1]/line[3]/value` (Line 3 NB-C330: tariff value (USD); schema required); issues: `INVOICE_TOTALS:invoice[1]`, `CIF_DEDUCTIONS:invoice[1]`
- `invoice[1]/line[4]/value` (Line 4 W-B220: tariff value (USD); schema required); issues: `INVOICE_TOTALS:invoice[1]`, `ASSIST_INDICATOR:invoice[1]/line[4]`, `CIF_DEDUCTIONS:invoice[1]`
- `invoice[1]/line[5]/country-origin` (Line 5 NB-P118S: country of origin; schema required); issues: `ORIGIN_CONFLICT:invoice[1]/line[5]`
- `invoice[1]/line[5]/value` (Line 5 NB-P118S: tariff value (USD); schema required); issues: `INVOICE_TOTALS:invoice[1]`, `NO_COMMERCIAL_VALUE:invoice[1]/line[5]`, `CIF_DEDUCTIONS:invoice[1]`

### Proposal awaiting explicit confirmation (22)

- `header/entry-port` (Entry port; schema required): proposal `3002`
- `header/state-destination` (State of destination; conditional): proposal `WA`
- `header/unlading-port` (Port of unlading; conditional): proposal `3002`
- `manifest/bill-of-lading/unit` (B/L unit; schema required): proposal `CTN`
- `containers/container[1]/container-number` (Container 1 number; optional): proposal `OPLU3041722`; issues: `CONTAINER_NUMBER:1`
- `containers/container[1]/container-size` (Container 1 size; optional): proposal `20 ft`
- `invoice[1]/invoice-no` (Invoice 1 number; schema required): proposal `KBASNB26-0912`; issues: `INVOICE_NUMBER_FORMAT:invoice[1]`
- `invoice[1]/line[1]/country-export` (Line 1 NB-T101: country of export; conditional): proposal `VN`
- `invoice[1]/line[1]/lading-port` (Line 1 NB-T101: foreign port of lading; conditional): proposal `55224`
- `invoice[1]/line[1]/export-date` (Line 1 NB-T101: export date; optional): proposal `2026-09-24`
- `invoice[1]/line[2]/country-export` (Line 2 NB-H205: country of export; conditional): proposal `VN`
- `invoice[1]/line[2]/lading-port` (Line 2 NB-H205: foreign port of lading; conditional): proposal `55224`
- `invoice[1]/line[2]/export-date` (Line 2 NB-H205: export date; optional): proposal `2026-09-24`
- `invoice[1]/line[3]/country-export` (Line 3 NB-C330: country of export; conditional): proposal `VN`
- `invoice[1]/line[3]/lading-port` (Line 3 NB-C330: foreign port of lading; conditional): proposal `55224`
- `invoice[1]/line[3]/export-date` (Line 3 NB-C330: export date; optional): proposal `2026-09-24`
- `invoice[1]/line[4]/country-export` (Line 4 W-B220: country of export; conditional): proposal `VN`
- `invoice[1]/line[4]/lading-port` (Line 4 W-B220: foreign port of lading; conditional): proposal `55224`
- `invoice[1]/line[4]/export-date` (Line 4 W-B220: export date; optional): proposal `2026-09-24`
- `invoice[1]/line[5]/country-export` (Line 5 NB-P118S: country of export; conditional): proposal `VN`
- `invoice[1]/line[5]/lading-port` (Line 5 NB-P118S: foreign port of lading; conditional): proposal `55224`
- `invoice[1]/line[5]/export-date` (Line 5 NB-P118S: export date; optional): proposal `2026-09-24`

### Missing: no value available (broker input required) (15)

- `entry-no` (Entry number option; schema required)
- `header/importer-tax-id` (Importer tax ID; conditional); issues: `PARTIES_UNRESOLVED`
- `header/ultimate-consignee/tax-id` (Ultimate consignee tax ID; optional); issues: `PARTIES_UNRESOLVED`
- `header/processing-port` (Processing port; schema required)
- `header/entry-date` (Entry date; schema required)
- `header/entry-type` (Entry type; schema required)
- `invoice[1]/line[1]/manufacturer-id` (Line 1 NB-T101: manufacturer ID (MID); optional); issues: `MID_MISSING`
- `invoice[1]/line[1]/tariff-no` (Line 1 NB-T101: HTSUS number; schema required); issues: `HTS_INCOMPLETE`
- `invoice[1]/line[2]/manufacturer-id` (Line 2 NB-H205: manufacturer ID (MID); optional); issues: `MID_MISSING`
- `invoice[1]/line[3]/manufacturer-id` (Line 3 NB-C330: manufacturer ID (MID); optional); issues: `MID_MISSING`
- `invoice[1]/line[3]/tariff-no` (Line 3 NB-C330: HTSUS number; schema required); issues: `HTS_INCOMPLETE`
- `invoice[1]/line[4]/manufacturer-id` (Line 4 W-B220: manufacturer ID (MID); optional); issues: `MID_MISSING`
- `invoice[1]/line[4]/tariff-no` (Line 4 W-B220: HTSUS number; schema required); issues: `HTS_INCOMPLETE`
- `invoice[1]/line[5]/manufacturer-id` (Line 5 NB-P118S: manufacturer ID (MID); optional); issues: `MID_MISSING`
- `invoice[1]/line[5]/tariff-no` (Line 5 NB-P118S: HTSUS number; schema required); issues: `HTS_INCOMPLETE`

## Field provenance

| Field | XML element | Requirement | Value written | Status | Proposal (not used unless confirmed) |
|---|---|---|---|---|---|
| Entry number option | `entry-no` | schema required | — | Missing: no value available |  |
| Importer tax ID | `header/importer-tax-id` | conditional | — | Missing: no value available |  |
| Importer name (profile match) | `header/importer-name` | optional | — | Missing: no value available |  |
| Ultimate consignee tax ID | `header/ultimate-consignee/tax-id` | optional | — | Missing: no value available |  |
| Ultimate consignee name (profile match) | `header/ultimate-consignee/consignee-name` | optional | — | Missing: no value available |  |
| Processing port | `header/processing-port` | schema required | — | Missing: no value available |  |
| Entry port | `header/entry-port` | schema required | — | Proposed — awaiting confirmation | `3002`: Port of discharge "TACOMA, WA, U.S.A." → 3002 (CBP port page "Tacoma, Washington – 3002" (research log RL-11)). Whether this port is also the entry, processing or unlading port is the broker's determination. |
| Entry date | `header/entry-date` | schema required | — | Missing: no value available |  |
| Entry type | `header/entry-type` | schema required | — | Missing: no value available |  |
| Bond type | `header/bond-type` | optional | — | Missing: no value available |  |
| Surety code | `header/surety-code` | optional | — | Missing: no value available |  |
| State of destination | `header/state-destination` | conditional | — | Proposed — awaiting confirmation | `WA`: Delivery address "KENT, WA (DOOR)" contains state WA. The state of destination is a broker confirmation. |
| Mode of transportation | `header/mode-transportation` | conditional | `11` | Calculated deterministically |  |
| Vessel name | `header/vessel-name` | conditional | `PACIFIC ARGOS` | Extracted from documents |  |
| Voyage number | `header/voyage-no` | conditional | `041E` | Extracted from documents |  |
| Port of unlading | `header/unlading-port` | conditional | — | Proposed — awaiting confirmation | `3002`: Port of discharge "TACOMA, WA, U.S.A." → 3002 (CBP port page "Tacoma, Washington – 3002" (research log RL-11)). Whether this port is also the entry, processing or unlading port is the broker's determination. |
| Carrier code (SCAC) | `header/carrier-code` | optional | — | Withheld: disputed or uncertain, needs confirmation |  |
| Gross weight | `header/gross-weight` | optional | — | Withheld: disputed or uncertain, needs confirmation |  |
| Master SCAC | `manifest/bill-of-lading/master-scac` | optional | — | Withheld: disputed or uncertain, needs confirmation |  |
| Master bill number | `manifest/bill-of-lading/master-bill` | conditional | `OPLUSGN260917735` | Extracted from documents |  |
| House SCAC | `manifest/bill-of-lading/house-scac` | optional | `BMLV` | Extracted from documents |  |
| House bill number | `manifest/bill-of-lading/house-bill` | conditional | `BMLVHCM26090418` | Extracted from documents |  |
| B/L quantity | `manifest/bill-of-lading/quantity` | schema required | `138` | Extracted from documents |  |
| B/L unit | `manifest/bill-of-lading/unit` | schema required | — | Proposed — awaiting confirmation | `CTN`: B/L states "CARTONS". "CTN" is in NetCHB's unit-of-measure list; the manifest unit code still needs confirmation. |
| Container 1 number | `containers/container/container-number` | optional | — | Proposed — awaiting confirmation | `OPLU3041722`: Corrected reading; ISO 6346 check digit 2 matches. |
| Container 1 seal | `containers/container/seal-numbers` | optional | `OPL7731482` | Extracted from documents |  |
| Container 1 size | `containers/container/container-size` | optional | — | Proposed — awaiting confirmation | `20 ft`: Documents state "20'GP". |
| Invoice 1 number | `invoices/invoice/invoice-no` | schema required | — | Proposed — awaiting confirmation | `KBASNB26-0912`: Original "KBAS/NB/26-0912" contains characters outside [A-Za-z0-9-]; they are removed. The original is kept in the report. |
| Line 1 NB-T101: country of origin | `line-item/country-origin` | schema required | `VN` | Extracted from documents |  |
| Line 1 NB-T101: manufacturer ID (MID) | `line-item/manufacturer-id` | optional | — | Missing: no value available |  |
| Line 1 NB-T101: HTSUS number | `line-item/tariffs/tariff/tariff-no` | schema required | — | Missing: no value available |  |
| Line 1 NB-T101: tariff value (USD) | `line-item/tariffs/tariff/value` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 1 NB-T101: country of export | `line-item/country-export` | conditional | — | Proposed — awaiting confirmation | `VN`: Port of loading "CAT LAI, HO CHI MINH CITY, VN" is in VN. Country of export is a broker confirmation. |
| Line 1 NB-T101: foreign port of lading | `line-item/lading-port` | conditional | — | Proposed — awaiting confirmation | `55224`: "CAT LAI, HO CHI MINH CITY, VN" → 55224 (CBP ACE Appendix F – Schedule K (Aug 2024), "55224 – Ho Chi Minh City" (research log RL-12)). Cat Lai is a Ho Chi Minh City terminal but is not listed separately in Schedule K; this mapping is provisional. |
| Line 1 NB-T101: export date | `line-item/export-date` | optional | — | Proposed — awaiting confirmation | `2026-09-24`: ETD / shipped-on-board dates agree on 2026-09-24. Using it as the export date needs confirmation. |
| Line 1 NB-T101: commercial description | `line-item/commercial-description` | optional | `MEN'S CREW NECK SHORT SLEEVE T-SHIRT` | Extracted from documents |  |
| Line 1 NB-T101: invoice quantity | `line-item/invoice-quantity` | optional | `2400` | Extracted from documents |  |
| Line 1 NB-T101: PO number | `line-item/po-number` | optional | `NB-26-0918` | Extracted from documents |  |
| Line 2 NB-H205: country of origin | `line-item/country-origin` | schema required | `VN` | Extracted from documents |  |
| Line 2 NB-H205: manufacturer ID (MID) | `line-item/manufacturer-id` | optional | — | Missing: no value available |  |
| Line 2 NB-H205: HTSUS number | `line-item/tariffs/tariff/tariff-no` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 2 NB-H205: tariff value (USD) | `line-item/tariffs/tariff/value` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 2 NB-H205: country of export | `line-item/country-export` | conditional | — | Proposed — awaiting confirmation | `VN`: Port of loading "CAT LAI, HO CHI MINH CITY, VN" is in VN. Country of export is a broker confirmation. |
| Line 2 NB-H205: foreign port of lading | `line-item/lading-port` | conditional | — | Proposed — awaiting confirmation | `55224`: "CAT LAI, HO CHI MINH CITY, VN" → 55224 (CBP ACE Appendix F – Schedule K (Aug 2024), "55224 – Ho Chi Minh City" (research log RL-12)). Cat Lai is a Ho Chi Minh City terminal but is not listed separately in Schedule K; this mapping is provisional. |
| Line 2 NB-H205: export date | `line-item/export-date` | optional | — | Proposed — awaiting confirmation | `2026-09-24`: ETD / shipped-on-board dates agree on 2026-09-24. Using it as the export date needs confirmation. |
| Line 2 NB-H205: commercial description | `line-item/commercial-description` | optional | `WOMEN'S PULLOVER HOODIE W/ KANGAROO POCKET` | Extracted from documents |  |
| Line 2 NB-H205: invoice quantity | `line-item/invoice-quantity` | optional | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 2 NB-H205: PO number | `line-item/po-number` | optional | `NB-26-0918` | Extracted from documents |  |
| Line 3 NB-C330: country of origin | `line-item/country-origin` | schema required | `VN` | Extracted from documents |  |
| Line 3 NB-C330: manufacturer ID (MID) | `line-item/manufacturer-id` | optional | — | Missing: no value available |  |
| Line 3 NB-C330: HTSUS number | `line-item/tariffs/tariff/tariff-no` | schema required | — | Missing: no value available |  |
| Line 3 NB-C330: tariff value (USD) | `line-item/tariffs/tariff/value` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 3 NB-C330: country of export | `line-item/country-export` | conditional | — | Proposed — awaiting confirmation | `VN`: Port of loading "CAT LAI, HO CHI MINH CITY, VN" is in VN. Country of export is a broker confirmation. |
| Line 3 NB-C330: foreign port of lading | `line-item/lading-port` | conditional | — | Proposed — awaiting confirmation | `55224`: "CAT LAI, HO CHI MINH CITY, VN" → 55224 (CBP ACE Appendix F – Schedule K (Aug 2024), "55224 – Ho Chi Minh City" (research log RL-12)). Cat Lai is a Ho Chi Minh City terminal but is not listed separately in Schedule K; this mapping is provisional. |
| Line 3 NB-C330: export date | `line-item/export-date` | optional | — | Proposed — awaiting confirmation | `2026-09-24`: ETD / shipped-on-board dates agree on 2026-09-24. Using it as the export date needs confirmation. |
| Line 3 NB-C330: commercial description | `line-item/commercial-description` | optional | `MEN'S SLIM FIT CHINO TROUSERS` | Extracted from documents |  |
| Line 3 NB-C330: invoice quantity | `line-item/invoice-quantity` | optional | `900` | Extracted from documents |  |
| Line 3 NB-C330: PO number | `line-item/po-number` | optional | `NB-26-0918` | Extracted from documents |  |
| Line 4 W-B220: country of origin | `line-item/country-origin` | schema required | `VN` | Extracted from documents |  |
| Line 4 W-B220: manufacturer ID (MID) | `line-item/manufacturer-id` | optional | — | Missing: no value available |  |
| Line 4 W-B220: HTSUS number | `line-item/tariffs/tariff/tariff-no` | schema required | — | Missing: no value available |  |
| Line 4 W-B220: tariff value (USD) | `line-item/tariffs/tariff/value` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 4 W-B220: country of export | `line-item/country-export` | conditional | — | Proposed — awaiting confirmation | `VN`: Port of loading "CAT LAI, HO CHI MINH CITY, VN" is in VN. Country of export is a broker confirmation. |
| Line 4 W-B220: foreign port of lading | `line-item/lading-port` | conditional | — | Proposed — awaiting confirmation | `55224`: "CAT LAI, HO CHI MINH CITY, VN" → 55224 (CBP ACE Appendix F – Schedule K (Aug 2024), "55224 – Ho Chi Minh City" (research log RL-12)). Cat Lai is a Ho Chi Minh City terminal but is not listed separately in Schedule K; this mapping is provisional. |
| Line 4 W-B220: export date | `line-item/export-date` | optional | — | Proposed — awaiting confirmation | `2026-09-24`: ETD / shipped-on-board dates agree on 2026-09-24. Using it as the export date needs confirmation. |
| Line 4 W-B220: commercial description | `line-item/commercial-description` | optional | `WOMEN'S LONG SLEEVE BLOUSE, V-NECK` | Extracted from documents |  |
| Line 4 W-B220: invoice quantity | `line-item/invoice-quantity` | optional | `600` | Extracted from documents |  |
| Line 4 W-B220: PO number | `line-item/po-number` | optional | `NB-26-0918` | Extracted from documents |  |
| Line 5 NB-P118S: country of origin | `line-item/country-origin` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 5 NB-P118S: manufacturer ID (MID) | `line-item/manufacturer-id` | optional | — | Missing: no value available |  |
| Line 5 NB-P118S: HTSUS number | `line-item/tariffs/tariff/tariff-no` | schema required | — | Missing: no value available |  |
| Line 5 NB-P118S: tariff value (USD) | `line-item/tariffs/tariff/value` | schema required | — | Withheld: disputed or uncertain, needs confirmation |  |
| Line 5 NB-P118S: country of export | `line-item/country-export` | conditional | — | Proposed — awaiting confirmation | `VN`: Port of loading "CAT LAI, HO CHI MINH CITY, VN" is in VN. Country of export is a broker confirmation. |
| Line 5 NB-P118S: foreign port of lading | `line-item/lading-port` | conditional | — | Proposed — awaiting confirmation | `55224`: "CAT LAI, HO CHI MINH CITY, VN" → 55224 (CBP ACE Appendix F – Schedule K (Aug 2024), "55224 – Ho Chi Minh City" (research log RL-12)). Cat Lai is a Ho Chi Minh City terminal but is not listed separately in Schedule K; this mapping is provisional. |
| Line 5 NB-P118S: export date | `line-item/export-date` | optional | — | Proposed — awaiting confirmation | `2026-09-24`: ETD / shipped-on-board dates agree on 2026-09-24. Using it as the export date needs confirmation. |
| Line 5 NB-P118S: commercial description | `line-item/commercial-description` | optional | `WOMEN'S SHORT SLEEVE POLO SHIRT - SAMPLES` | Extracted from documents |  |
| Line 5 NB-P118S: invoice quantity | `line-item/invoice-quantity` | optional | `24` | Extracted from documents |  |
| Line 5 NB-P118S: PO number | `line-item/po-number` | optional | `NB-26-0918` | Extracted from documents |  |
