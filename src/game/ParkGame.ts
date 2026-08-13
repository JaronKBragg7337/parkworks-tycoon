import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ParkSimulation } from '../core/ParkSimulation';
import { getPlaceableSpec } from '../core/catalog';
import type { FacilitySnapshot, GuestSnapshot, LitterSnapshot, PlacedObject, PlaceableKind } from '../core/types';
import { InputController } from '../controls/InputController';
import { AssetFactory } from '../world/AssetFactory';
import { MaterialLibrary } from '../world/Materials';
import { GameUI } from '../ui/GameUI';
import { PlacementSystem } from './PlacementSystem';

interface GuestVisual {
  object: Object3D;
  previousPosition: Vector3;
}

export class ParkGame {
  private readonly root: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(54, 1, 0.1, 180);
  private readonly world = new Group();
  private readonly dynamicLayer = new Group();
  private readonly materials: MaterialLibrary;
  private readonly assets: AssetFactory;
  private readonly simulation = new ParkSimulation();
  private readonly input: InputController;
  private readonly ui: GameUI;
  private readonly placement: PlacementSystem;
  private readonly clock = new Clock();
  private readonly placedObjects: PlacedObject[] = [];
  private readonly guestVisuals = new Map<string, GuestVisual>();
  private readonly litterVisuals = new Map<string, Object3D>();
  private readonly player: Object3D;
  private readonly playerPosition = new Vector3(0, 0, 18.5);
  private readonly cameraTarget = new Vector3();
  private readonly cameraDesired = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly moveDirection = new Vector3();
  private readonly unregisterSimulation: () => void;
  private animationFrame = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.44;
  private cameraDistance = 8.2;
  private running = false;
  private started = false;
  private mode: 'explore' | 'build' | 'placing' = 'explore';
  private activePlaceable: PlaceableKind | null = null;
  private lastStatsUiUpdate = 0;
  private isPaused = false;

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
    this.player = this.assets.createPlayer();
    this.root.dataset.playerX = this.playerPosition.x.toFixed(3);
    this.root.dataset.playerZ = this.playerPosition.z.toFixed(3);

    this.ui = new GameUI(this.root, {
      onStart: () => this.openGates(),
      onToggleBuild: () => this.toggleBuildMode(),
      onSelectPlaceable: (kind) => this.beginPlacement(kind),
      onRotate: () => this.rotatePlacement(),
      onConfirm: () => this.confirmPlacement(),
      onCancel: () => this.cancelPlacement(),
      onPause: () => this.togglePause(),
    });

    const joystick = this.requireElement('#movement-joystick');
    this.input = new InputController(this.renderer.domElement, joystick);
    touchStick.remove();

    this.placement = new PlacementSystem(this.world, this.assets, {
      onPreviewChanged: (valid) => {
        if (this.activePlaceable) this.ui.setPlacement(this.activePlaceable, valid);
      },
      onPlaced: ({ placed }) => this.onPlaced(placed),
      onCancelled: () => this.exitPlacement(),
    });

    this.unregisterSimulation = this.simulation.subscribe((event) => this.ui.handleEvent(event));
    this.setupScene();
    this.seedStarterPark();
    this.bindEvents();
    this.resize();
    this.ui.updateStats(this.simulation.getStats());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.unregisterSimulation();
    this.input.dispose();
    this.ui.dispose();
    this.placement.dispose();
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('contextmenu', this.preventContextMenu);
    this.assets.dispose?.();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private setupScene(): void {
    this.scene.background = new Color(0x9fc2be);
    this.scene.fog = new FogExp2(0xa8c8c0, 0.013);
    this.scene.add(this.world);
    this.world.add(this.dynamicLayer);

    const landscape = this.assets.createLandscape();
    this.world.add(landscape);
    const gate = this.assets.createParkGate();
    gate.position.set(0, 0, 29.2);
    this.world.add(gate);

    this.player.position.copy(this.playerPosition);
    this.dynamicLayer.add(this.player);

    const ambient = new AmbientLight(0xaaccc5, 1.18);
    this.scene.add(ambient);
    const sun = new DirectionalLight(0xffe7bd, 3.25);
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

    this.camera.position.set(7, 5.4, 35);
    this.cameraTarget.copy(this.playerPosition).add(new Vector3(0, 1.25, 0));
    this.camera.lookAt(this.cameraTarget);
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
  }

  private toggleBuildMode(): void {
    if (this.mode === 'placing') {
      this.cancelPlacement();
      return;
    }
    this.mode = this.mode === 'build' ? 'explore' : 'build';
    this.ui.setMode(this.mode);
    this.input.setEnabled(this.mode === 'explore');
    this.applySimulationState();
  }

  private beginPlacement(kind: PlaceableKind): void {
    if (!this.simulation.purchase(kind)) return;
    this.activePlaceable = kind;
    this.mode = 'placing';
    this.input.setEnabled(false);
    this.ui.setMode('placing');
    this.applySimulationState();
    this.placement.begin(kind);
    this.placement.updatePointer(window.innerWidth / 2, window.innerHeight / 2, this.camera, this.placedObjects);
  }

  private rotatePlacement(): void {
    this.placement.rotate(this.placedObjects);
  }

  private confirmPlacement(): void {
    const result = this.placement.confirm(this.placedObjects);
    if (!result) this.ui.toast('That plot is blocked', 'warning');
  }

  private cancelPlacement(): void {
    if (this.activePlaceable) this.simulation.refund(this.activePlaceable);
    this.placement.cancel(false);
    this.exitPlacement();
  }

  private exitPlacement(): void {
    this.activePlaceable = null;
    this.mode = 'build';
    this.ui.setMode('build');
    this.input.setEnabled(false);
    this.applySimulationState();
  }

  private onPlaced(placed: PlacedObject): void {
    this.placedObjects.push(placed);
    this.syncFacilities();
    this.activePlaceable = null;
    this.mode = 'explore';
    this.ui.setMode('explore');
    this.input.setEnabled(true);
    this.applySimulationState();
    this.ui.toast(`${placed.spec.shortName} opened`, 'positive');
  }

  private syncFacilities(): void {
    const snapshots: FacilitySnapshot[] = this.placedObjects
      .filter((placed) => placed.spec.serviceNeed !== null)
      .map((placed) => ({
        id: placed.id,
        kind: placed.spec.kind,
        position: { ...placed.position },
        rotation: placed.rotation,
        queueLength: placed.queueLength,
        activeUsers: placed.activeUsers,
        enabled: true,
      }));
    this.simulation.setFacilities(snapshots);
  }

  private togglePause(): void {
    if (!this.started) return;
    this.isPaused = !this.isPaused;
    this.applySimulationState();
    this.ui.setPaused(this.isPaused);
  }

  private applySimulationState(): void {
    this.simulation.setRunning(this.started && !this.isPaused && this.mode === 'explore');
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('contextmenu', this.preventContextMenu);
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.mode === 'placing') {
      this.placement.updatePointer(event.clientX, event.clientY, this.camera, this.placedObjects);
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.mode === 'placing' && (event.pointerType !== 'mouse' || event.button === 0)) {
      this.placement.updatePointer(event.clientX, event.clientY, this.camera, this.placedObjects);
    }
  };

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
      this.lastStatsUiUpdate = elapsed;
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
    this.cameraYaw -= look.x * 0.004;
    this.cameraPitch = MathUtils.clamp(this.cameraPitch + look.y * 0.003, 0.2, 0.78);

    const movement = this.input.getMovement();
    if (movement.magnitude <= 0) {
      this.assets.setCharacterMotion(this.player, 0);
      return;
    }
    this.forward.set(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw)).multiplyScalar(-1);
    this.right.set(this.forward.z, 0, -this.forward.x);
    this.moveDirection
      .copy(this.right)
      .multiplyScalar(movement.x)
      .addScaledVector(this.forward, movement.y)
      .normalize();
    const speed = (this.input.isSprinting() ? 6.1 : 3.9) * movement.magnitude;
    const nextX = MathUtils.clamp(this.playerPosition.x + this.moveDirection.x * speed * delta, -29, 29);
    const nextZ = MathUtils.clamp(this.playerPosition.z + this.moveDirection.z * speed * delta, -30, 32);

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
    if (this.mode === 'explore') {
      this.cameraDistance = MathUtils.lerp(this.cameraDistance, 8.2, 1 - Math.exp(-delta * 3));
      this.cameraTarget.set(this.playerPosition.x, 1.3, this.playerPosition.z);
      const horizontal = Math.cos(this.cameraPitch) * this.cameraDistance;
      this.cameraDesired.set(
        this.cameraTarget.x + Math.sin(this.cameraYaw) * horizontal,
        this.cameraTarget.y + Math.sin(this.cameraPitch) * this.cameraDistance,
        this.cameraTarget.z + Math.cos(this.cameraYaw) * horizontal,
      );
    } else {
      this.cameraTarget.lerp(new Vector3(0, 0, 1), 1 - Math.exp(-delta * 2.3));
      this.cameraDesired.set(22, 31, 31);
    }
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-delta * 7));
    this.camera.lookAt(this.cameraTarget);
  }

  private syncGuestVisuals(guests: readonly GuestSnapshot[], delta: number): void {
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

  private animateWorld(elapsed: number, delta: number): void {
    const activity = this.started && !this.isPaused ? 1 : 0;
    this.assets.animate(this.player, elapsed, delta);
    for (const visual of this.guestVisuals.values()) this.assets.animate(visual.object, elapsed, delta);
    for (const placed of this.placedObjects) this.assets.animate(placed.object, elapsed, delta, activity);
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
