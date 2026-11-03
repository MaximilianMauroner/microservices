/** The public guest and legacy upload pages use the same durable protocol as
 * the React console. Keep signed URLs in memory, and retain only the request ID. */
export const DIRECT_UPLOAD_SCRIPT = `
async function uploadDirectFile(file,base,onProgress){
  const key='publisher.direct-upload:'+JSON.stringify([base,file.name,file.size,file.lastModified]);
  let requestId;try{requestId=sessionStorage.getItem(key)}catch{}requestId=requestId||crypto.randomUUID();
  const save=()=>{try{sessionStorage.setItem(key,requestId)}catch{}};save();
  async function control(url,body){
    for(let attempt=0;attempt<4;attempt++){
      try{const response=await fetch(url,{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(1200000),headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        const payload=await response.json();if(response.ok)return payload;
        if(attempt<3&&(response.status===503||payload.error==='upload_busy')){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue}
        const error=new Error(payload.message||'Upload failed. Retry to resume.');error.status=response.status;throw error;
      }catch(error){if(error.status||attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)))}
    }
  }
  const initialize=()=>control(base,{requestId,filename:file.name,contentType:file.type||'application/octet-stream',totalBytes:file.size});
  let session;try{session=await initialize()}catch(error){if(error.status!==404)throw error;requestId=crypto.randomUUID();save();session=await initialize()}
  const path=base+'/'+session.sessionId;
  if(session.state==='uploading')for(let number=1;number<=session.totalParts;number++){
    const start=(number-1)*session.partBytes,end=Math.min(file.size,start+session.partBytes),part=file.slice(start,end);
    const digest=await crypto.subtle.digest('SHA-256',await part.arrayBuffer());const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    for(let attempt=0;attempt<2;attempt++){
      const signed=await control(path+'/parts',{number,sha256});if(session.uploaded.includes(number))break;
      try{const response=await fetch(signed.url,{method:'PUT',credentials:'omit',body:part,signal:AbortSignal.timeout(300000)});if(!response.ok)throw new Error('The file transfer was interrupted. Retry to resume.');break}catch(error){if(attempt===1)throw error}
    }
    onProgress(end,file.size);
  }
  const result=await control(path+'/complete');try{sessionStorage.removeItem(key)}catch{}return result;
}
`;
