const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {dependency}=require('../scripts/common.cjs');
const {adapt}=require('../scripts/adapt-assets.cjs');
const {assemble}=require('../scripts/assemble-qr.cjs');
const {verify}=require('../scripts/verify-qr.cjs');
const {readMatrix,layout}=require('../scripts/qr-layout.cjs');
const sharp=dependency('sharp');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'artistic-qr-test-'));

test('luminance adaptation preserves bright peaks, RGB ratios and transparency',async t=>{
 const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const raw=Buffer.alloc(64*32*4);for(let y=0;y<32;y++)for(let x=0;x<64;x++){const v=x<32?[160,110,40,255]:[255,250,245,255];if(y<4)v[3]=0;raw.set(v,(y*64+x)*4);}
 await sharp(raw,{raw:{width:64,height:32,channels:4}}).png().toFile(path.join(dir,'source.png'));
 fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({assets:[{id:'gold',file:'source.png',tone:{shadow_gamma:1.7,highlight_start:.78}}]}));
 await adapt(path.join(dir,'input.json'),path.join(dir,'out'));
 const a=await sharp(path.join(dir,'out/gold.png')).ensureAlpha().raw().toBuffer();
 const pixel=(x,y)=>Array.from(a.subarray((y*64+x)*4,(y*64+x)*4+4));
 const mid=pixel(16,16),bright=pixel(48,16);assert(mid[0]<150);assert(Math.abs(mid[0]/160-mid[1]/110)<.025);assert(Math.abs(mid[1]/110-mid[2]/40)<.025);assert(bright[0]>=252&&bright[1]>=247&&bright[2]>=242);assert.equal(pixel(16,1)[3],0);assert.equal(mid[3],255);
});

test('local shadow polygon leaves material outside that region unchanged',async t=>{
 const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 await sharp({create:{width:80,height:40,channels:4,background:{r:160,g:110,b:40,alpha:1}}}).png().toFile(path.join(dir,'source.png'));
 fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({assets:[{id:'local-gold',file:'source.png',tone:{shadow_gamma:1,shadow_gain:.7,regions:[[[0,0],[.45,0],[.45,1],[0,1]]],feather:.02}}]}));
 await adapt(path.join(dir,'input.json'),path.join(dir,'out'));const a=await sharp(path.join(dir,'out/local-gold.png')).ensureAlpha().raw().toBuffer();
 const px=x=>Array.from(a.subarray((20*80+x)*4,(20*80+x)*4+4));assert(px(12)[0]<150);assert.deepEqual(px(68),[160,110,40,255]);
 fs.writeFileSync(path.join(dir,'global.json'),JSON.stringify({assets:[{id:'bad-gold',file:'source.png',tone:{shadow_gamma:1,shadow_gain:.7}}]}));await assert.rejects(adapt(path.join(dir,'global.json'),path.join(dir,'bad')),/requires explicit local regions/);
});

test('L adaptation keeps missing quadrant transparent and rejects out-of-bounds crops',async t=>{
 const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));await sharp({create:{width:40,height:40,channels:4,background:'#075441'}}).png().toFile(path.join(dir,'source.png'));
 const asset={id:'bend',file:'source.png',patches:[[0,0],[0,1],[1,1]].map(([x,y])=>({source:[0,0,1,1],target:[x/2,y/2,.5,.5]}))};
 fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({assets:[asset]}));await adapt(path.join(dir,'input.json'),path.join(dir,'out'));const a=await sharp(path.join(dir,'out/bend.png')).ensureAlpha().raw().toBuffer();assert.equal(a[(10*40+30)*4+3],0);for(const [x,y]of[[10,10],[10,30],[30,30]])assert.equal(a[(y*40+x)*4+3],255);
 asset.patches[0].source=[.8,0,.5,1];fs.writeFileSync(path.join(dir,'bad.json'),JSON.stringify({assets:[asset]}));await assert.rejects(adapt(path.join(dir,'bad.json'),path.join(dir,'bad')),/outside/);
});

test('versions 1 and 7 assemble only selected assets and decode the actual JPEG',async t=>{
 const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const files={point:'<circle cx="20" cy="20" r="20" fill="#111"/>',finder:'<path fill="#111" fill-rule="evenodd" d="M0 0h280v280H0z M40 40h200v200H40z M80 80h120v120H80z"/>',alignment:'<path fill="#111" fill-rule="evenodd" d="M0 0h200v200H0z M40 40h120v120H40z M80 80h40v40H80z"/>'};
 const assets=[];for(const [id,body]of Object.entries(files)){const size=id==='point'?40:id==='finder'?280:200;fs.writeFileSync(path.join(dir,id+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`);assets.push({id,file:id+'.svg'});}
 const roles={point:'point',function:'point',finder:'finder',alignment:'alignment'};
 fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({assets,roles}));await adapt(path.join(dir,'input.json'),path.join(dir,'assets'));
 for(const version of [1,7]){
  const file=path.join(__dirname,'fixtures',`matrix-v${version}.json`),source=readMatrix(file);const l=layout(source.matrix,['point']);assert.equal(l.audit.data_dark_modules,l.audit.assigned);assert.equal(l.alignments.length,version===1?0:6);
  const config={matrix:file,assets:'assets/assets.json',output:'poster-v'+version,module_size:12};fs.writeFileSync(path.join(dir,'poster.json'),JSON.stringify(config));const result=await assemble(path.join(dir,'poster.json'));assert.equal(result.primitive_fallback_count,0);assert(result.function_modules.every(p=>p.asset==='point'));assert(result.selected_assets.finder===3);
  const expected=JSON.parse(fs.readFileSync(file,'utf8')).expected_payload;
  const report=await verify([path.join(dir,`poster-v${version}-${(source.matrix.length+8)*12}.jpg`)],{expected,engines:'zxing',require:'zxing',python:process.env.PYTHON});
  const decoder=report.tests[0].decoders[0];if(decoder.status==='not_tested'){t.skip('ZXing dependency unavailable; file decode check not executed');return;}assert.equal(decoder.status,'pass',JSON.stringify(decoder));
  const noFunction={...roles};delete noFunction.function;fs.writeFileSync(path.join(dir,'bad.json'),JSON.stringify({...config,roles:noFunction}));await assert.rejects(assemble(path.join(dir,'bad.json')),/no primitive fallback/);
 }
});

test('blank file fails required decoder, unavailable decoder is separately reported',async t=>{
 const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=path.join(dir,'blank.jpg');await sharp({create:{width:100,height:100,channels:3,background:'#fff'}}).jpeg().toFile(f);
 const r=await verify([f],{expected:'A',engines:'zxing,jsqr',require:'zxing',python:process.env.PYTHON,'jsqr-path':path.join(dir,'absent.cjs')});assert.equal(r.all_required_passed,false);assert.equal(r.tests[0].decoders.find(d=>d.engine==='jsqr').status,'not_tested');const z=r.tests[0].decoders.find(d=>d.engine==='zxing');if(z.status!=='not_tested')assert.equal(z.status,'fail');
});
