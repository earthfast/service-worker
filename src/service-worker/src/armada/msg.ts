export const MsgManifestFetchError = (error: string) => ({
  action: 'MANIFEST_FETCH_ERROR',
  error,
});

export const MsgManifestFetchNoConsensus = (error: string) => ({
  action: 'MANIFEST_FETCH_FAILURE_NO_CONSENSUS',
  error,
});

export const MsgContentNodeFetchFailure = (error: string) => ({
  action: 'CONTENT_NODE_FETCH_FAILURE',
  error,
});

export const MsgContentNodesFetchFailure = (error: string) => ({
  action: 'CONTENT_NODES_FETCH_FAILURE',
  error,
});

export const MsgContentChecksumMismatch = (error: string) => ({
  action: 'CONTENT_CHECKSUM_MISMATCH',
  error,
});