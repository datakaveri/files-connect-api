import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OutputService, Store, Blob, hash, File } from '../../outputs/service';
import { outputRouter } from '../../outputs/router';
class Memory implements Store {
  objects=new Map<string,Blob>();
  async read(key:string,limit:number){const b=this.objects.get(key);if(b&&b.bytes.length>limit)throw new Error('limit');return b||null;}
  async create(key:string,bytes:Buffer){if(this.objects.has(key))return false;this.objects.set(key,{bytes,etag:'etag',contentType:'application/json'});return true;}
  async presign(key:string,file:File){return {url:'https://storage.example/'+key,headers:{'Content-Type':'text/csv'}};}
  async copy(from:string,to:string){this.objects.set(to,this.objects.get(from)!);}
  async list(prefix:string,limit:number){return [...this.objects].filter(([key])=>key.startsWith(prefix)).slice(0,limit).map(([key,value])=>({key,size:value.bytes.length,lastModified:new Date(0)}));}
  async download(key:string){return {url:'https://storage.example/'+key,expiresAt:new Date('2030-01-01T00:00:00Z')};}
}
const key='u'.repeat(40),publisher='p'.repeat(40),sandbox='s'.repeat(40),shared='d'.repeat(40);
function setup(allowShared=false){
 const store=new Memory();
 const service=new OutputService({reviewBase:'nha-review',workspaceBase:'user-workspaces',reviewDatabankId:'review',workspaceDatabankId:'workspace',maxManifestBytes:262144,maxFiles:1000,maxFileBytes:268435456,maxBytes:1073741824},store);
 const job={outputId:'run-1',ownerId:'owner',notebookName:'notebook'};
 const bytes=Buffer.from('name,value\na,1\n');const objectKey=service.review(job)+'output/result.csv';
 const file={fileId:hash(objectKey),path:'result.csv',objectKey,size:bytes.length,mediaType:'text/csv',sha256:hash(bytes)};
 const body={reviewPrefix:service.review(job),files:[file]};
 const token=jwt.sign({...job,scope:'output:upload'},key,{algorithm:'HS256',issuer:'sandbox-connect',audience:'files-connect-output',expiresIn:'1h'});
 const app=express();app.use(express.json());app.use('/v1/outputs',outputRouter(service,key,publisher,sandbox,shared,allowShared));
 const post=(op:string,b:object=body,t=token)=>request(app).post('/v1/outputs/run-1/'+op).set('Authorization','Bearer '+t).send(b);
 return {store,service,job,bytes,file,body,token,app,post};
}
test('authenticated upload, verification, publication and idempotent replay',async()=>{
 const x=setup();expect((await x.post('uploads')).status).toBe(200);
 expect((await x.post('complete')).status).toBe(409);
 x.store.objects.set('review/'+x.file.objectKey,{bytes:x.bytes,etag:'v1',contentType:'text/csv'});
 expect((await x.post('complete')).status).toBe(200);expect((await x.post('complete')).status).toBe(200);
 const p={...x.body,outputId:x.job.outputId,ownerId:x.job.ownerId,reviewDatabankId:'review',workspaceDatabankId:'workspace',reviewManifestKey:x.body.reviewPrefix+'manifest.json',workspacePrefix:x.service.workspace(x.job)};
 expect((await x.post('publish',p)).status).toBe(403);
 expect((await x.post('publish',p,publisher)).status).toBe(200);
 expect((await x.post('publish',p,publisher)).status).toBe(200);
 expect((await x.post('publish',{...p,ownerId:'other'},publisher)).status).toBe(403);
 expect(x.store.objects.has('workspace/'+p.workspacePrefix+'manifest.json')).toBe(true);
});
test('reject foreign, expired and absent tokens even with normal authentication disabled',async()=>{
 const x=setup();expect((await request(x.app).post('/v1/outputs/run-1/uploads').send(x.body)).status).toBe(401);
 expect((await x.post('uploads',x.body,publisher)).status).toBe(403);
 const expired=jwt.sign({...x.job,scope:'output:upload'},key,{issuer:'sandbox-connect',audience:'files-connect-output',expiresIn:-1});expect((await x.post('uploads',x.body,expired)).status).toBe(403);
 expect((await request(x.app).post('/v1/outputs/other/uploads').set('Authorization','Bearer '+x.token).send(x.body)).status).toBe(403);
});
test('reject prefix traversal, wrong identities, duplicates and conflicting inventories',async()=>{
 const x=setup();expect((await x.post('uploads',{...x.body,reviewPrefix:'other/'})).status).toBe(403);
 expect((await x.post('uploads',{...x.body,files:[{...x.file,path:'../result.csv'}]})).status).toBe(400);
 expect((await x.post('uploads',{...x.body,files:[x.file,x.file]})).status).toBe(400);
 await x.post('uploads');expect((await x.post('uploads',{...x.body,files:[{...x.file,sha256:'a'.repeat(64)}]})).status).toBe(409);
});
test.each(['checksum','type','csv'])('completion rejects invalid %s without manifest',async(kind)=>{
 const x=setup();if(kind==='csv'){x.bytes=Buffer.from('a,b\n1\n');x.file.size=x.bytes.length;x.file.sha256=hash(x.bytes);}
 await x.post('uploads');x.store.objects.set('review/'+x.file.objectKey,{bytes:kind==='checksum'?Buffer.from('bad'):x.bytes,etag:'v1',contentType:kind==='type'?'text/plain':'text/csv'});
 expect((await x.post('complete')).status).toBe(kind==='csv'?422:409);
 expect(x.store.objects.has('review/'+x.body.reviewPrefix+'manifest.json')).toBe(false);
});
test('internal review preview requires the sandbox service token and a completed manifest',async()=>{
 const x=setup(),path='/v1/outputs/internal/review/run-1/files/'+x.file.fileId+'/preview';
 expect((await request(x.app).get(path)).status).toBe(401);
 expect((await request(x.app).get(path).set('Authorization','Bearer '+shared)).status).toBe(403);
 await x.post('uploads');
 x.store.objects.set('review/'+x.file.objectKey,{bytes:x.bytes,etag:'v1',contentType:'text/csv'});
 expect((await request(x.app).get(path).set('Authorization','Bearer '+sandbox)).status).toBe(409);
 await x.post('complete');
 const preview=await request(x.app).get(path).set('Authorization','Bearer '+sandbox);
 expect(preview.status).toBe(200);
 expect(preview.body.data.content).toMatchObject({headers:['name','value'],totalRows:1,data:[{name:'a',value:'1'}]});
 expect((await request(x.app).get(path.replace(x.file.fileId,'a'.repeat(64))).set('Authorization','Bearer '+sandbox)).status).toBe(404);
});
test('internal workspace access exposes only files committed by a publication manifest',async()=>{
 const x=setup();
 await x.post('uploads');
 x.store.objects.set('review/'+x.file.objectKey,{bytes:x.bytes,etag:'v1',contentType:'text/csv'});
 await x.post('complete');
 const publication={...x.body,outputId:x.job.outputId,ownerId:x.job.ownerId,reviewDatabankId:'review',workspaceDatabankId:'workspace',reviewManifestKey:x.body.reviewPrefix+'manifest.json',workspacePrefix:x.service.workspace(x.job)};
 await x.post('publish',publication,publisher);
 x.store.objects.set('workspace/user-workspaces/users/owner/outputs/uncommitted/orphan.csv',{bytes:x.bytes,etag:'v2',contentType:'text/csv'});
 const auth={'Authorization':'Bearer '+sandbox};
 const listed=await request(x.app).get('/v1/outputs/internal/workspaces/owner/files').set(auth);
 expect(listed.status).toBe(200);
 expect(listed.body.data.files).toHaveLength(1);
 expect(listed.body.data.files[0]).toMatchObject({name:'run-1/result.csv',size:x.bytes.length,contentType:'text/csv'});
 expect(listed.body.data.files[0].key).toBeUndefined();
 const id=listed.body.data.files[0].fileId;
 const base='/v1/outputs/internal/workspaces/owner/files/'+id;
 expect((await request(x.app).get(base+'/preview').set(auth)).body.data.content.totalRows).toBe(1);
 expect((await request(x.app).get(base+'/download').set(auth)).body.data.url).toContain('https://storage.example/workspace/');
 expect((await request(x.app).get('/v1/outputs/internal/workspaces/other/files').set(auth)).body.data.files).toEqual([]);
});
test('shared demo uploader token is opt-in and derives identity from the exact review prefix',async()=>{
 const disabled=setup();
 expect((await disabled.post('uploads',disabled.body,shared)).status).toBe(403);
 const enabled=setup(true);
 expect((await enabled.post('uploads',enabled.body,shared)).status).toBe(200);
 expect((await request(enabled.app).post('/v1/outputs/run-1/uploads').set('Authorization','Bearer '+shared).send({...enabled.body,reviewPrefix:'nha-review/users/owner/sandboxes/notebook/outputs/other/'})).status).toBe(403);
});
