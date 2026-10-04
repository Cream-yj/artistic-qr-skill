const fs=require('node:fs');
const {sha}=require('./common.cjs');
function readMatrix(file){
  const input=JSON.parse(fs.readFileSync(file,'utf8'));const m=Array.isArray(input)?input:input.matrix;
  if(!Array.isArray(m)||!m.every(row=>Array.isArray(row)&&row.length===m.length&&row.every(v=>[0,1,false,true].includes(v))))throw Error('Expected square binary matrix without quiet zone');
  const v=(m.length-17)/4;if(!Number.isInteger(v)||v<1||v>40)throw Error('Invalid QR version');
  return {matrix:m.map(row=>row.map(Boolean)),version:v,source_sha256:sha(file)};
}
function layout(matrix,available=[]){
  const n=matrix.length,v=(n-17)/4,f=Array.from({length:n},()=>Array(n).fill(false));
  const rect=(x,y,w,h)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)f[j][i]=true;};
  rect(0,0,9,9);rect(n-8,0,8,9);rect(0,n-8,9,8);
  for(let i=0;i<n;i++)f[6][i]=f[i][6]=true;
  const centers=[];
  if(v>1){const count=Math.floor(v/7)+2,step=v===32?26:Math.floor((v*4+count*2+1)/(count*2-2))*2;centers.push(6);for(let p=n-7;centers.length<count;p-=step)centers.push(p);centers.sort((a,b)=>a-b);}
  const alignments=[];
  for(const y of centers)for(const x of centers){if((x===6&&y===6)||(x===6&&y===n-7)||(x===n-7&&y===6))continue;rect(x-2,y-2,5,5);alignments.push([x-2,y-2]);}
  if(v>=7){rect(n-11,0,3,6);rect(0,n-11,6,3);}
  const used=f.map(row=>row.slice()),placements=[],supported=new Set(available);
  const valid=cells=>cells.every(([x,y])=>x>=0&&y>=0&&x<n&&y<n&&matrix[y][x]&&!used[y][x]);
  const add=(role,x,y,w,h,cells,angle=0)=>{for(const [i,j]of cells)used[j][i]=true;placements.push({role,x,y,w,h,cells,angle});};
  if(supported.has('block2'))for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){const c=[[x,y],[x+1,y],[x,y+1],[x+1,y+1]];if(valid(c))add('block2',x,y,2,2,c);}
  if(supported.has('bend'))for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++)for(const [dx,dy,angle]of[[1,0,0],[1,1,90],[0,1,180],[0,0,270]]){if(matrix[y+dy][x+dx])continue;const c=[[x,y],[x+1,y],[x,y+1],[x+1,y+1]].filter(([i,j])=>i!==x+dx||j!==y+dy);if(valid(c)){add('bend',x,y,2,2,c,angle);break;}}
  for(const [role,w,h]of[['h4',4,1],['v3',1,3],['h3',3,1],['v2',1,2],['h2',2,1],['point',1,1]])if(supported.has(role))for(let y=0;y<=n-h;y++)for(let x=0;x<=n-w;x++){const c=[];for(let j=0;j<h;j++)for(let i=0;i<w;i++)c.push([x+i,y+j]);if(valid(c))add(role,x,y,w,h,c);}
  const assigned=new Set();for(const p of placements)for(const [x,y]of p.cells){const key=x+','+y;if(f[y][x]||!matrix[y][x]||assigned.has(key))throw Error('Invalid or duplicate data assignment');assigned.add(key);}
  let expected=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(matrix[y][x]&&!f[y][x]){expected++;if(!assigned.has(x+','+y))throw Error('Missing data coverage: provide a point asset');}
  return {size:n,version:v,functional_mask:f,finders:[[0,0],[n-7,0],[0,n-7]],alignments,placements,audit:{data_dark_modules:expected,assigned:assigned.size,uncovered:0,duplicates:0,light_modules_assigned:0}};
}
module.exports={readMatrix,layout};
