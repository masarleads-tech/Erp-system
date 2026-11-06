// Loaded only when the admin / super admin screens are opened from another device on the WiFi (http://<main computer>/erp).
// It gives the page the same window.basita functions the desktop app has, but each one is a request to the main computer.
(function(){
  var TK='basita_tok',RL='basita_role';
  function tok(){try{return sessionStorage.getItem(TK)||''}catch(e){return ''}}
  if(!tok()){location.replace('/');return}
  function out(){try{sessionStorage.removeItem(TK);sessionStorage.removeItem(RL)}catch(e){}location.replace('/')}
  // sync request (the page expects load/save/sales to answer straight away, like the desktop app)
  function callSync(ch,args){
    var x=new XMLHttpRequest();x.open('POST','/api/ipc/'+ch,false);x.setRequestHeader('Content-Type','application/json');x.setRequestHeader('X-Token',tok());
    x.send(JSON.stringify(args||[]));
    if(x.status===401){out();throw new Error('login')}
    if(x.status!==200)throw new Error('net '+x.status);
    return JSON.parse(x.responseText).r}
  function call(ch,args){return fetch('/api/ipc/'+ch,{method:'POST',headers:{'Content-Type':'application/json','X-Token':tok()},body:JSON.stringify(args||[])})
    .then(function(r){if(r.status===401){out();throw new Error('login')}if(!r.ok)throw new Error('net '+r.status);return r.json()}).then(function(j){return j.r})}
  function login(code){var x=new XMLHttpRequest();x.open('POST','/api/login',false);x.setRequestHeader('Content-Type','application/json');x.send(JSON.stringify({code:code}));
    if(x.status!==200)return null;var j=JSON.parse(x.responseText);if(!j.token)return null;try{sessionStorage.setItem(TK,j.token);sessionStorage.setItem(RL,j.role)}catch(e){}return j.role}
  var printerCbs=[],posCbs=[],lastPos=null;
  setInterval(function(){
    if(printerCbs.length)call('printer-state').then(function(s){printerCbs.forEach(function(cb){cb(s)})}).catch(function(){});
    if(posCbs.length)call('data-rev').then(function(r){if(lastPos!==null&&r.pos!==lastPos)posCbs.forEach(function(cb){cb()});lastPos=r.pos}).catch(function(){});
  },5000);
  window.basita={
    net:true,
    role:function(){try{return sessionStorage.getItem(RL)||'admin'}catch(e){return 'admin'}},
    login:login,logout:out,
    load:function(){return callSync('data-load')},
    save:function(j){return callSync('data-save',[j])},
    get:function(){return callSync('data-get')},
    sync:function(ops,base){return callSync('data-sync',[ops,base])},
    rev:function(){return callSync('data-rev')},
    posInfo:function(){return callSync('pos-info')},
    posSales:function(){return callSync('pos-sales')},
    posImport:function(l){return callSync('pos-import',[l])},
    posVoid:function(id,v){return callSync('pos-void',[id,v])},
    printers:function(){return call('printer-list')},
    printerTest:function(){return call('printer-test')},
    printerApply:function(){return call('printer-apply')},
    printerState:function(){try{return callSync('printer-state')}catch(e){return {state:'off'}}},
    reprint:function(id){return call('pos-reprint',[id])},
    onPrinter:function(cb){printerCbs.push(cb)},
    aiStatus:function(){return call('ai-status')},
    aiSave:function(k,m){return call('ai-save',[k,m])},
    aiTest:function(){return call('ai-test')},
    aiClear:function(){return call('ai-clear')},
    aiAsk:function(a){return call('ai-ask',[a])},
    aiBill:function(a){return call('ai-bill',[a])},
    imgSave:function(id,d){return call('img-save',[id,d])},
    onPos:function(cb){posCbs.push(cb)}
  };
})();
