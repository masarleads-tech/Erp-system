const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('basita',{
  savePDF:name=>ipcRenderer.invoke('save-pdf',name),
  load:()=>ipcRenderer.sendSync('data-load'),
  save:json=>ipcRenderer.sendSync('data-save',json),
  posInfo:()=>ipcRenderer.sendSync('pos-info'),
  posSales:()=>ipcRenderer.sendSync('pos-sales'),
  posImport:list=>ipcRenderer.sendSync('pos-import',list),
  posVoid:(id,v)=>ipcRenderer.sendSync('pos-void',id,v),
  onPos:cb=>ipcRenderer.on('pos-changed',()=>cb())
});
