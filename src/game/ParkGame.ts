import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ParkSimulation } from '../core/ParkSimulation';
import { ParkGrid, type CellBounds, type GridCell, type SurfaceOperationQuote } from '../core/ParkGrid';
import { totalParkAppeal, type AppealContribution } from '../core/appeal';
import { getPlaceableSpec } from '../core/catalog';
import {
  computeAwayProgress,
  createEmptyAwayProfile,
  type AwayParkProfile,
  type ServicedNeed,
} from '../core/awayReport';
import {
  PARK_SAVE_FORMAT,
  PARK_SAVE_VERSION,
  parseSave,
  serializeSave,
  type ParkSaveDocument,
} from '../core/saveGame';
import { resolveSaveBackend, type SaveBackend } from '../core/SaveStore';
import { typicalWallet } from '../core/pricing';
import type { FacilitySnapshot, GuestSnapshot, LitterSnapshot, PlacedObject, PlaceableKind } from '../core/types';
import { InputController } from '../controls/InputController';
import { cameraRelativeMovement } from '../controls/movementMath';
import { AssetFactory } from '../world/AssetFactory';
import { MaterialLibrary } from '../world/Materials';
import { GameUI } from '../ui/GameUI';
import { sampleSkyCycle } from '../world/skyCycle';
import { OVERVIEW_CAMERA_FAR, overviewCameraPose } from './cameraMath';
import {
  createFreeCameraState,
  getFreeCameraPose,
  stepFreeCamera,
  type FreeCameraState,
} from './freeCameraMath';
import { InfrastructureBuilder, type InfrastructureTool } from './InfrastructureBuilder';
import { ParkInfrastructureView } from './ParkInfrastructureView';
import { PlacementSystem, createFacingArrowGeometry } from './PlacementSystem';
import {
  INITIAL_PLACEMENT_POINTER_STATE,
  reducePlacementPointer,
  type PlacementPointerState,
} from './placementPointerState';

interface GuestVisual {
  object: Object3D;
  previousPosition: Vector3;
}

type CameraMode = 'follow' | 'overview';

/** Seconds of running simulation between background saves. */
const AUTOSAVE_INTERVAL_SECONDS = 20;

/**
 * Fraction of the build cost returned when a building is sold. Remodelling is
 * meant to be affordable but not free, so a park cannot be churned for profit.
 */
const RESALE_RATE = 0.7;

/** A press shorter and stiller than this counts as a tap, not a camera drag. */
const TAP_MAX_MOVEMENT_PX = 9;
const TAP_MAX_DURATION_MS = 350;

/** Where a building came from, so cancelling a move puts it back. */
interface MovingOrigin {
  id: string;
  kind: PlaceableKind;
  position: { x: number; z: number };
  rotation: number;
}

export class ParkGame {
  private readonly root: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(54, 1, 0.1, OVERVIEW_CAMERA_FAR);
  private readonly fog = new FogExp2(0xa8c8c0, 0.013);
  private readonly world = new Group();
  private readonly dynamicLayer = new Group();
  private readonly materials: MaterialLibrary;
  private readonly assets: AssetFactory;
  private readonly simulation = new ParkSimulation();
  private readonly parkGrid = new ParkGrid();
  private readonly input: InputController;
  private readonly ui: GameUI;
  private readonly placement: PlacementSystem;
  private readonly infrastructureBuilder = new InfrastructureBuilder();
  private readonly infrastructureView: ParkInfrastructureView;
  private readonly clock = new Clock();
  private readonly placedObjects: PlacedObject[] = [];
  private readonly guestVisuals = new Map<string, GuestVisual>();
  private readonly litterVisuals = new Map<string, Object3D>();
  private readonly player: Object3D;
  private readonly playerPosition = new Vector3(0, 0, 18.5);
  private readonly cameraTarget = new Vector3();
  private readonly cameraTargetDesired = new Vector3();
  private readonly cameraDesired = new Vector3();
  private readonly moveDirection = new Vector3();
  private readonly buildPointer = new Vector2();
  private readonly buildRaycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly groundHit = new Vector3();
  private readonly unregisterSimulation: () => void;
  private sun!: DirectionalLight;
  private ambient!: AmbientLight;
  private readonly skyColor = new Color();
  private lastSkyMinute = Number.NaN;
  private animationFrame = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.44;
  private cameraDistance = 8.2;
  private freeCamera: FreeCameraState = createFreeCameraState();
  private running = false;
  private started = false;
  private mode: 'explore' | 'build' | 'placing' | 'surface' | 'inspect' = 'explore';
  private cameraMode: CameraMode = 'follow';
  private activePlaceable: PlaceableKind | null = null;
  private drawingSurface = false;
  private placementPointer: PlacementPointerState = { ...INITIAL_PLACEMENT_POINTER_STATE };
  private lastStatsUiUpdate = 0;
  private isPaused = false;
  private readonly saveBackend: SaveBackend;
  private parkName = 'My Park';
  private autosaveCountdown = AUTOSAVE_INTERVAL_SECONDS;
  private savePending = false;
  private saveInFlight = false;
  private pendingSave: ParkSaveDocument | null = null;
  private selectedId: string | null = null;
  private movingOrigin: MovingOrigin | null = null;
  private readonly selectionMarker = new Group();
  private readonly selectionPad: Mesh;
  private readonly selectionArrow: Mesh;
  private tapCandidate: { x: number; y: number; time: number } | null = null;
  private readonly guestRenderBudget: number;

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = true;
    this.root.append(this.renderer.domElement);

    const touchStick = document.createElement('div');
    touchStick.id = 'joystick-bootstrap';
    touchStick.hidden = true;
    this.root.append(touchStick);

    this.materials = new MaterialLibrary({
      renderer: this.renderer,
      textureAssetBaseUrl: `${import.meta.env.BASE_URL}assets/textures`,
    });
    const mobileQuality =
      window.matchMedia('(pointer: coarse)').matches ||
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    this.assets = new AssetFactory({ materials: this.materials, quality: mobileQuality ? 'mobile' : 'high' });
    // The phone budget from docs/DESIGN.md, now a drawing limit rather than a
    // limit on how many guests the park may have.
    this.guestRenderBudget = mobileQuality ? 42 : 90;
    this.infrastructureView = new ParkInfrastructureView(this.materials);
    this.player = this.assets.createPlayer();
    this.root.dataset.playerX = this.playerPosition.x.toFixed(3);
    this.root.dataset.playerZ = this.playerPosition.z.toFixed(3);

    // Bright enough to read against grass, but still translucent so the
    // building it belongs to stays the thing you are looking at.
    this.selectionPad = new Mesh(
      new BoxGeometry(1, 0.05, 1),
      new MeshBasicMaterial({ color: 0x8af0c4, transparent: true, opacity: 0.5, depthWrite: false, fog: false }),
    );
    this.selectionArrow = new Mesh(
      createFacingArrowGeometry(),
      new MeshBasicMaterial({
        color: 0x8af0c4,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.selectionArrow.renderOrder = 6;
    this.selectionMarker.add(this.selectionPad, this.selectionArrow);
    this.selectionMarker.visible = false;
    this.saveBackend = resolveSaveBackend();
    this.ui = new GameUI(this.root, {
      onStart: () => this.openGates(),
      onContinue: () => this.resumeSavedPark(),
      onNewPark: () => this.discardSavedPark(),
      onToggleBuild: () => this.toggleBuildMode(),
      onSelectPlaceable: (kind) => this.beginPlacement(kind),
      onSelectInfrastructure: (tool) => this.beginInfrastructure(tool),
      onBuyParcel: (parcelId) => this.buyParcel(parcelId),
      onRotate: () => this.rotatePlacement(),
      onNudge: (screenX, screenZ) => this.nudgePlacement(screenX, screenZ),
      onConfirm: () => this.confirmBuild(),
      onCancel: () => this.cancelBuild(),
      onMoveSelected: () => this.moveSelected(),
      onRotateSelected: () => this.rotateSelected(),
      onSellSelected: () => this.sellSelected(),
      onCloseInspector: () => this.closeInspector(),
      onPause: () => this.togglePause(),
      onToggleCamera: () => this.toggleCameraMode(),
      onReframeCamera: () => this.reframeFreeCamera(),
      onSetPrice: (kind, price) => this.setPrice(kind, price),
      onStartOver: () => void this.startOver(),
    });

    const joystick = this.requireElement('#movement-joystick');
    this.input = new InputController(this.renderer.domElement, joystick);
    touchStick.remove();

    this.placement = new PlacementSystem(this.world, this.assets, {
      onPreviewChanged: (validation) => {
        if (this.activePlaceable) this.ui.setPlacement(this.activePlaceable, validation);
      },
      onPlaced: ({ placed }) => this.onPlaced(placed),
      onCancelled: () => this.exitPlacement(),
      validatePlacement: (spec, position, rotation) =>
        this.validateFacilityPlacement(spec.footprint, spec.serviceNeed !== null, position, rotation),
    });

    this.unregisterSimulation = this.simulation.subscribe((event) => this.ui.handleEvent(event));
    this.setupScene();
    this.refreshInfrastructure();
    this.seedStarterPark();
    this.bindEvents();
    this.resize();
    this.ui.updateStats(this.simulation.getStats());
    this.ui.updateInfrastructure(this.parkGrid.getParcelSnapshots(), this.parkGrid.getCosts());
  }

  /**
   * Looks for a saved park and offers to resume it. Runs after construction so
   * a slow or asynchronous store (Heartbeat's cloud save) never blocks the first
   * frame; the splash is already on screen while this resolves.
   */
  async initialize(): Promise<void> {
    let text: string | null = null;
    try {
      text = await this.saveBackend.load();
    } catch {
      text = null;
    }
    if (!text) return;

    const { save, warnings } = parseSave(text);
    if (!save) {
      // A save we cannot read is worse than none: clear it so the player is not
      // offered a Continue button that can never work.
      await this.saveBackend.clear().catch(() => {});
      if (warnings[0]) this.ui.toast(warnings[0], 'warning');
      return;
    }

    this.pendingSave = save;
    this.ui.showResumeOption({
      parkName: save.parkName,
      day: save.simulation.stats?.day ?? 1,
      cash: save.simulation.stats?.cash ?? 0,
      buildings: save.buildings.length,
      storageLabel: this.saveBackend.label,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  /**
   * Development only — see the `import.meta.env.DEV` block in `main.ts`. Moves
   * the clock and repaints the sky immediately, so a check does not have to wait
   * for the next animation frame, which a background tab will never deliver.
   */
  debugSetClock(minuteOfDay: number): void {
    this.simulation.debugSetClock(minuteOfDay);
    const now = this.simulation.getStats().minuteOfDay;
    this.applySkyCycle(now, true);
    this.ui.updateStats(this.simulation.getStats());
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.unregisterSimulation();
    this.input.dispose();
    this.ui.dispose();
    this.placement.dispose();
    this.infrastructureView.dispose();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pagehide', this.saveBeforeHidden);
    document.removeEventListener('visibilitychange', this.saveBeforeHidden);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerUp);
    this.renderer.domElement.removeEventListener('contextmenu', this.preventContextMenu);
    this.assets.dispose?.();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private setupScene(): void {
    this.scene.background = new Color(0x9fc2be);
    this.scene.fog = this.fog;
    this.scene.add(this.world);
    this.world.add(this.dynamicLayer);

    const landscape = this.assets.createLandscape({ includePromenade: false });
    this.world.add(landscape);
    this.world.add(this.infrastructureView.object);
    const gate = this.assets.createParkGate();
    gate.position.set(0, 0, 29.2);
    this.world.add(gate);

    this.player.position.copy(this.playerPosition);
    this.dynamicLayer.add(this.player);
    this.world.add(this.selectionMarker);

    const ambient = new AmbientLight(0xaaccc5, 1.18);
    this.ambient = ambient;
    this.scene.add(ambient);
    const sun = new DirectionalLight(0xffe7bd, 3.25);
    this.sun = sun;
    sun.position.set(-24, 36, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -42;
    sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 42;
    sun.shadow.camera.bottom = -42;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    this.applySkyCycle(this.simulation.getStats().minuteOfDay, true);
    this.camera.position.set(7, 5.4, 35);
    this.cameraTarget.copy(this.playerPosition).add(new Vector3(0, 1.25, 0));
    this.cameraTargetDesired.copy(this.cameraTarget);
    this.camera.lookAt(this.cameraTarget);
  }

  /**
   * Selects an already-placed building so it can be turned, moved, or sold.
   * Remodelling matters more than it looks: a park that cannot be edited is a
   * park where one misplaced ride is permanent.
   */
  private selectPlaced(placed: PlacedObject): void {
    this.selectedId = placed.id;
    this.mode = 'inspect';
    this.ui.setMode('inspect');
    this.applyInputState();
    this.infrastructureView.setLandMode(false);
    this.applySimulationState();
    this.updateSelectionMarker();
    this.refreshInspector();
  }

  private closeInspector(): void {
    this.selectedId = null;
    this.selectionMarker.visible = false;
    this.mode = 'explore';
    this.ui.setMode('explore');
    this.applyInputState();
    this.applySimulationState();
  }

  private getSelected(): PlacedObject | null {
    if (!this.selectedId) return null;
    return this.placedObjects.find((placed) => placed.id === this.selectedId) ?? null;
  }

  private refreshInspector(): void {
    const selected = this.getSelected();
    if (!selected) return;
    const connected =
      selected.spec.serviceNeed === null || selected.object.userData.connected !== false;
    const detail = selected.spec.serviceNeed === null
      ? `Upkeep ${selected.spec.upkeep}/cycle`
      : connected
        ? `Open · queue ${selected.queueLength} · upkeep ${selected.spec.upkeep}/cycle`
        : 'No path reaches this yet';
    this.ui.setInspector({
      name: selected.spec.name,
      detail,
      tone: connected ? 'positive' : 'warning',
      resale: Math.round(selected.spec.cost * RESALE_RATE),
      price: this.simulation.getPrice(selected.spec.kind),
    });
  }

  /** Applies a price change, then re-renders everything that quotes a price. */
  private setPrice(kind: PlaceableKind, price: number): void {
    const applied = this.simulation.setPrice(kind, price);
    this.refreshPricing();
    this.refreshInspector();
    this.ui.toast(
      applied > 0
        ? `${getPlaceableSpec(kind).shortName} now ${applied.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} per guest`
        : `${getPlaceableSpec(kind).shortName} is now free`,
      'neutral',
    );
    this.requestSave();
  }

  private refreshPricing(): void {
    const stats = this.simulation.getStats();
    this.ui.updatePricing(this.simulation.getPrices(), stats.reputation, {
      day: stats.day,
      cash: stats.cash,
      buildings: this.placedObjects.length,
    });
  }

  /**
   * Abandons the park and returns to the splash, as if the game had never been
   * played on this device. The UI has already asked twice by the time this runs.
   *
   * The saved copy goes first. If the page were reloaded between clearing the
   * world and clearing the store, a cleared store means a clean start, whereas
   * a surviving save would resurrect the park the player just chose to destroy.
   */
  private async startOver(): Promise<void> {
    this.started = false;
    this.applySimulationState();
    await this.saveBackend.clear().catch(() => {});
    window.location.reload();
  }

  /**
   * Highlights the selection and shows which way it faces. The whole marker is
   * rotated with the building, so the arrow uses the unrotated footprint and
   * still lands in front — the same trick the placement preview uses.
   */
  private updateSelectionMarker(): void {
    const selected = this.getSelected();
    if (!selected) {
      this.selectionMarker.visible = false;
      return;
    }
    const [footprintX, footprintZ] = selected.spec.footprint;
    this.selectionPad.scale.set(footprintX + 0.6, 1, footprintZ + 0.6);
    const arrowScale = Math.min(2.4, Math.max(1, Math.min(footprintX, footprintZ) * 0.34));
    this.selectionArrow.scale.setScalar(arrowScale);
    this.selectionArrow.position.set(0, 0.12, footprintZ / 2 + 0.55 + arrowScale * 0.6);
    this.selectionMarker.position.set(selected.position.x, 0.06, selected.position.z);
    this.selectionMarker.rotation.y = selected.rotation;
    this.selectionMarker.visible = true;
  }

  /** Turns a placed building a quarter turn, reverting if it no longer fits. */
  private rotateSelected(): void {
    const selected = this.getSelected();
    if (!selected) return;
    const previous = selected.rotation;
    const next = (previous + Math.PI / 2) % (Math.PI * 2);
    const others = this.placedObjects.filter((placed) => placed.id !== selected.id);
    if (!this.canOccupy(selected.spec, selected.position, next, others)) {
      this.ui.toast('No room to turn it there', 'warning');
      return;
    }
    selected.rotation = next;
    selected.object.rotation.y = next;
    this.syncFacilities();
    this.updateSelectionMarker();
    this.refreshInspector();
    this.requestSave();
  }

  /** Lifts a building back into the placement flow, keeping its facing. */
  private moveSelected(): void {
    const selected = this.getSelected();
    if (!selected) return;
    this.movingOrigin = {
      id: selected.id,
      kind: selected.spec.kind,
      position: { ...selected.position },
      rotation: selected.rotation,
    };
    this.removePlaced(selected);
    this.selectedId = null;
    this.selectionMarker.visible = false;

    this.activePlaceable = selected.spec.kind;
    this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'begin' }).state;
    this.mode = 'placing';
    this.applyInputState();
    this.infrastructureView.setLandMode(false);
    this.ui.setMode('placing');
    this.applySimulationState();
    this.placement.begin(selected.spec.kind, selected.rotation);
    this.placement.updatePointer(
      window.innerWidth / 2,
      window.innerHeight / 2,
      this.camera,
      this.placedObjects,
    );
    this.exposePlacementPointerState();
    this.ui.toast('Pick a new spot, or cancel to put it back', 'neutral');
  }

  private sellSelected(): void {
    const selected = this.getSelected();
    if (!selected) return;
    const resale = Math.round(selected.spec.cost * RESALE_RATE);
    this.removePlaced(selected);
    this.simulation.refundExpense(resale);
    this.closeInspector();
    this.syncFacilities();
    this.ui.updateStats(this.simulation.getStats());
    this.ui.toast(`${selected.spec.shortName} sold for $${resale.toLocaleString('en-US')}`, 'positive');
    this.requestSave();
  }

  private removePlaced(placed: PlacedObject): void {
    const index = this.placedObjects.indexOf(placed);
    if (index >= 0) this.placedObjects.splice(index, 1);
    placed.object.removeFromParent();
  }

  /** Footprint, land, and surface check used when editing something in place. */
  private canOccupy(
    spec: PlacedObject['spec'],
    position: { x: number; z: number },
    rotation: number,
    others: readonly PlacedObject[],
  ): boolean {
    const bounds = this.footprintBounds(position, spec.footprint, rotation);
    const cells = this.cellsInFootprint(bounds);
    if (!cells.every((cell) => this.parkGrid.isOwned(cell))) return false;
    if (!cells.every((cell) => this.parkGrid.getSurface(cell) === 'lawn')) return false;
    return others.every((other) => {
      const otherBounds = this.footprintBounds(other.position, other.spec.footprint, other.rotation);
      return (
        bounds.minX > otherBounds.maxX ||
        bounds.maxX < otherBounds.minX ||
        bounds.minZ > otherBounds.maxZ ||
        bounds.maxZ < otherBounds.minZ
      );
    });
  }

  /** Returns the placed building under a screen point, if any. */
  private pickPlaced(clientX: number, clientY: number): PlacedObject | null {
    this.buildPointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.buildPointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.buildRaycaster.setFromCamera(this.buildPointer, this.camera);
    const hits = this.buildRaycaster.intersectObjects(
      this.placedObjects.map((placed) => placed.object),
      true,
    );
    const hit = hits[0];
    if (!hit) return null;
    return (
      this.placedObjects.find((placed) => {
        let node: Object3D | null = hit.object;
        while (node) {
          if (node === placed.object) return true;
          node = node.parent;
        }
        return false;
      }) ?? null
    );
  }

  private seedStarterPark(): void {
    this.addFreePlaceable('park-lamp', { x: -3.7, z: 21.5 }, 0);
    this.addFreePlaceable('park-lamp', { x: 3.7, z: 21.5 }, Math.PI);
    this.addFreePlaceable('bench', { x: -4.7, z: 15 }, Math.PI / 2);
    this.addFreePlaceable('trash-bin', { x: 3.2, z: 14.8 }, 0);
    this.addFreePlaceable('shade-tree', { x: -9, z: 17 }, 0);
    this.addFreePlaceable('shade-tree', { x: 10, z: 18 }, 0);
    this.syncFacilities();
  }

  private addFreePlaceable(kind: PlaceableKind, position: { x: number; z: number }, rotation: number): void {
    const spec = this.getSpec(kind);
    const object = this.assets.createPlaceable(kind);
    object.position.set(position.x, 0, position.z);
    object.rotation.y = rotation;
    this.world.add(object);
    this.placedObjects.push({
      id: `starter-${kind}-${this.placedObjects.length + 1}`,
      spec,
      position: { ...position },
      rotation,
      object,
      queueLength: 0,
      activeUsers: 0,
    });
  }

  private openGates(): void {
    this.started = true;
    this.applySimulationState();
    this.ui.toast('The park is open', 'positive');
    this.requestSave();
  }

  /** Rebuilds the saved park, then reports what happened while the player was gone. */
  private resumeSavedPark(): void {
    const save = this.pendingSave;
    this.pendingSave = null;
    if (!save) {
      this.openGates();
      return;
    }

    this.applySave(save);
    this.started = save.started;

    const elapsedSeconds = save.savedAt > 0 ? (Date.now() - save.savedAt) / 1000 : 0;
    if (this.started && elapsedSeconds > 0) {
      const report = computeAwayProgress(
        this.simulation.getStats(),
        this.buildAwayProfile(),
        elapsedSeconds,
        this.simulation.getLitter().length,
      );
      if (report) {
        const reputationBefore = this.simulation.getStats().reputation;
        this.simulation.applyAwayProgress(report);
        this.ui.showAwayReport(report, reputationBefore);
      }
    }

    if (!this.started) this.started = true;
    this.applySimulationState();
    this.ui.updateStats(this.simulation.getStats());
    this.requestSave();
  }

  /** Throws away the stored park and returns the splash to its first-run state. */
  private discardSavedPark(): void {
    this.pendingSave = null;
    void this.saveBackend.clear().catch(() => {});
    this.ui.showFreshStart();
    this.ui.toast('Saved park cleared', 'neutral');
  }

  private applySave(save: ParkSaveDocument): void {
    if (!this.parkGrid.loadSaveState(save.grid)) {
      this.ui.toast('That park did not fit this map — starting fresh', 'warning');
      return;
    }

    this.parkName = save.parkName;
    this.clearPlacedObjects();
    for (const building of save.buildings) {
      this.addSavedPlaceable(building.id, building.kind, { x: building.x, z: building.z }, building.rotation);
    }

    this.simulation.loadSaveState(save.simulation);
    this.playerPosition.set(save.player.x, 0, save.player.z);
    this.player.position.copy(this.playerPosition);
    this.root.dataset.playerX = this.playerPosition.x.toFixed(3);
    this.root.dataset.playerZ = this.playerPosition.z.toFixed(3);

    this.placement.reserveIds(this.placedObjects.map((placed) => placed.id));
    this.refreshInfrastructure();
    this.syncFacilities();
    this.syncLitterVisuals(this.simulation.getLitter());
  }

  private clearPlacedObjects(): void {
    for (const placed of this.placedObjects) {
      placed.object.removeFromParent();
    }
    this.placedObjects.length = 0;
  }

  private addSavedPlaceable(
    id: string,
    kind: PlaceableKind,
    position: { x: number; z: number },
    rotation: number,
  ): void {
    const spec = this.getSpec(kind);
    const object = this.assets.createPlaceable(kind);
    object.position.set(position.x, 0, position.z);
    object.rotation.y = rotation;
    this.world.add(object);
    this.placedObjects.push({
      id,
      spec,
      position: { ...position },
      rotation,
      object,
      queueLength: 0,
      activeUsers: 0,
    });
  }

  private captureSave(): ParkSaveDocument {
    return {
      format: PARK_SAVE_FORMAT,
      version: PARK_SAVE_VERSION,
      savedAt: Date.now(),
      parkName: this.parkName,
      started: this.started,
      grid: this.parkGrid.getSaveState(),
      simulation: this.simulation.getSaveState(),
      buildings: this.placedObjects.map((placed) => ({
        id: placed.id,
        kind: placed.spec.kind,
        x: placed.position.x,
        z: placed.position.z,
        rotation: placed.rotation,
      })),
      player: { x: this.playerPosition.x, z: this.playerPosition.z },
    };
  }

  /**
   * Marks the park dirty. Writes are coalesced so a burst of construction does
   * not hammer the store, and never overlap so a slow cloud write cannot
   * interleave two versions of the same park.
   */
  private requestSave(): void {
    this.savePending = true;
    this.autosaveCountdown = AUTOSAVE_INTERVAL_SECONDS;
    void this.flushSave();
  }

  private async flushSave(): Promise<void> {
    if (!this.savePending || this.saveInFlight) return;
    this.savePending = false;
    this.saveInFlight = true;
    try {
      await this.saveBackend.save(serializeSave(this.captureSave()));
    } catch {
      // A failed write is not worth interrupting play for; the next autosave
      // tick will try again with fresher state anyway.
      this.savePending = true;
    } finally {
      this.saveInFlight = false;
    }
  }

  /**
   * Describes the park to the offline projection: how much appeal draws guests,
   * what upkeep costs, and what each need's facilities can actually serve.
   * Only connected facilities count, exactly as in the live simulation.
   */
  private buildAwayProfile(): AwayParkProfile {
    const profile = createEmptyAwayProfile();
    profile.walletPerGuest = typicalWallet(this.simulation.getStats().reputation);
    const revenueWeighted: Record<ServicedNeed, number> = { hunger: 0, fun: 0, bladder: 0, rest: 0 };
    const acceptanceWeighted: Record<ServicedNeed, number> = { hunger: 0, fun: 0, bladder: 0, rest: 0 };
    const contributions: AppealContribution[] = this.placedObjects.map((placed) => ({
      spec: placed.spec,
      position: placed.position,
      connected: placed.spec.serviceNeed === null || placed.object.userData.connected !== false,
    }));
    // The same total the live spawner uses, from the same function, so an
    // absence draws the crowd the park was drawing when the player closed it.
    profile.appeal = totalParkAppeal(contributions);

    for (const [index, placed] of this.placedObjects.entries()) {
      const spec = placed.spec;
      profile.upkeepPerCycle += spec.upkeep;

      if (!contributions[index]?.connected) continue;

      if (spec.serviceNeed === 'trash') profile.binCount += 1;
      if (spec.category === 'food') profile.foodCount += 1;

      const need = spec.serviceNeed;
      if (need === null || need === 'trash' || need === 'information' || need === 'cash') continue;
      if (spec.serviceSeconds <= 0 || spec.capacity <= 0) continue;

      const throughput = spec.capacity / spec.serviceSeconds;
      profile.needs[need].throughput += throughput;
      // Prices, not spec sheets: a park left with the carousel at triple rate
      // must earn triple rate offline too, and lose the guests that costs.
      revenueWeighted[need] += throughput * this.simulation.getPrice(spec.kind);
      acceptanceWeighted[need] += throughput * this.simulation.getAcceptanceRate(spec.kind);
    }

    for (const need of Object.keys(profile.needs) as ServicedNeed[]) {
      const throughput = profile.needs[need].throughput;
      profile.needs[need].revenuePerService = throughput > 0 ? revenueWeighted[need] / throughput : 0;
      profile.needs[need].acceptance = throughput > 0 ? acceptanceWeighted[need] / throughput : 1;
    }
    return profile;
  }

  private toggleBuildMode(): void {
    if (this.mode === 'placing') {
      this.cancelPlacement();
      return;
    }
    if (this.mode === 'surface') {
      this.cancelInfrastructure(false);
      this.mode = 'explore';
      this.ui.setMode('explore');
      this.applyInputState();
      this.infrastructureView.setLandMode(false);
      this.applySimulationState();
      return;
    }
    this.mode = this.mode === 'build' ? 'explore' : 'build';
    this.ui.setMode(this.mode);
    this.applyInputState();
    this.infrastructureView.setLandMode(this.mode === 'build');
    this.applySimulationState();
  }

  private beginPlacement(kind: PlaceableKind): void {
    if (!this.simulation.purchase(kind)) return;
    this.activePlaceable = kind;
    this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'begin' }).state;
    this.mode = 'placing';
    this.applyInputState();
    this.infrastructureView.setLandMode(false);
    this.ui.setMode('placing');
    this.applySimulationState();
    this.placement.begin(kind);
    this.placement.updatePointer(window.innerWidth / 2, window.innerHeight / 2, this.camera, this.placedObjects);
    this.exposePlacementPointerState();
  }

  /**
   * Steps the preview one metre in a screen direction. The buttons read as
   * up/down/left/right on the pad, so they are mapped through the camera's
   * heading to the nearest world axis — pressing "up" always moves the building
   * away from you, whichever way the free camera happens to be facing.
   */
  private nudgePlacement(screenX: number, screenZ: number): void {
    if (this.mode !== 'placing') return;
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new Vector3(-forward.z, 0, forward.x);

    const axis = (vector: Vector3): { x: number; z: number } =>
      Math.abs(vector.x) >= Math.abs(vector.z)
        ? { x: Math.sign(vector.x), z: 0 }
        : { x: 0, z: Math.sign(vector.z) };

    // Screen "up" is away from the camera, which is +forward.
    const forwardAxis = axis(forward);
    const rightAxis = axis(right);
    const deltaX = forwardAxis.x * -screenZ + rightAxis.x * screenX;
    const deltaZ = forwardAxis.z * -screenZ + rightAxis.z * screenX;
    if (deltaX === 0 && deltaZ === 0) return;

    this.placement.nudge(deltaX, deltaZ, this.placedObjects);
    this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'confirm' }).state;
    this.exposePlacementPointerState();
  }

  private rotatePlacement(): void {
    this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'rotate' }).state;
    this.placement.rotate(this.placedObjects);
  }

  private confirmPlacement(): void {
    const result = this.placement.confirm(this.placedObjects);
    if (result) {
      this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'confirm' }).state;
      this.exposePlacementPointerState();
    }
    if (!result) this.ui.toast('That plot is blocked', 'warning');
  }

  private confirmBuild(): void {
    if (this.mode === 'surface') this.confirmInfrastructure();
    else this.confirmPlacement();
  }

  private cancelBuild(): void {
    if (this.mode === 'surface') this.cancelInfrastructure();
    else this.cancelPlacement();
  }

  private cancelPlacement(): void {
    const moving = this.movingOrigin;
    if (moving) {
      // A cancelled move is not a refund: the building was never re-bought, so
      // it simply goes back where it stood.
      this.movingOrigin = null;
      this.addSavedPlaceable(moving.id, moving.kind, moving.position, moving.rotation);
      this.placement.cancel(false);
      this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'cancel' }).state;
      this.syncFacilities();
      this.exitPlacement();
      this.ui.toast('Move cancelled', 'neutral');
      return;
    }
    if (this.activePlaceable) this.simulation.refund(this.activePlaceable);
    this.placement.cancel(false);
    this.placementPointer = reducePlacementPointer(this.placementPointer, { type: 'cancel' }).state;
    this.exitPlacement();
  }

  private exitPlacement(): void {
    this.activePlaceable = null;
    this.exposePlacementPointerState();
    this.mode = 'build';
    this.ui.setMode('build');
    this.applyInputState();
    this.infrastructureView.setLandMode(true);
    this.applySimulationState();
  }

  private beginInfrastructure(tool: InfrastructureTool): void {
    this.activePlaceable = null;
    this.infrastructureBuilder.begin(tool);
    this.mode = 'surface';
    this.drawingSurface = false;
    this.applyInputState();
    this.infrastructureView.setLandMode(false);
    this.ui.setMode('surface');
    this.updateInfrastructureQuote();
    this.applySimulationState();
  }

  private cancelInfrastructure(returnToBuild = true): void {
    this.infrastructureBuilder.cancel();
    this.infrastructureView.clearPreview();
    this.drawingSurface = false;
    if (!returnToBuild) return;
    this.mode = 'build';
    this.ui.setMode('build');
    this.applyInputState();
    this.infrastructureView.setLandMode(true);
    this.applySimulationState();
  }

  private confirmInfrastructure(): void {
    const tool = this.infrastructureBuilder.tool;
    if (!tool) return;
    const { cells, quote, valid, reason } = this.infrastructureQuote();
    if (!valid) {
      this.ui.toast(reason === 'insufficient-funds' ? 'Not enough park funds' : 'Adjust that stroke', 'warning');
      return;
    }
    if (!this.simulation.spend(quote.cost)) return;
    const result = tool === 'demolish'
      ? this.parkGrid.demolish(cells)
      : this.parkGrid.construct(cells, tool);
    if (!result.applied) {
      this.simulation.refundExpense(quote.cost);
      this.ui.toast('The park changed — draw that stroke again', 'warning');
      this.updateInfrastructureQuote();
      return;
    }

    this.infrastructureBuilder.clear();
    this.refreshInfrastructure();
    this.syncFacilities();
    this.updateInfrastructureQuote();
    this.requestSave();
    this.ui.toast(
      tool === 'demolish'
        ? `${result.cellCount} path ${result.cellCount === 1 ? 'tile' : 'tiles'} removed`
        : `${result.cellCount} ${tool === 'road' ? 'road' : 'sidewalk'} ${result.cellCount === 1 ? 'tile' : 'tiles'} built`,
      'positive',
    );
  }

  private buyParcel(parcelId: string): void {
    const quote = this.parkGrid.quoteParcelPurchase(parcelId);
    if (!quote.valid) {
      this.ui.toast('That parcel is not available yet', 'warning');
      return;
    }
    if (!this.simulation.spend(quote.cost)) return;
    const result = this.parkGrid.purchaseParcel(parcelId);
    if (!result.purchased) {
      this.simulation.refundExpense(quote.cost);
      return;
    }
    this.refreshInfrastructure();
    this.infrastructureView.setLandMode(this.mode === 'build');
    this.requestSave();
    const parcel = this.parkGrid.getParcelSnapshot(parcelId);
    this.ui.toast(`${parcel?.name ?? 'Land'} added to your park`, 'positive');
  }

  private infrastructureQuote(): {
    cells: readonly GridCell[];
    quote: SurfaceOperationQuote;
    valid: boolean;
    reason: string | null;
  } {
    const tool = this.infrastructureBuilder.tool;
    const rawCells = this.infrastructureBuilder.cells;
    if (!tool) {
      const quote = this.parkGrid.quoteConstruction([], 'sidewalk');
      return { cells: [], quote, valid: false, reason: quote.reason };
    }
    const cells = rawCells.filter((cell) => tool === 'demolish'
      ? this.parkGrid.getSurface(cell) !== 'lawn'
      : this.parkGrid.getSurface(cell) === 'lawn');
    const occupied = tool !== 'demolish' && cells.some((cell) => this.isCellInsideFacility(cell));
    const entrance = this.parkGrid.getEntranceCell();
    const removesEntrance = tool === 'demolish' && cells.some(
      (cell) => cell.x === entrance.x && cell.z === entrance.z,
    );
    const quote = tool === 'demolish'
      ? this.parkGrid.quoteDemolition(cells)
      : this.parkGrid.quoteConstruction(cells, tool);
    const affordable = this.simulation.getStats().cash >= quote.cost;
    const valid = quote.valid && !occupied && !removesEntrance && affordable;
    return {
      cells,
      quote,
      valid,
      reason: occupied
        ? 'occupied'
        : removesEntrance
          ? 'entrance-required'
          : !affordable && quote.valid
            ? 'insufficient-funds'
            : quote.reason,
    };
  }

  private updateInfrastructureQuote(): void {
    const tool = this.infrastructureBuilder.tool;
    if (!tool) return;
    const { cells, quote, valid, reason } = this.infrastructureQuote();
    this.infrastructureView.setPreview(cells, tool, valid);
    this.ui.setInfrastructureStroke(tool, cells.length, quote.cost, valid, reason);
  }

  private isCellInsideFacility(cell: GridCell): boolean {
    return this.placedObjects.some((placed) => {
      const bounds = this.footprintBounds(placed.position, placed.spec.footprint, placed.rotation);
      return cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.z >= bounds.minZ && cell.z <= bounds.maxZ;
    });
  }

  private onPlaced(placed: PlacedObject): void {
    if (this.movingOrigin) {
      placed.id = this.movingOrigin.id;
      this.movingOrigin = null;
    }
    this.placedObjects.push(placed);
    this.syncFacilities();
    this.activePlaceable = null;
    this.mode = 'explore';
    this.ui.setMode('explore');
    this.applyInputState();
    this.infrastructureView.setLandMode(false);
    this.applySimulationState();
    this.requestSave();
    const connected = placed.spec.serviceNeed === null || placed.object.userData.connected !== false;
    this.ui.toast(
      connected ? `${placed.spec.shortName} opened` : `${placed.spec.shortName} needs a connected path`,
      connected ? 'positive' : 'warning',
    );
  }

  private syncFacilities(): void {
    const connectivityById = new Map<string, ReturnType<ParkGrid['getFacilityConnectivity']>>();
    const snapshots: FacilitySnapshot[] = this.placedObjects
      .filter((placed) => placed.spec.serviceNeed !== null)
      .map((placed) => {
        const bounds = this.footprintBounds(placed.position, placed.spec.footprint, placed.rotation);
        const connectivity = this.parkGrid.getFacilityConnectivity(this.parkGrid.getApproachCells(bounds));
        connectivityById.set(placed.id, connectivity);
        placed.object.userData.connected = connectivity.connected;
        return {
          id: placed.id,
          kind: placed.spec.kind,
          position: { ...placed.position },
          rotation: placed.rotation,
          queueLength: placed.queueLength,
          activeUsers: placed.activeUsers,
          enabled: connectivity.connected,
          accessPoint: connectivity.approachCell
            ? this.parkGrid.cellToWorld(connectivity.approachCell) ?? undefined
            : undefined,
        };
      });
    this.simulation.setFacilities(snapshots);
    const appeal = totalParkAppeal(
      this.placedObjects.map((placed) => ({
        spec: placed.spec,
        position: placed.position,
        connected:
          placed.spec.serviceNeed === null || connectivityById.get(placed.id)?.connected === true,
      })),
    );
    const upkeep = this.placedObjects.reduce((total, placed) => total + placed.spec.upkeep, 0);
    this.simulation.setParkMetrics(appeal, upkeep);
  }

  private refreshInfrastructure(): void {
    const snapshot = this.parkGrid.getSnapshot();
    this.infrastructureView.update(snapshot);
    const destinations = this.parkGrid.getReachableCells().map((cell) => ({ ...cell }));
    this.simulation.setNavigationNetwork({
      destinations,
      findPath: (start, destination) => {
        const startCell = this.parkGrid.worldToCell(start.x, start.z);
        const destinationCell = this.parkGrid.worldToCell(destination.x, destination.z);
        if (!startCell || !destinationCell) return null;
        return this.parkGrid.findRoute(startCell, destinationCell)?.map((cell) => ({ ...cell })) ?? null;
      },
    });
    this.ui?.updateInfrastructure(this.parkGrid.getParcelSnapshots(), this.parkGrid.getCosts());
  }

  private validateFacilityPlacement(
    footprint: readonly [number, number],
    needsPath: boolean,
    position: { x: number; z: number },
    rotation: number,
  ) {
    const bounds = this.footprintBounds(position, footprint, rotation);
    const occupiedCells = this.cellsInFootprint(bounds);
    const insideOwnedLand = occupiedCells.every((cell) => this.parkGrid.isOwned(cell));
    if (!insideOwnedLand) {
      return { valid: false, connected: false, message: 'Purchase this land before building here' };
    }
    const clearLawn = occupiedCells.every((cell) => this.parkGrid.getSurface(cell) === 'lawn');
    if (!clearLawn) {
      return { valid: false, connected: false, message: 'Move the building off roads and sidewalks' };
    }
    if (!needsPath) return { valid: true, connected: true, message: 'Clear to build' };
    const connectivity = this.parkGrid.getFacilityConnectivity(this.parkGrid.getApproachCells(bounds));
    return {
      valid: true,
      connected: connectivity.connected,
      message: connectivity.connected ? 'Connected to the entrance' : 'No route yet',
    };
  }

  private footprintBounds(
    position: { x: number; z: number },
    footprint: readonly [number, number],
    rotation: number,
  ): CellBounds {
    const quarterTurn = Math.abs(Math.round(rotation / (Math.PI / 2))) % 2 === 1;
    const width = quarterTurn ? footprint[1] : footprint[0];
    const depth = quarterTurn ? footprint[0] : footprint[1];
    const minX = Math.round(position.x - (width - 1) / 2);
    const minZ = Math.round(position.z - (depth - 1) / 2);
    return { minX, maxX: minX + width - 1, minZ, maxZ: minZ + depth - 1 };
  }

  private cellsInFootprint(bounds: CellBounds): GridCell[] {
    const cells: GridCell[] = [];
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) cells.push({ x, z });
    }
    return cells;
  }

  private togglePause(): void {
    if (!this.started) return;
    this.isPaused = !this.isPaused;
    this.applySimulationState();
    this.ui.setPaused(this.isPaused);
    this.renderer.domElement.focus({ preventScroll: true });
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'follow' ? 'overview' : 'follow';
    if (this.cameraMode === 'overview') this.resetFreeCamera();
    this.ui.setCameraMode(this.cameraMode);
    this.applyInputState();
    this.renderer.domElement.focus({ preventScroll: true });
    this.player.userData.isWalking = false;
    this.assets.setCharacterMotion(this.player, 0);
    this.ui.toast(
      this.cameraMode === 'overview'
        ? 'Free Park View — move, orbit, and zoom anywhere'
        : 'Following your caretaker',
      'positive',
    );
  }

  private reframeFreeCamera(): void {
    if (this.mode !== 'explore' || this.cameraMode !== 'overview') return;
    this.resetFreeCamera();
    this.renderer.domElement.focus({ preventScroll: true });
    this.ui.toast('Park View recentered', 'positive');
  }

  private applyInputState(): void {
    const acceptsCameraInput = this.mode === 'explore';
    this.input.setEnabled(acceptsCameraInput);
    this.input.setZoomEnabled(acceptsCameraInput && this.cameraMode === 'overview');
    if (acceptsCameraInput) this.renderer.domElement.focus({ preventScroll: true });
  }

  private applySimulationState(): void {
    this.simulation.setRunning(this.started && !this.isPaused && this.mode === 'explore');
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    // Phones rarely fire unload. pagehide and the hidden visibility state are
    // the two that actually arrive when a player switches apps or locks the
    // screen, which is exactly when an unsaved park would otherwise be lost.
    window.addEventListener('pagehide', this.saveBeforeHidden);
    document.addEventListener('visibilitychange', this.saveBeforeHidden);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.renderer.domElement.addEventListener('contextmenu', this.preventContextMenu);
  }

  private saveBeforeHidden = (event: Event): void => {
    // pagehide can fire while the document still reports itself visible, so the
    // visibility guard only applies to visibilitychange.
    if (event.type === 'visibilitychange' && document.visibilityState === 'visible') return;
    if (!this.started) return;
    // An unconfirmed placement has already been paid for but does not exist yet.
    // Saving as-is would bank the spend and lose the building, so settle it
    // first: cancelling refunds a new build, or puts a moved one back.
    if (this.mode === 'placing') this.cancelPlacement();
    this.requestSave();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.mode === 'placing') {
      if (event.pointerType !== 'mouse' && !event.isPrimary) return;
      if (event.pointerType === 'pen' && event.buttons === 0) return;
      const transition = reducePlacementPointer(this.placementPointer, {
        type: 'pointer-move',
        pointerType: event.pointerType,
      });
      this.placementPointer = transition.state;
      if (transition.updatePreview) {
        this.placement.updatePointer(event.clientX, event.clientY, this.camera, this.placedObjects);
      }
      this.exposePlacementPointerState();
    } else if (this.mode === 'surface' && this.drawingSurface) {
      const cell = this.pointerToGridCell(event.clientX, event.clientY);
      if (!cell) return;
      this.infrastructureBuilder.extendStroke(cell);
      this.updateInfrastructureQuote();
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    // A press in a mode where the world is selectable might turn out to be a
    // tap on a building rather than a camera drag; onPointerUp decides.
    this.tapCandidate =
      (this.mode === 'explore' || this.mode === 'build' || this.mode === 'inspect') &&
      event.isPrimary &&
      (event.pointerType !== 'mouse' || event.button === 0)
        ? { x: event.clientX, y: event.clientY, time: event.timeStamp }
        : null;

    if (
      this.mode === 'placing' &&
      event.isPrimary &&
      (event.pointerType !== 'mouse' || event.button === 0)
    ) {
      const transition = reducePlacementPointer(this.placementPointer, {
        type: 'primary-canvas-press',
        pointerType: event.pointerType,
      });
      this.placementPointer = transition.state;
      if (transition.updatePreview) {
        const projected = this.placement.updatePointer(
          event.clientX,
          event.clientY,
          this.camera,
          this.placedObjects,
        );
        if (projected) {
          this.placement.pinPosition(this.placedObjects);
        } else if (this.placementPointer.phase === 'pinned' && !this.placement.pinned) {
          this.placementPointer = { phase: 'tracking' };
        }
      }
      this.exposePlacementPointerState();
    } else if (this.mode === 'surface' && (event.pointerType !== 'mouse' || event.button === 0)) {
      const cell = this.pointerToGridCell(event.clientX, event.clientY);
      if (!cell) return;
      this.drawingSurface = true;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.infrastructureBuilder.startStroke(cell);
      this.updateInfrastructureQuote();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const tap = this.tapCandidate;
    this.tapCandidate = null;
    if (tap && event.type === 'pointerup') {
      const travelled = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      const heldFor = event.timeStamp - tap.time;
      if (travelled <= TAP_MAX_MOVEMENT_PX && heldFor <= TAP_MAX_DURATION_MS) {
        const picked = this.pickPlaced(event.clientX, event.clientY);
        if (picked) {
          this.selectPlaced(picked);
          return;
        }
        if (this.mode === 'inspect') {
          this.closeInspector();
          return;
        }
      }
    }

    if (this.mode !== 'surface' || !this.drawingSurface) return;
    this.drawingSurface = false;
    this.infrastructureBuilder.endStroke();
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    this.updateInfrastructureQuote();
  };

  private pointerToGridCell(clientX: number, clientY: number): GridCell | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.buildPointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.buildPointer.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    this.buildRaycaster.setFromCamera(this.buildPointer, this.camera);
    if (!this.buildRaycaster.ray.intersectPlane(this.groundPlane, this.groundHit)) return null;
    return this.parkGrid.worldToCell(this.groundHit.x, this.groundHit.z);
  }

  private preventContextMenu = (event: MouseEvent): void => event.preventDefault();

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const maxRatio = coarse || deviceMemory <= 4 ? 1.35 : 1.8;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  private animate = (): void => {
    if (!this.running) return;
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;
    this.updateInput(delta);
    this.simulation.update(delta, { x: this.playerPosition.x, z: this.playerPosition.z });
    this.syncGuestVisuals(this.simulation.getGuests(), delta);
    this.syncLitterVisuals(this.simulation.getLitter());
    this.animateWorld(elapsed, delta);
    this.updateCamera(delta);

    if (elapsed - this.lastStatsUiUpdate > 0.15) {
      this.ui.updateStats(this.simulation.getStats());
      // Reputation moves as guests leave, and reputation is what decides which
      // prices guests accept — so the office tab has to follow it live rather
      // than showing what was true when it was opened.
      this.refreshPricing();
      this.lastStatsUiUpdate = elapsed;
    }

    this.applySkyCycle(this.simulation.getStats().minuteOfDay);

    if (this.simulation.isRunning()) {
      this.autosaveCountdown -= delta;
      if (this.autosaveCountdown <= 0) this.requestSave();
    }

    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private updateInput(delta: number): void {
    this.player.userData.isWalking = false;
    if (this.mode !== 'explore') {
      this.assets.setCharacterMotion(this.player, 0);
      return;
    }
    const look = this.input.consumeLookDelta();
    const movement = this.input.getMovement();
    if (this.cameraMode === 'overview') {
      this.freeCamera = stepFreeCamera(this.freeCamera, {
        panRight: movement.x * movement.magnitude,
        panForward: movement.y * movement.magnitude,
        lookDeltaX: look.x,
        lookDeltaY: look.y,
        zoomDelta: this.input.consumeZoomDelta(),
      }, delta);
      this.assets.setCharacterMotion(this.player, 0);
      this.exposeFreeCameraState();
      return;
    }

    this.cameraYaw -= look.x * 0.004;
    this.cameraPitch = MathUtils.clamp(this.cameraPitch + look.y * 0.003, 0.2, 0.78);

    if (movement.magnitude <= 0) {
      this.assets.setCharacterMotion(this.player, 0);
      return;
    }
    const relative = cameraRelativeMovement(movement.x, movement.y, this.cameraYaw);
    this.moveDirection.set(relative.x, 0, relative.z);
    const speed = (this.input.isSprinting() ? 6.1 : 3.9) * movement.magnitude;
    const gridBounds = this.parkGrid.getBounds();
    const nextX = MathUtils.clamp(
      this.playerPosition.x + this.moveDirection.x * speed * delta,
      gridBounds.minX + 0.35,
      gridBounds.maxX - 0.35,
    );
    const nextZ = MathUtils.clamp(
      this.playerPosition.z + this.moveDirection.z * speed * delta,
      gridBounds.minZ + 0.35,
      gridBounds.maxZ - 0.35,
    );

    if (!this.isPointInsideFacility(nextX, nextZ)) {
      this.playerPosition.x = nextX;
      this.playerPosition.z = nextZ;
      this.player.position.copy(this.playerPosition);
      this.root.dataset.playerX = this.playerPosition.x.toFixed(3);
      this.root.dataset.playerZ = this.playerPosition.z.toFixed(3);
      const heading = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      this.player.rotation.y = MathUtils.lerp(this.player.rotation.y, heading, 1 - Math.exp(-delta * 12));
      this.player.userData.isWalking = true;
      this.assets.setCharacterMotion(this.player, movement.magnitude * (this.input.isSprinting() ? 1.35 : 1));
    }
  }

  private isPointInsideFacility(x: number, z: number): boolean {
    const radius = 0.35;
    return this.placedObjects.some((placed) => {
      const quarterTurn = Math.round(placed.rotation / (Math.PI / 2)) % 2 !== 0;
      const width = quarterTurn ? placed.spec.footprint[1] : placed.spec.footprint[0];
      const depth = quarterTurn ? placed.spec.footprint[0] : placed.spec.footprint[1];
      return (
        Math.abs(x - placed.position.x) < width / 2 + radius &&
        Math.abs(z - placed.position.z) < depth / 2 + radius
      );
    });
  }

  private updateCamera(delta: number): void {
    const followsPlayer = this.mode === 'explore' && this.cameraMode === 'follow';
    if (followsPlayer) {
      this.cameraDistance = MathUtils.lerp(this.cameraDistance, 8.2, 1 - Math.exp(-delta * 3));
      this.cameraTargetDesired.set(this.playerPosition.x, 1.3, this.playerPosition.z);
      const horizontal = Math.cos(this.cameraPitch) * this.cameraDistance;
      this.cameraDesired.set(
        this.cameraTargetDesired.x + Math.sin(this.cameraYaw) * horizontal,
        this.cameraTargetDesired.y + Math.sin(this.cameraPitch) * this.cameraDistance,
        this.cameraTargetDesired.z + Math.cos(this.cameraYaw) * horizontal,
      );
      this.fog.density = MathUtils.lerp(this.fog.density, 0.013, 1 - Math.exp(-delta * 2.5));
    } else if (this.mode === 'explore' && this.cameraMode === 'overview') {
      const pose = getFreeCameraPose(this.freeCamera, 4.5);
      this.cameraTargetDesired.set(pose.target.x, pose.target.y, pose.target.z);
      this.cameraDesired.set(pose.position.x, pose.position.y, pose.position.z);
      const overviewFog = Math.min(0.0105, 0.68 / this.freeCamera.distance);
      this.fog.density = MathUtils.lerp(this.fog.density, overviewFog, 1 - Math.exp(-delta * 2.5));
    } else {
      const pose = overviewCameraPose(this.parkGrid.getParcelSnapshots(), this.camera.aspect);
      this.cameraTargetDesired.set(pose.target.x, pose.target.y, pose.target.z);
      this.cameraDesired.set(pose.position.x, pose.position.y, pose.position.z);
      const overviewFog = Math.min(0.0105, 0.68 / pose.distance);
      this.fog.density = MathUtils.lerp(this.fog.density, overviewFog, 1 - Math.exp(-delta * 2.5));
    }
    this.cameraTarget.lerp(this.cameraTargetDesired, 1 - Math.exp(-delta * (followsPlayer ? 9 : 3.5)));
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-delta * 7));
    this.camera.lookAt(this.cameraTarget);
  }

  private resetFreeCamera(): void {
    const framed = overviewCameraPose(this.parkGrid.getParcelSnapshots(), this.camera.aspect);
    this.freeCamera = createFreeCameraState({
      focusX: framed.target.x,
      focusZ: framed.target.z,
      yaw: framed.azimuth,
      pitch: framed.elevation,
      distance: framed.distance,
    });
    this.exposeFreeCameraState();
  }

  private exposeFreeCameraState(): void {
    this.root.dataset.cameraFocusX = this.freeCamera.focusX.toFixed(3);
    this.root.dataset.cameraFocusZ = this.freeCamera.focusZ.toFixed(3);
    this.root.dataset.cameraYaw = this.freeCamera.yaw.toFixed(4);
    this.root.dataset.cameraPitch = this.freeCamera.pitch.toFixed(4);
    this.root.dataset.cameraDistance = this.freeCamera.distance.toFixed(3);
  }

  private exposePlacementPointerState(): void {
    this.root.dataset.placementPointer = this.placementPointer.phase;
    this.root.dataset.placementX = this.placement.position.x.toFixed(3);
    this.root.dataset.placementZ = this.placement.position.z.toFixed(3);
  }

  /**
   * Draws the nearest guests only. The simulation is allowed to grow far past
   * what a phone can render, so attendance stops being limited by the mesh
   * budget: the crowd near the camera is real, and the rest of the park's
   * visitors keep queueing, spending, and littering off screen.
   */
  private visibleGuests(guests: readonly GuestSnapshot[]): readonly GuestSnapshot[] {
    if (guests.length <= this.guestRenderBudget) return guests;
    const focus = this.cameraTarget;
    return [...guests]
      .sort((a, b) => {
        const aDistance = (a.position.x - focus.x) ** 2 + (a.position.z - focus.z) ** 2;
        const bDistance = (b.position.x - focus.x) ** 2 + (b.position.z - focus.z) ** 2;
        return aDistance - bDistance;
      })
      .slice(0, this.guestRenderBudget);
  }

  private syncGuestVisuals(allGuests: readonly GuestSnapshot[], delta: number): void {
    const guests = this.visibleGuests(allGuests);
    const activeIds = new Set(guests.map((guest) => guest.id));
    for (const [id, visual] of this.guestVisuals) {
      if (activeIds.has(id)) continue;
      this.dynamicLayer.remove(visual.object);
      this.guestVisuals.delete(id);
    }

    for (const guest of guests) {
      let visual = this.guestVisuals.get(guest.id);
      if (!visual) {
        const object = this.assets.createGuest(guest.paletteIndex);
        object.scale.setScalar(guest.ageScale);
        this.dynamicLayer.add(object);
        visual = { object, previousPosition: new Vector3(guest.position.x, 0, guest.position.z) };
        this.guestVisuals.set(guest.id, visual);
      }
      const target = new Vector3(guest.position.x, 0, guest.position.z);
      visual.object.position.lerp(target, 1 - Math.exp(-delta * 11));
      visual.object.rotation.y = guest.heading;
      const moved = target.distanceToSquared(visual.previousPosition) > 0.00002;
      visual.object.userData.isWalking = moved;
      visual.object.userData.carryingTrash = guest.carryingTrash;
      this.assets.setCharacterMotion(visual.object, moved ? 0.88 : 0, guest.carryingTrash);
      visual.previousPosition.copy(target);
      visual.object.visible = guest.state !== 'using';
    }
  }

  private syncLitterVisuals(litter: readonly LitterSnapshot[]): void {
    const activeIds = new Set(litter.map((item) => item.id));
    for (const [id, object] of this.litterVisuals) {
      if (activeIds.has(id)) continue;
      this.dynamicLayer.remove(object);
      this.litterVisuals.delete(id);
    }
    for (const item of litter) {
      if (this.litterVisuals.has(item.id)) continue;
      const object = this.assets.createLitter(item.variant);
      object.position.set(item.position.x, 0.04, item.position.z);
      object.rotation.y = item.variant * 1.71;
      this.dynamicLayer.add(object);
      this.litterVisuals.set(item.id, object);
    }
  }

  /**
   * Drives the sun, sky, fog, and every lit fixture from the park clock.
   *
   * The clock has always run 9:00 to 21:00; until this existed, nothing looked
   * at it. Throttled to meaningful changes because a park minute is about a
   * sixth of a second of real time, so re-deriving it every frame is wasted
   * work for a difference nobody can see.
   */
  private applySkyCycle(minuteOfDay: number, force = false): void {
    if (!force && Math.abs(minuteOfDay - this.lastSkyMinute) < 0.25) return;
    this.lastSkyMinute = minuteOfDay;

    const sky = sampleSkyCycle(minuteOfDay);
    this.sun.position.set(...sky.sunPosition);
    this.sun.color.setHex(sky.sunColor);
    this.sun.intensity = sky.sunIntensity;
    this.ambient.color.setHex(sky.ambientColor);
    this.ambient.intensity = sky.ambientIntensity;

    this.skyColor.setHex(sky.skyColor);
    if (this.scene.background instanceof Color) this.scene.background.copy(this.skyColor);
    // Fog density stays with the camera code, which lerps it per view mode;
    // only the colour belongs to the time of day.
    this.fog.color.setHex(sky.fogColor);
    this.materials.setLampGlow(sky.lampGlow);
  }

  private animateWorld(elapsed: number, delta: number): void {
    const activity = this.started && !this.isPaused ? 1 : 0;
    this.assets.animate(this.player, elapsed, delta);
    for (const visual of this.guestVisuals.values()) this.assets.animate(visual.object, elapsed, delta);
    for (const placed of this.placedObjects) {
      const connectedActivity = placed.spec.serviceNeed === null || placed.object.userData.connected !== false;
      this.assets.animate(placed.object, elapsed, delta, connectedActivity ? activity : 0);
    }
  }

  private getSpec(kind: PlaceableKind) {
    return getPlaceableSpec(kind);
  }

  private requireElement(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element ${selector}`);
    return element;
  }
}
