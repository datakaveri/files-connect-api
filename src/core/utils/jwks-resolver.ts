import axios from 'axios';
import crypto from 'crypto';
import { createLogger } from './logger';

const logger = createLogger('JwksResolver');

export interface JwksConfig {
  type?: string;
  jwksUrl: string;
}

export class JwksResolver {
  private cache: Record<string, string> = {};
  
  public async resolve(issuer: string, kid: string, config: Record<string, JwksConfig>): Promise<string> {
    const cacheKey = `${issuer}#${kid}`;
    
    if (this.cache[cacheKey]) {
      return this.cache[cacheKey];
    }
    
    const cfg = config[issuer];
    if (!cfg) {
      throw new Error(`Unknown issuer: ${issuer}`);
    }
    
    const jwksUrl = cfg.jwksUrl;
    
    try {
      logger.debug(`Fetching JWKS from ${jwksUrl} for issuer ${issuer}`);
      const response = await axios.get(jwksUrl);
      const jwks = response.data;
      
      const keys = jwks.keys || [];
      const keyInfo = keys.find((k: any) => k.kid === kid);
      
      if (!keyInfo) {
        throw new Error(`No JWK found for kid: ${kid}`);
      }
      
      // Convert JWK to PEM for jsonwebtoken
      const publicKey = crypto.createPublicKey({ key: keyInfo, format: 'jwk' });
      const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      
      this.cache[cacheKey] = pem;
      return pem;
    } catch (error) {
      logger.error(`Error resolving JWK for issuer ${issuer} and kid ${kid}: ${(error as Error).message}`, error as Error);
      throw new Error(`Unable to resolve JWK for issuer ${issuer}`);
    }
  }
}

export const jwksResolver = new JwksResolver();
