// Spike: can xmllint-wasm validate against the UNMODIFIED NetCHB entry.xsd on this machine?
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';

const dir = new URL('../schemas/netchb/', import.meta.url);
const entryXsd = readFileSync(new URL('entry.xsd', dir), 'utf8');
const dataXsd = readFileSync(new URL('data_type.xsd', dir), 'utf8');
const IMPORT_URL = 'https://www.netchb.com/xml/data/data_type.xsd';

// Synthetic fixture: obviously fake test values, schema-valid shapes only.
const valid = `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.netchb.com/xml/entry">
  <entry-no><system-generated/></entry-no>
  <header>
    <processing-port>9999</processing-port>
    <entry-port>9999</entry-port>
    <entry-date>2099-01-01</entry-date>
    <entry-type>01</entry-type>
  </header>
  <manifest/>
  <invoices>
    <invoice>
      <invoice-no>TEST-1</invoice-no>
      <line-items>
        <line-item>
          <country-origin>ZZ</country-origin>
          <tariffs><tariff><tariff-no>0000000000</tariff-no><value>1.00</value></tariff></tariffs>
        </line-item>
      </line-items>
    </invoice>
  </invoices>
</entry>`;
// Expected failures: slash in invoice-no, missing entry-date, 6-digit tariff OK (5-10) but bad port.
const invalid = valid
  .replace('<invoice-no>TEST-1</invoice-no>', '<invoice-no>TEST/1</invoice-no>')
  .replace('<entry-date>2099-01-01</entry-date>', '')
  .replace('<entry-port>9999</entry-port>', '<entry-port>99A</entry-port>');

const catalog = `<?xml version="1.0"?>
<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">
  <uri name="${IMPORT_URL}" uri="data_type.xsd"/>
  <system systemId="${IMPORT_URL}" uri="data_type.xsd"/>
</catalog>`;

async function attempt(label, opts) {
  try {
    const r = await validateXML(opts);
    console.log(`\n[${label}] valid=${r.valid}`);
    for (const e of r.errors) console.log('   -', e.rawMessage.trim());
  } catch (err) {
    console.log(`\n[${label}] THREW: ${String(err.message || err).split('\n').slice(0, 6).join(' | ')}`);
  }
}

const base = { schema: { fileName: 'entry.xsd', contents: entryXsd } };
const preloadData = { fileName: 'data_type.xsd', contents: dataXsd };

await attempt('A: no help (expect import failure)', { ...base, xml: { fileName: 'valid.xml', contents: valid } });
await attempt('B: catalog via --catalogs + SGML? (valid fixture)', {
  ...base, xml: { fileName: 'valid.xml', contents: valid },
  preload: [preloadData, { fileName: 'catalog.xml', contents: catalog }],
  modifyArguments: (a) => ['--nonet', '--catalogs', ...a],
});
await attempt('C: default catalog path /etc/xml/catalog (valid fixture)', {
  ...base, xml: { fileName: 'valid.xml', contents: valid }, disableFileNameValidation: true,
  preload: [preloadData, { fileName: '/etc/xml/catalog', contents: catalog }],
  modifyArguments: (a) => ['--nonet', ...a],
});

// D: our own wrapper schema (official files untouched). It imports the data namespace from the
// local copy first, then entry.xsd. libxml2 should skip entry.xsd's https import because that
// namespace is already loaded.
const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:sefer:local-wrapper">
  <xsd:import namespace="http://www.netchb.com/xml/data" schemaLocation="data_type.xsd"/>
  <xsd:import namespace="http://www.netchb.com/xml/entry" schemaLocation="entry.xsd"/>
</xsd:schema>`;
const wrapped = (name, xml) => ({
  schema: { fileName: 'wrapper.xsd', contents: wrapper },
  preload: [preloadData, { fileName: 'entry.xsd', contents: entryXsd }],
  xml: { fileName: name, contents: xml },
});
await attempt('D1: wrapper, valid synthetic fixture (expect valid=true)', wrapped('valid.xml', valid));
await attempt('D2: wrapper, invalid synthetic fixture (expect 3 specific errors)', wrapped('invalid.xml', invalid));
const sample = readFileSync(process.argv[2] ?? new URL('../schemas/netchb/reference/entry_sample.xml', import.meta.url), 'utf8');
await attempt('D3: wrapper, official NetCHB entry_sample.xml (research found dea-drug-code at line 758)', wrapped('entry_sample.xml', sample));
