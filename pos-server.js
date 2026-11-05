// POS server: the ERP computer serves the POS page on the local WiFi.
// Sales are stored on this computer in Documents\Basita\pos-sales.json (safe write + daily backup).
// The menu and the cashier users (name + PIN) come from the ERP data file (DB.pos), written by the ERP window.
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
module.exports=function(app,ipcMain,getWin){
  const dir=path.join(app.getPath('documents'),'Basita'),bdir=path.join(dir,'backups');
  const dataFile=path.join(dir,'basita-data.json'),salesFile=path.join(dir,'pos-sales.json');
  fs.mkdirSync(bdir,{recursive:true});
  const readJSON=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return null}};
  function writeSafe(f,txt){const tmp=f+'.tmp',fd=fs.openSync(tmp,'w');try{fs.writeSync(fd,txt);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,f)}
  const pad=n=>String(n).padStart(2,'0');
  const today=()=>{const n=new Date();return n.getFullYear()+'-'+pad(n.getMonth()+1)+'-'+pad(n.getDate())};
  let S=readJSON(salesFile);
  if(!S||!Array.isArray(S.sales)){ // fall back to newest backup
    S=null;try{for(const b of fs.readdirSync(bdir).filter(n=>n.startsWith('pos-')).sort().reverse()){S=readJSON(path.join(bdir,b));if(S&&Array.isArray(S.sales))break;S=null}}catch(e){}
    if(!S)S={sales:[],next:1};
  }
  function saveSales(){const t=JSON.stringify(S);writeSafe(salesFile,t);writeSafe(path.join(bdir,'pos-sales-'+today()+'.json'),t);const w=getWin();if(w&&!w.isDestroyed())w.webContents.send('pos-changed')}
  const cfg=()=>{const d=readJSON(dataFile)||{};const c=d.pos||{menu:[],users:[]};c.stock=(d.stock&&d.stock.items)||[];return c};
  const who=(c,pin)=>(c.users||[]).find(x=>x.pin&&String(pin)===String(x.pin)&&x.active!==false);
  const page=fs.readFileSync(path.join(__dirname,'pos.html'));
  const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
  function mk(c,s,name,at){ // build a sale record (also used when importing a cashier-device backup)
        const items=s.items.map(i=>{const m=(c.menu||[]).find(x=>x.id===i.id);  // live sales: the price comes from the ERP menu, not from the tablet; imported backups keep the price that was charged
          return {id:String(i.id||'').slice(0,40),name:String(m?m.name:i.name).slice(0,80),price:Math.max(0,!at&&m&&+m.price>0?+m.price:(+i.price||0)),qty:Math.max(1,Math.round(+i.qty||1))}});
        // what this sale takes out of storage, from the menu links at the time of sale
        const kc=id=>{const k=c.stock.find(x=>x.id===id);return k?Math.max(0,+k.cost||0):0};
        const use={};for(const i of items){const m=(c.menu||[]).find(x=>x.id===i.id)||(c.menu||[]).find(x=>x.name===i.name);let uc=0;
          for(const u of (m&&m.use)||[]){use[u.itemId]=(use[u.itemId]||0)+(+u.qty||0)*i.qty;uc+=(+u.qty||0)*kc(u.itemId)}
          i.cost=Math.round(uc*1000)/1000} // cost of one unit of this meal at sale time
        const total=Math.round(items.reduce((a,i)=>a+i.price*i.qty,0)*1000)/1000;
        const n=new Date(),sale={id:String(s.id).slice(0,60),no:S.next++,date:at&&/^\d{4}-\d\d-\d\d$/.test(at.date)?at.date:today(),time:at&&/^\d\d:\d\d$/.test(at.time)?at.time:pad(n.getHours())+':'+pad(n.getMinutes()),items,total,method:s.method,cashier:name,use:Object.entries(use).map(([itemId,qty])=>({itemId,qty,cost:kc(itemId)})),voided:false};
        sale.cost=Math.round(sale.use.reduce((a,u)=>a+u.qty*u.cost,0)*1000)/1000; // cost of what left storage, at today's prices
        return sale}
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://x');
    if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/pos')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(page)}
    const c=cfg();
    if(u.pathname==='/api/menu'){ // also used as cashier login
      const w=who(c,u.searchParams.get('pin'));if(!w)return send(res,403,{error:'pin'});
      return send(res,200,{menu:(c.menu||[]).filter(m=>+m.price>0).map(m=>({id:m.id,cat:m.cat,name:m.name,price:+m.price})),cashier:w.name}); // no costs/links to the tablet; unpriced items hidden
    }
    if(u.pathname==='/api/sale'&&req.method==='POST'){
      let body='';req.on('data',d=>{body+=d;if(body.length>200000)req.destroy()});
      req.on('end',()=>{
        let s;try{s=JSON.parse(body)}catch(e){return send(res,400,{error:'json'})}
        const w=who(c,s.pin);if(!w)return send(res,403,{error:'pin'});
        if(!s.id||!Array.isArray(s.items)||!s.items.length||!['cash','card'].includes(s.method))return send(res,400,{error:'bad'});
        const dup=S.sales.find(x=>x.id===s.id);if(dup)return send(res,200,{ok:true,no:dup.no});
        const sale=mk(c,s,w.name);
        S.sales.push(sale);try{saveSales()}catch(e){S.sales.pop();S.next--;return send(res,500,{error:'save'})}
        send(res,200,{ok:true,no:sale.no});
      });return;
    }
    send(res,404,{error:'not found'});
  });
  let port=8080;
  server.on('error',e=>{if(e.code==='EADDRINUSE'&&port<8090){port++;server.listen(port,'0.0.0.0')}});
  server.listen(port,'0.0.0.0');
  const urls=()=>{const r=[];for(const l of Object.values(os.networkInterfaces()))for(const a of l||[])if(a.family==='IPv4'&&!a.internal)r.push('http://'+a.address+':'+port);return r};
  ipcMain.on('pos-info',e=>{e.returnValue={urls:urls(),port}});
  ipcMain.on('pos-import',(e,list)=>{let n=0;const c=cfg();try{
    for(const x of Array.isArray(list)?list:[]){if(!x||!x.id||S.sales.some(y=>y.id===x.id)||!Array.isArray(x.items)||!x.items.length||!['cash','card'].includes(x.method))continue;
      const w=who(c,x.pin);S.sales.push(mk(c,x,w?w.name:String(x.cashier||'—').slice(0,40),x));n++}
    if(n)saveSales();e.returnValue=n}catch(err){e.returnValue=-1}});
  ipcMain.on('pos-sales',e=>{e.returnValue=S.sales});
  ipcMain.on('pos-void',(e,id,v)=>{const s=S.sales.find(x=>x.id===id);if(s){s.voided=!!v;try{saveSales();e.returnValue=true}catch(err){e.returnValue=false}}else e.returnValue=false});
};
