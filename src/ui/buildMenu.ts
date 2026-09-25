// Builder's Hammer menu: choose what to build and from which material.
// Pieces are grouped (structure, roof, ground); each card shows the piece,
// its cost and whether you can afford it. Works with mouse and touch.

import { BUILD_MATERIALS, type BuildTexture, PIECES, type PieceShape, SHAPES } from '../building/structures';
import type { Inventory } from '../items/inventory';
import { item } from '../items/items';
import type { BuildChoice } from '../player/interaction';
import type { IconAtlas } from '../render/icons';
import { icon } from './icons';

const GROUPS: [string, (PieceShape | 'level')[]][] = [
  ['Structure', SHAPES.filter(s => PIECES[s].category === 'structure')],
  ['Roof', SHAPES.filter(s => PIECES[s].category === 'roof')],
  ['Ground', ['level']],
];

export class BuildMenu {
  private el: HTMLDivElement;
  open = false;
  onClose: () => void = () => {};

  constructor(parent: HTMLElement, private inv: Inventory, private icons: IconAtlas, private choice: () => BuildChoice, private choose: (c: BuildChoice) => void) {
    this.el = document.createElement('div');
    this.el.id = 'buildmenu';
    parent.appendChild(this.el);
    this.el.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement;
      const mat = t.closest<HTMLElement>('[data-mat]');
      const piece = t.closest<HTMLElement>('[data-piece]');
      if (t.closest('.close')) { e.preventDefault(); this.setOpen(false); return; }
      if (mat) {
        e.preventDefault();
        this.choose({ ...this.choice(), texture: mat.dataset.mat as BuildTexture });
        this.render();
      } else if (piece) {
        e.preventDefault();
        this.choose({ ...this.choice(), shape: piece.dataset.piece as PieceShape | 'level' });
        this.setOpen(false);
      }
    });
    this.el.addEventListener('pointerover', e => {
      const piece = (e.target as HTMLElement).closest<HTMLElement>('[data-piece]');
      if (piece) this.describe(piece.dataset.piece as PieceShape | 'level');
    });
    inv.onChange(() => { if (this.open) this.render(); });
  }

  setOpen(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    this.el.style.display = open ? 'flex' : 'none';
    if (open) this.render(); else this.onClose();
  }

  private describe(shape: PieceShape | 'level') {
    const info = this.el.querySelector('.info');
    if (!info) return;
    info.innerHTML = shape === 'level'
      ? '<b>Level Ground</b> Flattens the ground around where you aim to the height of your feet. Free.'
      : `<b>${PIECES[shape].name}</b> ${PIECES[shape].description}`;
  }

  private render() {
    const cur = this.choice();
    const mat = BUILD_MATERIALS.find(m => m.texture === cur.texture)!;
    const have = this.inv.count(mat.item);
    const mats = BUILD_MATERIALS.map(m => {
      const n = this.inv.count(m.item);
      return `<button class="mat${m.texture === cur.texture ? ' sel' : ''}${n ? '' : ' none'}" data-mat="${m.texture}">${this.icons.img(item(m.item))}<span>${m.name}</span><em>${n}</em></button>`;
    }).join('');
    const groups = GROUPS.map(([title, shapes]) => `<h3>${title}</h3><div class="cards">${shapes.map(s => {
      if (s === 'level') return `<button class="card${cur.shape === s ? ' sel' : ''}" data-piece="level"><span class="art">${icon('pick', 'art-icon')}</span><span class="name">Level Ground</span><span class="cost">free</span></button>`;
      const d = PIECES[s], ok = have >= d.cost;
      return `<button class="card${cur.shape === s ? ' sel' : ''}${ok ? '' : ' poor'}" data-piece="${s}">${this.icons.piece(s, 'art')}<span class="name">${d.name}</span><span class="cost">${d.cost} ${this.icons.img(item(mat.item), 'mini')}</span></button>`;
    }).join('')}</div>`).join('');
    this.el.innerHTML = `<button class="close px-btn icon" title="Close">${icon('close')}</button>
      <h2>Build</h2>
      <div class="mats">${mats}</div>
      ${groups}
      <div class="info"></div>
      <div class="hint"><span><kbd>LMB</kbd> place</span><span><kbd>R</kbd> rotate</span><span><kbd>Shift</kbd> free placement</span><span><kbd>RMB</kbd> take down</span><span><kbd>Q</kbd> close</span></div>`;
    this.describe(cur.shape);
  }
}
