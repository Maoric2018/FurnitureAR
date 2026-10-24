# Integration checks — October 24, 2026

- App: all 44 automated tests and the production build passed.
- Partner package: all 86 original tests passed. Its 13 normalization tests also passed against the adapted normalizer used by this app.
- Live SerpApi lookups returned the Little Tree table, Ambimall lamp, and a Virabit dining chair listing. A separate search result could not be retrieved by the product endpoint; the interface showed the failure instead of a placeholder.
- Browser checks covered sign-in prompting, real prices/photos/dimensions, model loading, a saved layout containing the table and lamp, combined model export, and saving/reopening a product without a model. The phone-sized layout was checked at 390 × 844.
- Source and production output were scanned for the supplied SerpApi key and local Hugging Face token; neither was embedded.
- The published website loads and rejects anonymous imports with a sign-in prompt. The complete signed-in flow was tested locally using the Sites development identity; the browser's hosted OpenAI login was not completed.

Physical iPhone/Android camera AR has not been tested here. Registered models are supplied approximations, and arbitrary Amazon photos do not yet generate models through the app. Listing measurements can be missing or disagree with model geometry; the interface keeps both sources distinct.

The separate [Mac SAM 3D experiment](experiments/README.md) generated and exported the isolated table example in 601.2 seconds. Its CPU-decoded mesh had zero invalid vertices/faces; the final 20,000-triangle textured GLB passed geometry/texture checks and visual inspection. Small reconstruction artifacts remain, and its scale has not been verified.
