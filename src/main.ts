import '@fontsource/jersey-10/latin-400.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './ui/styles.css';
import { Game, savedGame } from './game';
import { Menu } from './ui/menu';
import { isTouchDevice } from './ui/quality';
import { loadSettings } from './ui/settings';
import { TouchControls } from './ui/touch';
import { clearSave } from './world/persistence';

const params = new URLSearchParams(location.search);
const isTouch = isTouchDevice() || params.has('touch');
const settings = loadSettings();
const game = new Game(document.querySelector('#game') as HTMLCanvasElement);
(window as unknown as { __game: Game }).__game = game;

let touch: TouchControls | null = null;
let playing = false;

const menu = new Menu({
  isTouch,
  settings,
  saveInfo: () => {
    const s = savedGame();
    return s ? { seed: s.seed, savedAt: s.savedAt } : null;
  },
  seed: () => game.field?.cfg.seed ?? 0,
  play,
  newWorld: seed => {
    clearSave();
    location.href = `${location.pathname}?new&seed=${seed}&play`;
  },
  save: () => game.saveGame(),
  quitToTitle: () => {
    game.saveGame();
    playing = false;
    game.setMenuMode(true);
    touch?.setVisible(false);
    menu.open('title');
  },
  applySettings: s => game.applySettings(s),
  sound: name => game.audio.play(name === 'hover' ? 'pickup' : 'craft'),
});
(window as unknown as { __menu: Menu }).__menu = menu;

/** Leave the menus and hand control to the player. */
function play() {
  menu.hide();
  game.paused = false;
  game.setMenuMode(false);
  playing = true;
  touch?.setVisible(true);
  game.input.lock();
}

function pause() {
  if (!playing || menu.visible) return;
  game.paused = true;
  game.input.locked = false;
  touch?.setVisible(false);
  menu.open('pause');
}

async function boot() {
  const existing = savedGame();
  const fresh = params.has('new') || !existing;
  if (params.has('new')) clearSave();
  const seed = Number(params.get('seed') ?? 1337);
  // Seconds at which each loading phase began (read by the e2e scripts).
  const phases: Record<string, number> = {};
  const t0 = performance.now();
  (window as unknown as { __loadPhases: typeof phases }).__loadPhases = phases;
  await game.load(seed, fresh ? null : existing, {
    progress(f, label) {
      phases[label] ??= Math.round(performance.now() - t0) / 1000;
      menu.setProgress(f, label);
    },
  });
  game.applySettings(settings);
  game.start();
  game.setMenuMode(true);
  (window as unknown as { __ready: boolean }).__ready = true;

  if (isTouch) {
    touch = new TouchControls(game.input, {
      inventory: () => game.toggleInventory(),
      cycleMode: () => game.cycleBuildMode(),
      pause,
      menuOpen: () => game.menuOpen,
    });
    document.body.classList.add('touch');
    touch.setVisible(false);
    game.applySettings(settings);
    game.onFrame = () => touch?.update();
  }
  game.input.onFreeLook(active => { if (!active) pause(); });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !game.menuOpen && !isTouch && !game.input.freeLook) pause();
  });
  if (params.has('play') || params.has('continue')) menu.open('ready');
  else menu.open('title');
}

void boot();
