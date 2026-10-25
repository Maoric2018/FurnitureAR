/**
 * Replace this adapter when the image-to-3D service is ready.
 *
 * start receives { asin, url, imageUrl, listing, idempotencyKey, signal }.
 * poll receives the same fields plus jobId. Return one of:
 *   { status: 'not_configured' }
 *   { status: 'pending', jobId: 'provider-job-id' }
 *   { status: 'failed' }
 *   { status: 'ready', glb: Uint8Array, dimensions: { width, height, depth },
 *     colorName?, color?, category?, material? }
 * Dimensions are in meters and must match the GLB's actual world bounds. Output
 * uses meters, Y-up, centered on X/Z, with its floor at Y=0. GLBs must contain
 * their resources. The provider must honor idempotencyKey: coalescing
 * in the model service is per Worker instance, not a distributed job lock.
 * Increment version when changing the adapter so an earlier unconfigured
 * result can be retried. Ready models remain reusable across adapter versions.
 */
export const modelGenerator = {
  version: 'image-to-glb-placeholder-v1',
  async start(_input) { return { status: 'not_configured' }; },
  async poll(_input) { return { status: 'not_configured' }; },
};
