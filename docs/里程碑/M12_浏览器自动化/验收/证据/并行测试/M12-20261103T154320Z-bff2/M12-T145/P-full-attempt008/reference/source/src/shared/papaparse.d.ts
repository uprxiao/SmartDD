declare module 'papaparse' {
  interface ParseError { type: string; code: string; message: string; row?: number }
  interface ParseResult<T> { data: T[]; errors: ParseError[]; meta: { cursor: number; linebreak: string; aborted: boolean; truncated: boolean } }
  interface ParseConfig { delimiter: string; header?: boolean; dynamicTyping?: boolean; skipEmptyLines?: boolean; fastMode?: boolean; preview?: number }
  const Papa: { parse<T = string[]>(text: string, config: ParseConfig): ParseResult<T> };
  export default Papa;
}
