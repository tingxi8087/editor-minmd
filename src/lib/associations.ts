import { invoke, isTauri } from '@tauri-apps/api/core';
export const associationGroups = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: '普通文本', extensions: ['txt', 'text', 'log'] },
  { name: '配置与数据', extensions: ['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'csv'] },
  { name: '代码文件', extensions: ['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'less', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'sh', 'sql', 'vue', 'svelte'] },
];
export const associationExtensions = associationGroups.flatMap(group => group.extensions);
export interface AssociationResult { extension: string; contentType: string | null; success: boolean; message: string }
export const associations = {
  supported: () => isTauri() ? invoke<boolean>('association_platform') : Promise.resolve(false),
  apply: (extensions: string[]) => invoke<AssociationResult[]>('set_default_associations', { extensions }),
};
export type AssociationGateway = typeof associations;
