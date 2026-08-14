import { describe, expect, it } from 'vitest';
import { syntaxFileName, syntaxKeyFromFileName } from './syntaxKey';

describe('syntaxKeyFromFileName', () => {
  it('maps common extensions the same way Rust does', () => {
    expect(syntaxKeyFromFileName('app.tsx')).toBe('tsx');
    expect(syntaxKeyFromFileName('main.rs')).toBe('rust');
    expect(syntaxKeyFromFileName('README.md')).toBe('markdown');
    expect(syntaxKeyFromFileName('build.sh')).toBe('bash');
    expect(syntaxKeyFromFileName('deploy.bash')).toBe('bash');
  });

  it('returns null for unknown extensions', () => {
    expect(syntaxKeyFromFileName('notes.txt')).toBeNull();
  });

  it('maps manual selections back to virtual file names used by text tools', () => {
    expect(syntaxFileName('markdown')).toBe('untitled.md');
    expect(syntaxFileName('json')).toBe('untitled.json');
    expect(syntaxFileName('plainText')).toBe('untitled.txt');
  });
});
