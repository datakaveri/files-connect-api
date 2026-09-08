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
export interface Store {
  read(key: string, limit: number): Promise<Blob | null>;
  create(key: string, bytes: Buffer): Promise<boolean>;
  presign(key: string, file: File): Promise<{url: string; headers: Record<string,string>}>;
  copy(source: string, destination: string, etag: string): Promise<void>;
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
}
