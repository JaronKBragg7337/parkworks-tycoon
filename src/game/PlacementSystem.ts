import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
} from 'three';
import type { AssetFactory } from '../world/AssetFactory';
import type { PlacedObject, PlaceableKind, PlaceableSpec, Vec2 } from '../core/types';
import { getPlaceableSpec } from '../core/catalog';

export interface PlacementResult {
  placed: PlacedObject;
}

export interface PlacementCallbacks {
  onPreviewChanged: (valid: boolean, position: Vec2, rotation: number) => void;
  onPlaced: (result: PlacementResult) => void;
  onCancelled: () => void;
}

const LOT_LIMIT = 28;
const GATE_CLEARANCE = new Box3(new Vector3(-4.5, 0, 24), new Vector3(4.5, 6, 32));

export class PlacementSystem {
  private readonly world: Object3D;
  private readonly assetFactory: AssetFactory;
  private readonly callbacks: PlacementCallbacks;
  private readonly pointer = new Vector2();
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly hit = new Vector3();
  private readonly previewRoot = new Group();
  private readonly footprintMaterial = new MeshBasicMaterial({
    color: 0x51d9a3,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  private readonly footprintMesh = new Mesh(new BoxGeometry(1, 0.06, 1), this.footprintMaterial);
  private activeKind: PlaceableKind | null = null;
  private activeSpec: PlaceableSpec | null = null;
  private previewModel: Object3D | null = null;
  private rotation = 0;
  private valid = false;
  private placedCounter = 1;
  private pointerWorld: Vec2 = { x: 0, z: 0 };

  constructor(world: Object3D, assetFactory: AssetFactory, callbacks: PlacementCallbacks) {
    this.world = world;
    this.assetFactory = assetFactory;
    this.callbacks = callbacks;
    this.previewRoot.visible = false;
    this.previewRoot.add(this.footprintMesh);
    this.world.add(this.previewRoot);
  }

  get active(): boolean {
    return this.activeKind !== null;
  }

  begin(kind: PlaceableKind): void {
    this.cancel(false);
    const spec = getPlaceableSpec(kind);
    this.activeKind = kind;
    this.activeSpec = spec;
    this.rotation = 0;
    const previewModel = this.assetFactory.createPlaceable(kind);
    this.previewModel = previewModel;
    this.setPreviewTransparency(previewModel, 0.62);
    this.previewRoot.add(previewModel);
    this.previewRoot.visible = true;
    this.footprintMesh.scale.set(spec.footprint[0], 1, spec.footprint[1]);
    this.updateValidity([]);
  }

  updatePointer(clientX: number, clientY: number, camera: Camera, placed: readonly PlacedObject[]): void {
    if (!this.active) return;
    this.pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.hit)) return;
    this.pointerWorld = { x: Math.round(this.hit.x), z: Math.round(this.hit.z) };
    this.previewRoot.position.set(this.pointerWorld.x, 0.04, this.pointerWorld.z);
    this.updateValidity(placed);
  }

  rotate(placed: readonly PlacedObject[]): void {
    if (!this.active) return;
    this.rotation = (this.rotation + Math.PI / 2) % (Math.PI * 2);
    this.previewRoot.rotation.y = this.rotation;
    this.updateValidity(placed);
  }

  confirm(placed: readonly PlacedObject[]): PlacementResult | null {
    if (!this.activeKind || !this.activeSpec) return null;
    this.updateValidity(placed);
    if (!this.valid) return null;

    const object = this.assetFactory.createPlaceable(this.activeKind);
    object.position.set(this.pointerWorld.x, 0, this.pointerWorld.z);
    object.rotation.y = this.rotation;
    const placedObject: PlacedObject = {
      id: `facility-${this.placedCounter++}`,
      spec: this.activeSpec,
      position: { ...this.pointerWorld },
      rotation: this.rotation,
      object,
      queueLength: 0,
      activeUsers: 0,
    };
    this.world.add(object);
    const result = { placed: placedObject };
    this.callbacks.onPlaced(result);
    this.cancel(false);
    return result;
  }

  cancel(notify = true): void {
    if (this.previewModel) {
      this.previewRoot.remove(this.previewModel);
      this.disposePreview(this.previewModel);
    }
    this.previewModel = null;
    this.activeKind = null;
    this.activeSpec = null;
    this.previewRoot.visible = false;
    this.previewRoot.rotation.y = 0;
    this.valid = false;
    if (notify) this.callbacks.onCancelled();
  }

  dispose(): void {
    this.cancel(false);
    this.world.remove(this.previewRoot);
    this.footprintMesh.geometry.dispose();
    this.footprintMaterial.dispose();
  }

  private updateValidity(placed: readonly PlacedObject[]): void {
    if (!this.activeSpec) return;
    const footprint = this.rotatedFootprint(this.activeSpec);
    const previewBounds = this.boundsAt(this.pointerWorld, footprint[0], footprint[1]);
    const insideLot =
      previewBounds.min.x >= -LOT_LIMIT &&
      previewBounds.max.x <= LOT_LIMIT &&
      previewBounds.min.z >= -LOT_LIMIT &&
      previewBounds.max.z <= LOT_LIMIT;
    const avoidsGate = !previewBounds.intersectsBox(GATE_CLEARANCE);
    const avoidsObjects = placed.every((item) => {
      const existingFootprint = this.rotatedFootprint(item.spec, item.rotation);
      const existingBounds = this.boundsAt(item.position, existingFootprint[0], existingFootprint[1]);
      return !previewBounds.intersectsBox(existingBounds);
    });

    this.valid = insideLot && avoidsGate && avoidsObjects;
    const color = this.valid ? 0x51d9a3 : 0xff6b5d;
    this.footprintMaterial.color.setHex(color);
    this.setPreviewColor(this.previewModel, new Color(color));
    this.callbacks.onPreviewChanged(this.valid, { ...this.pointerWorld }, this.rotation);
  }

  private rotatedFootprint(spec: PlaceableSpec, rotation = this.rotation): readonly [number, number] {
    const quarterTurns = Math.round(rotation / (Math.PI / 2)) % 2;
    return quarterTurns === 0
      ? spec.footprint
      : [spec.footprint[1], spec.footprint[0]];
  }

  private boundsAt(position: Vec2, width: number, depth: number): Box3 {
    const padding = 0.28;
    return new Box3(
      new Vector3(position.x - width / 2 - padding, 0, position.z - depth / 2 - padding),
      new Vector3(position.x + width / 2 + padding, 8, position.z + depth / 2 + padding),
    );
  }

  private setPreviewTransparency(object: Object3D, opacity: number): void {
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      child.material = materials.map((material) => {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = opacity;
        clone.depthWrite = false;
        return clone;
      });
    });
  }

  private setPreviewColor(object: Object3D | null, color: Color): void {
    object?.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if ('emissive' in material && material.emissive instanceof Color) {
          material.emissive.copy(color).multiplyScalar(0.13);
        }
      }
    });
  }

  private disposePreview(object: Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
  }
}
