#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const {args,dependency,bounds,sha,safeSvg,xml,bodyOfSvg}=require('./common.cjs');
const {readMatrix,layout}=require('./qr-layout.cjs');
async function assemble(configFile){
  const sharp=dependency('sharp'),c=JSON.parse(fs.readFileSync(configFile,'utf8')),base=path.dirname(path.resolve(configFile));
  const resolve=p=>path.resolve(base,p);const source=readMatrix(resolve(c.matrix));
  const setFile=resolve(c.assets),set=JSON.parse(fs.readFileSync(setFile,'utf8')),assetBase=path.dirname(setFile);
  const roles=c.roles||set.roles;if(!roles||!roles.point||!roles.function||!roles.finder)throw Error('Explicit point, function and finder roles are required; no primitive fallback is inserted');
  const map=new Map();for(const a of set.assets){if(map.has(a.id))throw Error('Duplicate asset id');map.set(a.id,a);}
  for(const ids of Object.values(roles))for(const id of Array.isArray(ids)?ids:[ids])if(!map.has(id))throw Error(`Unknown selected asset: ${id}`);
  const l=layout(source.matrix,Object.keys(roles));if(l.alignments.length&&!roles.alignment)throw Error('This QR needs a separately adapted alignment asset');
  if(c.placements){
    const seen=new Set();for(const p of c.placements){
      if(!map.has(p.asset)||![p.x,p.y,p.w,p.h].every(Number.isInteger)||p.x<0||p.y<0||p.w<1||p.h<1||p.x+p.w>l.size||p.y+p.h>l.size||![0,90,180,270].includes(p.angle||0)||!Array.isArray(p.cells)||!p.cells.length)throw Error('Invalid explicit placement');
      for(const [x,y]of p.cells){const key=x+','+y;if(x<p.x||x>=p.x+p.w||y<p.y||y>=p.y+p.h||l.functional_mask[y][x]||!source.matrix[y][x]||seen.has(key))throw Error('Explicit placement changes matrix assignment');seen.add(key);}
    }
    if(seen.size!==l.audit.data_dark_modules)throw Error('Explicit placements do not cover all data dark modules');
    l.placements=c.placements;
  }
  const u=bounds(c.module_size??24,2,200,'module size'),n=l.size,quiet=bounds(c.quiet_zone_modules??4,4,32,'quiet zone');
  const width=bounds(c.width??(n+quiet*2)*u,1,20000,'canvas width'),height=bounds(c.height??width,1,20000,'canvas height');
  const origin=c.origin??[quiet*u,quiet*u];if(origin[0]<quiet*u||origin[1]<quiet*u||origin[0]+(n+quiet)*u>width||origin[1]+(n+quiet)*u>height)throw Error('Canvas clips four-module quiet zone');
  const coverage=bounds(c.coverage??.96,.6,1,'coverage');const offset=(1-coverage)*u/2;
  let defs='',body='';const chosen={};
  const choose=(role,index=0)=>{const ids=Array.isArray(roles[role])?roles[role]:[roles[role]];const id=ids[index%ids.length];chosen[id]=(chosen[id]||0)+1;return id;};
  for(const [id,a]of map){const content=safeSvg(fs.readFileSync(path.join(assetBase,a.file),'utf8'));const image=await sharp(Buffer.from(content)).png().toBuffer();defs+=`<symbol id="asset-${id}" viewBox="0 0 ${a.width} ${a.height}" preserveAspectRatio="none"><image width="${a.width}" height="${a.height}" href="data:image/png;base64,${image.toString('base64')}" preserveAspectRatio="none"/></symbol>`;}
  if(c.base_layer){const content=safeSvg(fs.readFileSync(resolve(c.base_layer),'utf8'));const meta=await sharp(Buffer.from(content)).metadata();body+=`<svg width="${width}" height="${height}" viewBox="0 0 ${meta.width} ${meta.height}" preserveAspectRatio="none">${bodyOfSvg(content)}</svg>`;}else body+=`<rect width="${width}" height="${height}" fill="${xml(c.background_color||'#fff')}"/>`;
  const place=(id,x,y,w,h,angle=0,inset=true)=>{const px=origin[0]+x*u,py=origin[1]+y*u,iw=inset?offset:0;body+=`<g${angle?` transform="rotate(${angle} ${px+w*u/2} ${py+h*u/2})"`:''}><use href="#asset-${id}" x="${px+iw}" y="${py+iw}" width="${w*u-2*iw}" height="${h*u-2*iw}" preserveAspectRatio="none"/></g>`;};
  const excluded=(x,y)=>l.finders.some(([fx,fy])=>x>=fx&&x<fx+7&&y>=fy&&y<fy+7)||l.alignments.some(([ax,ay])=>x>=ax&&x<ax+5&&y>=ay&&y<ay+5);
  const functions=[];let fi=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(source.matrix[y][x]&&l.functional_mask[y][x]&&!excluded(x,y)){const id=choose('function',fi++);place(id,x,y,1,1);functions.push({x,y,asset:id});}
  for(const [i,p]of l.placements.entries()){const id=p.asset||choose(p.role,i);if(p.asset)chosen[id]=(chosen[id]||0)+1;place(id,p.x,p.y,p.w,p.h,p.angle);}
  for(const [i,[x,y]]of l.finders.entries())place(choose('finder',i),x,y,7,7,0,false);
  for(const [i,[x,y]]of l.alignments.entries())place(choose('alignment',i),x,y,5,5,0,false);
  const out=resolve(c.output);fs.mkdirSync(path.dirname(out),{recursive:true});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Artistic QR from selected assets</title><defs>${defs}</defs>${body}</svg>`;
  fs.writeFileSync(out+'.svg',svg);await sharp(Buffer.from(svg),{limitInputPixels:false}).png().toFile(out+'.png');
  const files=[];for(const w of c.export_widths||[width]){bounds(w,1,20000,'export width');const file=out+'-'+w+'.jpg';await sharp(out+'.png').resize({width:w}).jpeg({quality:bounds(c.jpeg_quality??95,1,100,'JPEG quality'),chromaSubsampling:'4:4:4'}).toFile(file);files.push(path.basename(file));}
  const report={...l,matrix_file_sha256:source.source_sha256,asset_set_sha256:sha(setFile),selected_assets:chosen,function_modules:functions,primitive_fallback_count:0,quiet_zone_modules:quiet,origin,module_size:u,canvas:[width,height],files};
  fs.writeFileSync(out+'-layout.json',JSON.stringify(report,null,2));return report;
}
if(require.main===module){const a=args(process.argv.slice(2));if(!a._[0]){console.log('Usage: node assemble-qr.cjs poster.json');process.exitCode=2;}else assemble(a._[0]).then(r=>console.log(JSON.stringify({files:r.files,function_modules:r.function_modules.length,primitive_fallback_count:0}))).catch(e=>{console.error(e.message);process.exitCode=2;});}
module.exports={assemble};
