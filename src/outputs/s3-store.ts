import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Blob, File, OutputError, Store } from './service';
export class S3OutputStore implements Store {
  constructor(private client:S3Client,private bucket:string){}
  async read(key:string,limit:number):Promise<Blob|null>{
    try {
      const result=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}));
      const body=result.Body;
      if(!body) throw new OutputError(502,'empty_storage_response');
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of body as AsyncIterable<Uint8Array>) {
        size+=chunk.length;
        if(size>limit) { (body as any).destroy?.();throw new OutputError(413,'object_limit'); }
        chunks.push(Buffer.from(chunk));
      }
      return {bytes:Buffer.concat(chunks),etag:result.ETag||'',contentType:result.ContentType||''};
    } catch(e:any){if(e.$metadata?.httpStatusCode===404)return null;throw e;}
  }
  async create(key:string,bytes:Buffer){
    try { await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:bytes,ContentType:'application/json',IfNoneMatch:'*'}));return true; }
    catch(e:any){if(e.$metadata?.httpStatusCode===412)return false;throw e;}
  }
  async presign(key:string,file:File){
    const checksum=Buffer.from(file.sha256,'hex').toString('base64');
    const url=await getSignedUrl(this.client,new PutObjectCommand({Bucket:this.bucket,Key:key,ContentType:'text/csv',ContentLength:file.size,ChecksumSHA256:checksum}),{expiresIn:300,unhoistableHeaders:new Set(['x-amz-checksum-sha256'])});
    if(!url.startsWith('https://'))throw new OutputError(503,'https_storage_required');
    return {url,headers:{'Content-Type':'text/csv','x-amz-checksum-sha256':checksum}};
  }
  async copy(source:string,destination:string,etag:string){
    await this.client.send(new CopyObjectCommand({Bucket:this.bucket,Key:destination,CopySource:`${this.bucket}/${source.split('/').map(encodeURIComponent).join('/')}`,CopySourceIfMatch:etag}));
  }
}
