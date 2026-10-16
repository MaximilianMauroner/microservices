import hashlib,json,pathlib,subprocess,tarfile
R=pathlib.Path.cwd(); A=R/'.agents/artifacts/helper-logical-r7'; S=pathlib.Path('/dev/shm/direct-upload-final-verifier-20261016'); D=pathlib.Path('/home/codex/.local/share/direct-upload-vm-20261016/final-native-verifier')
status=json.loads((A/'status.json').read_text()); assert status['execution-verdict']=='pass' and status['ownedPortsClosed']
manifest=json.loads((R/'.agents/artifacts/final-native-verifier/build-manifest.json').read_text()); h=hashlib.sha256()
for row in manifest['files']:
 b=(R/'services/tools/.output'/row['path']).read_bytes(); assert hashlib.sha256(b).hexdigest()==row['sha256']; h.update(row['path'].encode()+b'\0'+b)
assert h.hexdigest()==manifest['treeSha256']
assert sorted(row['path'] for row in manifest['files'])==sorted(str(p.relative_to(R/'services/tools/.output')) for p in (R/'services/tools/.output').rglob('*') if p.is_file())
with tarfile.open(status['pre-stop-archive']['path']) as tar:
 pgpid=int(tar.extractfile(S.name+'/database/postmaster.pid').read().splitlines()[0])
pids={}
for label,pid in [('postgres',pgpid),('storage',status['storage-pid'])]:
 r=subprocess.run(['ps','-p',str(pid),'-o','stat='],text=True,capture_output=True); assert r.returncode!=0 or r.stdout.strip().startswith('Z'); pids[label]={'pid':pid,'active':False}
assert not (S/'database/postmaster.pid').exists()
listeners=subprocess.check_output(['ss','-H','-ltnp','( sport = :45434 or sport = :49004 or sport = :49005 or sport = :43175 )'],text=True);assert not listeners.strip()
old={
'helper-http-date-r6-pre-stop-fixture.tar':'11b33ccc2ae4d02b19f5ff5c86b672ace6a875e78bbdb0293e1bd94ed69b59b9',
'helper-http-date-r6-stopped-fixture.tar':'1cf5fd09ee784ee541108a9d5779f1a775745691e113acfe601fc3cdc5713ea1',
'helper-http-date-r6-retry-pre-stop-fixture.tar':'a6813a9cd769b58a952bea449fb42518d47b0d135565af332e13ffeec70199a2',
'helper-http-date-r6-retry-stopped-fixture.tar':'e41e9896fa5a5f9543f3a23feeb3a03e05e6e1d0e6463b9f02497ddffcabd40d'}
for name,expected in old.items():
 p=D/name; assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==expected
for key in ['pre-stop-archive','stopped-archive']:
 p=pathlib.Path(status[key]['path']);assert p.stat().st_mode&0o077==0
summary=json.loads((A/'independent-summary.json').read_text()); rows=sum(summary['tableCounts'].values());assert len(summary['objects'])==5
result={'verdict':'PASS','driverExit':0,'buildProof':json.loads((R/'services/tools/.output/build-source-proof.json').read_text()),'buildTreeMatchesPriorManifest':True,'buildTreeSha256':h.hexdigest(),'buildFilesVerified':len(manifest['files']),'buildEntrySha256':hashlib.sha256((R/'services/tools/.output/server/index.mjs').read_bytes()).hexdigest(),'ownedPids':pids,'ownedPortsClosed':True,'postmasterPidFileAbsent':True,'earlierR6ArchivesHashUnchanged':old,'earlierArchivesRetained':sorted(p.name for p in D.glob('*.tar') if not p.name.startswith('helper-logical-r7')),'tablesCompared':len(summary['tableCounts']),'rowsCompared':rows,'objectsCompared':5,'trackedSourceChanges':subprocess.check_output(['git','status','--short'],text=True),'diffCheckExit':subprocess.run(['git','diff','--check']).returncode}
assert result['trackedSourceChanges']=='' and result['diffCheckExit']==0
(A/'final-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
