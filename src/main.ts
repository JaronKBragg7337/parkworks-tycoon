import './styles.css';
import { ParkGame } from './game/ParkGame';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Parkworks could not find its application root.');
}

const game = new ParkGame(root);
game.start();
// Rendering begins immediately; the saved park is offered as soon as the store
// answers, which on a cloud-backed host may be a network round trip away.
void game.initialize();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}

// A development-only handle, stripped from the production bundle by the
// `import.meta.env.DEV` guard.
//
// Verifying how the park looks at dusk otherwise means sitting through seven
// and a half minutes of daylight, and a browser tab that is not on screen
// throttles requestAnimationFrame to a standstill, so the wait can never even
// finish. This lets a check jump straight to the hour it cares about:
//
//     window.__parkworks.setClock(22, 30)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__parkworks = {
    game,
    setClock: (hour: number, minute = 0) => game.debugSetClock(hour * 60 + minute),
  };
}
