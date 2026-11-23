/**
 * Deployment-path and outbound-link helpers. The game can be served from a sub-path
 * (e.g. https://devhack.co/gta-cali-claude/), so root-relative public asset paths are resolved
 * against Vite's BASE_URL, and links to devhack.co are tagged so DevHack can measure the funnel.
 */

/** Vite base path ('/' in dev and tests, '/gta-cali-claude/' in the devhack.co build). */
export function viteBaseUrl(): string {
  try {
    const base = import.meta.env?.BASE_URL;
    return typeof base === 'string' && base.length > 0 ? base : '/';
  } catch {
    return '/';
  }
}

/** Resolves a root-relative public asset path ("/models/x.glb") against the deployment base. */
export function publicAssetUrl(path: string, base: string = viteBaseUrl()): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return path;
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.slice(1)}`;
}

export const GAME_UTM = {
  utm_source: 'gta-cali-claude',
  utm_medium: 'game',
  utm_campaign: 'aprende-claude-jugando',
} as const;

const DEVHACK_HOST = /(^|\.)devhack\.co$/i;

/**
 * Adds the game's UTM tags to devhack.co links (other hosts, already-tagged links and invalid URLs
 * are returned unchanged). `content` identifies the placement (e.g. "toast", "album").
 */
export function withGameUtm(url: string, content?: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!DEVHACK_HOST.test(parsed.hostname) || parsed.searchParams.has('utm_source')) {
    return url;
  }
  for (const [key, value] of Object.entries(GAME_UTM)) {
    parsed.searchParams.set(key, value);
  }
  if (content) {
    parsed.searchParams.set('utm_content', content);
  }
  return parsed.toString();
}
