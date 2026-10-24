import type { AmazonProductResult } from './amazon';
import { getVariant } from './products';
import type { ProductItem } from './workspace';

/** Resolve the current preview, or its exact unmodeled saved copy, without changing identity or finish. */
export function resolveModelItem(item:ProductItem,previewId:string,result:AmazonProductResult,matchSaved=false):ProductItem {
  const sameUnmodeledSaved=matchSaved&&!item.product&&item.sourceUrl===result.listing.url;
  if((item.id!==previewId&&!sameUnmodeledSaved)||item.listing?.asin!==result.listing.asin)return item;
  // A late response must not undo a finish already chosen by the user.
  const current=item.product?getVariant(item.product,item.variantId):undefined;
  if(current?.asin&&current.asin!==result.listing.asin)return item;
  if(item.product&&!result.product)return item;
  const variant=result.product?.variants.find(option=>option.id===current?.id&&option.asin===current?.asin)
    ??result.product?.variants.find(option=>option.asin===result.listing.asin);
  return {...item,name:result.listing.title,sourceUrl:result.listing.url,listing:result.listing,product:result.product,
    ...(variant?{variantId:variant.id}:{})};
}
