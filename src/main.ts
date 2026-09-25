import { Game, savedGame } from './game';
import { TouchControls } from './ui/touch';
import { isTouchDevice } from './ui/quality';
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
  const isTouch = isTouchDevice() || params.has('touch');
  status.textContent = isTouch ? 'Tap to play' : 'Click to play';
  const touch = isTouch ? new TouchControls(game.input, {
    inventory: () => game.toggleInventory(),
    cycleMode: () => game.cycleBuildMode(),
    pause: () => {
      game.input.locked = false;
      touch?.setVisible(false);
      overlay.style.display = 'flex';
      status.textContent = 'Paused';
    },
    menuOpen: () => game.menuOpen,
  }) : null;
  if (touch) {
    document.body.classList.add('touch');
    game.onFrame = () => touch.update();
  }
  game.input.onFreeLook(active => {
    overlay.style.display = active ? 'none' : 'flex';
    if (!active) status.textContent = 'Paused';
  });
  const resume = () => {
    overlay.style.display = 'none';
    touch?.setVisible(true);
    game.input.lock();
  };
  button('Play', resume);
  button('Save', () => { game.saveGame(); status.textContent = 'World saved'; });
  overlay.onclick = e => { if (e.target === overlay) resume(); };
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !game.menuOpen) {
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
