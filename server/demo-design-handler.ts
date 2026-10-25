/** No provider calls or body/photo processing while the prepared demo is enabled. */
export function handleDemoDesign(request:Request):Response {
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(request.method==='GET')return Response.json({mode:'demo',configured:false,shopping:false,signedIn:false,authorized:true},{headers});
  if(request.method==='POST')return Response.json({error:{code:'DESIGN_DEMO_MODE',message:'Live AI design is disabled. The website uses the prepared Urban High-Rise demo.'}},{status:503,headers});
  return Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'Use GET to check demo status.'}},{status:405,headers:{...headers,Allow:'GET, POST'}});
}
