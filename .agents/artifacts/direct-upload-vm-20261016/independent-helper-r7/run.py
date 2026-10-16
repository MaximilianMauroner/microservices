import hashlib,json,os,pathlib,secrets,socket,subprocess,tarfile,time
ROOT=pathlib.Path.cwd(); A=ROOT/'.agents/artifacts/helper-logical-r7'; STATE=pathlib.Path('/dev/shm/direct-upload-final-verifier-20261016')
DURABLE=pathlib.Path('/home/codex/.local/share/direct-upload-vm-20261016/final-native-verifier')
NODE='/home/codex/.local/share/direct-upload-vm-20261016/deps/node-v22.23.3-linux-x64/bin'
PG='/usr/lib/postgresql/16/bin'; HELPER=ROOT/'services/tools/publisher/scripts/release-paired-backup.mjs'
status={}; storage=None
os.umask(0o077)
def record(k,v):
 status[k]=v;(A/'status.json').write_text(json.dumps(status,indent=2));print(k,json.dumps(v),flush=True)
def run(k,cmd,env=None):
 with (A/(k+'.log')).open('x') as out:r=subprocess.run(cmd,cwd=ROOT,env=env,stdout=out,stderr=subprocess.STDOUT)
 record(k,{'exit':r.returncode,'log':str(A/(k+'.log'))});assert r.returncode==0,k+' failed; see retained log'
def fingerprint():
 names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z','services/tools','package.json','pnpm-lock.yaml','pnpm-workspace.yaml']).split(b'\0');h=hashlib.sha256()
 for n in sorted(set(filter(None,names))):h.update(n+b'\0'+(ROOT/n.decode()).read_bytes())
 return h.hexdigest()
def archive(label,verify=False):
 path=DURABLE/('helper-logical-r7-'+label+'-fixture.tar')
 with tarfile.open(path,'x') as tar:tar.add(STATE,arcname=STATE.name)
 count=0
 if verify:
  with tarfile.open(path) as tar:
   for member in tar.getmembers():
    if not member.isfile():continue
    local=STATE/pathlib.PurePosixPath(member.name).relative_to(STATE.name)
    assert tar.extractfile(member).read()==local.read_bytes(),member.name;count+=1
 record(label+'-archive',{'path':str(path),'bytes':path.stat().st_size,'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),'regularFilesVerified':count})
paths=[HELPER,HELPER.with_suffix('.test.mjs')]
build_files=sorted(p for p in (ROOT/'services/tools').glob('**/dist/**/*') if p.is_file())
def build_fingerprint():
 h=hashlib.sha256()
 for p in build_files:h.update(str(p.relative_to(ROOT)).encode()+b'\0'+p.read_bytes())
 return {'files':len(build_files),'sha256':h.hexdigest()}
build_before=build_fingerprint();record('build-before',build_before)
start=fingerprint();assert start=='81172b361df7e14a09818ef9352270e3ac203aec2ce1dcf60aa9cacf72100fac';checks={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
record('provenance',{'sourceFingerprint':start,'checksums':checks,'revision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'node':subprocess.check_output([NODE+'/node','--version'],text=True).strip()})
baseenv={'PATH':NODE+':'+PG+':/home/codex/.local/bin:/usr/bin:/bin','HOME':str(STATE/'home'),'LANG':'C.UTF-8','NODE_OPTIONS':'--max-old-space-size=1024'}
fake=json.loads((STATE/'environment.json').read_text());env={**baseenv,**fake};env['PATH']=baseenv['PATH']
owner='r7'+secrets.token_hex(10);targeturl=__import__('urllib.parse',fromlist=['urlsplit']).urlsplit(fake['DATABASE_URL']);parse=__import__('urllib.parse',fromlist=['urlunsplit']);targeturl=parse.urlunsplit(targeturl._replace(path='/r7_restore_'+owner))
for k in ['DATABASE_URL','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY']:
 env['RELEASE_'+k]=fake[k if k=='DATABASE_URL' else 'ARTIFACT_'+k];env['RELEASE_RESTORE_'+k]=fake[k if k=='DATABASE_URL' else 'ARTIFACT_'+k]
env.update({'RELEASE_RESTORE_DATABASE_URL':targeturl,'RELEASE_RESTORE_S3_BUCKET':'tools-release-restore-'+owner,'RELEASE_RESTORE_OWNER':owner})
(STATE/'r7-release-environment.json').write_text(json.dumps({k:v for k,v in env.items() if k.startswith('RELEASE_')},indent=2))
try:
 assert int(dict(l.split(':',1) for l in pathlib.Path('/proc/meminfo').read_text().splitlines())['MemAvailable'].split()[0])>768*1024
 for port in [45434,49004,49005,43175]:
  with socket.socket() as probe:probe.bind(('127.0.0.1',port))
 run('boundaries',[NODE+'/node','--test',str(HELPER.with_suffix('.test.mjs'))],baseenv)
 run('postgres-start',[PG+'/pg_ctl','-D',str(STATE/'database'),'-l',str(STATE/'postgres.log'),'-o',"-h 127.0.0.1 -p 45434 -c unix_socket_directories=''",'-w','start'],env)
 with (STATE/'r7-storage.log').open('x') as log:
  storage=subprocess.Popen(['/home/codex/.local/share/direct-upload-vm-20261016/deps/rustfs','server','--address','127.0.0.1:49004','--console-address','127.0.0.1:49005',str(STATE/'bodies')],cwd=STATE,env=env,stdout=log,stderr=log,start_new_session=True)
 (STATE/'storage.pid').write_text(str(storage.pid));record('storage-pid',storage.pid)
 from urllib.request import urlopen
 for attempt in range(60):
  try:
   with urlopen('http://127.0.0.1:49004/health',timeout=2) as response:assert response.status==200
   break
  except OSError:
   assert storage.poll() is None,'Owned RustFS exited';time.sleep(.5)
 else:raise RuntimeError('Owned RustFS readiness failed')
 run('setup-and-precision',[NODE+'/node',str(A/'inspect.mjs'),'setup',str(STATE),owner],env)
 run('preflight',[NODE+'/node',str(HELPER),'preflight','--tmpdir',str(STATE/'tmp')],env)
 record('quiet-source',{'appNotStarted':True,'sourceWritesAfterIndependentSnapshot':False,'otherWritersAuthorized':False,'tmpdir':str(STATE/'tmp')})
 run('paired-backup',[NODE+'/node',str(HELPER),'backup','--tmpdir',str(STATE/'tmp'),'--directory',str(STATE/'r7-backup')],env)
 run('restore',[NODE+'/node',str(HELPER),'restore','--directory',str(STATE/'r7-backup')],env)
 run('verify-target',[NODE+'/node',str(HELPER),'verify','--directory',str(STATE/'r7-backup')],env)
 run('verify-target-repeat',[NODE+'/node',str(HELPER),'verify','--directory',str(STATE/'r7-backup')],env)
 run('verify-source',[NODE+'/node',str(HELPER),'verify','--source','--directory',str(STATE/'r7-backup')],env)
 run('independent-compare',[NODE+'/node',str(A/'inspect.mjs'),'compare',str(STATE),owner],env)
 assert fingerprint()==start;record('source-unchanged',True)
 record('execution-verdict','pass')
except BaseException as error:
 record('execution-verdict','fail');record('error',repr(error));raise
finally:
 if (STATE/'database/postmaster.pid').exists():
  for label,url in [('source',fake['DATABASE_URL']),('target',targeturl)]:
   try:run(label+'-final-dump',[PG+'/pg_dump','--format=custom','--file='+str(STATE/('r7-'+label+'-final.dump')),url],env)
   except Exception as error:record(label+'-final-dump-error',repr(error))
 archive('pre-stop')
 run('fixture-stop',['python3',str(ROOT/'.agents/skills/verify-tools/scripts/native-fixtures.py'),'stop','--state',str(STATE)],env)
 archive('stopped',True)
 listeners=subprocess.check_output(['ss','-H','-ltnp','( sport = :45434 or sport = :49004 or sport = :49005 or sport = :43175 )'],text=True)
 (A/'stopped-listeners.txt').write_text(listeners or 'No owned ports have listeners.\n');assert not listeners.strip();assert not (STATE/'database/postmaster.pid').exists()
 record('ownedPortsClosed',True)
 assert fingerprint()==start;record('finalSourceFingerprint',fingerprint())
 assert build_fingerprint()==build_before;record('build-after',build_fingerprint())
 record('finalChecksums',{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
 (A/'final-git-status.txt').write_text(subprocess.check_output(['git','status','--short'],text=True))
