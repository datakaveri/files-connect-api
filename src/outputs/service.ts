import { createHash } from 'crypto';
import { z } from 'zod';
import Papa from 'papaparse';

export class OutputError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const segment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
export const fileSchema = z.object({
  fileId: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().min(5).max(255).refine(v => !/[\/\\\x00-\x1f\x7f]/.test(v) && /\.csv$/i.test(v)),
  objectKey: z.string().max(2048), size: z.number().int().positive().safe(),
  mediaType: z.literal('text/csv'), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type File = z.infer<typeof fileSchema>;
export interface Manifest { files: File[] }
export interface Job { outputId: string; ownerId: string; notebookName: string }
export interface Limits { maxManifestBytes: number; maxFiles: number; maxFileBytes: number; maxBytes: number }
export interface Config extends Limits { reviewBase: string; workspaceBase: string; reviewDatabankId: string; workspaceDatabankId: string }
export interface Blob { bytes: Buffer; contentType: string; etag: string }
export interface StoredFile { key: string; size: number; lastModified: Date }
export interface AccessFile { fileId: string; name: string; size: number; lastModified: Date; contentType: string }
export interface Preview { content: { data: Record<string, unknown>[]; headers: string[]; totalRows: number; previewSupported: true }; format: 'csv'; truncated: boolean; firstNLines: number; totalLines: number }
export interface Download { url: string; expiresAt: Date }
export interface Store {
  read(key: string, limit: number): Promise<Blob | null>;
  create(key: string, bytes: Buffer): Promise<boolean>;
  presign(key: string, file: File): Promise<{url: string; headers: Record<string,string>}>;
  copy(source: string, destination: string, etag: string): Promise<void>;
  list(prefix: string, limit: number): Promise<StoredFile[]>;
  download(key: string): Promise<Download>;
}
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export class OutputService {
  constructor(public config: Config, private store: Store) {}
  review(job: Job) { return `${this.config.reviewBase}/users/${job.ownerId}/sandboxes/${job.notebookName}/outputs/${job.outputId}/`; }
  workspace(job: Job) { return `${this.config.workspaceBase}/users/${job.ownerId}/outputs/${job.outputId}/`; }
  private key(id: string) { return `${this.config.reviewBase}/.jobs/${segment.parse(id)}.json`; }
  private physical(databank: string, key: string) { return `${databank}/${key}`; }
  validate(job: Job, body: unknown): Manifest {
    const input = z.object({reviewPrefix:z.string(),files:z.array(fileSchema).min(1).max(this.config.maxFiles)}).strict().parse(body);
    if (input.reviewPrefix !== this.review(job)) throw new OutputError(403,'review_prefix_mismatch');
    let total=0; const ids=new Set<string>(); const paths=new Set<string>();
    for (const f of input.files) {
      if (f.objectKey !== this.review(job)+'output/'+f.path || f.fileId !== hash(f.objectKey)) throw new OutputError(400,'invalid_file_identity');
      if (ids.has(f.fileId)||paths.has(f.path)) throw new OutputError(400,'duplicate_file');
      ids.add(f.fileId); paths.add(f.path); total+=f.size;
      if (f.size>this.config.maxFileBytes || total>this.config.maxBytes) throw new OutputError(413,'output_limit');
    }
    const manifest={files:input.files.sort((a,b)=>a.path.localeCompare(b.path,'en'))};
    if (Buffer.byteLength(JSON.stringify(manifest))>this.config.maxManifestBytes) throw new OutputError(413,'manifest_limit');
    return manifest;
  }
  private async job(id: string): Promise<{job:Job;manifest:Manifest}> {
    const blob=await this.store.read(this.key(id),this.config.maxManifestBytes+4096);
    if (!blob) throw new OutputError(404,'output_not_registered');
    return JSON.parse(blob.bytes.toString());
  }
  jobFromReviewPrefix(id: string, rawPrefix: unknown): Job {
    const outputId=segment.parse(id),prefix=z.string().parse(rawPrefix);
    const base=this.config.reviewBase+'/users/';
    if(!prefix.startsWith(base)||!prefix.endsWith('/'))throw new OutputError(403,'review_prefix_mismatch');
    const parts=prefix.slice(base.length,-1).split('/');
    if(parts.length!==5||parts[1]!=='sandboxes'||parts[3]!=='outputs'||parts[4]!==outputId)throw new OutputError(403,'review_prefix_mismatch');
    return {outputId,ownerId:segment.parse(parts[0]),notebookName:segment.parse(parts[2])};
  }
  private same(a: unknown,b: unknown) { if(JSON.stringify(a)!==JSON.stringify(b)) throw new OutputError(409,'inventory_conflict'); }
  async uploads(job: Job, body: unknown) {
    const manifest=this.validate(job,body);
    const record={job,manifest};
    if (!await this.store.create(this.key(job.outputId),Buffer.from(JSON.stringify(record)))) this.same(await this.job(job.outputId),record);
    const uploads=[];
    for(const f of manifest.files) uploads.push({fileId:f.fileId,...await this.store.presign(this.physical(this.config.reviewDatabankId,f.objectKey),f)});
    return {uploads};
  }
  private async verify(key: string, f: File): Promise<Blob> {
    const blob=await this.store.read(key,f.size);
    if (!blob || blob.bytes.length!==f.size || blob.contentType!=='text/csv' || hash(blob.bytes)!==f.sha256) throw new OutputError(409,'object_verification_failed');
    let text: string;
    try { text=new TextDecoder('utf-8',{fatal:true}).decode(blob.bytes); } catch { throw new OutputError(422,'invalid_csv'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new OutputError(422,'invalid_csv');
    const csv=Papa.parse(text,{skipEmptyLines:true,delimiter:','});
    const cols=csv.data[0]?.length;
    if(csv.errors.length || !cols || csv.data.some(row=>row.length!==cols)) throw new OutputError(422,'invalid_csv');
    return blob;
  }
  private async marker(key: string, manifest: Manifest) {
    const raw=Buffer.from(JSON.stringify(manifest));
    if(!await this.store.create(key,raw)) {
      const old=await this.store.read(key,this.config.maxManifestBytes);
      if(!old || !old.bytes.equals(raw)) throw new OutputError(409,'manifest_conflict');
    }
  }
  async complete(job: Job, body: unknown) {
    const manifest=this.validate(job,body);this.same(await this.job(job.outputId),{job,manifest});
    for(const f of manifest.files) await this.verify(this.physical(this.config.reviewDatabankId,f.objectKey),f);
    const reviewManifestKey=this.review(job)+'manifest.json';
    await this.marker(this.physical(this.config.reviewDatabankId,reviewManifestKey),manifest);
    return {reviewManifestKey,manifest};
  }
  async publish(id: string, body: unknown) {
    const input=z.object({outputId:z.string(),ownerId:z.string(),reviewDatabankId:z.string(),workspaceDatabankId:z.string(),reviewPrefix:z.string(),reviewManifestKey:z.string(),workspacePrefix:z.string(),files:z.array(fileSchema)}).strict().parse(body);
    const {job,manifest}=await this.job(id);
    if(input.outputId!==id||input.ownerId!==job.ownerId||input.reviewDatabankId!==this.config.reviewDatabankId||input.workspaceDatabankId!==this.config.workspaceDatabankId||input.workspacePrefix!==this.workspace(job)||input.reviewManifestKey!==this.review(job)+'manifest.json') throw new OutputError(403,'publication_scope_mismatch');
    this.same(this.validate(job,{reviewPrefix:input.reviewPrefix,files:input.files}),manifest);
    const review=await this.store.read(this.physical(this.config.reviewDatabankId,input.reviewManifestKey),this.config.maxManifestBytes);
    if(!review) throw new OutputError(409,'output_not_complete');this.same(JSON.parse(review.bytes.toString()),manifest);
    const workspacePrefix=this.workspace(job);
    const destination:Manifest={files:[]};
    for(const f of manifest.files) {
      const source=this.physical(this.config.reviewDatabankId,f.objectKey);
      const blob=await this.verify(source,f);
      const objectKey=workspacePrefix+f.path;
      await this.store.copy(source,this.physical(this.config.workspaceDatabankId,objectKey),blob.etag);
      await this.verify(this.physical(this.config.workspaceDatabankId,objectKey),f);
      destination.files.push({...f,objectKey,fileId:hash(objectKey)});
    }
    const workspaceManifestKey=workspacePrefix+'manifest.json';
    await this.marker(this.physical(this.config.workspaceDatabankId,workspaceManifestKey),destination);
    return {workspacePrefix,workspaceManifestKey,approvedFileIds:manifest.files.map(f=>f.fileId)};
  }
  private async completed(id:string){
    const record=await this.job(id),manifestKey=this.physical(this.config.reviewDatabankId,this.review(record.job)+'manifest.json');
    const marker=await this.store.read(manifestKey,this.config.maxManifestBytes);
    if(!marker)throw new OutputError(409,'output_not_complete');
    try{this.same(JSON.parse(marker.bytes.toString()),record.manifest);}catch(e){if(e instanceof OutputError)throw e;throw new OutputError(409,'manifest_invalid');}
    return record;
  }
  private previewBlob(blob:Blob):Preview{
    let text:string;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(blob.bytes);}catch{throw new OutputError(422,'invalid_csv');}
    const parsed=Papa.parse(text,{header:true,skipEmptyLines:true});
    if(parsed.errors.length)throw new OutputError(422,'invalid_csv');
    const rows=parsed.data,first=rows.slice(0,10);
    return {content:{data:first,headers:parsed.meta.fields||[],totalRows:rows.length,previewSupported:true},format:'csv',truncated:rows.length>first.length,firstNLines:first.length,totalLines:rows.length};
  }
  async previewReview(id:string,fileId:string){
    const record=await this.completed(segment.parse(id)),wanted=z.string().regex(/^[a-f0-9]{64}$/).parse(fileId);
    const file=record.manifest.files.find(item=>item.fileId===wanted);
    if(!file)throw new OutputError(404,'file_not_found');
    return this.previewBlob(await this.verify(this.physical(this.config.reviewDatabankId,file.objectKey),file));
  }
  private async workspaceFiles(ownerId:string):Promise<Array<AccessFile&{key:string,file:File}>>{
    const owner=segment.parse(ownerId),logicalRoot=this.config.workspaceBase+'/users/'+owner+'/outputs/',physicalRoot=this.physical(this.config.workspaceDatabankId,logicalRoot);
    const objects=await this.store.list(physicalRoot,Math.min(1000,this.config.maxFiles*2));
    const byKey=new Map(objects.map(item=>[item.key,item]));
    const result:Array<AccessFile&{key:string,file:File}>=[];
    for(const markerMeta of objects.filter(item=>item.key.endsWith('/manifest.json'))){
      if(!markerMeta.key.startsWith(physicalRoot))continue;
      const logicalMarker=markerMeta.key.slice(this.config.workspaceDatabankId.length+1),relative=logicalMarker.slice(logicalRoot.length);
      const parts=relative.split('/');
      if(parts.length!==2||parts[1]!=='manifest.json')continue;
      segment.parse(parts[0]);
      const outputPrefix=logicalRoot+parts[0]+'/',blob=await this.store.read(markerMeta.key,this.config.maxManifestBytes);
      if(!blob)continue;
      let manifest:Manifest;
      try{manifest=z.object({files:z.array(fileSchema).max(this.config.maxFiles)}).strict().parse(JSON.parse(blob.bytes.toString()));}catch{throw new OutputError(409,'manifest_invalid');}
      for(const file of manifest.files){
        if(file.objectKey!==outputPrefix+file.path||file.fileId!==hash(file.objectKey))throw new OutputError(409,'manifest_invalid');
        const physical=this.physical(this.config.workspaceDatabankId,file.objectKey),meta=byKey.get(physical);
        if(!meta||meta.size!==file.size)throw new OutputError(409,'published_object_invalid');
        result.push({fileId:file.fileId,name:parts[0]+'/'+file.path,size:file.size,lastModified:meta.lastModified,contentType:'text/csv',key:physical,file});
        if(result.length>this.config.maxFiles)throw new OutputError(413,'file_limit');
      }
    }
    return result.sort((a,b)=>a.name.localeCompare(b.name,'en'));
  }
  async listWorkspace(ownerId:string):Promise<AccessFile[]>{
    return (await this.workspaceFiles(ownerId)).map(({key:_,file:__,...item})=>item);
  }
  private async workspaceFile(ownerId:string,fileId:string){
    const wanted=z.string().regex(/^[a-f0-9]{64}$/).parse(fileId),file=(await this.workspaceFiles(ownerId)).find(item=>item.fileId===wanted);
    if(!file)throw new OutputError(404,'file_not_found');
    return file;
  }
  async previewWorkspace(ownerId:string,fileId:string){
    const item=await this.workspaceFile(ownerId,fileId);
    return this.previewBlob(await this.verify(item.key,item.file));
  }
  async downloadWorkspace(ownerId:string,fileId:string){
    const item=await this.workspaceFile(ownerId,fileId);
    await this.verify(item.key,item.file);
    return this.store.download(item.key);
  }
}
