/**
 * Type definitions for fast-xml-parser
 */

declare module 'fast-xml-parser' {
  export class XMLParser {
    constructor(options?: any);
    parse(xml: string): Record<string, unknown>;
  }
}
