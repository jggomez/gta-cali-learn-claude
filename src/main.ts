/**
 * Application entry point for GTA I - Cali - Colombia (La Sucursal del Cielo).
 * Mounts the Vice Sunset Cali design system and starts the GameApp composition root.
 */

import './styles/theme.css';
import { GameApp } from './game/gameApp';
import { ACTIVE_LANGUAGE } from './config/language';

function bootstrap(): void {
  document.documentElement.lang = ACTIVE_LANGUAGE === 'en' ? 'en' : 'es-CO';
  const canvas = document.getElementById('game-canvas');
  const hudRoot = document.getElementById('hud-root');

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Expected #game-canvas element to be an HTMLCanvasElement.');
  }
  if (!(hudRoot instanceof HTMLElement)) {
    throw new Error('Expected #hud-root element to be an HTMLElement.');
  }

  const app = new GameApp(canvas, hudRoot);
  app.start();

  const cleanup = (): void => {
    app.dispose();
  };

  window.addEventListener('pagehide', cleanup, { once: true });
}

bootstrap();
