// AI API key (Anthropic) — stored encrypted on this computer, only the super admin can set or test it.
// The key file is Documents\Basita\ai-key.bin, encrypted with Windows' own protection (safeStorage),
// so it never sits in the data file, the backups or the cashier tablets.
const {safeStorage}=require('electron'),fs=require('fs'),path=require('path');
const MODELS=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'];
module.exports=function(app,ipcMain){
  const dir=path.join(app.getPath('documents'),'Basita'),file=path.join(dir,'ai-key.bin'),meta=path.join(dir,'ai-settings.json');
  const readMeta=()=>{try{return JSON.parse(fs.readFileSync(meta,'utf8'))}catch(e){return {model:MODELS[0]}}};
  const readKey=()=>{try{const b=fs.readFileSync(file);return safeStorage.isEncryptionAvailable()?safeStorage.decryptString(b):b.toString('utf8')}catch(e){return ''}};
  const status=()=>{const k=readKey(),m=readMeta();return {hasKey:!!k,last4:k?k.slice(-4):'',model:MODELS.includes(m.model)?m.model:MODELS[0],models:MODELS,lastTest:m.lastTest||null}};
  ipcMain.handle('ai-status',()=>status());
  ipcMain.handle('ai-save',(e,key,model)=>{fs.mkdirSync(dir,{recursive:true});
    if(key){key=String(key).trim();const enc=safeStorage.isEncryptionAvailable()?safeStorage.encryptString(key):Buffer.from(key,'utf8');fs.writeFileSync(file,enc)}
    const m=readMeta();if(MODELS.includes(model))m.model=model;fs.writeFileSync(meta,JSON.stringify(m));return status()});
  ipcMain.handle('ai-clear',()=>{try{fs.unlinkSync(file)}catch(e){}return status()});
  // a tiny request that proves the key, the internet connection and the model all work
  ipcMain.handle('ai-test',async()=>{
    const key=readKey(),st=status();if(!key)return {ok:false,reason:'ما في مفتاح محفوظ'};
    let Anthropic;try{const SDK=require('@anthropic-ai/sdk');Anthropic=SDK.default||SDK}catch(e){return {ok:false,reason:'مكتبة الاتصال مش موجودة بالبرنامج'}} // loaded here so the app always starts
    const client=new Anthropic({apiKey:key,timeout:30000,maxRetries:1}),t0=Date.now();
    let r;
    try{
      const res=await client.beta.messages.create({model:st.model,max_tokens:200,
        betas:['server-side-fallback-2026-07-01'],fallbacks:'default',
        output_config:{effort:'low'},
        messages:[{role:'user',content:'Reply with only the Arabic word: تمام'}]});
      const text=res.stop_reason==='refusal'?'':(res.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
      r={ok:true,ms:Date.now()-t0,model:res.model,reply:text||'(رد فاضي)',tokens:(res.usage&&res.usage.input_tokens+res.usage.output_tokens)||0};
    }catch(err){
      let reason='صار خطأ: '+(err&&err.message||err);
      if(err instanceof Anthropic.AuthenticationError)reason='المفتاح غلط أو انلغى (401)';
      else if(err instanceof Anthropic.PermissionDeniedError)reason='المفتاح ما إله صلاحية على هاد الموديل (403)';
      else if(err instanceof Anthropic.NotFoundError)reason='الموديل مش موجود (404)';
      else if(err instanceof Anthropic.RateLimitError)reason='كثير طلبات أو خلص الرصيد (429)';
      else if(err instanceof Anthropic.APIConnectionError)reason='ما في إنترنت أو الاتصال انقطع';
      else if(err instanceof Anthropic.APIError)reason='خطأ من الخدمة ('+err.status+'): '+err.message;
      r={ok:false,ms:Date.now()-t0,reason};
    }
    const m=readMeta();m.lastTest={at:new Date().toISOString(),ok:r.ok,msg:r.ok?r.reply:r.reason};try{fs.writeFileSync(meta,JSON.stringify(m))}catch(e){}
    return r;
  });
};
