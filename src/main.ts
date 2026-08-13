import './styles.css';
import { ParkGame } from './game/ParkGame';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Parkworks could not find its application root.');
}

const game = new ParkGame(root);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
