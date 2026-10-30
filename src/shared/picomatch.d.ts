declare module 'picomatch' {
  export default function picomatch(glob: string, options?: { dot?: boolean; nocase?: boolean; matchBase?: boolean; strictBrackets?: boolean }): (path: string) => boolean;
}
