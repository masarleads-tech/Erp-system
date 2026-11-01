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
