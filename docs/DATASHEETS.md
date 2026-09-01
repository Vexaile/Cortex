# Datasheet / Document Intelligence

Cortex can import engineering documents (datasheets, reference manuals,
application notes) and answer questions against them with **citations** back to
the exact document, section, and line. This is engineering-context *retrieval*,
deliberately not "chat with a PDF": every result is a verbatim passage with real
provenance, and when nothing matches, the system says so rather than inventing a
value.

## Architecture

The subsystem follows the repo's pure-core / IO-shell split (the same shape as
`environment.ts` + `environmentService.ts`, and `agentContext.ts` +
`agentService.ts`):

```
src/shared/datasheet.ts        PURE: sectionizer, BM25 index + query, citation
                               formatter, hardware-graph query enrichment,
                               doc<->device matcher. No fs, no Electron.
src/main/services/datasheetService.ts   IO: import (copy into the corpus),
                               list, and search (parse -> index -> enrich ->
                               query). Owns the on-disk corpus + the index cache.
```

- **Corpus**: imported documents are copied into `<workspace>/.cortex/datasheets/`,
  tracked by a `manifest.json` there. The stored copy is the source of truth and
  is revealable in the editor, so a citation opens the doc at its line.
- **Retrieval**: a local **BM25** lexical index over the documents' sections. No
  embeddings and no network - offline, deterministic, and unable to make a claim
  it cannot back. The tokenizer keeps technical tokens whole (`0x68`, `GPIO5`,
  `TIM2`, `PA5`) because those are exactly what a datasheet query is about.
- **Provenance**: each section records the 1-based line it starts on (and a page
  once a PDF adapter supplies one). A `DocCitation` carries doc name, section
  title, line, and optional page; `formatCitation` / `formatDocHits` render it
  identically everywhere.
- **Correlation**: `KnownDevice.key` from the hardware graph is the join key. At
  import, `matchDeviceForDoc` links a document to a device the project uses (by
  whole-token name match). At query, `enrichQueryFromGraph` adds the used
  devices' terms so "the I2C sensor" biases toward the right part's datasheet -
  additive terms only, never an asserted correlation.

## Surfaces

Retrieval reaches the engineer three ways, all through the one `formatDocHits`
formatter so citations render identically:

1. **Datasheets panel** (`DatasheetsPanel.tsx`): Import, a search box, results as
   cited passages (click to open the doc at the line), and the imported-document
   list with its linked device.
2. **Agent tool** `search_docs` (SAFE/read-only, auto-run): the engineering
   agent looks up register/timing/electrical facts and cites them instead of
   recalling from memory.
3. **Chat + structured fallback**: the last question's top passages are
   pre-injected into context (with citations) for providers without tool-calling.

## Security

- The corpus is confined to `<workspace>/.cortex/datasheets/`.
- The **only** read of a path outside the workspace is the one user-chosen file
  at import, and that path comes from a native open dialog invoked in the **main
  process** (the `DATASHEET_IMPORT` handler) - never from the renderer or the AI.
- Stored names are sanitized (`safeName`) to a conservative charset with no path
  separators, and the write destination is `withinWorkspace`-checked. `LIST` and
  `QUERY` are root-gated exactly like `ENV_INSPECT`.
- `readFile` refuses binaries and oversized files, so a PDF or a huge blob is
  rejected with an honest message rather than parsed into garbage.

## Extension points

- **PDF (and other formats)**: add one extractor that produces the same
  `DatasheetSection[]` shape (with `page`); the index, citations, IPC, and panel
  do not change. See `docs/implementation/CORTEX_PROGRESS.md` for the contained
  PDF-adapter plan (pdfjs-dist legacy, lazy-loaded, optional dependency).
- **New device correlations**: add to `DEVICE_MAP` in `hardwareGraph.ts`;
  `KNOWN_DEVICES` and the doc matcher pick it up automatically.

## Testing

- `test/datasheet.test.ts` - the pure engine: tokenizer, sectionizers (line
  provenance), BM25 ranking + determinism + no-zero-score citations, citation
  formatting, enrichment, and the device matcher.
- `test/datasheetService.test.ts` - real IO: import copy + manifest + device
  link, binary refusal, name sanitization, search over the stored corpus, and
  cache invalidation on re-import.
- `test/agentTools.test.ts` - `search_docs` is registered read-only.
