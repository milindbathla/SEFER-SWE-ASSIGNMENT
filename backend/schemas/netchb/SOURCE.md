# Vendored NetCHB schema files

These files are **unmodified copies** of NetCHB's publicly served files. They are used for local
structural validation only.

| File | Source URL | SHA-256 (verified identical to the live file on 2026-10-10) |
|---|---|---|
| `entry.xsd` | https://www.netchb.com/xml/entry/entry.xsd | `1bef18d4121f83f7f09a7346fa9d4a1a37310730363b66e6724908a3e5dc7132` |
| `data_type.xsd` | https://www.netchb.com/xml/data/data_type.xsd | `c1c529ad31045c37f794a4ec230975868d788b5d661348794aa4ffe9b3eb45fc` |
| `reference/entry_sample.xml` | https://www.netchb.com/xml/entry/entry_sample.xml | `258658ab7b349b4b4bd2be0c8a492b8c7063b6b8da8c9ea8e2b4fb377cc4256e` (reference fixture only) |

Notes (see `docs/research-log.md`):

- `entry.xsd` imports `data_type.xsd` from an absolute `https://` URL. The validator does **not**
  edit that import; it loads a small wrapper schema of its own that imports the local
  `data_type.xsd` first (`server/src/entry/xsdValidator.ts`).
- The official `entry_sample.xml` does **not** validate against `entry.xsd`: line 758,
  `dea-drug-code` "This element is not expected" (RL-5). It is not treated as authoritative.
- Whether this public schema matches NetCHB's production schema is **unconfirmed**.
