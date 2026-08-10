import { describe, expect, it } from 'vitest';
import { syntaxKeyFromFileName } from './syntaxKey';

describe('syntaxKeyFromFileName', () => {
  it('maps common extensions the same way Rust does', () => {
    expect(syntaxKeyFromFileName('app.tsx')).toBe('tsx');
    expect(syntaxKeyFromFileName('main.rs')).toBe('rust');
    expect(syntaxKeyFromFileName('README.md')).toBe('markdown');
  });

  it('returns null for unknown extensions', () => {
    expect(syntaxKeyFromFileName('notes.txt')).toBeNull();
  });
});
