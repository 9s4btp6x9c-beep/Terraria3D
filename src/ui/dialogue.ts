// NPC dialogue + shop panel.

import type { Inventory } from '../items/inventory';
import { item } from '../items/items';
import { type Npc, type NpcContext, buy } from '../entities/npcs';
import type { IconAtlas } from '../render/icons';

export class DialogueUI {
  private el: HTMLDivElement;
  npc: Npc | null = null;
  private showShop = false;

  constructor(parent: HTMLElement, private inv: Inventory, private icons: IconAtlas, private ctx: () => NpcContext, private onBuy: (ok: boolean, name: string) => void, private onClose: () => void) {
    this.el = document.createElement('div');
    this.el.id = 'dialogue';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    inv.onChange(() => { if (this.npc && this.showShop) this.render(); });
  }

  get open() { return this.npc !== null; }

  show(npc: Npc) {
    if (this.npc) this.npc.talking = false;
    this.npc = npc;
    npc.talking = true;
    this.showShop = false;
    this.text = npc.chat(this.ctx());
    this.render();
  }

  private text = '';

  close() {
    if (this.npc) this.npc.talking = false;
    this.npc = null;
    this.el.style.display = 'none';
    this.onClose();
  }

  private render() {
    const n = this.npc;
    if (!n) return;
    this.el.style.display = 'block';
    const coins = this.inv.count('coin');
    let html = `<div class="who">${n.def.name} <span>${n.def.title}</span></div><div class="say">${this.text}</div>`;
    if (this.showShop && n.def.shop) {
      html += `<div class="shop">${n.def.shop.map((e, i) =>
        `<div class="ware ${coins >= e.price ? '' : 'poor'}" data-i="${i}">${this.icons.img(item(e.item))}<span>${item(e.item).name}${e.count > 1 ? ` ×${e.count}` : ''}</span><b>${e.price} ${this.icons.img(item('coin'), 'mini')}</b></div>`).join('')}</div>` +
        `<div class="purse">You have ${coins} ${this.icons.img(item('coin'), 'mini')}</div>`;
    }
    html += `<div class="btns"><button data-a="chat">Chat</button>${n.def.shop ? `<button data-a="shop">${this.showShop ? 'Hide shop' : 'Shop'}</button>` : ''}<button data-a="close">Close</button></div>`;
    this.el.innerHTML = html;
    this.el.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
      b.onclick = () => {
        if (b.dataset.a === 'chat') this.text = n.chat(this.ctx());
        if (b.dataset.a === 'shop') this.showShop = !this.showShop;
        if (b.dataset.a === 'close') { this.close(); return; }
        this.render();
      };
    });
    this.el.querySelectorAll<HTMLElement>('.ware').forEach(w => {
      w.onclick = () => {
        const e = n.def.shop![Number(w.dataset.i)];
        const ok = buy(this.inv, e);
        this.onBuy(ok, item(e.item).name);
        this.render();
      };
    });
  }
}
