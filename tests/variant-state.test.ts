import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, getVariant, parseProduct } from '../src/lib/products.ts';
import { createLayout, createProductItem, duplicateLayout, parseWorkspace, placeItem, placeholderProduct, readWorkspace, saveWorkspace, selectItemVariant } from '../src/lib/workspace.ts';

test('The placeholder palette retains original oak and marks all added finishes as approximate previews',()=>{
  const product=parseProduct(placeholderProduct);
  assert.deepEqual(product.variants.map(({id,name,color})=>({id,name,color})),[
    {id:'oak',name:'Oak',color:'#b68d5d'},
    {id:'black',name:'Black',color:'#292929'},
    {id:'grey',name:'Grey',color:'#878781'},
    {id:'light-brown',name:'Light Brown',color:'#b5936b'},
    {id:'rustic-brown',name:'Rustic Brown',color:'#73513b'},
    {id:'white',name:'White',color:'#eeeae2'},
    {id:'brown',name:'Brown',color:'#79533b'},
  ]);
  assert.equal(product.variants[0].materialOverrides,undefined);
  for(const variant of product.variants){
    assert.equal(variant.modelSrc,'/models/little-tree-oak-table.glb');
    assert.equal(variant.asin,undefined);
    assert.equal(variant.productUrl,undefined);
  }
  for(const variant of product.variants.slice(1)){
    assert.equal(variant.approximate,true);
    assert.deepEqual(variant.materialOverrides,[{materialName:'Oak | original grain texture',color:variant.color}]);
  }
});

test('Selecting a finish returns a copy and preserves item identity, source, placement and product order',()=>{
  const item={...createProductItem('https://example.com/table'),x:.5,z:-.3,rotation:90};
  const before=JSON.parse(JSON.stringify(item));
  const changed=selectItemVariant(item,'black');
  assert.notEqual(changed,item);
  assert.deepEqual(changed,{...before,variantId:'black'});
  assert.deepEqual(item,before);
  assert.equal(changed.product,item.product);
  assert.equal(changed.id,item.id);
  assert.equal(changed.sourceUrl,item.sourceUrl);
  assert.equal(item.variantId,'oak');
  assert.throws(()=>selectItemVariant(item,'missing-finish'),/available finish/);
  assert.throws(()=>selectItemVariant(item,''),/available finish/);
});

test('Saved selections survive placement, independent finish changes, duplication and storage reload',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const stored=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>stored.get(key)??null,
    setItem:(key:string,value:string)=>stored.set(key,value),
  }});
  try {
    const saved=selectItemVariant(createProductItem('https://example.com/table'),'black');
    let room=placeItem(placeItem(createLayout('Dining room'),saved),saved);
    room={...room,items:[room.items[0],selectItemVariant(room.items[1],'white')]};
    assert.equal(saved.variantId,'black');
    assert.equal(room.items[0].variantId,'black');
    assert.equal(room.items[1].variantId,'white');
    const copy=duplicateLayout(room);
    assert.notEqual(copy.id,room.id);
    for(let index=0;index<room.items.length;index++){
      assert.notEqual(copy.items[index].id,room.items[index].id);
      assert.equal(copy.items[index].variantId,room.items[index].variantId);
      assert.equal(copy.items[index].x,room.items[index].x);
      assert.equal(copy.items[index].z,room.items[index].z);
    }
    const workspace={layouts:[room,copy],items:[saved]};
    assert.equal(saveWorkspace(workspace),true);
    assert.deepEqual(readWorkspace(),workspace);
  } finally {
    if(descriptor) Object.defineProperty(globalThis,'localStorage',descriptor);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});

test('Missing, malformed and retired saved selections safely use the first finish',()=>{
  const item=createProductItem('https://example.com/chair',catalog[0]);
  for(const variantId of [undefined,'retired',null,27,{}]){
    const restored=parseWorkspace({items:[{...item,variantId}],layouts:[]}).items[0];
    assert.equal(restored.variantId,catalog[0].variants[0].id);
    assert.equal(getVariant(restored.product,restored.variantId),restored.product.variants[0]);
    assert.equal(restored.id,item.id);
    assert.equal(restored.sourceUrl,item.sourceUrl);
  }
  const chosen=selectItemVariant(item,catalog[0].variants[2].id);
  assert.equal(parseWorkspace({items:[chosen],layouts:[]}).items[0].variantId,chosen.variantId);
});

test('Old single-oak placeholders gain the new palette in both saved items and layouts',()=>{
  const oldProduct={...placeholderProduct,variants:[placeholderProduct.variants[0]]};
  const saved=createProductItem('https://example.com/table',oldProduct);
  const oldSaved={...saved};
  delete oldSaved.variantId;
  const room=placeItem(createLayout('Dining room'),oldSaved);
  const restored=parseWorkspace({items:[oldSaved],layouts:[room]});
  for(const item of [restored.items[0],restored.layouts[0].items[0]]){
    assert.equal(item.variantId,'oak');
    assert.deepEqual(item.product.variants,placeholderProduct.variants);
    assert.equal(item.sourceUrl,saved.sourceUrl);
  }
  assert.equal(restored.items[0].id,saved.id);
  assert.equal(restored.layouts[0].items[0].id,room.items[0].id);
  assert.equal(restored.layouts[0].items[0].x,room.items[0].x);
  assert.equal(restored.layouts[0].items[0].z,room.items[0].z);
  assert.equal(oldSaved.product.variants.length,1);
  const alreadySelected=parseWorkspace({items:[{...saved,variantId:'black'}],layouts:[]}).items[0];
  assert.equal(alreadySelected.variantId,'black');
});

test('Palette migration never expands unrelated products or replaces an existing palette',()=>{
  const oak=placeholderProduct.variants[0];
  const products=[
    {...placeholderProduct,id:'different-product',variants:[oak]},
    {...placeholderProduct,variants:[{...oak,modelSrc:'/models/different-table.glb'}]},
    {...placeholderProduct,variants:[{...oak,id:'custom-oak'}]},
    {...placeholderProduct,variants:[oak,{...oak,id:'custom',name:'Custom',color:'#123456'}]},
  ];
  for(const product of products){
    const saved=createProductItem('https://example.com/table',product);
    const restored=parseWorkspace({items:[saved],layouts:[]}).items[0];
    assert.deepEqual(restored.product.variants,product.variants);
  }
});
