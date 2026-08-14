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
