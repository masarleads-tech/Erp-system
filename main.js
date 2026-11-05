const {app,BrowserWindow,ipcMain,dialog,Menu,shell}=require('electron');
const path=require('path'),fs=require('fs');
let win;
require('./data.js')(app,ipcMain);
require('./data.js').autoBackup(app);
app.whenReady().then(()=>{require('./ai.js')(app,ipcMain);require('./printer.js')(app,ipcMain,()=>win);require('./pos-server.js')(app,ipcMain,()=>win)});
if(!app.requestSingleInstanceLock()){app.quit()}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
function create(){
  win=new BrowserWindow({width:1200,height:850,minWidth:380,title:'بسيطة',backgroundColor:'#f6f2ea',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  Menu.setApplicationMenu(null);
  // keep keyboard focus in the page (after save dialogs, minimising, alt-tab), so text boxes always take typing
  const refocus=()=>{if(win&&!win.isDestroyed()){win.focus();win.webContents.focus()}};
  win.on('focus',()=>win.webContents.focus());win.on('restore',refocus);win.on('show',refocus);
  module.exports.refocus=refocus;
  win.loadFile(path.join(__dirname,'index.html'));
  // block any network navigation; the ERP window itself stays offline
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.session.on('will-download',(e,item)=>{
    let name=item.getFilename();
    const p=dialog.showSaveDialogSync(win,{title:'حفظ الملف',defaultPath:path.join(app.getPath('documents'),name)});
    module.exports.refocus();
    if(!p){item.cancel();return}
    item.setSavePath(p);
    item.once('done',(ev,state)=>{if(state==='completed')shell.showItemInFolder(p)});
  });
}
ipcMain.handle('save-pdf',async(e,name)=>{
  const p=dialog.showSaveDialogSync(win,{title:'حفظ التقرير PDF',defaultPath:path.join(app.getPath('documents'),name),filters:[{name:'PDF',extensions:['pdf']}]});
  module.exports.refocus();
  if(!p)return false;
  const data=await win.webContents.printToPDF({pageSize:'A4',printBackground:true,margins:{top:0.4,bottom:0.4,left:0.4,right:0.4}});
  fs.writeFileSync(p,data);shell.openPath(p);return true;
});
app.whenReady().then(create);
app.on('window-all-closed',()=>app.quit());
