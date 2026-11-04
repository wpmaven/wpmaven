// Asset module declarations — ambient (no imports/exports in this file).
// Bundler (Vite/webpack) resolves asset imports to URL strings; TS needs
// these wildcards to type the imports as string defaults.

declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.jpeg' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.avif' {
  const src: string;
  export default src;
}
