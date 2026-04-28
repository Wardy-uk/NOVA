export interface RawDocument {
  sourceDocId: string;
  path: string;
  title: string;
  url: string;
  markdown: string;
}

export interface KbSyncProvider {
  readonly source: string;
  fetchDocuments(): AsyncIterable<RawDocument>;
}
