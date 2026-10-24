These modules are adapted from the partner's `amazon-furniture-api-with-key.zip`:

- `serpapi.js`: SerpApi HTTP client, bounded responses, concurrency and safe errors.
- `serp-normalize.js`: product/price/image/dimension normalization.
- `errors.js`: typed API failures.

Worker compatibility changes in the transport:

1. Call fetch with its global receiver, avoiding an illegal invocation in Workers.
2. Use manual redirects (Workers does not support `redirect: 'error'`). Non-2xx responses fail without following redirects or disclosing provider URLs.

The normalizer also retains explicitly labeled dimensions when an unlabeled duplicate contains exactly the same three lengths. It still rejects unlabeled-only and conflicting measurements.

The Node HTTP server, local `.env`, example CLI, and unrelated search/Creators API routes are not shipped to the browser or the hosted Worker. The full original package remains outside this repository in the local `partner-import` directory. Runtime authentication, caching, URL validation and the Furniture AR response adapter live one directory above these modules.
