/**
 * Audit Middleware
 * Intercepts responses for specific APIs to publish audit messages
 */
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../core/utils/logger';
import { AuditServiceInterface, AuditContext, AuditLogType } from '../services/audit-service';

// Create a logger for this module
const logger = createLogger('AuditMiddleware');

// Define which endpoints should be audited
// These match the router-relative paths, not the full URL paths
// Values now represent the 'action' field in the new audit schema
const AUDITED_ENDPOINTS = {
  // Upload complete - matches /:databankId/uploads/:uploadId on databanks router
  'PUT_/:databankId/uploads/:uploadId': 'Upload',
  // Download files - matches /:databankId/files/download on databanks router  
  'POST_/:databankId/files/download': 'Download',
  // Download ZIP - matches /:databankId/download on databanks router
  'GET_/:databankId/download': 'Download',
  // Delete files - matches /:databankId/files/delete on databanks router
  'POST_/:databankId/files/delete': 'File Delete'
} as const;

type AuditAction = typeof AUDITED_ENDPOINTS[keyof typeof AUDITED_ENDPOINTS];

export function createAuditMiddleware(auditService: AuditServiceInterface) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original send method
    const originalSend = res.send;
    
    // Override the send method to intercept response
    res.send = function(body: any) {
      // Check if this endpoint should be audited
      const action = getAuditAction(req);
      
      logger.debug('Audit middleware intercepted response', {
        method: req.method,
        originalUrl: req.originalUrl || '',
        path: req.path || '',
        statusCode: res.statusCode,
        action,
        shouldAudit: shouldAudit(res.statusCode)
      });
      
      if (action && shouldAudit(res.statusCode)) {
        // Extract audit context from request and response
        const auditContext = extractAuditContext(req, res, action);
        
        if (auditContext) {
          logger.info('Publishing audit message', { action, databankId: auditContext.databankId });
          // Publish audit message asynchronously (don't block response)
          setImmediate(async () => {
            try {
              await auditService.publishAuditMessage(auditContext);
            } catch (error) {
              logger.error('Failed to publish audit message', error as Error);
            }
          });
        }
      }
      
      // Call original send method
      return originalSend.call(this, body);
    };
    
    next();
  };
}

function getAuditAction(req: Request): AuditAction | null {
  // Create endpoint key from method and path pattern
  const method = req.method;
  // Use req.route.path for router-relative path, fallback to req.path
  const routePath = req.route?.path || req.path || '';
  const fullPath = req.originalUrl || req.url || '';
  
  logger.debug('Checking audit action for path', { 
    method, 
    routePath, 
    fullPath,
    baseUrl: req.baseUrl || '',
    params: req.params
  });
  
  // Match against audited endpoints using router-relative path
  for (const [pattern, action] of Object.entries(AUDITED_ENDPOINTS)) {
    const [patternMethod, patternPath] = pattern.split('_');
    
    if (method === patternMethod && patternPath) {
      // Simple pattern matching - could be enhanced with more sophisticated matching
      if (matchPath(routePath, patternPath)) {
        logger.debug('Audit action matched', { 
          method, 
          routePath, 
          fullPath, 
          pattern, 
          action 
        });
        return action;
      }
    }
  }
  
  logger.debug('No audit action matched', { method, routePath, fullPath });
  return null;
}

function matchPath(actualPath: string, pattern: string): boolean {
  // Remove query parameters from actual path
  const cleanPath = actualPath.split('?')[0];
  
  // Convert pattern to regex (simple implementation)
  const regexPattern = pattern
    .replace(/:[^/]+/g, '[^/\\?]+') // Replace :param with regex (excluding query params)
    .replace(/\//g, '\\/') // Escape forward slashes
    .replace(/\./g, '\\.'); // Escape dots
  
  const regex = new RegExp(`^${regexPattern}(\\?.*)?$`);
  const matches = regex.test(cleanPath || '');
  
  logger.debug('Path matching result', { 
    actualPath: cleanPath, 
    pattern, 
    regexPattern, 
    matches 
  });
  
  return matches;
}

function shouldAudit(statusCode: number): boolean {
  // Only audit successful responses (2xx status codes)
  return statusCode >= 200 && statusCode < 300;
}

/**
 * Extract client IP address from request
 * Handles proxied requests with X-Forwarded-For header
 */
function extractClientIp(req: Request): string | undefined {
  // Check X-Forwarded-For header (common with proxies/load balancers)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can be comma-separated list; take the first (original client)
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const clientIp = ips?.split(',')[0]?.trim();
    if (clientIp) return clientIp;
  }
  
  // Check X-Real-IP header (used by some proxies)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  
  // Fall back to socket remote address
  return req.socket?.remoteAddress || req.ip;
}

function extractAuditContext(req: Request, res: Response, action: AuditAction): AuditContext | null {
  try {
    const databankId = req.params.databankId;
    // Access user info from res.locals which is set by auth middleware
    const userId = res.locals.userId;
    const userRole = res.locals.userRole;
    // Extract organization info from res.locals if available
    const orgId = res.locals.orgId;
    const orgName = res.locals.orgName;
    // Extract authorization token from request headers
    const authToken = req.headers.authorization;
    
    // Extract technical metadata for new schema
    const ipAddress = extractClientIp(req);
    const userAgent = req.headers['user-agent'];
    
    logger.debug('Extracting audit context', { 
      databankId, 
      userId, 
      userRole, 
      orgId,
      orgName,
      action,
      originalUrl: req.originalUrl || '',
      path: req.path || '',
      hasAuthToken: !!authToken,
      ipAddress,
      hasUserAgent: !!userAgent
    });
    
    if (!databankId || !userId || !userRole) {
      logger.warn('Missing required audit context', { databankId, userId, userRole });
      return null;
    }
    
    const api = req.originalUrl || req.url || '';
    
    logger.info('Creating audit context', {
      databankId,
      api,
      method: req.method,
      userId,
      role: userRole,
      action,
      orgId,
      orgName,
      ipAddress
    });
    
    return {
      databankId,
      api,
      method: req.method,
      userId,
      role: userRole,
      action,
      authToken,
      orgId,
      orgName,
      // New fields for updated schema
      ipAddress,
      userAgent,
      // Log type defaults to ASSET for file operations
      logType: 'ASSET',
    };
  } catch (error) {
    logger.error('Failed to extract audit context', error as Error);
    return null;
  }
} 