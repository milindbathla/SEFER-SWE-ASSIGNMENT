import type { ContainerReading, DocType, ExtractedDocument, SourceField } from '@sefer/shared';

/**
 * Builders for SYNTHETIC test documents. All values are invented test data for unit tests only;
 * they are never used in the sample-shipment deliverable.
 */
export function f(value: string, page = 1, quote?: string): SourceField {
  return { value, page, quote: quote ?? value };
}

let counter = 0;
export function doc(docType: DocType, fields: Record<string, string>, opts: Partial<Omit<ExtractedDocument, 'fields' | 'lines'>> & { lines?: Record<string, string>[] } = {}): ExtractedDocument {
  counter++;
  const { lines, ...rest } = opts;
  return {
    id: `test-${docType}-${counter}`,
    fileName: `${docType}-${counter}.pdf`,
    sha256: null,
    docType,
    docTypeSource: 'user',
    method: 'manual_transcription',
    pageCount: 1,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, f(v)])),
    lines: (lines ?? []).map((cells) => ({ cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, f(v)])) })),
    containers: [],
    textLines: [],
    warnings: [],
    ...rest,
  };
}

export function container(number: string, opts: Partial<Omit<ContainerReading, 'number'>> = {}): ContainerReading {
  return { number: f(number), seal: f('TESTSEAL1'), marking: 'printed', struckThrough: false, ...opts };
}

/** A consistent, conflict-free synthetic ocean shipment (different seller, ports and goods from the sample). */
export function cleanShipment(): ExtractedDocument[] {
  const invoice = doc('commercial_invoice', {
    invoiceNumber: 'TST-2026-001', invoiceDate: '2026-03-05', buyerPo: 'PO-TEST-1', currency: 'USD', incoterms: 'FOB TESTPORT',
    soldTo: 'TEST BUYER CO', shipTo: 'TEST BUYER CO, SOMEWHERE, CA 90000', portOfLoading: 'TESTPORT, TEST CITY', portOfDischarge: 'LONG BEACH, CA',
    countryOfOrigin: 'MEXICO', vesselName: 'TEST VESSEL', voyageNumber: '001W', totalGoodsValue: '1,500.00', totalPackages: '10 CARTONS',
  }, {
    lines: [
      { lineNo: '1', style: 'ST-1', description: 'TEST WIDGET A\n100% Cotton', hsCode: '6109.10.0012', quantity: '100', unit: 'PCS', unitPrice: '10.00', amount: '1,000.00' },
      { lineNo: '2', style: 'ST-2', description: 'TEST WIDGET B\n100% Cotton', hsCode: '6109.10.0040', quantity: '50', unit: 'PCS', unitPrice: '10.00', amount: '500.00' },
    ],
  });
  const packing = doc('packing_list', { invoiceReference: 'TST-2026-001', totalCartons: '10', totalGrossWeight: '250.00 KGS', vesselName: 'TEST VESSEL', voyageNumber: '001W' }, {
    lines: [
      { style: 'ST-1', description: 'TEST WIDGET A 100% COTTON', cartons: '5', pcsPerCarton: '20', quantity: '100', grossWeight: '150.00' },
      { style: 'ST-2', description: 'TEST WIDGET B 100% COTTON', cartons: '5', pcsPerCarton: '10', quantity: '50', grossWeight: '100.00' },
    ],
  });
  const bol = doc('bill_of_lading', {
    blNumber: 'TESTHBL0001', masterBlNumber: 'TESTMBL0001', invoiceReference: 'TST-2026-001', vesselName: 'TEST VESSEL', voyageNumber: '001W',
    portOfLoading: 'TESTPORT, TEST CITY', portOfDischarge: 'LONG BEACH, CA', placeOfDelivery: 'SOMEWHERE, CA', packages: '10 CARTONS', grossWeight: '250.000 KGS',
    countryOfOrigin: 'MEXICO', shippedOnBoardDate: '06-MAR-2026',
  }, { containers: [container('CSQU3054383')] });
  return [invoice, packing, bol];
}
