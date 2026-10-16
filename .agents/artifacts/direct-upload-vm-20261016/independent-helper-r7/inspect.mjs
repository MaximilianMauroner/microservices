import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../services/tools/publisher/package.json',import.meta.url));
const sdk=require('@aws-sdk/client-s3');
const postgres=require('postgres');
const [mode,state,owner]=process.argv.slice(2);
const env=JSON.parse(await readFile(state+'/environment.json','utf8'));
const client=new sdk.S3Client({endpoint:env.ARTIFACT_S3_ENDPOINT,region:env.ARTIFACT_S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.ARTIFACT_S3_ACCESS_KEY_ID,secretAccessKey:env.ARTIFACT_S3_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',maxAttempts:1});
const sourceUrl=new URL(env.DATABASE_URL);
const targetUrl=new URL(sourceUrl);targetUrl.pathname='/r7_restore_'+owner;
const targetBucket='tools-release-restore-'+owner;
const canon=v=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>createHash('sha256').update(v).digest('hex');
const connect=url=>postgres(String(url),{max:1,connection:{timezone:'UTC'},idle_timeout:2});
async function snapshot(url,bucket,label){
 const sql=connect(url);const objects=[];
 try{
  const tables=await sql`select table_schema, table_name from information_schema.tables where table_schema in ('tools','artifacts') and table_type='BASE TABLE' order by table_schema,table_name`;
  const database={};
  for(const t of tables){const rows=await sql.unsafe('select to_jsonb(t) as row from "'+t.table_schema+'"."'+t.table_name+'" t');database[t.table_schema+'.'+t.table_name]=rows.map(r=>canon(r.row)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
  let token;
  do{const page=await client.send(new sdk.ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));
   for(const item of page.Contents??[]){
    const result=await client.send(new sdk.GetObjectCommand({Bucket:bucket,Key:item.Key,IfMatch:item.ETag}));
    const raw=Buffer.from(await result.Body.transformToByteArray());
    const tags=(await client.send(new sdk.GetObjectTaggingCommand({Bucket:bucket,Key:item.Key}))).TagSet??[];
    tags.sort((a,b)=>a.Key.localeCompare(b.Key));
    const metadata=Object.fromEntries(['ContentType','CacheControl','ContentDisposition','ContentEncoding','ContentLanguage','Expires','WebsiteRedirectLocation','Metadata','ServerSideEncryption'].filter(k=>result[k]!==undefined).map(k=>[k,canon(result[k])]));
    assert.equal(raw.length,item.Size);assert.equal(result.ETag,item.ETag);
    const file=state+'/r7-independent/'+label+'-'+hash(item.Key)+'.bin';await writeFile(file,raw,{flag:'wx',mode:0o600});
    objects.push({key:item.Key,bytes:raw.length,sha256:hash(raw),metadata:canon(metadata),tags:canon(tags),listingModified:item.LastModified.toISOString(),getModified:result.LastModified.toISOString(),etag:item.ETag,file});
   }token=page.IsTruncated?page.NextContinuationToken:undefined;
  }while(token);
  objects.sort((a,b)=>a.key.localeCompare(b.key));
  const result={database:canon(database),objects};await writeFile(state+'/r7-independent/'+label+'.json',JSON.stringify(result,null,2),{flag:'wx',mode:0o600});return result;
 }finally{await sql.end();}
}
await mkdir(state+'/r7-independent',{mode:0o700,recursive:true});
try{
 if(mode==='setup'||mode==='fresh-target'){
  const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';const admin=connect(adminUrl);
  try{await admin.unsafe('create database "r7_restore_'+owner+'"');}finally{await admin.end();}
  const target=connect(targetUrl);
  try{await target`create table public.tools_runtime_test_sentinel(sentinel_key text primary key,sentinel_value text not null)`;
   await target`insert into public.tools_runtime_test_sentinel values ('database-purpose','tools-runtime-disposable-test-database'),('release-restore-owner',${owner}),('release-restore-state','empty')`;
  }finally{await target.end();}
  await client.send(new sdk.CreateBucketCommand({Bucket:targetBucket}));
  await client.send(new sdk.PutBucketTaggingCommand({Bucket:targetBucket,Tagging:{TagSet:[{Key:'tools-release-restore-owner',Value:owner},{Key:'tools-release-restore-state',Value:'empty'}]}}));
  if(mode==='fresh-target'){console.log(JSON.stringify({freshTarget:true}));}else{
  const before=await snapshot(sourceUrl,env.ARTIFACT_S3_BUCKET,'source-before');
  const old=JSON.parse(await readFile(state+'/r6-independent/source-before.json','utf8'));
  const strip=x=>({...x,objects:x.objects.map(({file,...rest})=>rest)});
  assert.deepEqual(strip(before),strip(old),'Retained R6 source changed');
  const differing=before.objects.filter(o=>o.listingModified!==o.getModified);
  assert(differing.length,'No real differing timestamp found; fixture append is required');
  for(const o of differing){assert.equal(new Date(Math.floor(Date.parse(o.listingModified)/1000)*1000).toISOString(),o.getModified);}
  console.log(JSON.stringify({freshTarget:true,objects:before.objects.length,differingTimestampObjects:differing.length,example:{listing:differing[0].listingModified,get:differing[0].getModified,sha256:differing[0].sha256}},null,2));
 }
 }else if(mode==='compare'){
  const before=JSON.parse(await readFile(state+'/r7-independent/source-before.json','utf8'));
  const after=await snapshot(sourceUrl,env.ARTIFACT_S3_BUCKET,'source-after');
  const target=await snapshot(targetUrl,targetBucket,'target-after');
  const withoutFiles=s=>({...s,objects:s.objects.map(({file,...rest})=>rest)});
  assert.deepEqual(withoutFiles(after),withoutFiles(before),'Source changed');
  const writable=s=>({database:s.database,objects:s.objects.map(({key,bytes,sha256,metadata,tags})=>({key,bytes,sha256,metadata,tags}))});
  assert.deepEqual(writable(target),writable(before),'Restored bytes, metadata, tags, or database differ');
  const manifest=JSON.parse(await readFile(state+'/r7-backup/manifest.json','utf8'));
  const backupDatabase=JSON.parse(await readFile(state+'/r7-backup/database.json','utf8'));
  const parsed=canon(Object.fromEntries(Object.entries(backupDatabase).map(([k,rows])=>[k,rows.map(r=>canon(JSON.parse(r))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])));
  assert.deepEqual(parsed,before.database,'Backup rows differ from independent source');
  assert.deepEqual(JSON.parse(await readFile(state+'/r7-backup/database-after.json','utf8')),backupDatabase);
  for(const o of before.objects){const m=manifest.objects.find(m=>m.key===o.key);assert(m);assert.equal(m.modified,o.listingModified);assert.equal(m.etag,o.etag);assert.equal(m.sha256,o.sha256);assert.equal(m.bytes,o.bytes);assert.deepEqual(canon(m.metadata),o.metadata);assert.deepEqual(canon(m.tags),o.tags);assert.deepEqual(await readFile(state+'/r7-backup/'+m.file),await readFile(o.file));const t=target.objects.find(t=>t.key===o.key);assert.deepEqual(await readFile(t.file),await readFile(o.file));}
  assert.deepEqual(JSON.parse(await readFile(state+'/r7-backup/bucket-before.json','utf8')),JSON.parse(await readFile(state+'/r7-backup/bucket-after.json','utf8')));
  const sql=connect(targetUrl);let markers;try{markers=await sql`select * from public.tools_runtime_test_sentinel order by sentinel_key`;}finally{await sql.end();}
  const databaseMarkerVerified=markers.some(r=>r.sentinel_key==='release-restore-state'&&r.sentinel_value==='verified');
  const tags=(await client.send(new sdk.GetBucketTaggingCommand({Bucket:targetBucket}))).TagSet;
  const bucketMarkerVerified=tags.some(t=>t.Key==='tools-release-restore-state'&&t.Value==='verified');
  assert(databaseMarkerVerified&&bucketMarkerVerified,'Target completion markers are not verified');
  const evidence={objects:before.objects.map(({bytes,sha256,listingModified,getModified,metadata,tags})=>({bytes,sha256,listingModified,getModified,metadataFields:Object.keys(metadata),tagCount:tags.length})),tableCounts:Object.fromEntries(Object.entries(before.database).map(([k,v])=>[k,v.length]))};
  await writeFile(new URL('./independent-summary.json',import.meta.url),JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({sourceUnchanged:true,rawBodyComparisons:before.objects.length,metadataAndTagsEqual:true,allDatabaseRowsEqual:true,fullListingMillisecondsPreserved:true,targetMarkersVerified:databaseMarkerVerified&&bucketMarkerVerified,manifestSha256:hash(await readFile(state+'/r7-backup/manifest.json'))},null,2));
 }else throw Error('Unknown inspection mode');
}finally{client.destroy();}
