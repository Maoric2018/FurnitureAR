# Mobile hosting

This independent deployment is based on GitHub commit `8d3ce5d` and preserves the original repository’s Site identity in that repository. This copy has its own `.openai/hosting.json` and source repository.

- Site: https://furniture-ar-mobile-20261024.notyourmewtwo.chatgpt.site
- Audience: owner-private. Sign in with the account used to create the Site.
- Photo generation: server secrets `MODEL_API_URL` and `MODEL_API_KEY` connect the existing Runpod SAM 3D service. The website does not depend on the Mac staying online.
- Runpod and its current temporary HTTPS service connection must remain active. If that connection changes, update `MODEL_API_URL` in the Site’s runtime secrets.
- Amazon searches and fresh product imports additionally need `SERPAPI_API_KEY`; this is not configured yet.
- Generated Amazon models persist in this Site’s `MODEL_BUCKET`. Local development cache data is separate.
- On a compatible phone, open the HTTPS website in Safari (iPhone) or Chrome (Android), choose Photo to 3D, capture/upload a photo, generate, then enter a measured height before AR. Camera permission and real AR tracking must be tested on the phone.

Same-origin product requests retain Site sign-in cookies for private hosting. Public-site guest handlers remain available without requiring identity; no provider keys are sent by the browser.
