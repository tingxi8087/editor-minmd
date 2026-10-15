import { describe, expect, it } from 'vitest';
import { fileURL, isLocalReference, rebaseReference, validLink } from '../src/lib/resources';
describe('resource URL paths', () => {
  it('preserves Chinese names, spaces and literal # in document paths', () => {
    expect(fileURL('/notes/中文 #.md').pathname).toBe('/notes/%E4%B8%AD%E6%96%87%20%23.md');
    expect(rebaseReference('assets/图%20片%231.png', '/notes/旧.md', '/other/新.md')).toBe('../notes/assets/%E5%9B%BE%20%E7%89%87%231.png');
  });
  it('rebases links with fragments, missing resources and parent paths', () => {
    expect(rebaseReference('../B.md#标题', '/notes/sub/A.md', '/notes/A.md')).toBe('B.md#%E6%A0%87%E9%A2%98');
    expect(rebaseReference('missing(1).png', '/old/A.md', '/new/A.md')).toBe('../old/missing%281%29.png');
    expect(rebaseReference('https://example.com/a', '/old/A.md', '/new/A.md')).toBe('https://example.com/a');
    expect(rebaseReference('#标题', '/old/A.md', '/new/A.md')).toBe('#标题');
  });
  it('handles Windows drive changes with absolute file URLs', () => {
    expect(fileURL('C:\\notes\\A.md').href).toBe('file:///C:/notes/A.md');
    expect(rebaseReference('image.png', 'C:\\notes\\A.md', 'D:\\other\\B.md')).toContain('file:');
  });
  it('allows document links and rejects executable schemes', () => {
    expect(validLink('../中文.md#标题')).toBe(true); expect(validLink('#标题')).toBe(true);
    expect(validLink('https://example.com')).toBe(true); expect(validLink('javascript:alert(1)')).toBe(false);
    expect(validLink('data:text/html,hi')).toBe(false); expect(validLink('//example.com')).toBe(false);
    expect(isLocalReference('assets/a.png')).toBe(true); expect(isLocalReference('file:///a.png')).toBe(false);
  });
});
