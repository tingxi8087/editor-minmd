export type DocumentKind = 'markdown' | 'text';
export const documentKind = (name: string): DocumentKind => /\.(md|markdown|mdown)$/i.test(name) ? 'markdown' : 'text';
