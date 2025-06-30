/**
 * Audit Middleware
 * Intercepts responses for specific APIs to publish audit messages
 */
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../core/utils/logger';
import { AuditServiceInterface, AuditContext } from '../services/audit-service';

// Create a logger for this module
const logger = createLogger('AuditMiddleware');

// Define which endpoints should be audited
// These match the router-relative paths, not the full URL paths
const AUDITED_ENDPOINTS = {
  // Upload complete - matches /:databankId/uploads/:uploadId on databanks router
  'PUT_/:databankId/uploads/:uploadId': 'Upload',
  // Download files - matches /:databankId/files/download on databanks router  
  'POST_/:databankId/files/download': 'Download',
  // Download ZIP - matches /:databankId/download on databanks router
  'GET_/:databankId/download': 'Download',
  // Delete files - matches /:databankId/files/delete on databanks router
  'POST_/:databankId/files/delete': 'Delete'
} as const;

type AuditOperation = typeof AUDITED_ENDPOINTS[keyof typeof AUDITED_ENDPOINTS];

export function createAuditMiddleware(auditService: AuditServiceInterface) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original send method
    const originalSend = res.send;
    
    // Override the send method to intercept response
    res.send = function(body: any) {
      // Check if this endpoint should be audited
      const operation = getAuditOperation(req);
      
      logger.debug('Audit middleware intercepted response', {
        method: req.method,
        originalUrl: req.originalUrl || '',
        path: req.path || '',
        statusCode: res.statusCode,
        operation,
        shouldAudit: shouldAudit(res.statusCode)
      });
      
      if (operation && shouldAudit(res.statusCode)) {
        // Extract audit context from request and response
        const auditContext = extractAuditContext(req, res, operation);
        
        if (auditContext) {
          logger.info('Publishing audit message', { operation, databankId: auditContext.databankId });
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

function getAuditOperation(req: Request): AuditOperation | null {
  // Create endpoint key from method and path pattern
  const method = req.method;
  // Use req.route.path for router-relative path, fallback to req.path
  const routePath = req.route?.path || req.path || '';
  const fullPath = req.originalUrl || req.url || '';
  
  logger.debug('Checking audit operation for path', { 
    method, 
    routePath, 
    fullPath,
    baseUrl: req.baseUrl || '',
    params: req.params
  });
  
  // Match against audited endpoints using router-relative path
  for (const [pattern, operation] of Object.entries(AUDITED_ENDPOINTS)) {
    const [patternMethod, patternPath] = pattern.split('_');
    
    if (method === patternMethod && patternPath) {
      // Simple pattern matching - could be enhanced with more sophisticated matching
      if (matchPath(routePath, patternPath)) {
        logger.debug('Audit operation matched', { 
          method, 
          routePath, 
          fullPath, 
          pattern, 
          operation 
        });
        return operation;
      }
    }
  }
  
  logger.debug('No audit operation matched', { method, routePath, fullPath });
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

function extractAuditContext(req: Request, res: Response, operation: AuditOperation): AuditContext | null {
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
    
    logger.debug('Extracting audit context', { 
      databankId, 
      userId, 
      userRole, 
      orgId,
      orgName,
      operation,
      originalUrl: req.originalUrl || '',
      path: req.path || '',
      hasAuthToken: !!authToken
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
      operation,
      orgId,
      orgName
    });
    
    return {
      databankId,
      api,
      method: req.method,
      userId,
      role: userRole,
      operation,
      authToken,
      orgId,
      orgName
    };
  } catch (error) {
    logger.error('Failed to extract audit context', error as Error);
    return null;
  }
} 