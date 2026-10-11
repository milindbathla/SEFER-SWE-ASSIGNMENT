import { z } from 'zod';

/**
 * The shape every extraction path must produce, whether that is the PDF text layer or a
 * person transcribing a scanned page. Values are kept EXACTLY as printed (strings);
 * deterministic code parses numbers, dates and units later, so nothing is "corrected" here.
 */

export const DOC_TYPES = ['commercial_invoice', 'packing_list', 'bill_of_lading', 'unknown'] as const;
export const DocType = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocType>;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  commercial_invoice: 'Commercial invoice',
  packing_list: 'Packing list',
  bill_of_lading: 'Bill of lading',
  unknown: 'Unknown document',
};

export const ExtractionMethod = z.enum(['text_layer', 'ocr', 'manual_transcription', 'unavailable']);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;

/** One value read from a document, with the evidence that supports it. */
export const SourceField = z.object({
  /** Exactly as printed. null = not present / not read. */
  value: z.string().nullable(),
  page: z.number().int().min(1).nullable(),
  /** Verbatim supporting text (for text-layer extraction, the text the value came from). */
  quote: z.string().nullable(),
  /** Free-text remark, e.g. "handwritten" or "partly covered by stamp". */
  note: z.string().optional(),
  /** OCR only: engine confidence (0-100) for the words the value was read from. */
  confidence: z.number().min(0).max(100).optional(),
  /**
   * OCR only: human review state. An OCR value is a reading, not a fact: until it is confirmed or corrected it is never
   * used as a confirmed value. rejected = the reading was wrong and no value is known (the OCR text stays in quote).
   */
  verification: z.enum(['unverified', 'confirmed', 'corrected', 'rejected']).optional(),
});
export type SourceField = z.infer<typeof SourceField>;

export const INVOICE_FIELDS = [
  'invoiceNumber', 'invoiceDate', 'buyerPo', 'currency', 'incoterms', 'paymentTerms', 'seller', 'soldTo', 'shipTo',
  'portOfLoading', 'portOfDischarge', 'countryOfOrigin', 'vesselName', 'voyageNumber', 'blNumber', 'etd', 'eta',
  'subtotal', 'totalGoodsValue', 'freight', 'insurance', 'totalInvoiceValue', 'totalQuantity', 'totalPackages',
] as const;

export const PACKING_LIST_FIELDS = [
  'packingListNumber', 'packingListDate', 'invoiceReference', 'buyerPo', 'shipper', 'consignee', 'deliverTo',
  'vesselName', 'voyageNumber', 'portOfLoading', 'portOfDischarge', 'containerSummary', 'totalCartons',
  'totalQuantity', 'totalNetWeight', 'totalGrossWeight', 'totalVolume', 'shippingMarks',
] as const;

export const BILL_OF_LADING_FIELDS = [
  'blNumber', 'masterBlNumber', 'issuerScac', 'carrier', 'bookingNumber', 'shipper', 'consignee', 'notifyParty',
  'invoiceReference', 'buyerPo', 'countryOfOrigin', 'vesselName', 'voyageNumber', 'portOfLoading', 'portOfDischarge',
  'placeOfReceipt', 'placeOfDelivery', 'packages', 'grossWeight', 'measurement', 'shippedOnBoardDate', 'placeDateOfIssue',
  'hsCodes', 'marks', 'freightTerms',
] as const;

export const INVOICE_LINE_CELLS = ['lineNo', 'style', 'description', 'hsCode', 'quantity', 'unit', 'unitPrice', 'amount', 'origin'] as const;
export const PACKING_LIST_LINE_CELLS = ['cartonRange', 'style', 'description', 'cartons', 'pcsPerCarton', 'quantity', 'netWeight', 'grossWeight'] as const;

export const FIELDS_BY_TYPE: Record<DocType, readonly string[]> = {
  commercial_invoice: INVOICE_FIELDS,
  packing_list: PACKING_LIST_FIELDS,
  bill_of_lading: BILL_OF_LADING_FIELDS,
  unknown: [],
};

export const LINE_CELLS_BY_TYPE: Record<DocType, readonly string[]> = {
  commercial_invoice: INVOICE_LINE_CELLS,
  packing_list: PACKING_LIST_LINE_CELLS,
  bill_of_lading: [],
  unknown: [],
};

export const DocumentLine = z.object({
  cells: z.record(z.string(), SourceField),
});
export type DocumentLine = z.infer<typeof DocumentLine>;

/** A container reading. A corrected number on a B/L is recorded as two readings. */
export const ContainerReading = z.object({
  number: SourceField,
  seal: SourceField.optional(),
  marking: z.enum(['printed', 'handwritten', 'unknown']),
  struckThrough: z.boolean(),
});
export type ContainerReading = z.infer<typeof ContainerReading>;

export const TextLine = z.object({ page: z.number().int().min(1), text: z.string(), confidence: z.number().min(0).max(100).optional() });
export type TextLine = z.infer<typeof TextLine>;

export const ExtractedDocument = z
  .object({
    id: z.string().min(1),
    fileName: z.string().min(1),
    sha256: z.string().nullable(),
    docType: DocType,
    /** How the document type was determined. A file-name guess must be confirmed by the user. */
    docTypeSource: z.enum(['content', 'file_name_guess', 'user']),
    method: ExtractionMethod,
    pageCount: z.number().int().min(0),
    fields: z.record(z.string(), SourceField),
    lines: z.array(DocumentLine),
    containers: z.array(ContainerReading),
    /** Notes, remarks, declarations and other free text, scanned by the review rules. */
    textLines: z.array(TextLine),
    warnings: z.array(z.string()),
  })
  .superRefine((doc, ctx) => {
    const allowed = new Set(FIELDS_BY_TYPE[doc.docType]);
    for (const key of Object.keys(doc.fields)) {
      if (!allowed.has(key)) ctx.addIssue({ code: 'custom', path: ['fields', key], message: `Field "${key}" is not defined for ${doc.docType}` });
    }
    const cells = new Set(LINE_CELLS_BY_TYPE[doc.docType]);
    doc.lines.forEach((line, i) => {
      for (const key of Object.keys(line.cells)) {
        if (!cells.has(key)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'cells', key], message: `Line cell "${key}" is not defined for ${doc.docType}` });
      }
    });
  });
export type ExtractedDocument = z.infer<typeof ExtractedDocument>;

/** Manual transcription file format (import/export in the UI, fixtures in tests). */
export const TranscriptionFile = z.object({
  format: z.literal('sefer-transcription/v1'),
  transcribedBy: z.string().min(1),
  transcriptionNote: z.string(),
  document: z.object({
    fileName: z.string().min(1),
    sha256: z.string().nullable(),
    docType: DocType,
    pageCount: z.number().int().min(1),
    fields: z.record(z.string(), SourceField),
    lines: z.array(DocumentLine),
    containers: z.array(ContainerReading),
    textLines: z.array(TextLine),
  }),
});
export type TranscriptionFile = z.infer<typeof TranscriptionFile>;

/** True for an OCR value that a person has not yet confirmed or corrected. */
export function isUnverifiedOcr(method: ExtractionMethod, f: SourceField | undefined): boolean {
  return method === 'ocr' && !!f && f.value !== null && f.verification !== 'confirmed' && f.verification !== 'corrected';
}

export function emptyField(): SourceField {
  return { value: null, page: null, quote: null };
}
