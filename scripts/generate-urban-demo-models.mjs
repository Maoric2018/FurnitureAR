import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// These original, deliberately lightweight approximations are presentation
// assets, not manufacturer CAD. No listing photographs or external textures
// are embedded. All visible colors are ordinary PBR materials for iOS export.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result=result; this.onloadend?.(); }); }
};
const output=new URL('../public/models/urban-demo/',import.meta.url);
await mkdir(output,{recursive:true});
const exporter=new GLTFExporter();
const material=(name,color,roughness=.88,metalness=0)=>{
  const value=new THREE.MeshStandardMaterial({color,roughness,metalness});value.name=name;return value;
};
const palette={
  black:material('Powder coated charcoal','#262623',.6,.12),
  edge:material('Black metal edge','#181916',.48,.3),
  linen:material('Beige linen shade','#e9dfc7',.98),
  linenThread:material('Linen seam and weave','#cdbd9b',1),
  bulb:material('Warm frosted bulb','#fff0cb',.7),
  rug:material('Cream polypropylene pile','#e5dfd2',1),
  rugWeft:material('Woven ivory variation','#d7cfbe',1),
  stripe:material('Khalil charcoal stripe','#34332f',1),
  stripeSoft:material('Khalil softened stripe fibers','#5a5750',1),
  oak:material('Light oak frame','#a98756',.68),
  oakLight:material('Frame bevel highlight','#c4a476',.7),
  back:material('Frame backing','#887963',1),
  canvas:material('Ivory canvas','#f0ede5',1),
  canvasWarm:material('Subtle canvas grain','#e4dfd2',1),
  taupe:material('Warm taupe abstract paint','#a58f73',1),
  taupeLight:material('Dry taupe brush strokes','#bcaa91',1),
  ink:material('Abstract charcoal paint','#242322',1),
};
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function add(group,geometry,mat,pos=[0,0,0]){const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(...pos);group.add(mesh);return mesh;}
function box(group,size,pos,mat,radius=0){return add(group,radius?new RoundedBoxGeometry(...size,2,radius):new THREE.BoxGeometry(...size),mat,pos);}
function cylinder(group,radius,height,pos,mat,segments=48){return add(group,new THREE.CylinderGeometry(radius,radius,height,segments),mat,pos);}
function tube(group,points,radius,mat,segments=56){return add(group,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),segments,radius,6,false),mat);}

function lamp(){
  const group=new THREE.Group();
  // The listing gives the 11-inch shade and 8.66-inch base. The arm reach is
  // estimated from its photograph; total width is explicitly approximate.
  const baseRadius=.219964/2, shadeRadius=.2794/2, top=1.56972;
  cylinder(group,baseRadius,.028,[0,.014,0],palette.black,72);
  cylinder(group,baseRadius-.005,.005,[0,.0305,0],palette.edge,72);
  cylinder(group,.0068,top-.052,[0,(top-.052)/2+.033,0],palette.black,24);
  cylinder(group,.008,.018,[0,.57,0],palette.edge,24);
  cylinder(group,.008,.018,[0,1.09,0],palette.edge,24);
  add(group,new THREE.SphereGeometry(.011,20,12),palette.black,[0,top-.011,0]);
  tube(group,[[0,1.482,0],[.067,1.528,0],[.15,1.555,0],[.25,1.558,0]],.006,palette.black);
  cylinder(group,.0045,.056,[.244,1.525,0],palette.edge,20);
  const shadeY=1.3898, shadeH=.199898;
  const shell=new THREE.MeshStandardMaterial({color:'#e9dfc7',roughness:1});shell.name='Beige linen drum';
  add(group,new THREE.CylinderGeometry(shadeRadius,shadeRadius,shadeH,80,1,true),shell,[.244,shadeY,0]);
  // Give the shade an actual inward-facing lining. USDZ does not support a
  // double-sided flag, so two physical surfaces preserve the interior in AR.
  const lining=new THREE.CylinderGeometry(shadeRadius-.001,shadeRadius-.001,shadeH,80,1,true);
  for(let i=0;i<lining.index.array.length;i+=3){const b=lining.index.array[i+1];lining.index.array[i+1]=lining.index.array[i+2];lining.index.array[i+2]=b;}
  for(let i=0;i<lining.attributes.normal.array.length;i++)lining.attributes.normal.array[i]*=-1;
  add(group,lining,shell,[.244,shadeY,0]);
  for(const y of [shadeY-shadeH/2,shadeY+shadeH/2]){
    const ring=add(group,new THREE.TorusGeometry(shadeRadius-.0015,.0025,7,80),palette.linenThread,[.244,y,0]);ring.rotation.x=Math.PI/2;
  }
  // Sparse raised seams provide texture without an image dependency.
  for(let i=0;i<48;i++){
    const angle=i*Math.PI*2/48;
    cylinder(group,.00028,shadeH-.006,[.244+Math.cos(angle)*(shadeRadius+.0001),shadeY,Math.sin(angle)*(shadeRadius+.0001)],palette.linenThread,4);
  }
  cylinder(group,.012,.052,[.244,1.448,0],palette.edge,20);
  const bulb=add(group,new THREE.SphereGeometry(.026,20,12),palette.bulb,[.244,1.407,0]);bulb.scale.y=1.35;
  for(const z of [-.04,.04]) tube(group,[[.244,1.482,0],[.244,1.482,z],[.244,1.482,Math.sign(z)*.132]],.0011,palette.linenThread,8);
  return group;
}
function shape(group,points,mat,position=[0,0,0],horizontal=false){
  const value=new THREE.Shape();points.forEach(([x,y],i)=>i?value.lineTo(x,y):value.moveTo(x,y));value.closePath();
  const geo=new THREE.ShapeGeometry(value);if(horizontal)geo.rotateX(-Math.PI/2);
  return add(group,geo,mat,position);
}
function rug(){
  const group=new THREE.Group(),rand=random(205711),w=1.2192,d=1.8288,h=.009906;
  box(group,[w,h-.00045,d],[0,(h-.00045)/2,0],palette.rug,.0035);
  // Horizontal, irregular broken bands follow the verified Khalil pattern.
  for(let row=0;row<61;row++){
    const z=-d/2+.035+row*(d-.07)/60;
    const wide=row%11!==0;
    const start=-w/2+.022+(wide?0:rand()*.25),end=w/2-.022-(row%7===0?rand()*.5:rand()*.065);
    const thickness=.007+rand()*.009;
    const points=[],samples=42;
    for(let i=0;i<=samples;i++)points.push([start+(end-start)*i/samples,z+thickness/2+(rand()-.5)*.007]);
    for(let i=samples;i>=0;i--)points.push([start+(end-start)*i/samples,z-thickness/2+(rand()-.5)*.007]);
    shape(group,points,row%4===0?palette.stripeSoft:palette.stripe,[0,h,0],true);
    // A few cream interruptions make the strokes feel woven instead of printed.
    for(let k=0;k<8;k++){
      const x=start+rand()*(end-start),length=.008+rand()*.035;
      shape(group,[[x,z-.001],[Math.min(end,x+length),z-.001],[Math.min(end,x+length),z+.001],[x,z+.001]],palette.rug,[0,h+.00004,0],true);
    }
  }
  // Fine selvage binding on the long edges.
  for(const x of [-w/2+.004,w/2-.004])box(group,[.005,.002,d-.008],[x,h-.001,0],palette.rugWeft,.0005);
  return group;
}

function artwork(index){
  const group=new THREE.Group(),w=.4064,h=.6096,d=.025,fw=.010;
  box(group,[w-.008,h-.008,.009],[0,h/2,-.008],palette.back);
  box(group,[w-fw*2,h-fw*2,.009],[0,h/2,.001],palette.canvas);
  for(const x of [-w/2+fw/2,w/2-fw/2])box(group,[fw,h,d],[x,h/2,0],palette.oak,.0012);
  for(const y of [fw/2,h-fw/2])box(group,[w-fw*2,fw,d],[0,y,0],palette.oak,.0012);
  for(const x of [-w/2+fw,w/2-fw])box(group,[.0018,h-fw*2,.002],[x,h/2,.0118],palette.oakLight);
  for(const y of [fw,h-fw])box(group,[w-fw*2,.0018,.002],[0,y,.0118],palette.oakLight);
  const cw=w-fw*2-.001,ch=h-fw*2-.001,front=.0063;
  const point=([x,y])=>[(x-.5)*cw,fw+y*ch];
  const paint=(points,mat,z=front)=>shape(group,points.map(point),mat,[0,0,z]);
  const rand=random(852+index*721);
  // Quiet canvas variations stay behind the opaque brush shapes.
  for(let k=0;k<70;k++){
    const x=rand(),y=rand(),s=.002+rand()*.007;
    paint([[x,y],[Math.min(.999,x+s),y],[Math.min(.999,x+s),Math.min(.999,y+s*.35)],[x,Math.min(.999,y+s*.35)]],palette.canvasWarm,front+.00001);
  }
  function swath(x,y,width,height,mat,seed){
    const jitter=random(seed),points=[];
    for(let i=0;i<=25;i++)points.push([Math.min(.999,Math.max(.001,x+i*width/25)),Math.min(.999,Math.max(.001,y+(jitter()-.5)*.02))]);
    for(let i=25;i>=0;i--)points.push([Math.min(.999,Math.max(.001,x+i*width/25)),Math.min(.999,Math.max(.001,y+height+(jitter()-.5)*.028))]);
    paint(points,mat,front+.00011);
  }
  if(index===1){
    paint([[.001,.001],[.001,.82],[.15,.79],[.36,.69],[.48,.56],[.52,.001]],palette.taupe);
    swath(.26,.14,.63,.13,palette.ink,114);
    swath(.28,.27,.52,.012,palette.ink,415);
    swath(.01,.67,.26,.012,palette.taupeLight,127);
  }else if(index===2){
    paint([[.31,.999],[.61,.999],[.56,.43],[.41,.31],[.29,.43]],palette.ink);
    paint([[.49,.001],[.84,.001],[.79,.54],[.58,.57],[.43,.45]],palette.taupe);
    swath(.62,.59,.36,.015,palette.canvas,829);
    swath(.67,.63,.31,.011,palette.canvas,719);
  }else{
    paint([[.12,.999],[.3,.999],[.27,.62],[.21,.54],[.13,.6]],palette.taupe);
    paint([[.55,.001],[.999,.001],[.999,.37],[.91,.53],[.76,.49],[.69,.34]],palette.ink);
    swath(.57,.15,.4,.027,palette.ink,329);
  }
  const line=index===1?[[.28,.999],[.22,.83],[.24,.70],[.21,.56],[.25,.39],[.31,.17],[.35,.001]]:
    index===2?[[.22,.999],[.24,.75],[.22,.45],[.3,.31],[.39,.36],[.28,.4],[.26,.32],[.28,.001]]:
    [[.12,.001],[.13,.2],[.31,.36],[.6,.55],[.61,.68],[.49,.77],[.31,.68],[.17,.48],[.29,.43],[.61,.46],[.78,.58],[.82,.999]];
  tube(group,line.map(p=>[...point(p),front+.0005]),.00065,palette.ink,110);
  tube(group,[[.001,.145],[.25,.137],[.53,.144],[.81,.15],[.999,.153]].map(p=>[...point(p),front+.00055]),.00075,palette.ink,60);
  return group;
}

function bake(group,dimensions,name){
  group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(group,true),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const transform=new THREE.Matrix4().makeScale(dimensions.width/size.x,dimensions.height/size.y,dimensions.depth/size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
  const geometries=new Map();
  group.traverse(child=>{if(!child.isMesh)return;
    let geo=child.geometry.clone();geo.applyMatrix4(child.matrixWorld);geo.applyMatrix4(transform);
    if(geo.index)geo=geo.toNonIndexed();
    const existing=geometries.get(child.material)??[];existing.push(geo);geometries.set(child.material,existing);
  });
  const baked=new THREE.Group();baked.name=name;
  for(const [mat,list]of geometries){const geometry=mergeGeometries(list,false);const child=new THREE.Mesh(geometry,mat);child.name=mat.name;baked.add(child);}
  baked.userData={dimensionsMeters:dimensions,prototype:true,accuracy:'Original photo-informed visual approximation; not manufacturer CAD.',units:'meters',front:'+Z',origin:'bottom center'};
  return baked;
}
const entries=[
  {id:'ambimall-floor-lamp',name:'Ambimall offset-arm floor lamp',asin:'B0C4DGFFCM',dimensions:{width:.5,height:1.56972,depth:.2794},build:lamp,
    note:'Shade diameter11in, base8.66in, listed height61.8in. Overall0.50m width/arm reach is estimated from the reference; not the misleading11in listing width.'},
  {id:'jonathan-y-khalil-rug',name:'JONATHAN Y Khalil cream/black 4×6 rug',asin:'B081D81DBX',dimensions:{width:1.2192,height:.009906,depth:1.8288},build:rug,
    note:'Nominal4×6ft rug; .39in pile from manufacturer. Original irregular stripe geometry approximates the listed pattern.'},
  ...[1,2,3].map(index=>({id:`kairne-abstract-${index}`,name:`KAIRNE neutral abstract wall art · panel ${index}`,asin:'B0D7MGQ5H6',dimensions:{width:.4064,height:.6096,depth:.025},build:()=>artwork(index),
    note:'One panel of the16×24in three-panel set. Overalldepth0.025m and frame width estimated; original geometric interpretation of the listed artwork.'})),
];
function thumbnail(id){
  const backdrop='<rect width="480" height="480" rx="28" fill="#eeebe4"/>';
  let content='';
  if(id==='ambimall-floor-lamp'){
    content='<ellipse cx="217" cy="421" rx="85" ry="13" fill="#d8d1c4"/><path d="M176 403V74M177 89Q215 61 283 67" fill="none" stroke="#262623" stroke-width="6" stroke-linecap="round"/><ellipse cx="176" cy="404" rx="42" ry="9" fill="#292a25"/><path d="M280 68V82" stroke="#262623" stroke-width="4"/><ellipse cx="282" cy="89" rx="48" ry="10" fill="#d0bd99"/><path d="M234 89V144Q282 160 330 144V89Q282 103 234 89" fill="#e9dfc7" stroke="#c7b38e" stroke-width="2"/><ellipse cx="282" cy="144" rx="48" ry="10" fill="#f2e7ca"/><path d="M242 97V141M254 99V148M267 101V151M282 102V153M297 101V151M311 99V148M323 96V142" stroke="#d3c29f" stroke-width="1"/>';
  }else if(id==='jonathan-y-khalil-rug'){
    const rand=random(1124);let stripes='';
    for(let row=0;row<40;row++){const y=55+row*9.1,x=102+rand()*14,end=377-(row%7===0?rand()*75:rand()*12);stripes+=`<path d="M${x.toFixed(1)} ${y.toFixed(1)}Q240 ${(y+rand()*3).toFixed(1)} ${end.toFixed(1)} ${(y+1.4).toFixed(1)}" fill="none" stroke="${row%4===0?'#57534b':'#33312c'}" stroke-width="${(2+rand()*1.5).toFixed(1)}"/>`;}
    content=`<rect x="90" y="38" width="300" height="410" rx="6" fill="#d8d1c4"/><rect x="86" y="31" width="300" height="410" rx="3" fill="#e5dfd2" stroke="#cfc5b2" stroke-width="2"/>${stripes}`;
  }else{
    const i=Number(id.at(-1));
    const paint=i===1?'<path d="M115 430V130Q250 147 265 252V430" fill="#a58f73"/><path d="M168 322L353 326L349 368L156 365Z" fill="#242322"/><path d="M194 50L179 160L181 252L207 430" stroke="#242322" stroke-width="1.5" fill="none"/>':i===2?'<path d="M198 50L281 50L269 246L215 285L195 220Z" fill="#242322"/><path d="M245 430L329 430L317 224L266 222L230 279Z" fill="#a58f73"/><path d="M178 50L183 257Q224 300 233 267Q213 241 186 261L200 430" fill="none" stroke="#242322" stroke-width="1.4"/>':'<path d="M151 50L203 50L194 199Q176 237 155 202Z" fill="#a58f73"/><path d="M265 430L365 430L365 283L345 232L305 256Z" fill="#242322"/><path d="M151 430Q144 331 255 243Q311 177 272 155Q221 107 164 244Q125 295 260 258L310 221L319 50" fill="none" stroke="#242322" stroke-width="1.5"/>';
    content=`<rect x="104" y="42" width="280" height="405" fill="#d8d1c4"/><rect x="99" y="35" width="280" height="405" fill="#a98756"/><rect x="110" y="46" width="258" height="383" fill="#f0ede5"/>${paint}<path d="M110 372Q240 366 368 373" stroke="#242322" stroke-width="2" fill="none"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" role="img"><title>Original approximate product illustration</title>${backdrop}${content}</svg>\n`;
}
const report=[];
for(const entry of entries){
  const model=bake(entry.build(),entry.dimensions,entry.name),scene=new THREE.Scene();scene.add(model);
  const glb=await exporter.parseAsync(scene,{binary:true,onlyVisible:true});
  await writeFile(new URL(`${entry.id}.glb`,output),Buffer.from(glb));
  await writeFile(new URL(`${entry.id}.svg`,output),thumbnail(entry.id));
  model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model,true),size=box.getSize(new THREE.Vector3());
  const triangles=model.children.reduce((n,mesh)=>n+mesh.geometry.attributes.position.count/3,0);
  for(const [axis,expected]of [['x',entry.dimensions.width],['y',entry.dimensions.height],['z',entry.dimensions.depth]])if(Math.abs(size[axis]-expected)>1e-6)throw Error(`Wrong dimensions for ${entry.id}`);
  if(Math.abs(box.min.y)>1e-6)throw Error(`Model is not grounded: ${entry.id}`);
  report.push({id:entry.id,name:entry.name,asin:entry.asin,url:`https://www.amazon.com/dp/${entry.asin}`,modelSrc:`/models/urban-demo/${entry.id}.glb`,thumbnailSrc:`/models/urban-demo/${entry.id}.svg`,dimensions:entry.dimensions,bytes:glb.byteLength,triangles,materials:model.children.length,notes:entry.note});
}
await writeFile(new URL('metadata.json',output),JSON.stringify({license:'Original procedural demo assets',accuracy:'Approximate product visualization. No manufacturer model or listing photograph is embedded.',models:report},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
