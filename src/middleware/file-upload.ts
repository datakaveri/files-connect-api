/**
 * File Upload Middleware
 * Handles file uploads using multer
 */
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('FileUploadMiddleware');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  },
});

/**
 * Middleware that only applies multer to specific routes
 * This prevents multer from interfering with other routes
 */
export const fileUpload = (req: Request, res: Response, next: NextFunction) => {
  // Only apply multer to the asset upload route
  // The path is '/' because the router has already matched the '/assets' prefix
  if (req.path === '/' && req.method === 'POST') {
    logger.debug('Applying multer to file upload route', { 
      path: req.path, 
      originalUrl: req.originalUrl,
      contentType: req.headers['content-type'] 
    });
    
    // Apply multer middleware
    return upload.single('file')(req, res, (err) => {
      if (err) {
        // Handle multer errors
        logger.error(`Multer error during file upload: ${err.message}`);
        
        // Format the error response
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'File size exceeds the 10MB limit'
            }
          });
        }
        
        // Generic multer error
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_UPLOAD_ERROR',
            message: err.message
          }
        });
      }
      
      // Continue to the next middleware if no error
      next();
    });
  }
  
  // Skip multer for all other routes
  logger.debug('Skipping multer for non-upload route', { 
    path: req.path, 
    originalUrl: req.originalUrl,
    method: req.method 
  });
  return next();
};
