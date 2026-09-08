import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { Job, OutputError, OutputService, segment } from './service';
const claims=z.object({outputId:segment,ownerId:segment,notebookName:segment,scope:z.literal('output:upload'),exp:z.number(),iat:z.number()});
export function outputRouter(service:OutputService,uploadKey:string,publishToken:string){
  if(uploadKey.length<32||publishToken.length<32||uploadKey===publishToken)throw new Error('Separate output credentials of at least 32 characters are required');
  const router=Router();
  for(const operation of ['uploads','complete','publish'] as const){
    router.post(`/:outputId/${operation}`,async(req,res)=>{
      try {
        const id=segment.parse(req.params.outputId);
        const auth=req.headers.authorization;
        if(!auth?.startsWith('Bearer '))throw new OutputError(401,'authentication_required');
        const token=auth.slice(7);let job:Job|undefined;
        if(operation==='publish'){
          const a=Buffer.from(token),b=Buffer.from(publishToken);
          if(a.length!==b.length||!timingSafeEqual(a,b))throw new OutputError(403,'publication_forbidden');
        }else{
          try {
            const c=claims.parse(jwt.verify(token,uploadKey,{algorithms:['HS256'],audience:'files-connect-output',issuer:'sandbox-connect',maxAge:'1h'}));
            if(c.outputId!==id)throw new Error('scope');
            job={outputId:c.outputId,ownerId:c.ownerId,notebookName:c.notebookName};
          }catch{throw new OutputError(403,'upload_forbidden');}
        }
        const data=operation==='publish'?await service.publish(id,req.body):operation==='uploads'?await service.uploads(job!,req.body):await service.complete(job!,req.body);
        res.json({success:true,data});
      }catch(e){
        const status=e instanceof OutputError?e.status:e instanceof z.ZodError?400:503;
        const code=e instanceof OutputError?e.code:e instanceof z.ZodError?'invalid_request':'output_storage_unavailable';
        res.status(status).json({error:{code,message:code}});
      }
    });
  }
  return router;
}
