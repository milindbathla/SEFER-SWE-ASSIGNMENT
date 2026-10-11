import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { XsdResult } from '@sefer/shared';
import { validateXML } from 'xmllint-wasm';

/**
 * Validates entry XML against the official NetCHB schemas with libxml2 (xmllint compiled to
 * WebAssembly, so it runs the same on Windows, macOS and Linux without native builds).
 *
 * The official files are used UNMODIFIED. entry.xsd imports data_type.xsd from an absolute
 * https:// URL that WebAssembly cannot fetch, so a small wrapper schema of our own imports the
 * local data_type.xsd first; libxml2 then reports "Skipping import ... since this namespace was
 * already imported" for the URL import. That informational warning is filtered out below.
 */

const SCHEMA_DIR = new URL('../../schemas/netchb/', import.meta.url);
const SOURCES: Record<string, string> = {
  'entry.xsd': 'https://www.netchb.com/xml/entry/entry.xsd',
  'data_type.xsd': 'https://www.netchb.com/xml/data/data_type.xsd',
};

const WRAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:sefer:local-wrapper">
  <xsd:import namespace="http://www.netchb.com/xml/data" schemaLocation="data_type.xsd"/>
  <xsd:import namespace="http://www.netchb.com/xml/entry" schemaLocation="entry.xsd"/>
</xsd:schema>`;

interface LoadedSchemas {
  entry: string;
  data: string;
  files: XsdResult['schemaFiles'];
}

let cached: LoadedSchemas | null = null;

function loadSchemas(): LoadedSchemas {
  if (cached) return cached;
  const read = (name: string) => readFileSync(fileURLToPath(new URL(name, SCHEMA_DIR)), 'utf8');
  const entry = read('entry.xsd');
  const data = read('data_type.xsd');
  const files = Object.entries({ 'entry.xsd': entry, 'data_type.xsd': data }).map(([file, text]) => ({
    file: `server/schemas/netchb/${file}`,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    source: SOURCES[file],
  }));
  cached = { entry, data, files };
  return cached;
}

const VALIDATOR = 'libxml2 via xmllint-wasm 5.3.0 (official entry.xsd + data_type.xsd, unmodified, loaded through a local wrapper schema)';
const IGNORABLE = /Skipping import of schema located at 'https:\/\/www\.netchb\.com\/xml\/data\/data_type\.xsd'/;

export async function validateEntryXml(xml: string): Promise<XsdResult> {
  let schemas: LoadedSchemas;
  try {
    schemas = loadSchemas();
  } catch (err) {
    return { ran: false, valid: null, errors: [], validator: VALIDATOR, schemaFiles: [], limitation: `Schema files could not be loaded (${(err as Error).message}). Only the rule-based checks ran; this is NOT XSD validation.` };
  }
  try {
    const result = await validateXML({
      xml: { fileName: 'entry.xml', contents: xml },
      schema: { fileName: 'wrapper.xsd', contents: WRAPPER },
      preload: [
        { fileName: 'data_type.xsd', contents: schemas.data },
        { fileName: 'entry.xsd', contents: schemas.entry },
      ],
    });
    const errors = result.errors
      .filter((e) => !IGNORABLE.test(e.rawMessage))
      .map((e) => ({ line: e.loc?.fileName === 'entry.xml' ? e.loc.lineNumber : null, message: e.message.replace(/\{http:\/\/www\.netchb\.com\/xml\/entry\}/g, '').trim() }));
    return {
      ran: true,
      valid: result.valid,
      errors,
      validator: VALIDATOR,
      schemaFiles: schemas.files,
      limitation: 'Structural validation against the public NetCHB schema only. It does not prove NetCHB will accept the entry (the public schema\'s currency is unconfirmed and NetCHB applies further business rules).',
    };
  } catch (err) {
    return { ran: false, valid: null, errors: [], validator: VALIDATOR, schemaFiles: schemas.files, limitation: `The XSD validator failed to run (${(err as Error).message}). Only the rule-based checks ran; this is NOT XSD validation.` };
  }
}
