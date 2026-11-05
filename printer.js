// Receipt printing on a thermal printer (58 / 80 mm) installed in Windows on the ERP computer.
// A receipt is laid out as HTML (so Arabic prints correctly) and sent silently to the chosen printer.
// Settings live in the ERP data file: DB.printer = {on, name, width, phone}.
// Status goes to the ERP window ('printer-status') and to the cashier tablets (through pos-server).
const {BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
module.exports=function(app,ipcMain,getWin){
  const dataFile=path.join(app.getPath('documents'),'Basita','basita-data.json');
  const cfg=()=>{try{const d=JSON.parse(fs.readFileSync(dataFile,'utf8'));return Object.assign({on:false,name:'',width:80,phone:''},d.printer||{})}catch(e){return {on:false,name:'',width:80,phone:''}}};
  let state={state:'off',msg:''},fails=0,queue=[],busy=false,retryT=null;
  const tell=()=>{const w=getWin();if(w&&!w.isDestroyed())w.webContents.send('printer-status',state)};
  const set=(st,msg)=>{state={state:st,msg:msg||'',fails};tell()};
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const f3=n=>(Math.round(n*1000)/1000).toFixed(3);
  function receipt(s,width){
    const rows=s.items.map(i=>`<tr><td class="n">${esc(i.name)}</td><td>${i.qty}</td><td>${f3(i.price*i.qty)}</td></tr>`).join('');
    const count=s.items.reduce((a,i)=>a+i.qty,0);
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
      @page{size:${width}mm auto;margin:0}
      *{box-sizing:border-box}body{margin:0;padding:2mm 3mm;width:${width}mm;font-family:Tahoma,Arial,sans-serif;font-size:${width<70?11:13}px;color:#000}
      h1{margin:0;text-align:center;font-size:${width<70?22:28}px}.c{text-align:center}.sub{text-align:center;margin:0 0 4px}
      hr{border:0;border-top:1px dashed #000;margin:4px 0}table{width:100%;border-collapse:collapse}td,th{padding:2px 0;text-align:left;vertical-align:top}
      td.n,th.n{text-align:right;width:62%}th{border-bottom:1px solid #000;font-weight:700}.tot{font-size:${width<70?16:19}px;font-weight:700;display:flex;justify-content:space-between}
      .row{display:flex;justify-content:space-between}
    </style></head><body>
      <h1>بسيطة</h1><p class="sub">لا تعقدها</p><hr>
      <div class="row"><span>فاتورة رقم ${s.no}</span><span>${esc(s.date)} ${esc(s.time)}</span></div>
      <div class="row"><span>الكاشير: ${esc(s.cashier||'')}</span><span>${s.method==='cash'?'كاش':'فيزا'}</span></div><hr>
      <table><tr><th class="n">الصنف</th><th>العدد</th><th>المبلغ</th></tr>${rows}</table><hr>
      <div class="row"><span>عدد القطع</span><span>${count}</span></div>
      <div class="tot"><span>المجموع</span><span>${f3(s.total)} دينار</span></div><hr>
      <p class="c">شكراً لزيارتكم ❤</p><p class="c">&nbsp;</p>
    </body></html>`;
  }
  // print one receipt; resolves {ok, reason}
  async function printOne(s,c){
    const list=await printers();
    if(!c.name)return {ok:false,reason:'ما في طابعة مختارة'};
    if(!list.some(p=>p.name===c.name))return {ok:false,reason:'الطابعة "'+c.name+'" مش موجودة أو مش موصولة'};
    const w=new BrowserWindow({show:false,width:400,height:800,webPreferences:{offscreen:false,javascript:true}});
    try{
      await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(receipt(s,+c.width||80)));
      const hPx=await w.webContents.executeJavaScript('document.body.scrollHeight');
      const r=await new Promise(res=>w.webContents.print({silent:true,printBackground:false,deviceName:c.name,margins:{marginType:'none'},
        pageSize:{width:(+c.width||80)*1000,height:Math.max(60000,Math.ceil(hPx*264.6)+5000)}},(ok,why)=>res({ok,reason:why})));
      return r.ok?{ok:true}:{ok:false,reason:r.reason||'الطابعة ما ردّت'};
    }catch(e){return {ok:false,reason:String(e.message||e)}}finally{if(!w.isDestroyed())w.destroy()}
  }
  async function printers(){const w=getWin();if(!w||w.isDestroyed())return [];try{return await w.webContents.getPrintersAsync()}catch(e){return []}}
  async function run(){
    if(busy)return;busy=true;
    try{while(queue.length){const c=cfg();if(!c.on){queue=[];set('off');break}
      const r=await printOne(queue[0],c);
      if(r.ok){queue.shift();fails=0;set('ok','')}
      else{fails++;set(fails>=3?'down':'retry',r.reason);
        if(fails>=3)queue=queue.slice(-1); // keep only the newest receipt waiting, older ones can be reprinted from the sales list
        clearTimeout(retryT);retryT=setTimeout(run,10000);break}}}
    finally{busy=false}
  }
  // called by pos-server for every new sale
  module.exports.printSale=s=>{const c=cfg();if(!c.on)return;queue.push(s);run()};
  ipcMain.handle('printer-list',async()=>(await printers()).map(p=>({name:p.name,display:p.displayName||p.name,isDefault:!!p.isDefault})));
  ipcMain.handle('printer-test',async()=>{const c=cfg();const r=await printOne({no:0,date:new Date().toISOString().slice(0,10),time:new Date().toTimeString().slice(0,5),cashier:'تجربة',method:'cash',items:[{name:'تجربة طباعة',qty:1,price:0}],total:0},Object.assign(c,{on:true}));
    if(r.ok){fails=0;set(c.on?'ok':'off')}return r});
  module.exports.reprint=async s=>{const r=await printOne(s,Object.assign(cfg(),{on:true}));if(r.ok&&cfg().on){fails=0;set('ok')}return r};
  ipcMain.on('printer-state',e=>{e.returnValue=state});
  // admin pressed connect / disconnect (the ERP has already saved DB.printer.on)
  const apply=async()=>{const c=cfg();fails=0;if(!c.on){queue=[];clearTimeout(retryT);set('off');return state}
    const list=await printers();if(c.name&&list.some(p=>p.name===c.name))set('ok');else{fails=3;set('down',c.name?'الطابعة "'+c.name+'" مش موجودة أو مش موصولة':'ما في طابعة مختارة')}return state};
  ipcMain.handle('printer-apply',apply);
  setTimeout(apply,4000); // check the printer when the app starts
  // keep checking every 15 s that the printer is still there, and recover on its own when it comes back
  setInterval(async()=>{const c=cfg();if(!c.on){if(state.state!=='off')set('off');return}
    const there=c.name&&(await printers()).some(p=>p.name===c.name);
    if(there&&state.state!=='ok'&&!queue.length){fails=0;set('ok')}
    else if(there&&queue.length)run();
    else if(!there&&state.state==='ok'){fails=1;set('retry','الطابعة انفصلت، بنحاول نرجّعها')}
    else if(!there&&state.state==='retry'){fails++;if(fails>=3)set('down','الطابعة "'+c.name+'" مش موصولة');else set('retry',state.msg)}},15000);
  module.exports.state=()=>state;module.exports.receipt=receipt;
};
