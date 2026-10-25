import { createUrbanDemoProposals } from '../src/lib/urban-demo';
import type { DesignResult } from '../src/lib/design';

/** Keep the temporary preset and its timing server-side; no provider or request-body processing. */
async function waitForDesign(signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},3400);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
  signal.throwIfAborted();
}
export async function handleDemoDesign(request:Request):Promise<Response> {
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method==='GET')return Response.json({configured:true,shopping:false,signedIn:!!request.headers.get('oai-authenticated-user-id')?.trim(),authorized:true},{headers});
  if(request.method!=='POST')return Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'Use POST to design a room.'}},{status:405,headers:{...headers,Allow:'GET, POST'}});
  await waitForDesign(request.signal);
  const result:DesignResult={
    summary:'Three urban high-rise directions pair a graphic rug, warm lighting and an abstract gallery with the room’s existing furniture.',
    observations:['The bed, desk and chair remain as measured furniture outlines.','Wall art sits above the furniture, with room around the doorways.'],
    proposals:createUrbanDemoProposals(),
    notices:['Select a direction to save it as a new layout. Product links open on Amazon.'],
  };
  return Response.json(result,{headers});
}
