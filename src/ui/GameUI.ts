import type { AwayReport } from '../core/awayReport';
import { CATEGORY_LABELS, PLACEABLE_SPECS } from '../core/catalog';
import {
  MAX_PRICE_MULTIPLE,
  acceptanceRate,
  expectedRevenuePerGuest,
  isPriceable,
  priceFor,
  priceTolerance,
  type PriceBook,
} from '../core/pricing';
import type { ParkStats, PlaceableCategory, PlaceableKind, SimulationEvent } from '../core/types';
import {
  DEFAULT_SURFACE_COSTS,
  type ParcelSnapshot,
  type ParkGridCosts,
} from '../core/ParkGrid';
import type { InfrastructureTool } from '../game/InfrastructureBuilder';
import type { PlacementValidation } from '../game/PlacementSystem';
import { icon } from './icons';

export interface ResumeSummary {
  parkName: string;
  day: number;
  cash: number;
  buildings: number;
  /** Where the park is stored, e.g. "this device". */
  storageLabel: string;
}

export interface GameUICallbacks {
  onStart: () => void;
  onContinue: () => void;
  onNewPark: () => void;
  onToggleBuild: () => void;
  onSelectPlaceable: (kind: PlaceableKind) => void;
  onSelectInfrastructure: (tool: InfrastructureTool) => void;
  onBuyParcel: (parcelId: string) => void;
  onRotate: () => void;
  /** Screen-relative nudge: (0,-1) is away from the camera, (1,0) is right. */
  onNudge: (screenX: number, screenZ: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onMoveSelected: () => void;
  onRotateSelected: () => void;
  onSellSelected: () => void;
  onCloseInspector: () => void;
  onPause: () => void;
  onToggleCamera: () => void;
  onReframeCamera: () => void;
  /** Sets what one kind of facility charges every guest who uses it. */
  onSetPrice: (kind: PlaceableKind, price: number) => void;
  /** Abandons the park and starts again. Only called after both confirmations. */
  onStartOver: () => void;
}

type GameUIMode = 'explore' | 'build' | 'placing' | 'surface' | 'inspect';

/** What the inspector shows about one already-placed building. */
export interface InspectorInfo {
  name: string;
  detail: string;
  tone: 'positive' | 'warning';
  resale: number;
  /** What this building charges each guest it serves. Zero for free facilities. */
  price?: number;
}

/** The park as the office tab needs to describe it when offering to start over. */
export interface ParkSummary {
  day: number;
  cash: number;
  buildings: number;
}

type CatalogSection = 'infrastructure' | 'office' | PlaceableCategory;

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function describeDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours >= 1) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes >= 1) return `${minutes}m`;
  return 'a moment';
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
  private rotateButton!: HTMLButtonElement;
  private confirmButton!: HTMLButtonElement;
  private pauseButton!: HTMLButtonElement;
  private cameraButton!: HTMLButtonElement;
  private reframeButton!: HTMLButtonElement;
  private toastElement!: HTMLElement;
  private inspectorBar!: HTMLElement;
  private inspectorStatus!: HTMLElement;
  private sellButton!: HTMLButtonElement;
  private nudgePad!: HTMLElement;
  private selectedCategory: CatalogSection = 'infrastructure';
  private infrastructureTool: InfrastructureTool = 'sidewalk';
  private parcels: readonly ParcelSnapshot[] = [];
  private infrastructureCosts: ParkGridCosts = DEFAULT_SURFACE_COSTS;
  private prices: PriceBook = {};
  private reputation = 38;
  private parkSummary: ParkSummary = { day: 1, cash: 0, buildings: 0 };
  private pricingSignature = '';
  private toastTimer = 0;

  constructor(root: HTMLElement, callbacks: GameUICallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.render();
    this.captureElements();
    this.bindEvents();
    this.setMode('explore');
    this.setCameraMode('follow');
    this.renderCatalog();
  }

  setMode(mode: GameUIMode): void {
    this.root.dataset.mode = mode;
    this.buildPanel.classList.toggle('is-open', mode === 'build');
    this.placementBar.classList.toggle('is-open', mode === 'placing' || mode === 'surface');
    this.placementBar.classList.toggle('is-surface', mode === 'surface');
    this.inspectorBar.classList.toggle('is-open', mode === 'inspect');
    this.rotateButton.hidden = mode === 'surface';
    this.nudgePad.hidden = mode !== 'placing';
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

  setCameraMode(mode: 'follow' | 'overview'): void {
    const isOverview = mode === 'overview';
    const actionLabel = isOverview
      ? 'Return to follow camera'
      : 'Switch to overview camera';
    this.root.dataset.cameraMode = mode;
    this.cameraButton.dataset.cameraMode = mode;
    this.cameraButton.innerHTML = `${icon(isOverview ? 'camera' : 'follow')}<span class="camera-mode-label">${isOverview ? 'Overview' : 'Follow'}</span>`;
    this.cameraButton.setAttribute('aria-label', actionLabel);
    this.cameraButton.setAttribute('aria-pressed', `${isOverview}`);
    this.cameraButton.title = actionLabel;
    this.reframeButton.hidden = !isOverview;
  }

  setPlacement(kind: PlaceableKind, validation: PlacementValidation): void {
    const spec = PLACEABLE_SPECS.find((item) => item.kind === kind);
    if (!spec) return;
    const tone = !validation.valid
      ? 'is-invalid'
      : validation.connected
        ? 'is-valid'
        : 'is-warning';
    this.placementStatus.innerHTML = `<strong>${spec.name}</strong><span class="placement-validity ${tone}">${validation.message}</span>`;
    this.confirmButton.disabled = !validation.valid;
    this.confirmButton.innerHTML = `${icon('check')}<span>Build</span>`;
  }

  updateInfrastructure(
    parcels: readonly ParcelSnapshot[],
    costs: ParkGridCosts,
  ): void {
    this.parcels = parcels;
    this.infrastructureCosts = costs;
    if (this.selectedCategory === 'infrastructure') this.renderCatalog();
  }

  setInfrastructureStroke(
    tool: InfrastructureTool,
    cellCount: number,
    cost: number,
    valid: boolean,
    reason: string | null = null,
  ): void {
    this.infrastructureTool = tool;
    const label = tool === 'sidewalk'
      ? 'Sidewalk'
      : tool === 'road'
        ? 'Park road'
        : 'Demolish paths';
    const action = tool === 'demolish' ? 'Demolish' : 'Build';
    const hasCells = cellCount > 0;
    const status = hasCells
      ? valid
        ? `${cellCount} ${cellCount === 1 ? 'tile' : 'tiles'} · ${money(cost)}`
        : this.infrastructureReason(reason)
      : 'Drag across the park to mark tiles';
    const tone = !hasCells ? 'is-neutral' : valid ? 'is-valid' : 'is-invalid';
    this.placementStatus.innerHTML = `<strong>${label}</strong><span class="placement-validity ${tone}">${status}</span>`;
    this.confirmButton.disabled = !hasCells || !valid;
    this.confirmButton.innerHTML = `${icon('check')}<span>${action}</span>`;
  }

  setInspector(info: InspectorInfo): void {
    // What a building earns per guest is the number the player is actually
    // managing, so it sits beside the name rather than being something they
    // have to remember from the catalog.
    const charge = typeof info.price === 'number'
      ? info.price > 0
        ? `<span class="inspector-charge">${money(info.price)} per guest</span>`
        : '<span class="inspector-charge is-free">Free to use</span>'
      : '';
    this.inspectorStatus.innerHTML =
      `<strong>${info.name}</strong><span class="placement-validity ${info.tone === 'positive' ? 'is-valid' : 'is-warning'}">${info.detail}</span>${charge}`;
    this.sellButton.innerHTML = `${icon('close')}<span>Sell ${money(info.resale)}</span>`;
  }

  /**
   * Hands the office tab the numbers it needs: the prices in force, the
   * reputation that decides what guests will tolerate, and enough about the
   * park to describe it honestly in the start-over confirmation.
   */
  updatePricing(prices: Readonly<PriceBook>, reputation: number, summary: ParkSummary): void {
    this.prices = { ...prices };
    this.reputation = reputation;
    this.parkSummary = { ...summary };
    if (this.selectedCategory !== 'office' || !this.buildPanel.classList.contains('is-open')) return;

    // This is called from the simulation loop, so it must not rebuild the panel
    // sixty times a second. Only what the office actually displays counts as a
    // change: prices, whole-number reputation, and the park line in the
    // start-over warning.
    const signature = [
      JSON.stringify(this.prices),
      Math.round(reputation),
      summary.day,
      Math.round(summary.cash),
      summary.buildings,
    ].join('|');
    if (signature === this.pricingSignature) return;
    this.pricingSignature = signature;
    this.renderCatalog();
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

  /**
   * Offers to resume a saved park. Continue is the primary action, because a
   * player who saved a park almost always came back for that park.
   */
  showResumeOption(summary: ResumeSummary): void {
    const actions = this.requireElement('#splash-actions');
    actions.innerHTML = `
      <button class="start-button" id="continue-button">
        <span>Continue ${summary.parkName}</span>${icon('spark')}
      </button>
      <button class="ghost-action" id="new-park-button" type="button">Start a new park</button>
    `;
    this.requireElement('#splash-footnote').textContent =
      `Day ${summary.day} · ${money(summary.cash)} · ${summary.buildings} built · saved on ${summary.storageLabel}`;

    this.requireElement('#continue-button').addEventListener('click', () => {
      this.hideSplash();
      this.callbacks.onContinue();
    });
    this.requireElement('#new-park-button').addEventListener('click', () => {
      this.callbacks.onNewPark();
    });
  }

  /** Restores the first-run splash after the player discards a saved park. */
  showFreshStart(): void {
    const actions = this.requireElement('#splash-actions');
    actions.innerHTML = `
      <button class="start-button" id="start-button"><span>Open the gates</span>${icon('spark')}</button>
    `;
    this.requireElement('#splash-footnote').textContent = 'No account · Touch-ready · CC0 materials';
    this.requireElement('#start-button').addEventListener('click', () => {
      this.hideSplash();
      this.callbacks.onStart();
    });
  }

  hideSplash(): void {
    this.requireElement('#splash').classList.add('is-hidden');
  }

  showAwayReport(report: AwayReport, reputationBefore: number): void {
    const panel = this.requireElement('#away-report');
    const grid = this.requireElement('#away-grid');
    const heading = this.requireElement('#away-heading');
    const note = this.requireElement('#away-note');

    heading.textContent = report.netCash >= 0
      ? 'Your park kept running'
      : 'Your park ran at a loss';

    const rows: Array<[string, string]> = [
      ['Away for', describeDuration(report.awaySeconds)],
      ['Guests', `${report.guestsVisited.toLocaleString('en-US')}`],
      ['Served', `${report.guestsServed.toLocaleString('en-US')}`],
      ['Revenue', money(report.revenue)],
      ['Upkeep', `-${money(report.upkeep)}`],
      ['Net', `${report.netCash < 0 ? '-' : '+'}${money(Math.abs(report.netCash))}`],
    ];
    if (report.litterCreated > 0) rows.push(['Litter dropped', `${report.litterCreated}`]);
    rows.push(['Cleanliness', `${Math.round(report.cleanliness * 100)}%`]);

    // Reputation can move a long way over a long absence. Showing only the new
    // number would look like a bug, so the swing is always spelled out.
    const reputationAfter = Math.round(report.reputation);
    const reputationDelta = reputationAfter - Math.round(reputationBefore);
    rows.push([
      'Reputation',
      reputationDelta === 0
        ? `${reputationAfter}`
        : `${reputationAfter} (${reputationDelta > 0 ? '+' : ''}${reputationDelta})`,
    ]);

    grid.innerHTML = rows
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join('');

    const notes = ['Estimated from your park’s own service rates.'];
    if (report.guestsVisited > 0 && report.guestsServed === 0) {
      notes.push('Nothing was open to serve them, so they left unhappy.');
    }
    if (report.capped) {
      notes.push(`Only the first ${describeDuration(report.creditedSeconds)} counted.`);
    }
    if (report.litterCreated > 0) {
      notes.push('Nobody was there to clean up.');
    }
    note.textContent = notes.join(' ');
    panel.hidden = false;
  }

  hideAwayReport(): void {
    this.requireElement('#away-report').hidden = true;
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
            <button class="icon-button camera-toggle" id="camera-button" type="button" aria-label="Switch to overview camera" aria-pressed="false" title="Switch to overview camera">
              ${icon('follow')}<span class="camera-mode-label">Follow</span>
            </button>
            <button class="icon-button reframe-camera" id="reframe-camera" type="button" aria-label="Recenter Park View" title="Recenter Park View" hidden>
              ${icon('reframe')}
            </button>
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
          <span class="desktop-hint follow-camera-hint"><kbd>WASD</kbd> walk · drag to look · <kbd>Shift</kbd> sprint</span>
          <span class="touch-hint follow-camera-hint">Touch left to walk · drag right to look</span>
          <span class="desktop-hint free-camera-hint"><kbd>WASD</kbd> pan · drag to orbit · wheel to zoom</span>
          <span class="touch-hint free-camera-hint">Touch left to pan · drag right to orbit · pinch to zoom</span>
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
          <div class="nudge-pad" id="nudge-pad" role="group" aria-label="Nudge one metre">
            <button class="nudge-button nudge-up" id="nudge-up" type="button" aria-label="Nudge away from camera">${icon('nudge')}</button>
            <button class="nudge-button nudge-left" id="nudge-left" type="button" aria-label="Nudge left">${icon('nudge')}</button>
            <span class="nudge-hub" aria-hidden="true">1m</span>
            <button class="nudge-button nudge-right" id="nudge-right" type="button" aria-label="Nudge right">${icon('nudge')}</button>
            <button class="nudge-button nudge-down" id="nudge-down" type="button" aria-label="Nudge toward camera">${icon('nudge')}</button>
          </div>
          <div class="placement-actions">
            <button class="secondary-action" id="rotate-placement">${icon('rotate')}<span>Rotate</span></button>
            <button class="secondary-action" id="cancel-placement">${icon('close')}<span>Cancel</span></button>
            <button class="primary-action" id="confirm-placement">${icon('check')}<span>Build</span></button>
          </div>
        </section>

        <section class="placement-bar inspector-bar glass-panel" id="inspector-bar" aria-label="Edit a building">
          <div class="placement-copy" id="inspector-status"></div>
          <div class="placement-actions">
            <button class="secondary-action" id="inspector-move">${icon('build')}<span>Move</span></button>
            <button class="secondary-action" id="inspector-rotate">${icon('rotate')}<span>Rotate</span></button>
            <button class="secondary-action inspector-sell" id="inspector-sell">${icon('close')}<span>Sell</span></button>
            <button class="primary-action" id="inspector-done">${icon('check')}<span>Done</span></button>
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
          <div class="splash-actions" id="splash-actions">
            <button class="start-button" id="start-button"><span>Open the gates</span>${icon('spark')}</button>
          </div>
          <span class="splash-footnote" id="splash-footnote">No account · Touch-ready · CC0 materials</span>
        </div>
      </section>

      <section class="away-report confirm-dialog" id="confirm-dialog" data-ui hidden role="alertdialog" aria-labelledby="confirm-heading" aria-describedby="confirm-body">
        <div class="away-card glass-panel">
          <span class="eyebrow">Confirm</span>
          <h2 id="confirm-heading"></h2>
          <p class="away-note" id="confirm-body"></p>
          <div class="confirm-actions" id="confirm-actions"></div>
        </div>
      </section>

      <section class="away-report" id="away-report" data-ui hidden aria-live="polite">
        <div class="away-card glass-panel">
          <span class="eyebrow">While you were away</span>
          <h2 id="away-heading">Your park kept running</h2>
          <dl class="away-grid" id="away-grid"></dl>
          <p class="away-note" id="away-note"></p>
          <button class="primary-action" id="away-dismiss"><span>Back to the park</span></button>
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
    this.rotateButton = this.requireElement<HTMLButtonElement>('#rotate-placement');
    this.confirmButton = this.requireElement<HTMLButtonElement>('#confirm-placement');
    this.cameraButton = this.requireElement<HTMLButtonElement>('#camera-button');
    this.reframeButton = this.requireElement<HTMLButtonElement>('#reframe-camera');
    this.pauseButton = this.requireElement<HTMLButtonElement>('#pause-button');
    this.toastElement = this.requireElement('#toast');
    this.inspectorBar = this.requireElement('#inspector-bar');
    this.inspectorStatus = this.requireElement('#inspector-status');
    this.sellButton = this.requireElement<HTMLButtonElement>('#inspector-sell');
    this.nudgePad = this.requireElement('#nudge-pad');
  }

  private bindEvents(): void {
    this.requireElement('#start-button').addEventListener('click', () => {
      this.hideSplash();
      this.callbacks.onStart();
    });
    this.requireElement('#away-dismiss').addEventListener('click', () => this.hideAwayReport());
    this.requireElement('#nudge-up').addEventListener('click', () => this.callbacks.onNudge(0, -1));
    this.requireElement('#nudge-down').addEventListener('click', () => this.callbacks.onNudge(0, 1));
    this.requireElement('#nudge-left').addEventListener('click', () => this.callbacks.onNudge(-1, 0));
    this.requireElement('#nudge-right').addEventListener('click', () => this.callbacks.onNudge(1, 0));
    this.requireElement('#inspector-move').addEventListener('click', this.callbacks.onMoveSelected);
    this.requireElement('#inspector-rotate').addEventListener('click', this.callbacks.onRotateSelected);
    this.sellButton.addEventListener('click', this.callbacks.onSellSelected);
    this.requireElement('#inspector-done').addEventListener('click', this.callbacks.onCloseInspector);
    this.buildToggle.addEventListener('click', this.callbacks.onToggleBuild);
    this.requireElement('#close-build').addEventListener('click', this.callbacks.onToggleBuild);
    this.cameraButton.addEventListener('click', this.callbacks.onToggleCamera);
    this.reframeButton.addEventListener('click', this.callbacks.onReframeCamera);
    this.pauseButton.addEventListener('click', this.callbacks.onPause);
    this.requireElement('#rotate-placement').addEventListener('click', this.callbacks.onRotate);
    this.requireElement('#cancel-placement').addEventListener('click', this.callbacks.onCancel);
    this.requireElement('#confirm-placement').addEventListener('click', this.callbacks.onConfirm);
  }

  private renderCatalog(): void {
    const tabs = this.requireElement('#category-tabs');
    const categories: CatalogSection[] = [
      'infrastructure',
      ...(Object.keys(CATEGORY_LABELS) as PlaceableCategory[]),
      'office',
    ];
    tabs.innerHTML = categories
      .map((category) => `<button data-category="${category}" class="${category === this.selectedCategory ? 'is-active' : ''}">${this.categoryLabel(category)}</button>`)
      .join('');
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      button.addEventListener('click', () => {
        this.selectedCategory = button.dataset.category as CatalogSection;
        // Force the next pricing update through: the panel it would compare
        // against is the one we are about to replace.
        this.pricingSignature = '';
        this.renderCatalog();
      });
    }

    const catalog = this.requireElement('#catalog-grid');
    catalog.classList.toggle('is-office', this.selectedCategory === 'office');
    if (this.selectedCategory === 'infrastructure') {
      this.renderInfrastructureCatalog(catalog);
      return;
    }
    if (this.selectedCategory === 'office') {
      this.renderOffice(catalog);
      return;
    }
    catalog.classList.remove('is-infrastructure');
    catalog.innerHTML = PLACEABLE_SPECS.filter((spec) => spec.category === this.selectedCategory)
      .map((spec) => {
        // Cost is what the player pays once; the earn line is what comes back
        // every time a guest uses it. Both belong on the card, because the
        // second is the only reason to pay the first.
        const charge = priceFor(spec.kind, this.prices);
        // Decoration is the one thing here whose worth depends on where it is
        // put, so its card says how far it reaches instead of leaving the
        // player to work out why their trees stopped counting.
        // Staff are the one thing on these cards that only ever costs. Saying
        // "free for guests" about a crew post would be true and useless; the
        // number the player needs is the wage, because that is the decision.
        const earns = spec.staff
          ? `<small class="catalog-earns is-wage">Wages ${money(spec.upkeep)} every upkeep cycle</small>`
          : typeof spec.radius === 'number'
            ? `<small class="catalog-earns is-free">Adds ${spec.appeal} appeal within ${spec.radius} m</small>`
            : charge > 0
              ? `<small class="catalog-earns">Earns ${money(charge)} per guest</small>`
              : '<small class="catalog-earns is-free">Free for guests</small>';
        return `
        <button class="catalog-card" data-kind="${spec.kind}">
          <span class="catalog-icon">${icon(spec.icon as Parameters<typeof icon>[0])}</span>
          <span class="catalog-copy"><strong>${spec.shortName}</strong><small>${spec.description}</small>${earns}</span>
          <span class="catalog-price">${money(spec.cost)}</span>
        </button>
      `;
      })
      .join('');
    for (const button of catalog.querySelectorAll<HTMLButtonElement>('[data-kind]')) {
      button.addEventListener('click', () => this.callbacks.onSelectPlaceable(button.dataset.kind as PlaceableKind));
    }
  }

  private categoryLabel(category: CatalogSection): string {
    if (category === 'infrastructure') return 'Paths & land';
    if (category === 'office') return 'Park office';
    return CATEGORY_LABELS[category];
  }

  /**
   * The management screen: what the park charges, and the way out.
   *
   * Prices live here rather than on each building because a price is a park
   * policy — every carousel in the park charges the same, and raising it is a
   * decision about the whole business rather than about one ride.
   */
  private renderOffice(catalog: HTMLElement): void {
    catalog.classList.remove('is-infrastructure');
    const tolerance = priceTolerance(this.reputation);
    const priceable = PLACEABLE_SPECS.filter((spec) => isPriceable(spec.kind));

    catalog.innerHTML = `
      <section class="infrastructure-section" aria-labelledby="prices-heading">
        <div class="catalog-section-heading">
          <div><span class="eyebrow">Pricing</span><h3 id="prices-heading">What the park charges</h3></div>
          <span>At reputation ${Math.round(this.reputation)}, guests pay up to <strong>${Math.round(tolerance * 100)}%</strong> of the standard price before they start walking away.</span>
        </div>
        <div class="price-list">
          ${priceable.map((spec) => this.priceRow(spec.kind)).join('')}
        </div>
        <p class="parcel-note">Raise your reputation and you can raise your prices. Charge past what your park has earned and guests refuse the queue — which lowers your reputation, and lowers what you can charge.</p>
      </section>
      <section class="infrastructure-section danger-section" aria-labelledby="startover-heading">
        <div class="catalog-section-heading">
          <div><span class="eyebrow">Danger</span><h3 id="startover-heading">Start over</h3></div>
          <span>Clears this park completely and begins a new one.</span>
        </div>
        <button class="ghost-action is-danger" id="start-over-button" type="button">Start over with a new park</button>
      </section>
    `;

    for (const button of catalog.querySelectorAll<HTMLButtonElement>('[data-price-kind]')) {
      button.addEventListener('click', () => {
        const kind = button.dataset.priceKind as PlaceableKind;
        const step = Number(button.dataset.priceStep);
        if (!kind || !Number.isFinite(step)) return;
        this.callbacks.onSetPrice(kind, priceFor(kind, this.prices) + step);
      });
    }
    this.requireElement('#start-over-button').addEventListener('click', () => this.confirmStartOver());
  }

  private priceRow(kind: PlaceableKind): string {
    const spec = PLACEABLE_SPECS.find((item) => item.kind === kind);
    if (!spec) return '';
    const price = priceFor(kind, this.prices);
    const accepted = acceptanceRate(kind, this.prices, this.reputation);
    const expected = expectedRevenuePerGuest(kind, this.prices, this.reputation);
    const share = Math.round(accepted * 100);
    const tone = share >= 100 ? 'is-valid' : share >= 50 ? 'is-warning' : 'is-invalid';
    const verdict = share >= 100
      ? 'Everyone pays this'
      : share > 0
        ? `Only ${share}% of guests will pay`
        : 'Nobody will pay this';
    const ceiling = spec.revenue * MAX_PRICE_MULTIPLE;
    // The step scales with the price so a $35 drop tower and a $19 lemonade
    // both take a sensible number of taps to move meaningfully.
    const step = Math.max(1, Math.round(spec.revenue * 0.1));

    return `
      <div class="price-row">
        <span class="catalog-icon">${icon(spec.icon as Parameters<typeof icon>[0])}</span>
        <span class="catalog-copy">
          <strong>${spec.shortName}</strong>
          <small>Standard ${money(spec.revenue)} · earning ${money(expected)} per guest</small>
          <small class="placement-validity ${tone}">${verdict}</small>
        </span>
        <span class="price-stepper">
          <button type="button" data-price-kind="${kind}" data-price-step="${-step}" aria-label="Lower the price of ${spec.shortName}" ${price <= 0 ? 'disabled' : ''}>−</button>
          <strong>${money(price)}</strong>
          <button type="button" data-price-kind="${kind}" data-price-step="${step}" aria-label="Raise the price of ${spec.shortName}" ${price >= ceiling ? 'disabled' : ''}>+</button>
        </span>
      </div>
    `;
  }

  /**
   * Two confirmations, on purpose. A park represents hours of play, and a
   * mispress that silently destroys one is the worst outcome this game has. The
   * first step spells out exactly what will be lost; the second makes the
   * player name the act with a button that says what it does.
   */
  private confirmStartOver(): void {
    const { day, cash, buildings } = this.parkSummary;
    this.showConfirm({
      heading: 'Start over?',
      body: `This park is on day ${day}, holds ${money(cash)}, and has ${buildings} ${buildings === 1 ? 'building' : 'buildings'}. Starting over clears all of it.`,
      confirmLabel: 'Continue',
      onConfirm: () => {
        this.showConfirm({
          heading: 'This cannot be undone',
          body: 'The park, its buildings, its paths, and its saved copy will be gone for good. There is no way back to it.',
          confirmLabel: 'Delete my park',
          onConfirm: () => this.callbacks.onStartOver(),
        });
      },
    });
  }

  private showConfirm(options: {
    heading: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
  }): void {
    const panel = this.requireElement('#confirm-dialog');
    this.requireElement('#confirm-heading').textContent = options.heading;
    this.requireElement('#confirm-body').textContent = options.body;

    // Replacing the buttons drops every listener from the previous step, so the
    // first confirmation can never fire the second one's action.
    const actions = this.requireElement('#confirm-actions');
    actions.innerHTML = `
      <button class="secondary-action" id="confirm-cancel" type="button">Keep my park</button>
      <button class="primary-action is-danger" id="confirm-accept" type="button">${options.confirmLabel}</button>
    `;
    panel.hidden = false;

    const close = () => {
      panel.hidden = true;
    };
    this.requireElement('#confirm-cancel').addEventListener('click', close);
    this.requireElement('#confirm-accept').addEventListener('click', () => {
      close();
      options.onConfirm();
    });
  }

  private renderInfrastructureCatalog(catalog: HTMLElement): void {
    const ownedParcels = this.parcels.filter((parcel) => parcel.owned);
    const ownedArea = ownedParcels.reduce((total, parcel) => total + parcel.area, 0);
    const availableParcels = this.parcels.filter((parcel) => parcel.status === 'available');
    const sidewalkCost = this.infrastructureCosts.construction.sidewalk;
    const roadCost = this.infrastructureCosts.construction.road;
    const demolitionCost = Math.min(
      this.infrastructureCosts.demolition.sidewalk,
      this.infrastructureCosts.demolition.road,
    );

    catalog.classList.add('is-infrastructure');
    catalog.innerHTML = `
      <section class="infrastructure-section" aria-labelledby="paths-heading">
        <div class="catalog-section-heading">
          <div><span class="eyebrow">Infrastructure</span><h3 id="paths-heading">Draw the way</h3></div>
          <span>Guests only visit places connected to the gate.</span>
        </div>
        <div class="infrastructure-tools">
          ${this.infrastructureToolCard('sidewalk', 'Sidewalk', 'Comfortable pedestrian paving', sidewalkCost)}
          ${this.infrastructureToolCard('road', 'Park road', 'A broad service and guest route', roadCost)}
          ${this.infrastructureToolCard('demolish', 'Demolish', 'Return path tiles to lawn', demolitionCost, true)}
        </div>
      </section>
      <section class="infrastructure-section land-section" aria-labelledby="land-heading">
        <div class="catalog-section-heading">
          <div><span class="eyebrow">Expansion</span><h3 id="land-heading">Grow your park</h3></div>
          <span>${ownedParcels.length} ${ownedParcels.length === 1 ? 'parcel' : 'parcels'} · ${ownedArea.toLocaleString('en-US')} m² owned</span>
        </div>
        <div class="parcel-grid">
          ${this.parcels.length > 0
            ? this.parcels.map((parcel) => this.parcelCard(parcel)).join('')
            : '<div class="parcel-empty">Expansion survey loading…</div>'}
        </div>
        ${availableParcels.length === 0 && this.parcels.length > ownedParcels.length
          ? '<p class="parcel-note">Buy an adjacent parcel to unlock the next expansion.</p>'
          : ''}
      </section>
    `;

    for (const button of catalog.querySelectorAll<HTMLButtonElement>('[data-infrastructure-tool]')) {
      button.addEventListener('click', () => {
        this.infrastructureTool = button.dataset.infrastructureTool as InfrastructureTool;
        this.callbacks.onSelectInfrastructure(this.infrastructureTool);
      });
    }
    for (const button of catalog.querySelectorAll<HTMLButtonElement>('[data-parcel-id]')) {
      button.addEventListener('click', () => {
        const parcelId = button.dataset.parcelId;
        if (parcelId) this.callbacks.onBuyParcel(parcelId);
      });
    }
  }

  private infrastructureToolCard(
    tool: InfrastructureTool,
    name: string,
    description: string,
    cost: number,
    from = false,
  ): string {
    return `
      <button class="infrastructure-card" data-infrastructure-tool="${tool}">
        <span class="infrastructure-swatch is-${tool}" aria-hidden="true"><i></i></span>
        <span class="catalog-copy"><strong>${name}</strong><small>${description}</small></span>
        <span class="catalog-price">${from ? 'from ' : ''}${money(cost)}<small>/ tile</small></span>
      </button>
    `;
  }

  private parcelCard(parcel: ParcelSnapshot): string {
    const stateLabel = parcel.owned
      ? 'Owned'
      : parcel.purchasable
        ? `Buy ${money(parcel.cost)}`
        : 'Locked';
    const note = parcel.owned
      ? `${parcel.area.toLocaleString('en-US')} m² in your park`
      : parcel.purchasable
        ? `${parcel.area.toLocaleString('en-US')} m² · adjacent land`
        : 'Expand toward this parcel to unlock it';
    return `
      <button
        class="parcel-card is-${parcel.status}"
        ${parcel.purchasable ? `data-parcel-id="${parcel.id}"` : 'disabled'}
        aria-label="${parcel.name}: ${stateLabel}"
      >
        <span class="parcel-map" aria-hidden="true"><i></i></span>
        <span class="parcel-copy"><strong>${parcel.name}</strong><small>${note}</small></span>
        <span class="parcel-state">${stateLabel}</span>
      </button>
    `;
  }

  private infrastructureReason(reason: string | null): string {
    switch (reason) {
      case 'unowned-land': return 'This tile is outside your owned land';
      case 'surface-not-lawn': return 'Build paths only on clear lawn';
      case 'surface-is-lawn': return 'Select a road or sidewalk to demolish';
      case 'out-of-bounds': return 'Keep the stroke inside the park boundary';
      case 'occupied': return 'A facility occupies part of this stroke';
      case 'entrance-required': return 'The front-gate path must stay connected';
      case 'insufficient-funds': return 'Not enough park funds';
      case 'empty-selection': return 'Drag across the park to mark tiles';
      default: return reason ?? 'This stroke cannot be applied';
    }
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
