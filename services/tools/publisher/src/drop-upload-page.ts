export function renderDropUploadPage(expiresAt: Date, nonce: string) {
  const expiry = expiresAt.toISOString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Send files</title><link rel="icon" href="/assets/icons/publisher.png">
<style nonce="${nonce}">${DROP_UPLOAD_STYLES}</style></head><body><main>
<div class="mark"><img src="/assets/icons/publisher.png" alt="" width="36" height="36"></div>
<p class="eyebrow">Private upload link</p><h1>Send files</h1>
<p class="intro">Choose as many files as you need. This link accepts uploads until <time datetime="${expiry}" id="expiry">${expiry}</time>.</p>
<form id="form"><label class="drop" id="drop"><strong>Drop files here</strong><span>or choose them from your device</span><input id="files" type="file" multiple required></label>
<button id="submit" type="submit">Upload files</button></form><p id="message" role="status" aria-live="polite"></p><ul id="results"></ul>
<p class="privacy">Files are sent directly to the link owner. This page does not show previously uploaded files.</p>
</main><script nonce="${nonce}">${DROP_UPLOAD_SCRIPT}</script></body></html>`;
}

const DROP_UPLOAD_STYLES = `
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#211a2d;background:#f5f2f8;color-scheme:light}*{box-sizing:border-box}body{margin:0;min-width:320px}main{width:min(640px,calc(100% - 32px));margin:8vh auto;background:#fff;border:1px solid #ddd5e6;border-radius:18px;padding:clamp(24px,6vw,48px);box-shadow:0 24px 70px rgba(45,27,65,.09)}.mark{display:grid;place-items:center;width:56px;height:56px;border-radius:16px;background:#f0e9f7}.eyebrow{margin:24px 0 8px;color:#72558e;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{font-size:clamp(32px,7vw,52px);line-height:1;margin:0}.intro{color:#665d70;line-height:1.55}.drop{display:grid;gap:8px;margin:28px 0 16px;padding:38px 24px;text-align:center;border:2px dashed #c8b9d6;border-radius:14px;background:#fbf9fc;cursor:pointer}.drop.is-over{border-color:#6f3d96;background:#f4edf9}.drop span,.privacy{color:#756d7d;font-size:14px}.drop input{margin:14px auto 0;max-width:100%}button{width:100%;border:0;border-radius:10px;padding:13px 18px;background:#6f3d96;color:#fff;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}#message{min-height:24px;font-weight:600}ul{list-style:none;margin:16px 0;padding:0;display:grid;gap:8px}li{padding:12px 14px;border:1px solid #e3dce9;border-radius:9px;font-size:14px;overflow-wrap:anywhere}li.ok{border-color:#acd5bd;background:#f1faf4}li.error{border-color:#e2b5b5;background:#fff4f4}.privacy{margin:28px 0 0;line-height:1.5}`;

const DROP_UPLOAD_SCRIPT = `
const form=document.getElementById('form'),input=document.getElementById('files'),button=document.getElementById('submit'),message=document.getElementById('message'),results=document.getElementById('results'),drop=document.getElementById('drop');
const SINGLE_REQUEST_LIMIT=80*1024*1024,CHUNK_BYTES=20*1024*1024;
document.getElementById('expiry').textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(document.getElementById('expiry').dateTime));
for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('is-over')});
for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('is-over')});
drop.addEventListener('drop',e=>{if(e.dataTransfer.files.length)input.files=e.dataTransfer.files});
const uploadBase=()=>location.pathname.replace(/\\/$/,'').replace(/^\\/drop\\//,'/api/drop/')+'/uploads';
async function readResponse(response){const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||'Upload failed.');return payload}
async function uploadFile(file,item){if(file.size<=SINGLE_REQUEST_LIMIT){const data=new FormData();data.append('file',file);return readResponse(await fetch(uploadBase(),{method:'POST',body:data,headers:{Accept:'application/json'}}))}
const totalChunks=Math.ceil(file.size/CHUNK_BYTES);const initialized=await readResponse(await fetch(uploadBase()+'/chunks',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({filename:file.name,contentType:file.type||'application/octet-stream',totalBytes:file.size,totalChunks,chunkBytes:CHUNK_BYTES})}));
const sessionPath=uploadBase()+'/chunks/'+initialized.sessionId;try{for(let index=0;index<totalChunks;index++){item.textContent='Uploading '+file.name+' — chunk '+(index+1)+' of '+totalChunks;const start=index*CHUNK_BYTES,end=Math.min(file.size,start+CHUNK_BYTES);await readResponse(await fetch(sessionPath+'/'+index,{method:'PUT',headers:{Accept:'application/json','Content-Type':'application/octet-stream'},body:file.slice(start,end)}))}return await readResponse(await fetch(sessionPath+'/complete',{method:'POST',headers:{Accept:'application/json'}}))}catch(error){void fetch(sessionPath,{method:'DELETE',headers:{Accept:'application/json'}});throw error}}
form.addEventListener('submit',async e=>{e.preventDefault();const files=Array.from(input.files||[]);if(!files.length)return;button.disabled=true;results.innerHTML='';let ok=0;
for(let i=0;i<files.length;i++){const file=files[i],item=document.createElement('li');item.textContent='Uploading '+file.name+' ('+(i+1)+' of '+files.length+')…';results.append(item);message.textContent='Uploading '+(i+1)+' of '+files.length+'…';
try{await uploadFile(file,item);item.className='ok';item.textContent='Uploaded '+file.name;ok++;}catch(error){item.className='error';item.textContent=file.name+': '+(error instanceof Error?error.message:'Upload failed.');}}
message.textContent=ok===files.length?(ok===1?'File sent successfully.':ok+' files sent successfully.'):ok+' of '+files.length+' files sent.';button.disabled=false;input.value='';});`;
