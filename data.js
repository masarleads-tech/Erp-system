// Safe storage on disk: Documents\Basita\basita-data.json
// Every save is written to a temp file, flushed to disk, then renamed over the real file,
// so a sudden shutdown leaves either the old or the new file, never a half-written one.
// A dated copy is kept once per day in Documents\Basita\backups (last 90 days).
const fs=require('fs'),path=require('path');
module.exports=function(app,ipcMain){
  const dir=path.join(app.getPath('documents'),'Basita'),bdir=path.join(dir,'backups');
  const file=path.join(dir,'basita-data.json');
  fs.mkdirSync(bdir,{recursive:true});
  const readJSON=f=>{try{const d=JSON.parse(fs.readFileSync(f,'utf8'));return d&&d.days&&d.payments?d:null}catch(e){return null}};
  function writeSafe(f,txt){
    const tmp=f+'.tmp',fd=fs.openSync(tmp,'w');
    try{fs.writeSync(fd,txt);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    fs.renameSync(tmp,f);
  }
  let DB=null,REV=1;
  function loadFile(){
    let d=readJSON(file);
    if(!d){ // main file missing or damaged: fall back to the newest good backup
      const bs=fs.existsSync(bdir)?fs.readdirSync(bdir).filter(n=>n.endsWith('.json')).sort().reverse():[];
      for(const b of bs){d=readJSON(path.join(bdir,b));if(d)break}
    }
    return d}
  DB=loadFile();
  function writeAll(txt){
    writeSafe(file,txt);
    const n=new Date(),day=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
    writeSafe(path.join(bdir,'basita-'+day+'.json'),txt);
    const bs=fs.readdirSync(bdir).filter(x=>/^basita-\d{4}-\d\d-\d\d\.json$/.test(x)).sort();
    bs.slice(0,Math.max(0,bs.length-90)).forEach(x=>{try{fs.unlinkSync(path.join(bdir,x))}catch(_){}})}
  ipcMain.on('data-load',e=>{e.returnValue=DB});
  // full replace (first start, or a device with no copy yet)
  ipcMain.on('data-save',(e,txt)=>{
    try{const d=JSON.parse(txt);writeAll(txt);DB=d;REV++;e.returnValue=true}catch(err){e.returnValue=false}
  });
  // ---- several devices on the WiFi share one copy of the data, kept here on the main computer ----
  // Each device sends only what it changed since it last synced ("ops"), so changes made at the same time
  // on different devices are merged instead of one wiping the other. rev goes up by one on every change.
  ipcMain.on('data-get',e=>{e.returnValue={db:DB,rev:REV}});
  ipcMain.on('data-rev',e=>{let pos=0;try{pos=require('./pos-server.js').salesRev()}catch(_){}e.returnValue={rev:REV,pos}});
  ipcMain.on('data-sync',(e,ops,base,role)=>{
    try{
      if(!Array.isArray(ops))throw new Error('bad');
      if(!DB)DB={days:{},payments:[],employees:[]};
      const was=REV;let n=0;
      for(const op of ops){if(role&&role!=='super'&&op&&Array.isArray(op.p)&&['printer','profile'].includes(op.p[0]))continue;if(apply(DB,op))n++}
      if(n){writeAll(JSON.stringify(DB));REV++}
      const stale=base!==was; // somebody else changed something since this device last synced
      e.returnValue={ok:true,rev:REV,stale,db:stale?DB:undefined};
    }catch(err){e.returnValue={ok:false,reason:String(err.message||err)}}
  });
};
// apply one change: {p:[path], v:value} (v missing = delete) or {p, add:[..], rm:[..]} for a list of names.
// A path step {i:id} means "the element with this id" inside a list (payments, menu, stock items…).
const BAD=new Set(['__proto__','prototype','constructor']);
function apply(root,op){
  if(!op||!Array.isArray(op.p)||!op.p.length)return false;
  let o=root;const P=op.p;
  const step=(o,k)=>k&&typeof k==='object'?(Array.isArray(o)?o.find(x=>x&&x.id===k.i):undefined):o[k];
  for(let j=0;j<P.length-1;j++){const k=P[j];if(typeof k==='string'&&BAD.has(k))return false;
    let nx=step(o,k);
    if(nx===undefined||nx===null||typeof nx!=='object'){
      if(k&&typeof k==='object')return false; // that element was deleted on another device
      nx=P[j+1]&&typeof P[j+1]==='object'?[]:{};o[k]=nx}
    o=nx}
  const k=P[P.length-1];if(typeof k==='string'&&BAD.has(k))return false;
  if(op.add||op.rm){let a=step(o,k);if(!Array.isArray(a)){a=[];if(typeof k==='object')return false;o[k]=a}
    for(const x of op.rm||[]){const i=a.indexOf(x);if(i>=0)a.splice(i,1)}
    for(const x of op.add||[])if(!a.includes(x))a.push(x);return true}
  if(k&&typeof k==='object'){if(!Array.isArray(o))return false;const i=o.findIndex(x=>x&&x.id===k.i);
    if(!('v' in op)){if(i>=0)o.splice(i,1);return true}
    if(i>=0)o[i]=op.v;else o.push(op.v);return true}
  if(Array.isArray(o)&&typeof k!=='number')return false;
  if(!('v' in op))delete o[k];else o[k]=op.v;return true}
module.exports.apply=apply;

// Automatic backup every 30 minutes: Documents\Basita\backups\auto\basita-YYYY-MM-DD-HHmm.json
// One file holds the ERP data and the POS sales together. Kept for 14 days.
module.exports.autoBackup=function(app){
  const dir=path.join(app.getPath('documents'),'Basita'),adir=path.join(dir,'backups','auto');
  const pad=n=>String(n).padStart(2,'0');
  function run(){
    try{
      fs.mkdirSync(adir,{recursive:true});
      const read=f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))}catch(e){return null}};
      const data=read('basita-data.json'),pos=read('pos-sales.json');
      if(!data&&!pos)return;
      const txt=JSON.stringify({savedAt:new Date().toISOString(),data,pos});
      const n=new Date(),name='basita-'+n.getFullYear()+'-'+pad(n.getMonth()+1)+'-'+pad(n.getDate())+'-'+pad(n.getHours())+pad(n.getMinutes())+'.json';
      const tmp=path.join(adir,name+'.tmp'),fd=fs.openSync(tmp,'w');
      try{fs.writeSync(fd,txt);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      fs.renameSync(tmp,path.join(adir,name));
      const cut=Date.now()-14*24*3600*1000;
      for(const f of fs.readdirSync(adir))if(/^basita-.*\.json$/.test(f)){const p=path.join(adir,f);try{if(fs.statSync(p).mtimeMs<cut)fs.unlinkSync(p)}catch(_){}}
    }catch(e){}
  }
  // Only the local disk is used, so this keeps working with no WiFi or internet.
  const every=+process.env.BASITA_BACKUP_MS||30*60*1000;
  setTimeout(run,Math.min(60*1000,every)); // first copy one minute after opening
  setInterval(run,every);                  // then every 30 minutes
  app.on('before-quit',run);        // and once more when closing
};
