#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {args,dependency,sha}=require('./common.cjs');
const PYTHON=`import sys,json,importlib.metadata
try:
 import zxingcpp
 from PIL import Image
except ImportError as e:
 print(json.dumps({'available':False,'reason':str(e)}));sys.exit(0)
try: version=importlib.metadata.version('zxing-cpp')
except Exception: version='unknown'
rows=[]
for file in sys.argv[1:]:
 row={}
 try:
  im=Image.open(file).convert('RGB')
  for key in ['zxing','global']:
   try:
    config={} if key=='zxing' else {'binarizer':zxingcpp.Binarizer.GlobalHistogram}
    result=zxingcpp.read_barcodes(im,formats=zxingcpp.BarcodeFormat.QRCode,**config)
    row[key]={'payloads':[r.text for r in result]}
   except AttributeError as e: row[key]={'unavailable':str(e)}
   except Exception as e: row[key]={'error':str(e)}
 except Exception as e: row={'zxing':{'error':str(e)},'global':{'error':str(e)}}
 rows.append(row)
print(json.dumps({'available':True,'version':version,'rows':rows}))`;
function run(command,argv,timeout=60000){return cp.execFileSync(command,argv,{encoding:'utf8',timeout,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}
function shortError(error){return String(error.stderr||error.message||error).replace(/\/Users\/[^\s"']+|\/home\/[^\s"']+/g,'[local path]').slice(0,2000);}
function score(payloads,expected){return payloads.includes(expected)?'pass':'fail';}
function visionBinary(option){
  if(option)return path.resolve(option);
  if(process.platform!=='darwin')return null;
  const source=path.join(__dirname,'apple-vision.m');
  const binary=path.join(os.tmpdir(),'artistic-qr-vision-'+sha(source).slice(0,12)+'-'+os.release());
  if(!fs.existsSync(binary))run('xcrun',['clang','-fobjc-arc','-framework','Foundation','-framework','Vision',source,'-o',binary]);
  return binary;
}
async function verify(files,options){
  if(!files.length)throw Error('Provide actual exported image files');
  const expected=options['expected-file']?fs.readFileSync(options['expected-file'],'utf8').replace(/\r?\n$/,''):options.expected;
  if(typeof expected!=='string'||!expected.length)throw Error('Provide --expected-file or --expected');
  const engines=String(options.engines||'zxing,vision,jsqr,global').split(',');
  const required=String(options.require||'zxing').split(',');
  const known=['zxing','vision','jsqr','global'];if([...engines,...required].some(e=>!known.includes(e))||required.some(e=>!engines.includes(e)))throw Error('Invalid requested engine');
  const sharp=dependency('sharp');const tests=[];
  for(const file of files){const m=await sharp(file).metadata();tests.push({file:path.basename(file),sha256:sha(file),dimensions:[m.width,m.height],format:m.format,case:'actual supplied file',preprocessing:'none',decoders:[]});}
  if(engines.includes('zxing')||engines.includes('global')){
    let result;try{result=JSON.parse(run(options.python||process.env.PYTHON||'python3',['-c',PYTHON,...files]));}catch(e){result={available:false,error:shortError(e)};}
    for(const [i,t]of tests.entries())for(const engine of ['zxing','global'].filter(e=>engines.includes(e))){const raw=result.rows?.[i]?.[engine];t.decoders.push({engine,name:'ZXing-C++',config:engine==='global'?'GlobalHistogram':'default',version:result.version||null,status:!result.available?(result.error?'error':'not_tested'):raw?.unavailable?'not_tested':raw?.error?'error':score(raw?.payloads||[],expected),payloads:raw?.payloads||[],reason:raw?.unavailable||raw?.error||result.error||result.reason||null});}
  }
  if(engines.includes('jsqr')){
    let decoder,error,version='unknown';try{
      decoder=options['jsqr-path']?require(path.resolve(options['jsqr-path'])):dependency('jsqr');decoder=decoder.default||decoder;
      let folder=options['jsqr-path']?path.dirname(path.resolve(options['jsqr-path'])):null;
      if(!folder)try{folder=path.dirname(require.resolve('jsqr'));}catch{}
      for(let depth=0;folder&&depth<5;depth++,folder=path.dirname(folder)){const file=path.join(folder,'package.json');if(fs.existsSync(file)){const p=JSON.parse(fs.readFileSync(file,'utf8'));if(String(p.name).toLowerCase()==='jsqr'){version=p.version;break;}}}
    }catch(e){error=shortError(e);}
    for(const [i,file]of files.entries()){
      const row={engine:'jsqr',name:'jsQR',version,config:{inversionAttempts:'attemptBoth'},status:decoder?'fail':'not_tested',payloads:[],reason:error||null};
      if(decoder)try{const {data,info}=await sharp(file).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});const r=decoder(new Uint8ClampedArray(data),info.width,info.height,{inversionAttempts:'attemptBoth'});row.payloads=r?[r.data]:[];row.status=score(row.payloads,expected);}catch(e){row.status='error';row.reason=shortError(e);}
      tests[i].decoders.push(row);
    }
  }
  if(engines.includes('vision')){
    let binary,result,error;
    try{binary=visionBinary(options['vision-bin']);if(binary){result=run(binary,files).trim().split('\n').map(JSON.parse);if(result.length!==files.length)throw Error('Incomplete Apple Vision output');}}catch(e){error=shortError(e);}
    for(const [i,t]of tests.entries()){const r=result?.[i],payloads=(r?.codes||[]).map(c=>c.payload);t.decoders.push({engine:'vision',name:'Apple Vision',config:'VNDetectBarcodesRequest / QR / default revision',platform:process.platform,os_release:os.release(),status:error||r?.error?'error':!binary?'not_tested':score(payloads,expected),payloads,reason:error||r?.error||(!binary?'macOS Vision unavailable':null)});}
  }
  const allRequiredPassed=tests.every(t=>required.every(e=>t.decoders.find(d=>d.engine===e)?.status==='pass'));
  const report={created_at:new Date().toISOString(),expected_payload:expected,required_engines:required,all_required_passed:allRequiredPassed,tests,notes:['GlobalHistogram is another configuration of ZXing, not an independent engine.','Static-file tests do not cover real phone/app/print conditions.'],physical_phone_test:'not_tested'};
  if(options.out){fs.mkdirSync(path.dirname(path.resolve(options.out)),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(report,null,2));}
  return report;
}
if(require.main===module){const a=args(process.argv.slice(2));if(!a._.length){console.log('Usage: node verify-qr.cjs poster.jpg ... --expected-file payload.txt --out report.json --require zxing,vision');process.exitCode=2;}else verify(a._,a).then(r=>{console.log(JSON.stringify({all_required_passed:r.all_required_passed,tests:r.tests.map(t=>({file:t.file,decoders:t.decoders.map(d=>[d.engine,d.status])}))},null,2));process.exitCode=r.all_required_passed?0:1;}).catch(e=>{console.error(e.message);process.exitCode=2;});}
module.exports={verify};
