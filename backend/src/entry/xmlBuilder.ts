import { NETCHB_ENTRY_NAMESPACE, type ResolvedField } from '@sefer/shared';
import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';

/**
 * Builds NetCHB entry XML from resolved fields. Only fields with a value are written; nothing is
 * defaulted. Required elements that are missing are marked with an XML comment so a reviewer sees
 * the gap in the file itself, and the XSD validation then reports them.
 *
 * Element order: children of <entry> and of <manifest> follow the schema's xsd:sequence;
 * children of header, invoice, line-item, tariff and container are xsd:all (any order).
 * Never generated: <transmit/> or any other submission instruction.
 */

export interface BuildOptions {
  readyToFile: boolean;
  generatedAt: string;
  /** Identifies the analysed input state (documents + broker decisions); repeated in the validation report. */
  inputFingerprint?: string;
}

/** XML comments may not contain "--" or end with "-". */
function safeComment(text: string): string {
  return ` ${text.replace(/-{2,}/g, (m) => m.split('').join(' ')).replace(/-$/, '- ')} `;
}

export function buildEntryXml(fields: ResolvedField[], opts: BuildOptions): string {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const val = (path: string) => byPath.get(path)?.value ?? null;

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const input = opts.inputFingerprint ? ` Input ${opts.inputFingerprint.slice(0, 16)}.` : '';
  doc.com(
    safeComment(
      opts.readyToFile
        ? `Generated ${opts.generatedAt}.${input} Passed local checks only (XSD + documented rules). NOT verified by NetCHB or CBP. Review before upload.`
        : `DRAFT: NOT READY TO FILE. Generated ${opts.generatedAt}.${input} Required data is missing or unresolved; see the validation report. Not verified by NetCHB or CBP.`,
    ),
  );
  const entry = doc.ele(NETCHB_ENTRY_NAMESPACE, 'entry');

  const missing = (parent: XMLBuilder, path: string) => {
    const f = byPath.get(path);
    if (f && f.value === null && f.requirement !== 'optional') {
      const why = f.provenance === 'proposed' ? 'proposal awaiting confirmation' : f.provenance === 'withheld' ? 'withheld: unresolved issue' : 'not available';
      parent.com(safeComment(`MISSING (${f.requirement === 'schema_required' ? 'required by schema' : 'conditionally required'}): ${f.xmlPath} [${f.path}]: ${why}`));
    } else if (f && f.value === null && f.issueIds.length > 0) {
      withheld(parent, f);
    }
  };
  // Optional elements are omitted silently when absent, but not when an open issue concerns them.
  const withheld = (parent: XMLBuilder, f: ResolvedField) => {
    const kind = f.provenance === 'withheld' ? 'WITHHELD (unresolved issue)'
      : f.provenance === 'proposed' ? 'WITHHELD (unresolved issue; proposal awaiting confirmation)'
        : 'MISSING (optional; broker input required)';
    parent.com(safeComment(`${kind}: ${f.xmlPath} [${f.path}]: see the validation report`));
  };
  const leaf = (parent: XMLBuilder, element: string, path: string) => {
    const v = val(path);
    if (v !== null) parent.ele(element).txt(v);
    else missing(parent, path);
  };

  // entry-no (required choice)
  const entryNo = entry.ele('entry-no');
  const mode = val('entry-no');
  if (mode === 'system-generated') {
    entryNo.ele('system-generated');
  } else if (mode === 'user-specified') {
    const us = entryNo.ele('user-specified');
    leaf(us, 'filer-code', 'entry-no/filer-code');
    leaf(us, 'entry-no', 'entry-no/entry-no');
  } else {
    entryNo.com(safeComment('MISSING (required by schema): entry-no [entry-no]: choose a user-specified entry number or the NetCHB system-generated option'));
  }

  // header (xsd:all)
  const header = entry.ele('header');
  const headerLeaves = [
    'importer-tax-id', 'importer-name', 'processing-port', 'entry-port', 'entry-date', 'entry-type', 'bond-type', 'surety-code',
    'gross-weight', 'state-destination', 'vessel-name', 'mode-transportation', 'unlading-port', 'carrier-code', 'voyage-no',
  ];
  for (const el of headerLeaves) {
    if (el === 'processing-port') {
      const ucTax = val('header/ultimate-consignee/tax-id');
      const ucName = val('header/ultimate-consignee/consignee-name');
      if (ucTax !== null || ucName !== null) {
        const uc = header.ele('ultimate-consignee');
        if (ucTax !== null) uc.ele('tax-id').txt(ucTax);
        if (ucName !== null) uc.ele('consignee-name').txt(ucName);
      }
    }
    leaf(header, el, `header/${el}`);
  }

  // manifest (xsd:sequence; bill-of-lading children are xsd:all)
  const manifest = entry.ele('manifest');
  const blPaths = ['master-scac', 'master-bill', 'house-scac', 'house-bill', 'quantity', 'unit'];
  if (blPaths.some((p) => byPath.has(`manifest/bill-of-lading/${p}`))) {
    const bl = manifest.ele('bill-of-lading');
    for (const p of blPaths) leaf(bl, p, `manifest/bill-of-lading/${p}`);
  }

  // containers (sequence of <container>, children xsd:all)
  const containerIdx = [...new Set(fields.filter((f) => f.path.startsWith('containers/')).map((f) => /container\[(\d+)\]/.exec(f.path)?.[1]).filter(Boolean))] as string[];
  const withValues = containerIdx.filter((i) => ['container-number', 'seal-numbers', 'container-size'].some((el) => val(`containers/container[${i}]/${el}`) !== null));
  if (withValues.length) {
    const containers = entry.ele('containers');
    for (const i of withValues) {
      const c = containers.ele('container');
      for (const el of ['container-number', 'container-size', 'seal-numbers']) {
        const path = `containers/container[${i}]/${el}`;
        const v = val(path);
        if (v !== null) c.ele(el).txt(v);
        else if (byPath.get(path)?.issueIds.length) withheld(c, byPath.get(path)!);
      }
    }
  } else if (containerIdx.length) {
    entry.com(safeComment('Container data withheld: container number awaiting confirmation (see validation report)'));
  }

  // invoices (sequence of <invoice>, children xsd:all)
  const invoices = entry.ele('invoices');
  const invoicePrefixes = [...new Set(fields.map((f) => /^(invoice\[\d+\])\//.exec(f.path)?.[1]).filter(Boolean))] as string[];
  for (const ip of invoicePrefixes) {
    const invoice = invoices.ele('invoice');
    leaf(invoice, 'invoice-no', `${ip}/invoice-no`);
    const lineItems = invoice.ele('line-items');
    const linePrefixes = [...new Set(fields.map((f) => new RegExp(`^(${ip.replace(/[[\]]/g, '\\$&')}/line\\[[^\\]]+\\])/`).exec(f.path)?.[1]).filter(Boolean))] as string[];
    for (const lp of linePrefixes) {
      const li = lineItems.ele('line-item');
      for (const el of ['country-origin', 'manufacturer-id', 'export-date', 'commercial-description', 'invoice-quantity', 'po-number', 'country-export', 'lading-port']) {
        leaf(li, el, `${lp}/${el}`);
      }
      const tariff = li.ele('tariffs').ele('tariff');
      leaf(tariff, 'tariff-no', `${lp}/tariff-no`);
      leaf(tariff, 'value', `${lp}/value`);
    }
  }

  return doc.end({ prettyPrint: true });
}
