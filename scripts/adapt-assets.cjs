#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { args, dependency, bounds, sha, safeSvg, xml } = require('./common.cjs');

// Bright pixels remain bright; a scalar luminance gain preserves RGB ratios.
function gains(gamma, preserve, localGain=1) {
  bounds(gamma, 1, 3, 'shadow gamma'); bounds(preserve, .5, .99, 'highlight threshold');
  return Array.from({ length: 65 }, (_, i) => {
    const l = i / 64;
    const base = Math.max(.4, Math.pow(Math.max(l, .001), gamma - 1)) * localGain;
    const t = Math.max(0, Math.min(1, (l - preserve) / (1 - preserve)));
    return base + (1 - base) * t * t * (3 - 2 * t);
  });
}
function photo(href, width, height) {
  return `<image width="${width}" height="${height}" href="${href}" preserveAspectRatio="none"/>`;
}
async function filter(id, config, width, height) {
  const gamma = config.shadow_gamma ?? 1, preserve = config.highlight_start ?? .78;
  const localGain=bounds(config.shadow_gain??1,.4,1,'local shadow gain');
  if(localGain!==1&&!config.regions)throw Error('shadow_gain requires explicit local regions; global dimming is disabled');
  const table = gains(gamma, preserve,localGain).map(x => x.toFixed(6)).join(' ');
  let mask = '';
  if (config.regions) {
    if (!Array.isArray(config.regions) || !config.regions.length) throw Error('Empty shadow regions');
    const polygons = config.regions.map(points => {
      if (!Array.isArray(points) || points.length < 3) throw Error('Shadow polygon needs three points');
      return `<polygon fill="white" points="${points.map(p => `${bounds(p[0],0,1,'polygon x')*width},${bounds(p[1],0,1,'polygon y')*height}`).join(' ')}"/>`;
    }).join('');
    const map = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${polygons}</svg>`;
    // A PNG mask avoids recursive-SVG feImage failures in some librsvg builds.
    const maskImage=await dependency('sharp')(Buffer.from(map)).png().toBuffer();
    mask = `<feImage href="data:image/png;base64,${maskImage.toString('base64')}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="region"/><feGaussianBlur in="region" stdDeviation="${bounds(config.feather ?? 0,0,.1,'feather')*Math.min(width,height)}" result="soft-region"/><feComposite in="gain" in2="soft-region" operator="arithmetic" k1="1" k2="0" k3="-1" k4="1" result="local-gain"/>`;
  }
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values=".2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 .2126 .7152 .0722 0 0 0 0 0 0 1" result="luma"/><feComponentTransfer in="luma" result="gain">${['R','G','B'].map(c=>`<feFunc${c} type="table" tableValues="${table}"/>`).join('')}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>${mask}<feComposite in="SourceGraphic" in2="${mask?'local-gain':'gain'}" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"/></filter>`;
}
function fractionRect(rect, label) {
  if (!Array.isArray(rect) || rect.length !== 4) throw Error(`Invalid ${label}`);
  rect.forEach((v,i)=>bounds(v,0,1,label));
  if (!rect[2] || !rect[3] || rect[0]+rect[2]>1.00001 || rect[1]+rect[3]>1.00001) throw Error(`${label} extends outside its bounds`);
  return rect;
}
async function adapt(manifestFile, outputDir) {
  const sharp = dependency('sharp');
  const manifest = JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if (!Array.isArray(manifest.assets) || !manifest.assets.length) throw Error('Manifest needs assets');
  fs.mkdirSync(outputDir,{recursive:true}); const records=[], ids=new Set();
  for (const asset of manifest.assets) {
    if (!/^[a-z][a-z0-9-]*$/.test(asset.id) || ids.has(asset.id)) throw Error('Asset IDs must be unique lowercase names'); ids.add(asset.id);
    const source=path.resolve(path.dirname(manifestFile),asset.file);
    const input=fs.readFileSync(source);const isSvg=path.extname(source).toLowerCase()==='.svg';
    if(isSvg)safeSvg(input.toString('utf8'));
    const metadata=await sharp(input).metadata();const sw=metadata.width,sh=metadata.height;
    if(!sw||!sh)throw Error('Asset has no dimensions');
    const width=bounds(asset.width??sw,1,10000,'width'),height=bounds(asset.height??sh,1,10000,'height');
    const href=`data:image/${isSvg?'svg+xml':'png'};base64,${(isSvg?input:await sharp(input).png().toBuffer()).toString('base64')}`;
    let defs='',body='';const image=photo(href,sw,sh);
    const patches=asset.patches||[{source:[0,0,1,1],target:[0,0,1,1]}];
    for (const [index,patch] of patches.entries()) {
      const s=fractionRect(patch.source,'source patch'),t=fractionRect(patch.target,'target patch');
      const tone=patch.tone||asset.tone;
      let content=image;
      if(tone&&(tone.shadow_gamma!==1||(tone.shadow_gain??1)!==1)){const id=`${asset.id}-tone-${index}`;defs+=await filter(id,tone,sw,sh);content=`<g filter="url(#${id})">${content}</g>`;}
      if(patch.lighten){const amount=bounds(patch.lighten,0,.6,'lining lightening'),id=`${asset.id}-lining-${index}`;defs+=`<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${['R','G','B'].map((c,i)=>`<feFunc${c} type="linear" slope="${1-amount}" intercept="${amount*[.98,.96,.92][i]}"/>`).join('')}</feComponentTransfer></filter>`;content=`<g filter="url(#${id})">${content}</g>`;}
      body+=`<svg x="${t[0]*width}" y="${t[1]*height}" width="${t[2]*width}" height="${t[3]*height}" viewBox="${s[0]*sw} ${s[1]*sh} ${s[2]*sw} ${s[3]*sh}" preserveAspectRatio="none" overflow="hidden">${content}</svg>`;
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xml(asset.id)}: ${isSvg?'SVG source':'embedded raster source'}</title><defs>${defs}</defs>${body}</svg>`;
    const output=path.join(outputDir,asset.id+'.svg');fs.writeFileSync(output,svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(outputDir,asset.id+'.png'));
    records.push({id:asset.id,file:asset.id+'.svg',png:asset.id+'.png',width,height,grid:asset.grid,source_sha256:sha(source),output_sha256:sha(output),format:isSvg?'SVG-source wrapper':'embedded-PNG SVG',tone:asset.tone||null,patch_count:patches.length});
  }
  const result={assets:records,roles:manifest.roles||{},note:'Geometry and luminance adaptation; decoder testing is still required.'};
  fs.writeFileSync(path.join(outputDir,'assets.json'),JSON.stringify(result,null,2));return result;
}
if(require.main===module){const a=args(process.argv.slice(2));if(!a._[0]||!a.out){console.log('Usage: node adapt-assets.cjs assets.json --out adapted/');process.exitCode=2;}else adapt(a._[0],a.out).then(r=>console.log(JSON.stringify({assets:r.assets.length}))).catch(e=>{console.error(e.message);process.exitCode=2;});}
module.exports={adapt,gains};
