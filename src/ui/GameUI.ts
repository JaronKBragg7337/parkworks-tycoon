import { CATEGORY_LABELS, PLACEABLE_SPECS } from '../core/catalog';
import type { ParkStats, PlaceableCategory, PlaceableKind, SimulationEvent } from '../core/types';
import { icon } from './icons';

export interface GameUICallbacks {
  onStart: () => void;
  onToggleBuild: () => void;
  onSelectPlaceable: (kind: PlaceableKind) => void;
  onRotate: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onPause: () => void;
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function timeLabel(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = Math.floor(minuteOfDay % 60);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${suffix}`;
}

export class GameUI {
  private readonly root: HTMLElement;
  private readonly callbacks: GameUICallbacks;
  private cashElement!: HTMLElement;
  private reputationElement!: HTMLElement;
  private guestsElement!: HTMLElement;
  private cleanlinessElement!: HTMLElement;
  private cleanlinessFill!: HTMLElement;
  private timeElement!: HTMLElement;
  private objectiveElement!: HTMLElement;
  private buildPanel!: HTMLElement;
  private buildToggle!: HTMLButtonElement;
  private placementBar!: HTMLElement;
  private placementStatus!: HTMLElement;
  private pauseButton!: HTMLButtonElement;
  private toastElement!: HTMLElement;
  private selectedCategory: PlaceableCategory = 'food';
  private toastTimer = 0;

  constructor(root: HTMLElement, callbacks: GameUICallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.render();
    this.captureElements();
    this.bindEvents();
    this.renderCatalog();
  }

  setMode(mode: 'explore' | 'build' | 'placing'): void {
    this.root.dataset.mode = mode;
    this.buildPanel.classList.toggle('is-open', mode === 'build');
    this.placementBar.classList.toggle('is-open', mode === 'placing');
    this.buildToggle.classList.toggle('is-active', mode !== 'explore');
    this.buildToggle.innerHTML = mode === 'explore'
      ? `${icon('build')}<span>Build</span>`
      : `${icon('walk')}<span>Walk</span>`;
  }

  setPaused(paused: boolean): void {
    this.pauseButton.innerHTML = paused ? icon('play', 'Resume') : icon('pause', 'Pause');
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    this.root.classList.toggle('is-paused', paused);
  }

  setPlacement(kind: PlaceableKind, valid: boolean): void {
    const spec = PLACEABLE_SPECS.find((item) => item.kind === kind);
    if (!spec) return;
    this.placementStatus.innerHTML = `<strong>${spec.name}</strong><span class="placement-validity ${valid ? 'is-valid' : ''}">${valid ? 'Clear to build' : 'Move to a clear plot'}</span>`;
  }

  updateStats(stats: Readonly<ParkStats>): void {
    this.cashElement.textContent = money(stats.cash);
    this.reputationElement.textContent = `${Math.round(stats.reputation)}`;
    this.guestsElement.textContent = `${stats.guestCount}`;
    const cleanliness = Math.round(stats.cleanliness * 100);
    this.cleanlinessElement.textContent = `${cleanliness}%`;
    this.cleanlinessFill.style.width = `${cleanliness}%`;
    this.cleanlinessFill.dataset.level = cleanliness < 45 ? 'low' : cleanliness < 75 ? 'medium' : 'high';
    this.timeElement.textContent = `Day ${stats.day} · ${timeLabel(stats.minuteOfDay)}`;

    const served = Math.min(25, stats.guestsServed);
    const clean = cleanliness >= 75;
    const rep = stats.reputation >= 70;
    this.objectiveElement.innerHTML = `
      <span class="objective-label">Opening goals</span>
      <span class="objective-step ${served >= 25 ? 'is-complete' : ''}">${served}/25 guests served</span>
      <span class="objective-step ${clean ? 'is-complete' : ''}">75% clean</span>
      <span class="objective-step ${rep ? 'is-complete' : ''}">70 reputation</span>
    `;
  }

  handleEvent(event: SimulationEvent): void {
    switch (event.type) {
      case 'service-complete':
        if (event.revenue > 0) this.toast(`Sale +${money(event.revenue)}`, 'positive');
        break;
      case 'litter-created':
        this.toast('A guest dropped litter', 'warning');
        break;
      case 'litter-removed':
        if (event.byPlayer) this.toast('Cleaned +$3', 'positive');
        break;
      case 'insufficient-funds':
        this.toast(`Need ${money(event.required)}`, 'warning');
        break;
      default:
        break;
    }
  }

  toast(message: string, tone: 'neutral' | 'positive' | 'warning' = 'neutral'): void {
    window.clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.dataset.tone = tone;
    this.toastElement.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => this.toastElement.classList.remove('is-visible'), 2400);
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
  }

  private render(): void {
    this.root.insertAdjacentHTML('beforeend', `
      <div class="game-ui" data-ui>
        <header class="hud-bar glass-panel">
          <div class="brand-lockup">
            <span class="brand-mark">${icon('spark')}</span>
            <span><b>Parkworks</b><small>TYCOON</small></span>
          </div>
          <div class="stat-cluster">
            <div class="stat stat-cash"><span class="stat-label">Park funds</span><strong id="cash-stat">$4,200</strong></div>
            <div class="stat"><span class="stat-label">Reputation</span><strong><span class="stat-symbol">★</span> <span id="reputation-stat">38</span></strong></div>
            <div class="stat"><span class="stat-label">Guests</span><strong id="guest-stat">0</strong></div>
          </div>
          <div class="day-cluster">
            <span id="time-stat">Day 1 · 9:00 AM</span>
            <button class="icon-button" id="pause-button" aria-label="Pause simulation">${icon('pause')}</button>
          </div>
        </header>

        <aside class="park-pulse glass-panel" aria-label="Park condition">
          <div class="pulse-heading"><span>Park pulse</span><strong id="cleanliness-stat">100%</strong></div>
          <div class="meter"><i id="cleanliness-fill" data-level="high"></i></div>
          <span class="pulse-caption">Cleanliness</span>
        </aside>

        <section class="objectives glass-panel" id="objectives" aria-live="polite"></section>

        <div class="control-hint glass-panel" id="control-hint">
          <span class="desktop-hint"><kbd>WASD</kbd> walk · drag to look · <kbd>Shift</kbd> sprint</span>
          <span class="touch-hint">Touch left to walk · drag right to look</span>
        </div>

        <button class="build-toggle" id="build-toggle" aria-label="Open build catalog">
          ${icon('build')}<span>Build</span>
        </button>

        <section class="build-panel glass-panel" id="build-panel" aria-label="Build catalog">
          <div class="build-header">
            <div><span class="eyebrow">Workshop</span><h2>Build the park</h2></div>
            <button class="icon-button" id="close-build" aria-label="Close build catalog">${icon('close')}</button>
          </div>
          <nav class="category-tabs" id="category-tabs" aria-label="Build categories"></nav>
          <div class="catalog-grid" id="catalog-grid"></div>
        </section>

        <section class="placement-bar glass-panel" id="placement-bar" aria-label="Placement controls">
          <div class="placement-copy" id="placement-status"></div>
          <div class="placement-actions">
            <button class="secondary-action" id="rotate-placement">${icon('rotate')}<span>Rotate</span></button>
            <button class="secondary-action" id="cancel-placement">${icon('close')}<span>Cancel</span></button>
            <button class="primary-action" id="confirm-placement">${icon('check')}<span>Build</span></button>
          </div>
        </section>

        <div class="joystick" id="movement-joystick" aria-hidden="true">
          <div class="joystick-ring"></div><div class="joystick-knob"></div>
        </div>

        <div class="toast" id="toast" role="status" aria-live="polite"></div>
      </div>

      <section class="splash" id="splash" data-ui>
        <div class="splash-vignette"></div>
        <div class="splash-content">
          <span class="splash-kicker">A tiny park with a big heartbeat</span>
          <h1>Build joy.<br><em>Mind the mess.</em></h1>
          <p>Shape a welcoming park on foot. Build rides, feed your guests, keep facilities flowing, and clean up what they leave behind.</p>
          <button class="start-button" id="start-button"><span>Open the gates</span>${icon('spark')}</button>
          <span class="splash-footnote">No account · Touch-ready · CC0 materials</span>
        </div>
      </section>
    `);
  }

  private captureElements(): void {
    this.cashElement = this.requireElement('#cash-stat');
    this.reputationElement = this.requireElement('#reputation-stat');
    this.guestsElement = this.requireElement('#guest-stat');
    this.cleanlinessElement = this.requireElement('#cleanliness-stat');
    this.cleanlinessFill = this.requireElement('#cleanliness-fill');
    this.timeElement = this.requireElement('#time-stat');
    this.objectiveElement = this.requireElement('#objectives');
    this.buildPanel = this.requireElement('#build-panel');
    this.buildToggle = this.requireElement<HTMLButtonElement>('#build-toggle');
    this.placementBar = this.requireElement('#placement-bar');
    this.placementStatus = this.requireElement('#placement-status');
    this.pauseButton = this.requireElement<HTMLButtonElement>('#pause-button');
    this.toastElement = this.requireElement('#toast');
  }

  private bindEvents(): void {
    this.requireElement('#start-button').addEventListener('click', () => {
      this.requireElement('#splash').classList.add('is-hidden');
      this.callbacks.onStart();
    });
    this.buildToggle.addEventListener('click', this.callbacks.onToggleBuild);
    this.requireElement('#close-build').addEventListener('click', this.callbacks.onToggleBuild);
    this.pauseButton.addEventListener('click', this.callbacks.onPause);
    this.requireElement('#rotate-placement').addEventListener('click', this.callbacks.onRotate);
    this.requireElement('#cancel-placement').addEventListener('click', this.callbacks.onCancel);
    this.requireElement('#confirm-placement').addEventListener('click', this.callbacks.onConfirm);
  }

  private renderCatalog(): void {
    const tabs = this.requireElement('#category-tabs');
    const categories = Object.keys(CATEGORY_LABELS) as PlaceableCategory[];
    tabs.innerHTML = categories
      .map((category) => `<button data-category="${category}" class="${category === this.selectedCategory ? 'is-active' : ''}">${CATEGORY_LABELS[category]}</button>`)
      .join('');
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      button.addEventListener('click', () => {
        this.selectedCategory = button.dataset.category as PlaceableCategory;
        this.renderCatalog();
      });
    }

    const catalog = this.requireElement('#catalog-grid');
    catalog.innerHTML = PLACEABLE_SPECS.filter((spec) => spec.category === this.selectedCategory)
      .map((spec) => `
        <button class="catalog-card" data-kind="${spec.kind}">
          <span class="catalog-icon">${icon(spec.icon as Parameters<typeof icon>[0])}</span>
          <span class="catalog-copy"><strong>${spec.shortName}</strong><small>${spec.description}</small></span>
          <span class="catalog-price">${money(spec.cost)}</span>
        </button>
      `)
      .join('');
    for (const button of catalog.querySelectorAll<HTMLButtonElement>('[data-kind]')) {
      button.addEventListener('click', () => this.callbacks.onSelectPlaceable(button.dataset.kind as PlaceableKind));
    }
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
