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
    const m=readMeta();
    if(key){key=String(key).trim();const enc=safeStorage.isEncryptionAvailable()?safeStorage.encryptString(key):Buffer.from(key,'utf8');fs.writeFileSync(file,enc);delete m.lastTest} // a new key has to be tested again
    if(MODELS.includes(model))m.model=model;fs.writeFileSync(meta,JSON.stringify(m));return status()});
  ipcMain.handle('ai-clear',()=>{try{fs.unlinkSync(file)}catch(e){}const m=readMeta();delete m.lastTest;try{fs.writeFileSync(meta,JSON.stringify(m))}catch(e){}return status()});
  const SDK=()=>{const x=require('@anthropic-ai/sdk');return x.default||x}; // loaded only when used, so the app always starts
  const why=(err,A)=>{
    if(A&&err instanceof A.AuthenticationError)return 'المفتاح غلط أو انلغى (401)';
    if(A&&err instanceof A.PermissionDeniedError)return 'المفتاح ما إله صلاحية على هاد الموديل (403)';
    if(A&&err instanceof A.NotFoundError)return 'الموديل مش موجود (404)';
    if(A&&err instanceof A.RateLimitError)return 'كثير طلبات أو خلص الرصيد (429)';
    if(A&&err instanceof A.APIConnectionError)return 'ما في إنترنت أو الاتصال انقطع';
    if(A&&err instanceof A.APIError)return 'خطأ من الخدمة ('+err.status+'): '+err.message;
    return 'صار خطأ: '+(err&&err.message||err)};
  // one request to Claude; if the key stops working the AI screens lock again until it is re-tested
  async function call(params){
    const key=readKey();if(!key)return {ok:false,reason:'ما في مفتاح محفوظ',locked:true};
    let A;try{A=SDK()}catch(e){return {ok:false,reason:'مكتبة الاتصال مش موجودة بالبرنامج'}}
    const client=new A({apiKey:key,timeout:120000,maxRetries:2});
    try{
      const res=await client.beta.messages.create(Object.assign({model:status().model,betas:['server-side-fallback-2026-07-01'],fallbacks:'default'},params));
      if(res.stop_reason==='refusal')return {ok:false,reason:'المساعد رفض يجاوب على هاد الطلب'};
      return {ok:true,text:(res.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim(),cut:res.stop_reason==='max_tokens'};
    }catch(err){
      const auth=err instanceof A.AuthenticationError||err instanceof A.PermissionDeniedError;
      if(auth){const m=readMeta();m.lastTest={at:new Date().toISOString(),ok:false,msg:why(err,A)};try{fs.writeFileSync(meta,JSON.stringify(m))}catch(e){}}
      return {ok:false,reason:why(err,A),locked:auth};
    }
  }
  // who the assistant is: the restaurant itself, built from the profile the super admin filled in
  function persona(p){p=p||{};const name=p.name||'بسيطة',L=[];
    L.push(`انت «${name}»، المساعد الذكي لمطعم ${name}${p.slogan?' ('+p.slogan+')':''}. إذا حدا سألك مين انت أو شو اسمك، جاوب إنك ${name}، مساعد المطعم.`);
    L.push('بتحكي مع مدير المطعم باللهجة الأردنية، بجمل قصيرة وواضحة. المبالغ بالدينار الأردني بثلاث خانات عشرية.');
    L.push('شغلك: تجاوب عن المبيعات والدخل والرواتب والدفعات والمخزن والأرباح من البيانات المرفقة، وتعطي معلومات عن المطعم من ملف المطعم لما حدا يسأل.');
    L.push('اعتمد بس على ملف المطعم والبيانات المرفقة. إذا المعلومة مش موجودة فيهم قول بصراحة إنها مش عندك، وما تخترع أرقام ولا معلومات. لما تحسب، وضّح من وين جبت الرقم بسطر.');
    L.push('انت بتقرأ بس: ما بتقدر تعدّل ولا تحذف ولا تسجّل إشي بالبرنامج. إذا المدير طلب تعديل، قلّه وين يعمله بالبرنامج.');
    const F=[['اسم المطعم',name],['الشعار',p.slogan],['نوع المطعم',p.kind],['المالك',p.owner],['التلفون',p.phone],['العنوان',p.address],['ساعات الدوام',p.hours],['التوصيل',p.delivery],['السوشال ميديا',p.social],['نبذة',p.about]].filter(x=>x[1]);
    L.push('\n# ملف المطعم\n'+F.map(x=>'- '+x[0]+': '+x[1]).join('\n'));
    return L.join('\n')}
  // admin question about the business: {q, history:[{role,text}], ctx:'json text', profile}
  ipcMain.handle('ai-ask',async(e,a)=>{a=a||{};const q=String(a.q||'').trim().slice(0,4000);if(!q)return {ok:false,reason:'اكتب سؤال'};
    const msgs=(a.history||[]).slice(-10).filter(h=>h&&h.text&&(h.role==='user'||h.role==='assistant')).map(h=>({role:h.role,content:String(h.text).slice(0,8000)}));
    while(msgs.length&&msgs[0].role!=='user')msgs.shift();
    msgs.push({role:'user',content:q});
    return call({max_tokens:3000,output_config:{effort:'medium'},
      system:[{type:'text',text:persona(a.profile)},{type:'text',text:'# بيانات البرنامج (JSON)\n'+String(a.ctx||'{}'),cache_control:{type:'ephemeral'}}],
      messages:msgs})});
  // read a supplier bill from a photo: {image:'data:image/jpeg;base64,...', cats:[...], profile}
  ipcMain.handle('ai-bill',async(e,a)=>{a=a||{};const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(a.image||''));if(!m)return {ok:false,reason:'الصورة مش صالحة'};
    const cats=(a.cats||[]).filter(c=>typeof c==='string'&&c).slice(0,30);
    const schema={type:'object',additionalProperties:false,required:['is_bill','date','supplier','category','total','items','note'],properties:{
      is_bill:{type:'boolean',description:'هل الصورة فاتورة أو وصل شراء'},
      date:{type:'string',description:'تاريخ الفاتورة YYYY-MM-DD، أو فاضي إذا مش واضح'},
      supplier:{type:'string',description:'اسم المورد أو المحل'},
      category:cats.length?{type:'string',enum:cats.concat(['']),description:'أقرب نوع دفعة من القائمة، أو فاضي'}:{type:'string'},
      total:{type:'number',description:'المجموع النهائي المطلوب دفعه بالدينار، 0 إذا مش واضح'},
      items:{type:'array',items:{type:'object',additionalProperties:false,required:['name','qty','price'],properties:{name:{type:'string'},qty:{type:'number'},price:{type:'number'}}}},
      note:{type:'string',description:'ملاحظة قصيرة بالعربي عن أي شي مش واضح بالصورة'}}};
    const r=await call({max_tokens:4000,output_config:{effort:'low',format:{type:'json_schema',schema}},
      system:persona(a.profile)+'\n\nهلأ مطلوب منك تقرأ فاتورة مورّد من صورة وتطلّع بياناتها. اقرأ الأرقام زي ما هي بالصورة. المجموع هو المبلغ النهائي بعد الخصم والضريبة. الأرقام العربية (٠١٢٣) حوّلها لأرقام عادية. الدينار = 1000 فلس.',
      messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:m[1],data:m[2]}},{type:'text',text:'طلّع بيانات هاي الفاتورة. أنواع الدفعات عندنا: '+cats.join('، ')}]}]});
    if(!r.ok)return r;
    try{const j=JSON.parse(r.text.replace(/^```(?:json)?|```$/g,'').trim());return {ok:true,bill:j}}catch(err){return {ok:false,reason:'ما قدرنا نفهم رد المساعد، جرّب صورة أوضح'}}});
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
