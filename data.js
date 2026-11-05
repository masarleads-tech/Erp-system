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
  ipcMain.on('data-load',e=>{
    let d=readJSON(file);
    if(!d){ // main file missing or damaged: fall back to the newest good backup
      const bs=fs.existsSync(bdir)?fs.readdirSync(bdir).filter(n=>n.endsWith('.json')).sort().reverse():[];
      for(const b of bs){d=readJSON(path.join(bdir,b));if(d)break}
    }
    e.returnValue=d;
  });
  ipcMain.on('data-save',(e,txt)=>{
    try{
      writeSafe(file,txt);
      const n=new Date(),day=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
      writeSafe(path.join(bdir,'basita-'+day+'.json'),txt);
      const bs=fs.readdirSync(bdir).filter(x=>/^basita-\d{4}-\d\d-\d\d\.json$/.test(x)).sort();
      bs.slice(0,Math.max(0,bs.length-90)).forEach(x=>{try{fs.unlinkSync(path.join(bdir,x))}catch(_){}});
      e.returnValue=true;
    }catch(err){e.returnValue=false}
  });
};

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
