/**
 * Type declarations for papaparse
 */
declare module 'papaparse' {
  export interface ParseConfig {
    header?: boolean;
    skipEmptyLines?: boolean;
    complete?: (results: ParseResult) => void;
    error?: (error: Error) => void;
  }
  
  export interface ParseResult {
    data: any[];
    errors: any[];
    meta: {
      delimiter: string;
      linebreak: string;
      aborted: boolean;
      truncated: boolean;
      cursor: number;
      fields?: string[];
    };
  }
  
  export function parse(input: string, config?: ParseConfig): ParseResult;
  export const NODE_STREAM_INPUT: number;
}
