import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { Job, OutputError, OutputService, segment } from './service';
const claims=z.object({outputId:segment,ownerId:segment,notebookName:segment,scope:z.literal('output:upload'),exp:z.number(),iat:z.number()});
function sameToken(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export function outputRouter(service:OutputService,uploadKey:string,publishToken:string,sandboxToken:string,sharedUploadToken?:string,allowSharedUpload=false){
  const required=[uploadKey,publishToken,sandboxToken];
  if(required.some(value=>value.length<32)||new Set(required).size!==required.length)throw new Error('Separate output credentials of at least 32 characters are required');
  if(allowSharedUpload&&(!sharedUploadToken||sharedUploadToken.length<32||required.includes(sharedUploadToken)))throw new Error('A separate shared upload credential of at least 32 characters is required');
  const router=Router();
  const bearer=(req:any)=>{const auth=req.headers.authorization;if(!auth?.startsWith('Bearer '))throw new OutputError(401,'authentication_required');return auth.slice(7);};
  const fail=(res:any,e:unknown)=>{const status=e instanceof OutputError?e.status:e instanceof z.ZodError?400:503;const code=e instanceof OutputError?e.code:e instanceof z.ZodError?'invalid_request':'output_storage_unavailable';res.status(status).json({error:{code,message:code}});};
  for(const operation of ['uploads','complete','publish'] as const){
    router.post(`/:outputId/${operation}`,async(req,res)=>{
      try {
        const id=segment.parse(req.params.outputId);
        const token=bearer(req);let job:Job|undefined;
        if(operation==='publish'){
          if(!sameToken(token,publishToken))throw new OutputError(403,'publication_forbidden');
        }else{
          try {
            const c=claims.parse(jwt.verify(token,uploadKey,{algorithms:['HS256'],audience:'files-connect-output',issuer:'sandbox-connect',maxAge:'1h'}));
            if(c.outputId!==id)throw new Error('scope');
            job={outputId:c.outputId,ownerId:c.ownerId,notebookName:c.notebookName};
          }catch{
            if(!allowSharedUpload||!sharedUploadToken||!sameToken(token,sharedUploadToken))throw new OutputError(403,'upload_forbidden');
            job=service.jobFromReviewPrefix(id,req.body?.reviewPrefix);
          }
        }
        const data=operation==='publish'?await service.publish(id,req.body):operation==='uploads'?await service.uploads(job!,req.body):await service.complete(job!,req.body);
        res.json({success:true,data});
      }catch(e){fail(res,e);}
    });
  }
  router.get('/internal/review/:outputId/files/:fileId/preview',async(req,res)=>{try{if(!sameToken(bearer(req),sandboxToken))throw new OutputError(403,'sandbox_forbidden');res.json({success:true,data:await service.previewReview(req.params.outputId,req.params.fileId)});}catch(e){fail(res,e);}});
  router.get('/internal/workspaces/:ownerId/files',async(req,res)=>{try{if(!sameToken(bearer(req),sandboxToken))throw new OutputError(403,'sandbox_forbidden');res.json({success:true,data:{files:await service.listWorkspace(req.params.ownerId)}});}catch(e){fail(res,e);}});
  router.get('/internal/workspaces/:ownerId/files/:fileId/preview',async(req,res)=>{try{if(!sameToken(bearer(req),sandboxToken))throw new OutputError(403,'sandbox_forbidden');res.json({success:true,data:await service.previewWorkspace(req.params.ownerId,req.params.fileId)});}catch(e){fail(res,e);}});
  router.get('/internal/workspaces/:ownerId/files/:fileId/download',async(req,res)=>{try{if(!sameToken(bearer(req),sandboxToken))throw new OutputError(403,'sandbox_forbidden');res.json({success:true,data:await service.downloadWorkspace(req.params.ownerId,req.params.fileId)});}catch(e){fail(res,e);}});
  return router;
}
