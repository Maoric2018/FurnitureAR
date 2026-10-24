# Amazon product import

The app uses the partner's SerpApi transport and normalizer through a same-origin server route. It supports US Amazon product URLs (`/dp/`, `/gp/product/`, `/gp/aw/d/`) and bare ASINs. Short links must first be expanded in a browser. Other stores and marketplaces return a clear error without being fetched.

## Run locally

1. `npm ci`
2. Copy `.dev.vars.example` to `.dev.vars` and set `SERPAPI_API_KEY`.
3. `npm run dev`
4. Open the printed localhost address. The local sign-in link uses the Sites development identity.

`.dev.vars` is ignored by Git. Never put the API key in a `VITE_` variable. Hosted deployments use the Sites runtime secret named `SERPAPI_API_KEY`.

## Request and response

`POST /api/products/import` with `Content-Type: application/json`:

```json
{"url":"https://www.amazon.com/dp/B0F2ML48Y6"}
```

The response contains `listing`, `product`, and `cached`. `listing` has the real title, brand, photo URLs, price (nullable), availability (nullable), feature text, raw listing dimensions, normalized dimensions (nullable), ASIN and retrieval timestamp. `product` is a validated FurnitureProduct with geometry dimensions and a model URL **only when a model is registered for the confirmed ASIN**; otherwise it is null.

The UI can save and reopen listings without models. Those listings cannot enter a floor plan or launch AR. No unrelated placeholder is substituted. Previously saved placeholder products still reopen.

Errors use `{ "error": { "code": "...", "message": "..." } }`. The UI handles sign-in, invalid URLs, unavailable products, provider failures, quota limits, and timeouts. A returned ASIN mismatch blocks model association. Secrets and raw upstream responses never go to the client.

## Registered models

| ASIN | Asset | Scale |
| --- | --- | --- |
| B0F2ML48Y6 | Little Tree oak table | Approximately 1.20 × 1.20 × 0.75 m |
| B0C4DGFFCM | Ambimall floor lamp | 1.524 m tall; bounds include the cord |

Both assets are manually created approximations supplied by the project team. They are not Amazon-provided or SAM-generated. The lamp's root is translated to center its complete footprint on the floor; its geometry, textures and scale are retained.

Model bounds and listing measurements stay separate. In the live test, the lamp listing specified 61.8 inches while its model is 60 inches. The table included both labeled and unlabeled duplicate measurements. The integrated normalizer retains the explicit axes when the duplicate contains exactly the same three lengths. Ambiguous measurements alone, conflicting fields, and shipping dimensions remain unknown. No supplied asset is rescaled to hide a mismatch.

## Request controls

Imports require the trusted Sites signed-in user header. Browser POSTs must be same-origin JSON. There is a 4 KB body limit, strict host/ASIN validation, 60-second upstream timeout, and 65-second browser timeout. Each Worker instance caches successful results for one hour, coalesces simultaneous requests for the same ASIN, allows up to four different in-flight lookups, and limits uncached imports to eight per user per minute. These per-instance limits are prototype safeguards, not a durable account-wide billing cap. SerpApi's own cache remains enabled; live requests share the supplied account's allowance.

SAM 3D generation is a separate local experiment. This route does not yet generate new models from product photos.
