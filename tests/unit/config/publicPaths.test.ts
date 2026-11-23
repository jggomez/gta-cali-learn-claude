import { describe, expect, it } from 'vitest';
import { publicAssetUrl, viteBaseUrl, withGameUtm } from '../../../src/config/publicPaths';

describe('publicAssetUrl', () => {
  it('keeps root paths at the dev/test base', () => {
    expect(viteBaseUrl()).toBe('/');
    expect(publicAssetUrl('/models/ferrari.glb')).toBe('/models/ferrari.glb');
  });

  it('prefixes the devhack.co sub-path', () => {
    expect(publicAssetUrl('/models/ferrari.glb', '/gta-cali-claude/')).toBe('/gta-cali-claude/models/ferrari.glb');
    expect(publicAssetUrl('/draco/', '/gta-cali-claude')).toBe('/gta-cali-claude/draco/');
    expect(publicAssetUrl('https://example.com/x.png', '/gta-cali-claude/')).toBe('https://example.com/x.png');
    expect(publicAssetUrl('//cdn.example.com/x.png', '/gta-cali-claude/')).toBe('//cdn.example.com/x.png');
  });
});

describe('withGameUtm', () => {
  it('tags devhack.co links with the game campaign and placement', () => {
    const tagged = new URL(withGameUtm('https://devhack.co/academy-ai/claude-code-desde-cero/', 'learn-toast'));
    expect(tagged.pathname).toBe('/academy-ai/claude-code-desde-cero/');
    expect(tagged.searchParams.get('utm_source')).toBe('gta-cali-claude');
    expect(tagged.searchParams.get('utm_medium')).toBe('game');
    expect(tagged.searchParams.get('utm_campaign')).toBe('aprende-claude-jugando');
    expect(tagged.searchParams.get('utm_content')).toBe('learn-toast');
  });

  it('keeps existing query params and never double-tags', () => {
    const once = withGameUtm('https://devhack.co/acadevhack-virtual/registro/?curso=claude-para-todos');
    expect(new URL(once).searchParams.get('curso')).toBe('claude-para-todos');
    expect(withGameUtm(once, 'again')).toBe(once);
  });

  it('leaves other hosts and invalid URLs untouched', () => {
    expect(withGameUtm('https://wa.me/573174498336?text=hola')).toBe('https://wa.me/573174498336?text=hola');
    expect(withGameUtm('not a url')).toBe('not a url');
    expect(withGameUtm('https://evil-devhack.co.example.com/')).toBe('https://evil-devhack.co.example.com/');
  });
});
