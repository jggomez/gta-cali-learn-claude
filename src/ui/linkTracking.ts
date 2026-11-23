/**
 * Tags every devhack.co link inside the HUD with the game's UTM parameters at click time, so the
 * DevHack site can measure how many players reach AcaDevHack from the game. One delegated listener
 * covers toasts, album cards, plan modal, Reto screens and the title showcase.
 */

import { withGameUtm } from '../config/publicPaths';

export interface LinkTrackingHandle {
  dispose(): void;
}

export function installUtmLinkTagging(root: HTMLElement): LinkTrackingHandle {
  if (typeof root.addEventListener !== 'function') {
    return { dispose: () => undefined };
  }
  const tag = (event: Event): void => {
    const target = event.target as Element | null;
    const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
    if (!anchor || typeof (anchor as HTMLAnchorElement).href !== 'string') {
      return;
    }
    const placement = anchor.closest('[data-testid]')?.getAttribute('data-testid') ?? 'hud';
    const link = anchor as HTMLAnchorElement;
    const tagged = withGameUtm(link.href, placement);
    if (tagged !== link.href) {
      link.href = tagged;
    }
  };
  root.addEventListener('click', tag, true);
  root.addEventListener('auxclick', tag, true);
  return {
    dispose(): void {
      root.removeEventListener('click', tag, true);
      root.removeEventListener('auxclick', tag, true);
    },
  };
}
