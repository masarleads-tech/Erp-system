const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('basita',{
  savePDF:name=>ipcRenderer.invoke('save-pdf',name),
  load:()=>ipcRenderer.sendSync('data-load'),
  save:json=>ipcRenderer.sendSync('data-save',json)
});
