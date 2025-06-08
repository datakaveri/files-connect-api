/**
 * File Service
 * Handles file operations like preview and processing
 */
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
// Use any type for papaparse to avoid type errors
import * as Papa from 'papaparse';
import { XMLParser } from 'fast-xml-parser';

// Define types for file preview results
export interface FilePreviewDataSuccess {
  previewSupported: true;
  data: Record<string, any>[];
  headers: string[];
  totalRows: number;
  sheets?: string[]; // Optional: for XLSX
}

export interface FilePreviewNotSupported {
  previewSupported: false;
  message: string;
}

export type FilePreviewResult = FilePreviewDataSuccess | FilePreviewNotSupported;

// Existing type definitions (assuming they are here or imported elsewhere)
// For example, if CSVPreviewResult, XLSXPreviewResult, ParquetPreviewResult were defined here:
// export interface CSVPreviewResult { data: Record<string, any>[]; headers: string[]; totalRows: number; }
// export interface XLSXPreviewResult { data: Record<string, any>[]; headers: string[]; sheets: string[]; totalRows: number; }
// export interface ParquetPreviewResult { data: Record<string, any>[]; headers: string[]; totalRows: number; }
import { readParquet } from 'parquet-wasm';
import { S3ServiceInterface } from './s3-service';
import { createLogger } from '../core/utils/logger';
import { FileTypes, S3Constants } from '../config/constants';
import { 
  FilePreviewOptions, 
  CSVPreviewResult, 
  XLSXPreviewResult,
  ParquetPreviewResult,
  SupportedFileType,
  FileType
} from '../core/types/file';
import { getFileExtension } from '../core/utils/helpers';

// Define types for papaparse
type PapaParseConfig = {
  header?: boolean;
  skipEmptyLines?: boolean;
  complete?: (results: any) => void;
  error?: (error: Error) => void;
};

type PapaParseResult = {
  data: any[];
  errors: any[];
  meta: {
    fields?: string[];
    [key: string]: any;
  };
};

/**
 * Type for preview result metadata
 */
export interface PreviewMetadata {
  /** File key */
  key: string;
  /** File type */
  fileType: FileType;
  /** Total rows or lines in the file */
  totalRows?: number;
  /** Total size in bytes */
  size?: number;
  /** Last modified date */
  lastModified?: Date;
  /** Additional metadata specific to file type */
  [key: string]: unknown;
}

/**
 * Type for preview result
 */
export interface PreviewResult {
  /** Preview data */
  data: CSVPreviewResult | XLSXPreviewResult | ParquetPreviewResult | Record<string, unknown> | string;
  /** File metadata */
  metadata: PreviewMetadata;
}

// Create a logger for this module
const logger = createLogger('FileService');

/**
 * Interface for file service
 * Defines methods for file operations
 */
export interface FileServiceInterface {
  /**
   * Previews a file from S3
   * @param key - The key of the file to preview
   * @param databankId - The databank ID for authorization
   * @param options - Preview options
   * @returns Promise resolving to the preview data
   */
  previewFile(
    key: string, 
    databankId: string, 
    options?: FilePreviewOptions
  ): Promise<CSVPreviewResult | XLSXPreviewResult | ParquetPreviewResult | Record<string, unknown> | string>;
  
  /**
   * Generates a preview of a file
   * @param options - Preview generation options
   * @returns Promise resolving to the preview result
   */
  generatePreview(options: {
    key: string;
    fileType: FileType;
    maxLines?: number;
    databankId: string;
  }): Promise<PreviewResult>;
  
  /**
   * Detects the file type from a key
   * @param key - The key to detect file type from
   * @returns The detected file type
   */
  detectFileType(key: string): SupportedFileType | null;
}

/**
 * File Service implementation
 * Handles file operations like preview and processing
 */
export class FileService implements FileServiceInterface {
  private s3Service: S3ServiceInterface;
  
  /**
   * Creates a new FileService instance
   * @param s3Service - The S3 service to use
   */
  constructor(s3Service: S3ServiceInterface) {
    this.s3Service = s3Service;
    logger.info('FileService initialized');
  }
  
  /**
   * Generates a preview of a file
   * @param options - Preview generation options
   * @returns Promise resolving to the preview result
   */
  async generatePreview(options: {
    key: string;
    fileType: string;
    maxLines?: number;
    databankId: string;
  }): Promise<PreviewResult> {
    const { key, fileType, maxLines = 100, databankId } = options;
    
    logger.debug('Generating file preview', { key, fileType, maxLines, databankId });
    
    const previewData = await this.previewFile(key, databankId, {
      fileType: fileType as SupportedFileType,
      maxLines
    });
    
    return {
      data: previewData,
      metadata: {
        key,
        fileType,
        totalRows: typeof previewData === 'object' && 'totalRows' in previewData ? (previewData as any).totalRows : undefined,
        lastModified: new Date(),
        maxLines
      }
    };
  }
  
  /**
   * Detects the file type from a key
   * @param key - The key to detect file type from
   * @returns The detected file type
   */
  detectFileType(key: string): SupportedFileType | null {
    const extension = getFileExtension(key).toLowerCase();
    
    switch (extension) {
      case 'csv':
        return FileTypes.CSV as SupportedFileType;
      case 'json':
        return FileTypes.JSON as SupportedFileType;
      case 'xml':
        return FileTypes.XML as SupportedFileType;
      case 'xlsx':
      case 'xls':
        return FileTypes.XLSX as SupportedFileType;
      case 'parquet':
        return FileTypes.PARQUET as SupportedFileType;
      default:
        return null;
    }
  }
  
  /**
   * Previews a file from S3
   * @param key - The key of the file to preview
   * @param databankId - The databank ID for authorization
   * @param options - Preview options
   * @returns Promise resolving to the preview data
   */
  async previewFile(
    key: string, 
    databankId: string, 
    options: FilePreviewOptions = {}
  ): Promise<CSVPreviewResult | XLSXPreviewResult | ParquetPreviewResult | Record<string, unknown> | string> {
    const fileType = options.fileType || this.detectFileType(key);
    const maxLines = options.maxLines || S3Constants.DEFAULT_PREVIEW_LINES;
    
    logger.debug('Previewing file', { key, databankId, fileType, maxLines });
    
    if (!fileType) {
      throw new Error('Unsupported file type');
    }
    
    try {
      // Log the normalized key that will be used
      logger.info(`Attempting to get partial object for preview with key: ${key}, databankId: ${databankId}`);
      
      try {
        // Estimate bytes needed based on file type and max lines
        // This is a rough estimate - adjust as needed based on your data characteristics
        let estimatedBytesPerLine = 500; // Default estimate
        
        if (String(fileType) === 'csv') {
          estimatedBytesPerLine = 100; // CSV tends to be smaller per line
        } else if (String(fileType) === 'xlsx') {
          // For XLSX, we need to get the whole file since it's binary
          estimatedBytesPerLine = 0; // Will use getObject instead of getPartialObject
        }
        
        // Calculate max bytes to retrieve
        // Add 50% buffer to ensure we get enough data for the requested lines
        const maxBytes = estimatedBytesPerLine > 0 ? 
          Math.min(estimatedBytesPerLine * maxLines * 1.5, S3Constants.MAX_PREVIEW_FILE_SIZE) : 
          0;
        
        // Get the file stream from S3 - use partial object for text-based formats
        let stream;
        if (maxBytes > 0 && String(fileType) !== 'xlsx') {
          logger.debug(`Getting partial object with maxBytes: ${maxBytes}`);
          stream = await this.s3Service.getPartialObject(key, databankId, maxBytes);
        } else {
          logger.debug('Getting full object for preview');
          stream = await this.s3Service.getObject(key, databankId);
        }
        
        // Process the file based on its type
        let result;
        
        switch (fileType) {
          case FileTypes.CSV as SupportedFileType:
            const csvResult = await this.processCSV(stream, maxLines);
            result = { ...csvResult, previewSupported: true };
            break;
          case FileTypes.XLSX as SupportedFileType:
            const xlsxResult = await this.processXLSX(stream, maxLines);
            result = { ...xlsxResult, previewSupported: true };
            break;
          case FileTypes.JSON as SupportedFileType:
            result = await this.processJSON(stream, maxLines);
            break;
          case FileTypes.XML as SupportedFileType:
            const xmlData = await this.processXML(stream);
            // For XML, we'll consider preview not supported in the structured format by default
            // Or, if a specific array-like structure is expected, that logic could be added here.
            logger.info('XML data processed, but structured preview is not supported by default.', xmlData);
            result = { previewSupported: false, message: 'Preview not supported for XML files in a structured table format.' };
            break;
          case FileTypes.PARQUET as SupportedFileType:
            const parquetResult = await this.processParquet(stream, maxLines);
            result = { ...parquetResult, previewSupported: true };
            break;
          default:
            throw new Error(`Unsupported file type: ${fileType}`);
        }
        
        logger.debug('File preview generated successfully', { 
          key, 
          databankId, 
          fileType 
        });
        
        return result;
      } catch (error) {
        // Check if it's a NoSuchKey or NotFound error from S3
        if (error instanceof Error && 
            (error.name === 'NoSuchKey' || 
             error.name === 'NotFound' || 
             error.message.includes('NoSuchKey') || 
             error.message.includes('Not Found'))) {
          logger.error(`File not found in S3: key=${key}, databankId=${databankId}`);
          throw new Error(`File not found: ${key}`);
        }
        throw error;
      }
    } catch (error) {
      // Log the error with context information as separate parameters
      logger.error(
        `Error previewing file: ${error instanceof Error ? error.message : String(error)}`, 
        error instanceof Error ? error : new Error(String(error)),
        { 
          context: {
            key, 
            databankId, 
            fileType
          },
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorStack: error instanceof Error ? error.stack : 'No stack trace'
        }
      );
      throw error;
    }
  }
  
  /**
   * Utility method to process a stream and return a buffer
   * @param stream - The stream to process
   * @returns Promise resolving to a buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    logger.debug('Converting stream to buffer');
    
    return new Promise((resolve, reject) => {
      // Check if we're dealing with a stream that has traditional Node.js methods
      const isNodeStream = typeof stream.on === 'function' && typeof stream.read === 'function';
      
      if (!isNodeStream) {
        // Handle as a buffer directly
        try {
          // @ts-ignore - We'll read the entire stream as a buffer
          const buffer = Buffer.from(stream);
          resolve(buffer);
        } catch (err) {
          reject(err);
        }
      } else {
        // Node.js stream handling
        const chunks: Buffer[] = [];
        
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            resolve(buffer);
          } catch (err) {
            reject(err);
          }
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
      }
    });
  }

  /**
   * Processes a CSV file stream
   * @param stream - The CSV file stream
   * @param maxLines - Maximum number of lines to return
   * @returns Promise resolving to the CSV preview result
   */
  private async processCSV(stream: Readable, maxLines: number): Promise<CSVPreviewResult> {
    logger.debug('Processing CSV file', { maxLines });
    
    try {
      const buffer = await this.streamToBuffer(stream);
      const content = buffer.toString('utf-8');
      
      // Parse CSV
      const result = Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
      });
      
      if (result.errors && result.errors.length > 0) {
        logger.warn('CSV parsing warnings', { errors: result.errors });
      }
      
      return {
        data: result.data.slice(0, maxLines) as Record<string, any>[],
        headers: result.meta.fields || [],
        totalRows: result.data.length,
      };
    } catch (err) {
      logger.error('Error processing CSV file', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
  
  /**
   * Processes an XLSX file stream
   * @param stream - The XLSX file stream
   * @param maxLines - Maximum number of lines to return
   * @returns Promise resolving to the XLSX preview result
   */
  private async processXLSX(stream: Readable, maxLines: number): Promise<XLSXPreviewResult> {
    logger.debug('Processing XLSX file', { maxLines });
    
    try {
      const buffer = await this.streamToBuffer(stream);
      return await new Promise((resolve, reject) => {
        this.processXLSXBuffer(buffer, maxLines, resolve, reject);
      });
    } catch (err) {
      logger.error('Error processing XLSX file', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
  
  /**
   * Processes an XLSX buffer
   * @param buffer - The XLSX buffer
   * @param maxLines - Maximum number of lines to return
   * @param resolve - Promise resolve function
   * @param reject - Promise reject function
   */
  private processXLSXBuffer(
    buffer: Buffer, 
    maxLines: number,
    resolve: (value: XLSXPreviewResult) => void,
    reject: (reason?: any) => void
  ): void {
    try {
      // Parse XLSX
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      
      // Get the first sheet
      const firstSheetName = workbook.SheetNames[0];
      
      if (!firstSheetName) {
        return reject(new Error('No sheets found in workbook'));
      }
      
      const worksheet = workbook.Sheets[firstSheetName];
      
      if (!worksheet) {
        return reject(new Error('Sheet not found'));
      }
      
      // Get the data as an array of arrays
      const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Extract headers (first row)
      const headers = sheetData.length > 0 ? sheetData[0] as string[] : [];
      
      // Extract data rows (skip header row)
      const dataRows = sheetData.slice(1).map((row: any) => {
        const rowData: Record<string, any> = {};
        
        // Map each cell to its corresponding header
        (row as any[]).forEach((cell, index) => {
          if (index < headers.length) {
            rowData[headers[index] as string] = cell;
          }
        });
        
        return rowData;
      });
      
      // Return the data
      resolve({
        data: dataRows.slice(0, maxLines),
        headers,
        sheets: workbook.SheetNames,
        totalRows: dataRows.length,
      });
    } catch (err) {
      reject(err);
    }
  }
  
  /**
   * Processes a JSON file stream
   * @param stream - The JSON file stream
   * @returns Promise resolving to the parsed JSON data
   */
  private async processJSON(stream: Readable, maxLines: number): Promise<FilePreviewResult> {
    logger.debug('Processing JSON file');
    
    try {
      const buffer = await this.streamToBuffer(stream);
      const jsonData = JSON.parse(buffer.toString('utf-8'));

      if (Array.isArray(jsonData) && jsonData.length > 0 && typeof jsonData[0] === 'object' && jsonData[0] !== null) {
        const firstItem = jsonData[0] as Record<string, any>;
        const headers = Object.keys(firstItem);
        const data = jsonData.slice(0, maxLines).map(item => {
          if (typeof item === 'object' && item !== null) {
            return item as Record<string, any>;
          }
          // Handle cases where some array items might not be objects, though ideally the array is homogeneous
          const placeholder: Record<string, any> = {};
          headers.forEach(h => placeholder[h] = null); // or some other placeholder value
          return placeholder; 
        });

        return {
          previewSupported: true,
          data,
          headers,
          totalRows: jsonData.length,
        };
      } else if (typeof jsonData === 'object' && jsonData !== null && !Array.isArray(jsonData)){
        // Handle single JSON object by wrapping it in an array
        const dataArray = [jsonData as Record<string, any>];
        const headers = Object.keys(jsonData);
        return {
            previewSupported: true,
            data: dataArray.slice(0, maxLines),
            headers,
            totalRows: 1
        };
      } else {
        logger.warn('JSON data is not an array of objects or a single object, preview not supported as structured data.');
        return {
          previewSupported: false,
          message: 'Preview is supported for an array of JSON objects or a single JSON object. The provided JSON structure is not supported for tabular preview.',
        };
      }
    } catch (err) {
      logger.error('Error processing JSON file', err instanceof Error ? err : new Error(String(err)));
      // For parsing errors, also return preview not supported
      return {
        previewSupported: false,
        message: `Error parsing JSON file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  
  /**
   * Processes an XML file stream
   * @param stream - The XML file stream
   * @returns Promise resolving to the parsed XML data
   */
  private async processXML(stream: Readable): Promise<Record<string, unknown>> {
    logger.debug('Processing XML file');
    
    try {
      const buffer = await this.streamToBuffer(stream);
      const parser = new XMLParser();
      const xmlData = parser.parse(buffer.toString('utf-8'));
      return xmlData;
    } catch (err) {
      logger.error('Error processing XML file', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
  
  /**
   * Processes a Parquet file stream
   * @param stream - The Parquet file stream
   * @param maxLines - Maximum number of rows to return
   * @returns Promise resolving to the Parquet preview result
   */
  private async processParquet(stream: Readable, maxLines: number): Promise<ParquetPreviewResult> {
    logger.debug('Processing Parquet file', { maxLines });
    
    try {
      const buffer = await this.streamToBuffer(stream);
      return await new Promise((resolve, reject) => {
        this.processParquetBuffer(buffer, maxLines, resolve, reject);
      });
    } catch (err) {
      logger.error('Error processing Parquet file', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
  
  /**
   * Process a Parquet file from a buffer
   * @param buffer - The buffer containing the Parquet file
   * @param maxLines - Maximum number of rows to return
   * @param resolve - Promise resolve function
   * @param reject - Promise reject function
   */
  private processParquetBuffer(
    buffer: Buffer, 
    maxLines: number, 
    resolve: (value: ParquetPreviewResult) => void, 
    reject: (reason?: any) => void
  ): void {
    try {
      logger.debug('Processing Parquet buffer');
      
      // Use parquet-wasm to read the parquet file
      const table = readParquet(buffer);
      
      // Create a schema representation
      const schema: Record<string, any> = {};
      
      // Get column names from the table
      const columnNames = table.columnNames();
      
      // Use column names as headers
      const headers = columnNames;
      
      // For each column, add schema information
      columnNames.forEach((name: string) => {
        schema[name] = {
          // Get basic type information if available
          type: 'unknown'
        };
      });
      
      // Convert Arrow Table to array of objects
      const data: Record<string, any>[] = [];
      
      // Get the number of rows
      const rowCount = table.numRows();
      
      // Process only up to maxLines rows
      const rowsToProcess = Math.min(rowCount, maxLines);
      
      // Extract data from the table
      for (let i = 0; i < rowsToProcess; i++) {
        const row: Record<string, any> = {};
        
        // For each column, get the value at the current row
        headers.forEach((header: string) => {
          try {
            // Get the value at the current row and column
            const value = table.getColumnByName(header)?.get(i);
            row[header] = value;
          } catch (e) {
            // If there's an error getting the value, set it to null
            row[header] = null;
          }
        });
        
        data.push(row);
      }
      
      // Return the preview result
      resolve({
        data,
        headers,
        schema,
        totalRows: rowCount,
      });
    } catch (err) {
      logger.error('Error processing Parquet file', err instanceof Error ? err : new Error(String(err)));
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * Creates a new FileService instance with the given S3 service
 * @param s3Service - The S3 service to use
 * @returns FileService instance
 */
export function createFileService(s3Service: S3ServiceInterface): FileService {
  return new FileService(s3Service);
}
