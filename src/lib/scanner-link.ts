// Carry the hosting page across the app switch; never pick a deployment here.
export function plannerReturnURL(pageURL:string):string|null {
  try {
    const url=new URL(pageURL);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    // Do not forward sign-in tokens or a previously imported scan fragment.
    url.search='';url.hash='';
    return url.href.length<=4096?url.href:null;
  } catch {return null;}
}

export function scannerLaunchURL(pageURL:string):string|null {
  const returnURL=plannerReturnURL(pageURL);
  if(!returnURL)return null;
  const url=new URL('furniturear-scan://scan');
  url.searchParams.set('returnUrl',returnURL);
  return url.href;
}
