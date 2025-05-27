/**
 * Type definitions for xlsx
 */

declare module 'xlsx' {
  export interface WorkSheet {
    [key: string]: any;
  }

  export interface WorkBook {
    SheetNames: string[];
    Sheets: {
      [sheet: string]: WorkSheet;
    };
  }

  export function read(data: any, opts?: any): WorkBook;
  
  export namespace utils {
    function sheet_to_json(worksheet: WorkSheet, opts?: any): any[];
  }
}
