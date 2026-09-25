import { Game, savedGame } from './game';
import { clearSave } from './world/persistence';

const overlay = document.querySelector('#overlay') as HTMLElement;
const bar = document.querySelector('#overlay .bar div') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
const buttons = document.querySelector('#buttons') as HTMLElement;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1337);

const game = new Game(document.querySelector('#game') as HTMLCanvasElement);
(window as unknown as { __game: Game }).__game = game;

function button(label: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  buttons.appendChild(b);
  return b;
}

async function begin(useSave: boolean) {
  buttons.innerHTML = '';
  const save = useSave ? savedGame() : null;
  if (!useSave) clearSave();
  await game.load(seed, save, {
    progress(f, label) {
      bar.style.width = `${(f * 100).toFixed(0)}%`;
      status.textContent = `${label}…`;
    },
  });
  game.start();
  (window as unknown as { __ready: boolean }).__ready = true;
  status.textContent = 'Click to play';
  const resume = () => { overlay.style.display = 'none'; game.input.lock(); };
  button('Play', resume);
  overlay.onclick = e => { if (e.target === overlay) resume(); };
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !game.inventoryOpen) {
      overlay.style.display = 'flex';
      status.textContent = 'Paused';
    }
  });
}

const existing = savedGame();
if (params.has('continue') && existing) begin(true);
else if (params.has('new') || !existing) begin(false);
else {
  status.textContent = 'A saved world was found.';
  button('Continue', () => begin(true));
  button('New World', () => begin(false));
}
