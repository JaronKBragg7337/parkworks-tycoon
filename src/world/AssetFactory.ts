import {
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getPlaceableSpec } from '../core/catalog';
import type { PlaceableKind } from '../core/types';
import {
  applyWorldUV,
  beamBetween,
  cylinderMesh,
  ensureAmbientOcclusionUV,
  planeMesh,
  polar,
  roundedBoxMesh,
  sphereMesh,
} from './geometry';
import { MaterialLibrary } from './Materials';

type XYZ = readonly [number, number, number];

export type AssetQuality = 'mobile' | 'high';

export interface AssetFactoryOptions {
  materials?: MaterialLibrary;
  quality?: AssetQuality;
}

export interface LandscapeOptions {
  width?: number;
  depth?: number;
  includeFence?: boolean;
}

export interface GuestAssetOptions {
  paletteIndex?: number;
  ageScale?: number;
  carryingTrash?: boolean;
}

export interface AssetAnimationContext {
  elapsed: number;
  delta: number;
  /** 0 is idle/stopped, 1 is normal operating or walking speed. */
  activity: number;
}

export type AssetAnimationHook = (context: AssetAnimationContext) => void;

const ZERO_ROTATION: XYZ = [0, 0, 0];
const SHIRT_PALETTE = [
  0x315c85,
  0xb84a3c,
  0x467652,
  0xd09a38,
  0x76538c,
  0x277b7d,
  0x9a5964,
  0x56636c,
] as const;

const TROUSER_PALETTE = [0x26323b, 0x493b34, 0x2e3b33, 0x3d3b51] as const;
const SKIN_PALETTE = [0xf0c8a0, 0xdba77f, 0xba7f5b, 0x86553c, 0x5c382a] as const;
const HAIR_PALETTE = [0x2d211c, 0x5a3826, 0x9a6b37, 0x151617, 0x6b5545] as const;

function addBox(
  parent: Object3D,
  size: XYZ,
  position: XYZ,
  material: Material,
  name: string,
  radius = 0.045,
  rotation: XYZ = ZERO_ROTATION,
  castShadow = true,
  receiveShadow = true,
): Mesh {
  const mesh = roundedBoxMesh(size[0], size[1], size[2], radius, material, {
    name,
    position,
    rotation,
    castShadow,
    receiveShadow,
    texelScale: 1,
  });
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: XYZ,
  material: Material,
  name: string,
  rotation: XYZ = ZERO_ROTATION,
  radialSegments = 10,
  castShadow = true,
  receiveShadow = true,
): Mesh {
  const mesh = cylinderMesh(radiusTop, radiusBottom, height, radialSegments, material, {
    name,
    position,
    rotation,
    castShadow,
    receiveShadow,
    texelScale: 1,
  });
  parent.add(mesh);
  return mesh;
}

function addSphere(
  parent: Object3D,
  radius: number,
  position: XYZ,
  material: Material,
  name: string,
  scale: XYZ = [1, 1, 1],
  castShadow = true,
  segments = 12,
): Mesh {
  const mesh = sphereMesh(
    radius,
    material,
    { name, position, castShadow, receiveShadow: true, texelScale: 1 },
    segments,
    Math.max(6, Math.floor(segments * 0.65)),
  );
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function addTorus(
  parent: Object3D,
  radius: number,
  tube: number,
  position: XYZ,
  material: Material,
  name: string,
  rotation: XYZ = ZERO_ROTATION,
  tubularSegments = 48,
  castShadow = true,
): Mesh {
  const geometry = new TorusGeometry(radius, tube, 8, tubularSegments);
  applyWorldUV(geometry, 1);
  ensureAmbientOcclusionUV(geometry);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBrace(
  parent: Object3D,
  start: XYZ,
  end: XYZ,
  radius: number,
  material: Material,
  name: string,
  castShadow = true,
): Mesh {
  const mesh = beamBetween(
    new Vector3(...start),
    new Vector3(...end),
    radius,
    material,
    8,
    { name, castShadow, receiveShadow: true, texelScale: 1 },
  );
  parent.add(mesh);
  return mesh;
}

function addBolt(
  parent: Object3D,
  position: XYZ,
  material: Material,
  rotation: XYZ = [Math.PI / 2, 0, 0],
  radius = 0.035,
): Mesh {
  return addCylinder(
    parent,
    radius,
    radius,
    0.035,
    position,
    material,
    'fastener',
    rotation,
    8,
    false,
    false,
  );
}

function addPanelSeams(
  parent: Object3D,
  width: number,
  y: number,
  z: number,
  count: number,
  material: Material,
): void {
  for (let index = 1; index < count; index += 1) {
    const x = -width / 2 + (width / count) * index;
    addBox(parent, [0.018, 1.05, 0.024], [x, y, z], material, 'panel seam', 0.006, ZERO_ROTATION, false, false);
  }
}

function makeRoot(name: string, type: string): Group {
  const root = new Group();
  root.name = name;
  root.userData.assetType = type;
  root.userData.forward = '+z';
  return root;
}

function setInstance(
  mesh: InstancedMesh,
  index: number,
  position: Vector3,
  rotation: Quaternion,
  scale = new Vector3(1, 1, 1),
): void {
  const matrix = new Matrix4().compose(position, rotation, scale);
  mesh.setMatrixAt(index, matrix);
}

/**
 * Builds all static and animated 3D assets used by Parkworks.
 *
 * Objects face +Z, stand on y=0, and use metres. Major masses cast shadows;
 * tertiary fasteners and decals do not. Repeated ride details use instancing.
 * Call `animate(asset, elapsed, delta, activity)` once per frame for rides and
 * characters, and `setCharacterMotion` when a humanoid starts/stops walking.
 */
export class AssetFactory {
  readonly materials: MaterialLibrary;
  readonly quality: AssetQuality;
  private readonly ownsMaterials: boolean;
  private readonly animationHooks = new WeakMap<Object3D, AssetAnimationHook[]>();
  private readonly signMaterials = new Map<string, MeshStandardMaterial>();
  private readonly signTextures = new Set<Texture>();

  constructor(options: AssetFactoryOptions | MaterialLibrary = {}) {
    if (options instanceof MaterialLibrary) {
      this.materials = options;
      this.quality = 'mobile';
      this.ownsMaterials = false;
    } else {
      this.materials = options.materials ?? new MaterialLibrary();
      this.quality = options.quality ?? 'mobile';
      this.ownsMaterials = !options.materials;
    }
  }

  /** Build any item listed in core/catalog.ts. */
  createPlaceable(kind: PlaceableKind): Group {
    let asset: Group;
    switch (kind) {
      case 'burger-kiosk':
        asset = this.createBurgerKiosk();
        break;
      case 'lemonade-stand':
        asset = this.createLemonadeStand();
        break;
      case 'carousel':
        asset = this.createCarousel();
        break;
      case 'sky-wheel':
        asset = this.createSkyWheel();
        break;
      case 'restroom':
        asset = this.createRestroom();
        break;
      case 'trash-bin':
        asset = this.createTrashBin();
        break;
      case 'bench':
        asset = this.createBench();
        break;
      case 'park-lamp':
        asset = this.createParkLamp();
        break;
      case 'shade-tree':
        asset = this.createShadeTree();
        break;
    }

    const spec = getPlaceableSpec(kind);
    asset.userData.placeableKind = kind;
    asset.userData.footprint = [...spec.footprint];
    asset.userData.serviceNeed = spec.serviceNeed;
    asset.userData.approachOffset = Math.max(...spec.footprint) * 0.54 + 0.65;
    return asset;
  }

  createBurgerKiosk(): Group {
    const root = makeRoot('Copper Bun Kitchen', 'placeable');
    const concrete = this.materials.get('concrete');
    const cream = this.materials.get('paintCream');
    const red = this.materials.get('paintRed');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('steel');
    const galvanized = this.materials.get('galvanized');
    const copper = this.materials.get('copper');
    const glow = this.materials.get('lampGlow');

    addBox(root, [4.8, 0.18, 3.8], [0, 0.09, 0], concrete, 'foundation slab', 0.07, ZERO_ROTATION, false, true);
    addBox(root, [4.35, 2.55, 0.18], [0, 1.48, -1.62], cream, 'rear wall', 0.055);
    addBox(root, [0.2, 2.55, 3.1], [-2.08, 1.48, -0.05], cream, 'left wall frame', 0.05);
    addBox(root, [0.2, 2.55, 3.1], [2.08, 1.48, -0.05], cream, 'right wall frame', 0.05);
    addBox(root, [4.15, 1.18, 0.22], [0, 0.78, 1.5], red, 'service counter front', 0.045);
    addPanelSeams(root, 4.0, 0.78, 1.622, 5, copper);
    addBox(root, [4.45, 0.15, 0.62], [0, 1.42, 1.63], steel, 'stainless counter', 0.055);
    addBox(root, [4.2, 0.26, 0.2], [0, 2.72, 1.5], cream, 'service header', 0.045);
    addBox(root, [4.6, 0.18, 3.6], [0, 2.86, -0.02], dark, 'standing seam roof', 0.055);
    for (let index = -2; index <= 2; index += 1) {
      addBox(root, [0.035, 0.045, 3.5], [index * 0.9, 2.97, -0.02], steel, 'roof seam', 0.01, ZERO_ROTATION, false, false);
    }

    const awning = new Group();
    awning.name = 'mechanically framed awning';
    awning.position.set(0, 2.63, 1.9);
    awning.rotation.x = -0.12;
    root.add(awning);
    for (let stripe = 0; stripe < 8; stripe += 1) {
      const x = -2.0 + stripe * 0.57;
      addBox(
        awning,
        [0.56, 0.075, 1.0],
        [x, 0, 0],
        stripe % 2 === 0 ? red : cream,
        'awning fabric panel',
        0.025,
        ZERO_ROTATION,
        false,
        true,
      );
    }
    addBox(awning, [4.6, 0.08, 0.08], [0, -0.02, 0.47], dark, 'awning front rail', 0.02, ZERO_ROTATION, false, false);
    addBrace(root, [-2.0, 2.58, 1.52], [-2.0, 2.48, 2.36], 0.025, dark, 'awning stay', false);
    addBrace(root, [2.0, 2.58, 1.52], [2.0, 2.48, 2.36], 0.025, dark, 'awning stay', false);

    addBox(root, [2.2, 0.32, 0.5], [0, 2.46, 1.62], dark, 'sign backing', 0.05);
    this.addSign(root, 'COPPER BUN', [2.05, 0.52], [0, 2.5, 1.885], 0x8f302c, 0xffe3ae, 'BURGERS • FRIES');

    addBox(root, [1.25, 0.7, 0.62], [-0.86, 1.83, -0.93], dark, 'grill chassis', 0.035);
    for (let rail = 0; rail < 6; rail += 1) {
      addBox(root, [0.035, 0.025, 0.5], [-1.36 + rail * 0.2, 2.19, -0.9], steel, 'grill grate', 0.008, ZERO_ROTATION, false, false);
    }
    addBox(root, [1.4, 0.12, 0.82], [-0.85, 2.42, -0.98], steel, 'extract hood lip', 0.035);
    addBrace(root, [-1.52, 2.35, -1.16], [-1.14, 2.7, -1.16], 0.035, steel, 'hood taper', false);
    addBrace(root, [-0.18, 2.35, -1.16], [-0.56, 2.7, -1.16], 0.035, steel, 'hood taper', false);
    addCylinder(root, 0.16, 0.16, 1.0, [-0.85, 3.36, -0.93], galvanized, 'exhaust stack', ZERO_ROTATION, 12);
    addCylinder(root, 0.28, 0.18, 0.16, [-0.85, 3.9, -0.93], galvanized, 'rain cap', ZERO_ROTATION, 12, false, true);

    addBox(root, [0.62, 0.42, 0.35], [1.3, 1.83, -1.12], copper, 'warming cabinet', 0.04);
    addBox(root, [0.5, 0.25, 0.015], [1.3, 1.84, -0.935], this.materials.get('glass'), 'warming cabinet glass', 0.005, ZERO_ROTATION, false, false);
    addSphere(root, 0.08, [-1.55, 2.47, 1.44], glow, 'counter light', [1, 0.55, 1], false, 10);
    addSphere(root, 0.08, [1.55, 2.47, 1.44], glow, 'counter light', [1, 0.55, 1], false, 10);
    for (const x of [-1.88, 1.88]) {
      for (const y of [0.34, 1.19]) addBolt(root, [x, y, 1.645], steel);
    }

    root.userData.counterPoints = [[-0.8, 0, 2.2], [0.8, 0, 2.2]];
    return root;
  }

  createLemonadeStand(): Group {
    const root = makeRoot('Citrus Press', 'placeable');
    const concrete = this.materials.get('concrete');
    const teal = this.materials.get('paintTeal');
    const yellow = this.materials.get('paintYellow');
    const cream = this.materials.get('paintCream');
    const steel = this.materials.get('steelDark');
    const timber = this.materials.get('timber');
    const glass = this.materials.get('glass');

    addBox(root, [2.75, 0.15, 2.65], [0, 0.075, 0], concrete, 'stand pad', 0.07, ZERO_ROTATION, false, true);
    addBox(root, [2.35, 1.05, 1.55], [0, 0.72, 0.08], teal, 'cabinet carcass', 0.07);
    addPanelSeams(root, 2.1, 0.72, 0.868, 3, yellow);
    addBox(root, [2.6, 0.14, 1.85], [0, 1.3, 0.05], timber, 'butcher block counter', 0.05);
    addBox(root, [2.45, 0.56, 0.16], [0, 0.75, 0.94], yellow, 'front fascia', 0.035);
    addBox(root, [1.9, 0.38, 0.05], [0, 0.74, 1.035], teal, 'front inset panel', 0.015, ZERO_ROTATION, false, true);

    for (const x of [-1.06, 1.06]) {
      addBox(root, [0.08, 2.15, 0.08], [x, 2.22, -0.52], steel, 'canopy post', 0.018);
      addBox(root, [0.08, 2.15, 0.08], [x, 2.22, 0.63], steel, 'canopy post', 0.018);
      addBolt(root, [x, 1.2, 0.99], this.materials.get('brass'));
    }
    const canopy = new Group();
    canopy.name = 'striped tensile canopy';
    canopy.position.y = 3.25;
    root.add(canopy);
    for (let stripe = 0; stripe < 6; stripe += 1) {
      addBox(
        canopy,
        [0.48, 0.09, 2.15],
        [-1.2 + stripe * 0.48, 0, 0],
        stripe % 2 === 0 ? yellow : cream,
        'canopy stripe',
        0.035,
        [0, 0, (stripe - 2.5) * 0.012],
        false,
        true,
      );
    }
    addBox(canopy, [2.95, 0.1, 0.08], [0, -0.02, 1.05], steel, 'canopy valance rail', 0.018, ZERO_ROTATION, false, false);

    addCylinder(root, 0.29, 0.29, 0.68, [-0.55, 1.72, 0.05], glass, 'drink dispenser tank', ZERO_ROTATION, 16, false, false);
    addCylinder(root, 0.31, 0.31, 0.06, [-0.55, 1.39, 0.05], steel, 'dispenser base', ZERO_ROTATION, 12, false, true);
    addCylinder(root, 0.31, 0.31, 0.06, [-0.55, 2.06, 0.05], steel, 'dispenser lid', ZERO_ROTATION, 12, false, true);
    addBox(root, [0.08, 0.22, 0.12], [-0.55, 1.55, 0.4], steel, 'dispenser tap', 0.02, ZERO_ROTATION, false, false);
    addBox(root, [0.62, 0.43, 0.7], [0.55, 1.55, 0.05], timber, 'lemon crate', 0.035);
    for (let index = 0; index < 6; index += 1) {
      addSphere(
        root,
        0.11,
        [0.34 + (index % 3) * 0.2, 1.79 + Math.floor(index / 3) * 0.14, -0.1 + (index % 2) * 0.24],
        yellow,
        'lemon',
        [1, 0.92, 1],
        false,
        8,
      );
    }
    addCylinder(root, 0.34, 0.34, 0.055, [0, 2.72, 0.75], yellow, 'citrus medallion', [Math.PI / 2, 0, 0], 20, false, true);
    addCylinder(root, 0.26, 0.26, 0.058, [0, 2.72, 0.785], cream, 'citrus medallion inset', [Math.PI / 2, 0, 0], 20, false, true);
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = (spoke / 8) * Math.PI * 2;
      addBrace(
        root,
        [0, 2.72, 0.82],
        [Math.cos(angle) * 0.23, 2.72 + Math.sin(angle) * 0.23, 0.82],
        0.012,
        yellow,
        'lemon segment',
        false,
      );
    }
    this.addSign(root, 'CITRUS PRESS', [1.75, 0.38], [0, 2.54, 0.76], 0x245f61, 0xffe265, 'FRESH LEMONADE');

    for (const x of [-0.84, 0.84]) {
      addCylinder(root, 0.23, 0.23, 0.11, [x, 0.42, -0.83], this.materials.get('rubber'), 'cart wheel', [Math.PI / 2, 0, 0], 14);
      addCylinder(root, 0.09, 0.09, 0.14, [x, 0.42, -0.83], steel, 'wheel hub', [Math.PI / 2, 0, 0], 10, false, true);
    }
    root.userData.counterPoints = [[0, 0, 1.75]];
    return root;
  }

  createCarousel(): Group {
    const root = makeRoot('Constellation Carousel', 'placeable');
    const concrete = this.materials.get('concrete');
    const teal = this.materials.get('paintTeal');
    const red = this.materials.get('paintRed');
    const cream = this.materials.get('paintCream');
    const brass = this.materials.get('brass');
    const dark = this.materials.get('steelDark');
    const glow = this.materials.get('lampGlow');
    const segments = this.quality === 'high' ? 40 : 32;

    addCylinder(root, 4.42, 4.42, 0.22, [0, 0.11, 0], concrete, 'circular foundation', ZERO_ROTATION, segments, false, true);
    addTorus(root, 4.1, 0.11, [0, 0.28, 0], brass, 'platform perimeter trim', [Math.PI / 2, 0, 0], segments, false);

    const rotating = new Group();
    rotating.name = 'carousel rotating assembly';
    root.add(rotating);
    addCylinder(rotating, 4.03, 4.03, 0.2, [0, 0.33, 0], teal, 'rotating deck', ZERO_ROTATION, segments);
    addCylinder(rotating, 0.42, 0.5, 4.7, [0, 2.68, 0], red, 'central drive mast', ZERO_ROTATION, 16);
    addCylinder(rotating, 0.54, 0.54, 0.18, [0, 0.51, 0], brass, 'mast bearing collar', ZERO_ROTATION, 16);
    addCylinder(rotating, 0.46, 0.46, 0.12, [0, 4.92, 0], brass, 'upper bearing collar', ZERO_ROTATION, 16);

    const roofGeometry = new ConeGeometry(4.48, 1.5, segments, 1, false);
    applyWorldUV(roofGeometry, 1);
    ensureAmbientOcclusionUV(roofGeometry);
    const roof = new Mesh(roofGeometry, cream);
    roof.name = 'tensioned carousel canopy';
    roof.position.y = 4.63;
    roof.castShadow = true;
    roof.receiveShadow = true;
    rotating.add(roof);
    addTorus(rotating, 4.43, 0.095, [0, 3.9, 0], red, 'canopy edge rail', [Math.PI / 2, 0, 0], segments);
    addCylinder(rotating, 0.08, 0.08, 0.8, [0, 5.75, 0], brass, 'finial stem', ZERO_ROTATION, 10);
    addSphere(rotating, 0.18, [0, 6.18, 0], brass, 'finial', [1, 1.25, 1], true, 12);

    const count = 12;
    const poleGeometry = new CylinderGeometry(0.032, 0.032, 3.1, 8);
    const bodyGeometry = new SphereGeometry(0.5, 10, 7);
    const headGeometry = new SphereGeometry(0.5, 9, 6);
    const legGeometry = new CylinderGeometry(0.045, 0.06, 0.72, 7);
    const saddleGeometry = new RoundedBoxGeometry(0.58, 0.12, 0.42, 1, 0.05);
    for (const geometry of [poleGeometry, bodyGeometry, headGeometry, legGeometry, saddleGeometry]) {
      applyWorldUV(geometry, 1);
      ensureAmbientOcclusionUV(geometry);
    }
    const poles = new InstancedMesh(poleGeometry, brass, count);
    const bodies = new InstancedMesh(bodyGeometry, cream, count);
    const heads = new InstancedMesh(headGeometry, cream, count);
    const legs = new InstancedMesh(legGeometry, cream, count * 2);
    const saddles = new InstancedMesh(saddleGeometry, red, count);
    poles.name = 'instanced brass ride poles';
    bodies.name = 'instanced carousel horse bodies';
    heads.name = 'instanced carousel horse heads';
    legs.name = 'instanced carousel horse legs';
    saddles.name = 'instanced saddles';
    bodies.castShadow = true;
    heads.castShadow = true;
    saddles.castShadow = true;
    for (const mesh of [poles, bodies, heads, legs, saddles]) mesh.receiveShadow = true;

    const rotation = new Quaternion();
    const localOffset = new Vector3();
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const bob = index % 2 === 0 ? 0.2 : -0.05;
      rotation.setFromEuler(new Euler(0, angle, 0));
      const base = polar(2.78, angle, 0);
      setInstance(poles, index, new Vector3(base.x, 2.24, base.z), new Quaternion());
      setInstance(bodies, index, new Vector3(base.x, 2.0 + bob, base.z), rotation, new Vector3(1.0, 0.58, 1.35));
      localOffset.set(0, 0.35, 0.68).applyQuaternion(rotation).add(base);
      localOffset.y += 2.0 + bob;
      setInstance(heads, index, localOffset, rotation, new Vector3(0.52, 0.72, 0.56));
      localOffset.set(0, 0.36, -0.06).applyQuaternion(rotation).add(base);
      localOffset.y += 2.0 + bob;
      setInstance(saddles, index, localOffset, rotation);
      for (let leg = 0; leg < 2; leg += 1) {
        localOffset
          .set(leg === 0 ? -0.25 : 0.25, -0.55, leg === 0 ? 0.27 : -0.25)
          .applyQuaternion(rotation)
          .add(base);
        localOffset.y += 2.0 + bob;
        const legRotation = rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(0.15, 0, leg === 0 ? -0.25 : 0.25)));
        setInstance(legs, index * 2 + leg, localOffset, legRotation);
      }
    }
    for (const mesh of [poles, bodies, heads, legs, saddles]) {
      mesh.instanceMatrix.needsUpdate = true;
      rotating.add(mesh);
    }

    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      const point = polar(4.23, angle, 3.82);
      addSphere(rotating, 0.075, [point.x, point.y, point.z], glow, 'canopy bulb', [1, 1, 1], false, 8);
    }
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const outer = polar(4.0, angle, 0.62);
      addBrace(rotating, [outer.x, 0.62, outer.z], [outer.x, 1.08, outer.z], 0.035, dark, 'deck guard post', false);
    }

    root.userData.operating = true;
    this.registerAnimation(root, ({ delta, activity }) => {
      if (root.userData.operating === false) return;
      rotating.rotation.y += delta * 0.34 * activity;
    });
    return root;
  }

  createSkyWheel(): Group {
    const root = makeRoot('Aurora Sky Wheel', 'placeable');
    const concrete = this.materials.get('concrete');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const teal = this.materials.get('paintTeal');
    const red = this.materials.get('paintRed');
    const cream = this.materials.get('paintCream');
    const brass = this.materials.get('brass');
    const glow = this.materials.get('lampGlow');
    const wheelSegments = this.quality === 'high' ? 72 : 56;

    addBox(root, [10.9, 0.24, 5.8], [0, 0.12, 0], concrete, 'reinforced foundation', 0.09, ZERO_ROTATION, false, true);
    for (const x of [-3.85, 3.85]) {
      for (const z of [-1.35, 1.35]) {
        addBox(root, [1.2, 0.28, 1.1], [x, 0.35, z], concrete, 'support footing', 0.08);
        addBox(root, [0.56, 0.12, 0.56], [x, 0.56, z], steel, 'support base plate', 0.025);
        for (const bx of [-0.2, 0.2]) {
          for (const bz of [-0.2, 0.2]) addBolt(root, [x + bx, 0.64, z + bz], dark, ZERO_ROTATION, 0.045);
        }
      }
    }

    const hubY = 5.45;
    for (const z of [-0.58, 0.58]) {
      addBrace(root, [-3.85, 0.62, z * 2.25], [-0.58, hubY, z], 0.14, dark, 'left A-frame leg');
      addBrace(root, [3.85, 0.62, z * 2.25], [0.58, hubY, z], 0.14, dark, 'right A-frame leg');
      addBrace(root, [-3.0, 1.88, z * 1.8], [3.0, 1.88, z * 1.8], 0.065, steel, 'lower cross brace');
      addBrace(root, [-2.25, 3.0, z * 1.45], [2.25, 3.0, z * 1.45], 0.055, steel, 'middle cross brace');
      addBrace(root, [-3.3, 1.4, z * 1.9], [2.45, 3.0, z * 1.45], 0.045, steel, 'diagonal lattice brace', false);
      addBrace(root, [3.3, 1.4, z * 1.9], [-2.45, 3.0, z * 1.45], 0.045, steel, 'diagonal lattice brace', false);
    }

    const wheel = new Group();
    wheel.name = 'rotating observation wheel';
    wheel.position.y = hubY;
    root.add(wheel);
    for (const z of [-0.32, 0.32]) {
      addTorus(wheel, 4.58, 0.09, [0, 0, z], teal, 'double wheel rim', ZERO_ROTATION, wheelSegments);
      for (let spoke = 0; spoke < 16; spoke += 1) {
        const angle = (spoke / 16) * Math.PI * 2;
        addBrace(
          wheel,
          [0, 0, z],
          [Math.cos(angle) * 4.48, Math.sin(angle) * 4.48, z],
          0.028,
          spoke % 2 === 0 ? steel : dark,
          'tension spoke',
          false,
        );
      }
    }
    addCylinder(wheel, 0.34, 0.34, 1.65, [0, 0, 0], brass, 'main axle', [Math.PI / 2, 0, 0], 16);
    addCylinder(wheel, 0.53, 0.53, 0.22, [0, 0, -0.48], dark, 'hub bearing', [Math.PI / 2, 0, 0], 16);
    addCylinder(wheel, 0.53, 0.53, 0.22, [0, 0, 0.48], dark, 'hub bearing', [Math.PI / 2, 0, 0], 16);

    const gondolas: Group[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const hanger = new Group();
      hanger.name = `gondola ${index + 1}`;
      hanger.position.set(Math.cos(angle) * 4.55, Math.sin(angle) * 4.55, 0);
      wheel.add(hanger);
      gondolas.push(hanger);
      addBrace(hanger, [0, 0.02, -0.42], [0, -0.62, -0.42], 0.035, brass, 'gondola hanger', false);
      addBrace(hanger, [0, 0.02, 0.42], [0, -0.62, 0.42], 0.035, brass, 'gondola hanger', false);
      const cabinColor = index % 2 === 0 ? red : cream;
      addBox(hanger, [1.05, 0.52, 0.95], [0, -0.88, 0], cabinColor, 'gondola cabin', 0.12);
      addBox(hanger, [1.12, 0.1, 1.02], [0, -0.56, 0], dark, 'gondola roof', 0.045);
      addBox(hanger, [0.72, 0.28, 0.018], [0, -0.82, 0.49], this.materials.get('glass'), 'gondola glazing', 0.005, ZERO_ROTATION, false, false);
      addBox(hanger, [0.78, 0.06, 0.06], [0, -0.72, 0.53], brass, 'gondola safety rail', 0.018, ZERO_ROTATION, false, false);
      addBolt(hanger, [-0.44, -0.56, 0], steel, [0, 0, Math.PI / 2], 0.035);
      addBolt(hanger, [0.44, -0.56, 0], steel, [0, 0, Math.PI / 2], 0.035);
    }

    addBox(root, [3.4, 0.16, 1.65], [0, 0.42, 2.0], dark, 'loading platform', 0.05);
    addBox(root, [3.5, 0.82, 0.12], [0, 0.85, 2.76], teal, 'operator rail panel', 0.025);
    for (const x of [-1.68, -0.56, 0.56, 1.68]) {
      addBox(root, [0.06, 1.0, 0.06], [x, 0.91, 2.76], brass, 'queue rail post', 0.015, ZERO_ROTATION, false, true);
    }
    addBox(root, [1.55, 0.82, 1.0], [-4.55, 0.62, 1.6], cream, 'operator cabinet', 0.06);
    addBox(root, [1.1, 0.35, 0.02], [-4.55, 0.7, 2.11], dark, 'operator control panel', 0.01, ZERO_ROTATION, false, true);
    for (const x of [-4.9, -4.55, -4.2]) addSphere(root, 0.055, [x, 0.77, 2.14], x === -4.55 ? glow : red, 'control button', [1, 0.45, 1], false, 8);
    this.addSign(root, 'AURORA SKY WHEEL', [3.4, 0.54], [0, 2.0, 2.75], 0x214e62, 0xf3d797, 'OBSERVATION RIDE');

    root.userData.operating = true;
    this.registerAnimation(root, ({ delta, activity }) => {
      if (root.userData.operating === false) return;
      wheel.rotation.z -= delta * 0.11 * activity;
      for (const gondola of gondolas) gondola.rotation.z = -wheel.rotation.z;
    });
    return root;
  }

  createRestroom(): Group {
    const root = makeRoot('Park Comfort Station', 'placeable');
    const concrete = this.materials.get('concrete');
    const brick = this.materials.get('brick');
    const cream = this.materials.get('paintCream');
    const teal = this.materials.get('paintTeal');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const glow = this.materials.get('lampGlow');

    addBox(root, [5.8, 0.18, 3.8], [0, 0.09, 0], concrete, 'accessible foundation', 0.07, ZERO_ROTATION, false, true);
    addBox(root, [5.45, 2.65, 0.22], [0, 1.5, -1.66], brick, 'rear masonry wall', 0.04);
    addBox(root, [0.24, 2.65, 3.25], [-2.61, 1.5, -0.04], brick, 'left masonry wall', 0.045);
    addBox(root, [0.24, 2.65, 3.25], [2.61, 1.5, -0.04], brick, 'right masonry wall', 0.045);
    addBox(root, [0.86, 2.65, 0.22], [0, 1.5, 1.58], brick, 'center door pier', 0.04);
    addBox(root, [0.42, 2.65, 0.22], [-2.38, 1.5, 1.58], brick, 'left door jamb wall', 0.04);
    addBox(root, [0.42, 2.65, 0.22], [2.38, 1.5, 1.58], brick, 'right door jamb wall', 0.04);
    addBox(root, [5.45, 0.46, 0.22], [0, 2.6, 1.58], brick, 'front lintel wall', 0.04);

    for (const x of [-1.28, 1.28]) {
      addBox(root, [1.65, 2.15, 0.11], [x, 1.33, 1.72], teal, 'restroom door', 0.045);
      addBox(root, [1.82, 0.08, 0.18], [x, 2.45, 1.69], dark, 'door head frame', 0.018);
      addBox(root, [0.08, 2.28, 0.18], [x - 0.87, 1.34, 1.69], dark, 'door jamb', 0.018);
      addBox(root, [0.08, 2.28, 0.18], [x + 0.87, 1.34, 1.69], dark, 'door jamb', 0.018);
      addCylinder(root, 0.045, 0.045, 0.14, [x + (x < 0 ? 0.55 : -0.55), 1.3, 1.83], steel, 'lever handle', [Math.PI / 2, 0, 0], 10, false, true);
      addBox(root, [0.76, 0.07, 0.03], [x, 0.29, 1.83], steel, 'door kick plate trim', 0.012, ZERO_ROTATION, false, false);
    }
    this.addSign(root, 'RESTROOM', [2.35, 0.46], [0, 2.88, 1.71], 0x2a6868, 0xf5e9cb, 'ACCESSIBLE • FAMILY');

    addBox(root, [5.75, 0.2, 3.65], [0, 2.91, -0.02], cream, 'sloped roof deck', 0.06, [-0.025, 0, 0]);
    addBox(root, [5.86, 0.12, 0.14], [0, 2.81, 1.75], dark, 'roof drip edge', 0.025);
    addBox(root, [0.13, 2.35, 0.13], [2.78, 1.65, -1.55], dark, 'rain downspout', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [0.5, 0.16, 0.5], [-1.45, 3.13, -0.52], steel, 'roof vent curb', 0.035);
    addCylinder(root, 0.17, 0.17, 0.5, [-1.45, 3.44, -0.52], steel, 'roof vent', ZERO_ROTATION, 12);
    addCylinder(root, 0.27, 0.17, 0.08, [-1.45, 3.72, -0.52], steel, 'vent rain cap', ZERO_ROTATION, 12, false, true);

    for (let x = -1.9; x <= 1.9; x += 0.38) {
      addBox(root, [0.28, 0.045, 0.055], [x, 2.24, -1.79], dark, 'ventilation louver', 0.012, [0.12, 0, 0], false, false);
    }
    for (const x of [-2.15, 2.15]) {
      addBox(root, [0.26, 0.12, 0.2], [x, 2.52, 1.79], dark, 'shielded wall light', 0.03, [0.16, 0, 0], false, true);
      addSphere(root, 0.075, [x, 2.44, 1.87], glow, 'wall light lens', [1.3, 0.6, 0.8], false, 8);
    }
    addBox(root, [1.75, 0.08, 0.65], [-1.28, 0.23, 2.0], concrete, 'flush threshold', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [1.75, 0.08, 0.65], [1.28, 0.23, 2.0], concrete, 'flush threshold', 0.025, ZERO_ROTATION, false, true);
    root.userData.entryPoints = [[-1.28, 0, 2.2], [1.28, 0, 2.2]];
    return root;
  }

  createTrashBin(): Group {
    const root = makeRoot('Sorting Bin', 'placeable');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const green = this.materials.get('paintGreen');
    const yellow = this.materials.get('paintYellow');
    const rubber = this.materials.get('rubber');

    addBox(root, [0.92, 0.08, 0.72], [0, 0.04, 0], this.materials.get('concreteDark'), 'bin anchor pad', 0.04, ZERO_ROTATION, false, true);
    addBox(root, [0.82, 0.95, 0.62], [0, 0.54, 0], dark, 'bin welded enclosure', 0.075);
    addBox(root, [0.36, 0.68, 0.02], [-0.2, 0.49, 0.321], green, 'waste door panel', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [0.36, 0.68, 0.02], [0.2, 0.49, 0.321], yellow, 'recycling door panel', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [0.38, 0.08, 0.18], [-0.2, 0.85, 0.37], rubber, 'waste aperture', 0.035, ZERO_ROTATION, false, false);
    addCylinder(root, 0.11, 0.11, 0.05, [0.2, 0.85, 0.37], rubber, 'bottle aperture', [Math.PI / 2, 0, 0], 14, false, false);
    addBox(root, [0.9, 0.11, 0.7], [0, 1.075, 0], steel, 'weather lid', 0.055);
    addBox(root, [0.28, 0.055, 0.14], [0, 0.13, 0.36], rubber, 'foot pedal', 0.025, [-0.1, 0, 0], false, true);
    addBox(root, [0.68, 0.025, 0.025], [0, 0.54, -0.326], steel, 'rear service hinge', 0.008, ZERO_ROTATION, false, false);
    for (const x of [-0.34, 0.34]) {
      for (const y of [0.2, 0.87]) addBolt(root, [x, y, 0.345], steel, ZERO_ROTATION, 0.026);
    }
    this.addSign(root, 'WASTE   RECYCLE', [0.7, 0.13], [0, 0.65, 0.355], 0x20282a, 0xf3e8d0);
    root.userData.fillIndicator = 0;
    return root;
  }

  createBench(): Group {
    const root = makeRoot('Slatted Park Bench', 'placeable');
    const timber = this.materials.get('timber');
    const darkTimber = this.materials.get('timberDark');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('steel');

    addBox(root, [2.25, 0.07, 0.92], [0, 0.035, 0], this.materials.get('concrete'), 'bench footing', 0.035, ZERO_ROTATION, false, true);
    for (const x of [-0.75, 0.75]) {
      addBox(root, [0.11, 0.62, 0.11], [x, 0.36, -0.12], dark, 'cast steel leg', 0.035);
      addBox(root, [0.48, 0.1, 0.11], [x, 0.11, -0.03], dark, 'bolted foot', 0.03);
      addBrace(root, [x, 0.48, -0.36], [x, 1.05, -0.46], 0.05, dark, 'back support');
      addBolt(root, [x - 0.15, 0.17, 0], steel, ZERO_ROTATION, 0.028);
      addBolt(root, [x + 0.15, 0.17, 0], steel, ZERO_ROTATION, 0.028);
    }
    for (let slat = 0; slat < 5; slat += 1) {
      addBox(root, [2.02, 0.085, 0.14], [0, 0.67, 0.32 - slat * 0.16], slat === 2 ? darkTimber : timber, 'seat timber slat', 0.028);
    }
    for (let slat = 0; slat < 4; slat += 1) {
      addBox(root, [2.02, 0.15, 0.075], [0, 0.83 + slat * 0.17, -0.46], slat === 1 ? darkTimber : timber, 'back timber slat', 0.03, [-0.08, 0, 0]);
    }
    for (const x of [-1.03, 1.03]) {
      addBox(root, [0.09, 0.46, 0.09], [x, 0.73, 0.12], dark, 'armrest upright', 0.03);
      addBox(root, [0.1, 0.09, 0.58], [x, 0.96, 0.02], dark, 'curved armrest', 0.035, [0.04, 0, 0]);
      for (const y of [0.87, 1.22]) addBolt(root, [x, y, -0.505], steel, ZERO_ROTATION, 0.025);
    }
    root.userData.seatPoints = [[-0.52, 0.74, 0.02], [0.52, 0.74, 0.02]];
    return root;
  }

  createParkLamp(): Group {
    const root = makeRoot('Shielded Park Lamp', 'placeable');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('steel');
    const copper = this.materials.get('copper');
    const glow = this.materials.get('lampGlow');

    addCylinder(root, 0.34, 0.39, 0.16, [0, 0.08, 0], this.materials.get('concreteDark'), 'lamp foundation', ZERO_ROTATION, 14, false, true);
    addCylinder(root, 0.22, 0.28, 0.28, [0, 0.29, 0], dark, 'bolted lamp base', ZERO_ROTATION, 12);
    addCylinder(root, 0.08, 0.11, 3.02, [0, 1.88, 0], dark, 'tapered pole', ZERO_ROTATION, 12);
    addCylinder(root, 0.12, 0.12, 0.08, [0, 0.5, 0], copper, 'lower collar', ZERO_ROTATION, 12, false, true);
    addCylinder(root, 0.105, 0.105, 0.08, [0, 3.36, 0], copper, 'upper collar', ZERO_ROTATION, 12, false, true);
    addBrace(root, [0, 3.35, 0], [0, 3.72, 0.36], 0.055, dark, 'luminaire swan neck');
    addBrace(root, [0, 3.72, 0.36], [0, 3.72, 0.72], 0.055, dark, 'luminaire arm');
    addCylinder(root, 0.32, 0.12, 0.18, [0, 3.64, 0.75], dark, 'full cutoff shade', ZERO_ROTATION, 16);
    addCylinder(root, 0.18, 0.18, 0.1, [0, 3.53, 0.75], glow, 'warm LED lens', ZERO_ROTATION, 12, false, false);
    addBox(root, [0.18, 0.1, 0.24], [0, 3.76, 0.47], steel, 'driver enclosure', 0.035, ZERO_ROTATION, false, true);
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      addBolt(root, [Math.sin(angle) * 0.2, 0.18, Math.cos(angle) * 0.2], steel, ZERO_ROTATION, 0.025);
    }
    root.userData.lightAnchor = [0, 3.48, 0.75];
    root.userData.lightColor = 0xffc45b;
    root.userData.lightIntensity = 1.35;
    return root;
  }

  createShadeTree(): Group {
    const root = makeRoot('Copper Beech', 'placeable');
    const soil = this.materials.get('soil');
    const bark = this.materials.get('bark');
    const leaf = this.materials.get('leaf');
    const leafLight = this.materials.get('leafLight');
    const dark = this.materials.get('steelDark');

    addCylinder(root, 1.15, 1.3, 0.12, [0, 0.06, 0], soil, 'mulched root bed', ZERO_ROTATION, 18, false, true);
    addCylinder(root, 0.2, 0.34, 2.7, [0, 1.4, 0], bark, 'tapered trunk', ZERO_ROTATION, 12);
    addCylinder(root, 0.13, 0.2, 1.6, [-0.42, 2.7, 0.03], bark, 'left scaffold branch', [0, 0, -0.55], 10);
    addCylinder(root, 0.12, 0.18, 1.5, [0.48, 2.78, -0.05], bark, 'right scaffold branch', [0.05, 0, 0.62], 10);
    addCylinder(root, 0.1, 0.16, 1.3, [0.08, 3.0, -0.42], bark, 'rear scaffold branch', [0.6, 0, 0.12], 10);
    const crown: ReadonlyArray<{ p: XYZ; s: XYZ; light: boolean }> = [
      { p: [-0.95, 3.55, 0.05], s: [1.35, 1.0, 1.12], light: false },
      { p: [0.75, 3.65, 0.12], s: [1.25, 1.05, 1.18], light: true },
      { p: [0, 4.15, 0], s: [1.35, 1.12, 1.2], light: false },
      { p: [-0.25, 3.62, -0.95], s: [1.15, 0.9, 1.15], light: true },
      { p: [0.34, 3.46, 0.98], s: [1.25, 0.93, 1.12], light: false },
      { p: [-1.15, 3.18, -0.62], s: [0.9, 0.82, 0.9], light: true },
      { p: [1.22, 3.2, 0.58], s: [0.94, 0.84, 0.9], light: false },
    ];
    for (const [index, cluster] of crown.entries()) {
      const geometry = new IcosahedronGeometry(0.86, this.quality === 'high' ? 2 : 1);
      applyWorldUV(geometry, 1);
      ensureAmbientOcclusionUV(geometry);
      const mesh = new Mesh(geometry, cluster.light ? leafLight : leaf);
      mesh.name = `layered foliage cluster ${index + 1}`;
      mesh.position.set(...cluster.p);
      mesh.scale.set(...cluster.s);
      mesh.rotation.set(index * 0.17, index * 0.73, index * 0.11);
      mesh.castShadow = index < 4;
      mesh.receiveShadow = true;
      root.add(mesh);
    }

    addTorus(root, 0.72, 0.035, [0, 0.62, 0], dark, 'tree guard ring', [Math.PI / 2, 0, 0], 24, false);
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2;
      const p = polar(0.72, angle, 0.4);
      addBox(root, [0.055, 0.78, 0.055], [p.x, p.y, p.z], dark, 'tree guard upright', 0.015, ZERO_ROTATION, false, true);
    }
    root.userData.windResponsive = true;
    return root;
  }

  /** Entrance architecture is separate from the build catalog and aligns across X. */
  createParkGate(): Group {
    const root = makeRoot('Parkworks Entrance Gate', 'gate');
    const brick = this.materials.get('brick');
    const concrete = this.materials.get('concrete');
    const dark = this.materials.get('steelDark');
    const teal = this.materials.get('paintTeal');
    const brass = this.materials.get('brass');
    const glow = this.materials.get('lampGlow');

    addBox(root, [11.5, 0.14, 2.3], [0, 0.07, 0], concrete, 'gate pavement slab', 0.06, ZERO_ROTATION, false, true);
    for (const x of [-4.2, 4.2]) {
      addBox(root, [1.35, 3.75, 1.35], [x, 1.95, 0], brick, 'gate masonry pier', 0.06);
      addBox(root, [1.55, 0.2, 1.55], [x, 0.22, 0], concrete, 'pier footing', 0.055);
      addBox(root, [1.52, 0.18, 1.52], [x, 3.9, 0], concrete, 'pier cap', 0.065);
      addBox(root, [1.43, 0.12, 1.43], [x, 2.35, 0], concrete, 'pier belt course', 0.025);
      addBox(root, [0.44, 0.62, 0.18], [x, 2.85, 0.73], dark, 'shielded gate lantern', 0.055);
      addSphere(root, 0.13, [x, 2.71, 0.83], glow, 'gate lantern lens', [1.25, 0.75, 0.6], false, 10);
    }

    addBox(root, [7.18, 0.34, 0.42], [0, 3.75, 0], dark, 'gate header beam', 0.06);
    addBrace(root, [-3.52, 3.92, 0], [-2.7, 4.72, 0], 0.075, teal, 'left arch chord');
    addBrace(root, [-2.7, 4.72, 0], [0, 5.05, 0], 0.075, teal, 'left arch chord');
    addBrace(root, [0, 5.05, 0], [2.7, 4.72, 0], 0.075, teal, 'right arch chord');
    addBrace(root, [2.7, 4.72, 0], [3.52, 3.92, 0], 0.075, teal, 'right arch chord');
    for (const x of [-2.7, -1.35, 0, 1.35, 2.7]) {
      const top = 5.05 - Math.abs(x) * 0.13;
      addBrace(root, [x, 3.92, 0], [x, top, 0], 0.035, brass, 'arch hanger', false);
    }
    addBox(root, [5.5, 0.82, 0.2], [0, 4.35, 0.05], teal, 'entrance sign chassis', 0.085);
    this.addSign(root, 'PARKWORKS', [5.15, 0.64], [0, 4.36, 0.17], 0x28666a, 0xf6deb0, 'ADVENTURE GARDENS');

    for (const x of [-2.1, 0, 2.1]) {
      addCylinder(root, 0.1, 0.13, 1.05, [x, 0.61, 0.18], dark, 'turnstile pedestal', ZERO_ROTATION, 12);
      addCylinder(root, 0.12, 0.12, 0.26, [x, 1.12, 0.18], brass, 'turnstile hub', [Math.PI / 2, 0, 0], 12, false, true);
      for (let arm = 0; arm < 3; arm += 1) {
        const angle = (arm / 3) * Math.PI * 2;
        addBrace(root, [x, 1.12, 0.18], [x + Math.cos(angle) * 0.62, 1.12 + Math.sin(angle) * 0.62, 0.18], 0.025, steelOrDark(this.materials), 'turnstile arm', false);
      }
      addBox(root, [0.48, 0.12, 0.4], [x, 0.12, 0.18], dark, 'turnstile anchor plate', 0.035, ZERO_ROTATION, false, true);
    }

    for (const side of [-1, 1]) {
      const x = side * 5.3;
      addBox(root, [2.05, 0.09, 0.09], [x, 1.0, 0], dark, 'gate side rail', 0.02, ZERO_ROTATION, false, true);
      addBox(root, [2.05, 0.09, 0.09], [x, 1.65, 0], dark, 'gate side rail', 0.02, ZERO_ROTATION, false, true);
      for (const px of [side * 4.75, side * 5.85]) {
        addBox(root, [0.1, 1.9, 0.1], [px, 0.98, 0], dark, 'gate fence post', 0.025, ZERO_ROTATION, false, true);
      }
    }
    root.userData.spawnPoint = [0, 0, -2.4];
    root.userData.exitPoint = [0, 0, 2.4];
    return root;
  }

  /** Build the 64 m park parcel, crossing promenade, beds, edging, and boundary fence. */
  createLandscape(options: LandscapeOptions = {}): Group {
    const width = Math.max(40, options.width ?? 64);
    const depth = Math.max(46, options.depth ?? 66);
    const root = makeRoot('Parkworks Landscape', 'landscape');
    const grass = this.materials.get('grass');
    const path = this.materials.get('path');
    const concrete = this.materials.get('concrete');
    const soil = this.materials.get('soil');
    const dark = this.materials.get('steelDark');

    const lawn = planeMesh(width, depth, grass, {
      name: 'meter-scaled grass parcel',
      position: [0, -0.08, 0],
      rotation: [-Math.PI / 2, 0, 0],
      receiveShadow: true,
      castShadow: false,
      texelScale: 1,
    });
    root.add(lawn);
    addBox(root, [5.8, 0.11, depth - 4], [0, -0.005, 0], path, 'north south promenade', 0.08, ZERO_ROTATION, false, true);
    addBox(root, [width - 8, 0.11, 5.8], [0, 0.002, -0.6], path, 'east west promenade', 0.08, ZERO_ROTATION, false, true);

    const northLength = (depth - 4) / 2;
    for (const x of [-3.02, 3.02]) {
      addBox(root, [0.16, 0.14, depth - 4], [x, 0.02, 0], concrete, 'promenade edge restraint', 0.035, ZERO_ROTATION, false, true);
    }
    for (const z of [-3.62, 2.42]) {
      addBox(root, [width - 8, 0.14, 0.16], [0, 0.025, z], concrete, 'cross path edge restraint', 0.035, ZERO_ROTATION, false, true);
    }
    void northLength;

    for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
      addCylinder(root, 1.4, 1.55, 0.12, [x, 0.01, z], soil, 'ornamental planting bed', ZERO_ROTATION, 18, false, true);
      addTorus(root, 1.47, 0.055, [x, 0.08, z], concrete, 'planting bed curb', [Math.PI / 2, 0, 0], 24, false);
      for (let plant = 0; plant < 5; plant += 1) {
        const angle = (plant / 5) * Math.PI * 2 + x * 0.03;
        const p = polar(0.72, angle, 0.24);
        addSphere(root, 0.23, [x + p.x, p.y, z + p.z], plant % 2 === 0 ? this.materials.get('leafLight') : this.materials.get('leaf'), 'planting mound', [1, 0.75, 1], false, 8);
      }
    }

    if (options.includeFence !== false) this.addBoundaryFence(root, width, depth, dark);
    root.userData.bounds = { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 };
    root.userData.buildBounds = { minX: -27, maxX: 27, minZ: -27, maxZ: 27 };
    return root;
  }

  createPlayer(): Group {
    const root = this.createHumanoid({
      name: 'Park Caretaker',
      shirt: 0x315c85,
      trousers: 0x26323b,
      skin: 0xdba77f,
      hair: 0x3b2a22,
      worker: true,
    });
    root.userData.assetType = 'player';
    root.userData.motion = 0;
    return root;
  }

  createGuest(options: GuestAssetOptions | number = {}): Group {
    const resolved: GuestAssetOptions = typeof options === 'number' ? { paletteIndex: options } : options;
    const paletteIndex = Math.abs(Math.floor(resolved.paletteIndex ?? 0));
    const root = this.createHumanoid({
      name: `Park Guest ${paletteIndex + 1}`,
      shirt: SHIRT_PALETTE[paletteIndex % SHIRT_PALETTE.length] ?? SHIRT_PALETTE[0],
      trousers: TROUSER_PALETTE[paletteIndex % TROUSER_PALETTE.length] ?? TROUSER_PALETTE[0],
      skin: SKIN_PALETTE[paletteIndex % SKIN_PALETTE.length] ?? SKIN_PALETTE[0],
      hair: HAIR_PALETTE[(paletteIndex * 3) % HAIR_PALETTE.length] ?? HAIR_PALETTE[0],
      worker: false,
    });
    root.name = `Guest ${paletteIndex + 1}`;
    root.userData.assetType = 'guest';
    root.userData.paletteIndex = paletteIndex;
    root.userData.motion = 0;
    root.userData.carryingTrash = resolved.carryingTrash ?? false;
    root.scale.setScalar(Math.max(0.72, Math.min(1.08, resolved.ageScale ?? 1)));
    return root;
  }

  createLitter(variant = 0): Group {
    const root = makeRoot(`Litter ${variant}`, 'litter');
    const normalized = ((Math.floor(variant) % 4) + 4) % 4;
    if (normalized === 0) {
      addBox(root, [0.28, 0.025, 0.22], [0, 0.035, 0], this.materials.get('cardboard'), 'creased food wrapper', 0.015, [0.08, 0.35, -0.06], false, true);
      addBox(root, [0.11, 0.012, 0.2], [0.12, 0.055, 0.02], this.materials.get('paper'), 'wrapper folded flap', 0.006, [0.13, -0.2, 0.22], false, true);
    } else if (normalized === 1) {
      addCylinder(root, 0.09, 0.065, 0.24, [0, 0.13, 0], this.materials.get('paper'), 'discarded drink cup', [0.1, 0, 0.25], 12, false, true);
      addCylinder(root, 0.095, 0.095, 0.018, [-0.03, 0.24, 0], this.materials.get('paintWhite'), 'cup lid', [0.1, 0, 0.25], 12, false, true);
      addCylinder(root, 0.009, 0.009, 0.2, [-0.08, 0.34, 0], this.materials.get('paintRed'), 'cup straw', [0.08, 0, 0.42], 7, false, false);
    } else if (normalized === 2) {
      const paper = new Mesh(new PlaneGeometry(0.34, 0.26, 2, 2), this.materials.get('paper'));
      paper.name = 'crumpled napkin';
      paper.rotation.set(-Math.PI / 2 + 0.08, 0.45, 0.12);
      paper.position.y = 0.025;
      paper.scale.set(1, 0.75, 1);
      paper.receiveShadow = true;
      root.add(paper);
    } else {
      addCylinder(root, 0.065, 0.065, 0.25, [0, 0.08, 0], this.materials.get('steel'), 'aluminum can', [Math.PI / 2, 0.18, 0.4], 12, false, true);
      addCylinder(root, 0.05, 0.05, 0.01, [0.1, 0.15, -0.04], this.materials.get('steelDark'), 'can pull tab', [Math.PI / 2, 0.18, 0.4], 10, false, false);
    }
    root.userData.variant = normalized;
    root.userData.collectRadius = 1.7;
    return root;
  }

  /** Update one asset's registered mechanical or character animation hooks. */
  animate(asset: Object3D, elapsed: number, delta: number, activity?: number): void {
    const hooks = this.animationHooks.get(asset);
    if (!hooks) return;
    const storedMotion = asset.userData.motion;
    const resolvedActivity = activity ?? (typeof storedMotion === 'number' ? storedMotion : 1);
    const context: AssetAnimationContext = {
      elapsed,
      delta: Math.min(Math.max(delta, 0), 0.1),
      activity: Math.max(0, Math.min(1.5, resolvedActivity)),
    };
    for (const hook of hooks) hook(context);
  }

  setCharacterMotion(character: Object3D, normalizedSpeed: number, carryingTrash?: boolean): void {
    character.userData.motion = Math.max(0, Math.min(1.5, normalizedSpeed));
    if (carryingTrash !== undefined) character.userData.carryingTrash = carryingTrash;
  }

  dispose(): void {
    for (const material of this.signMaterials.values()) material.dispose();
    for (const texture of this.signTextures) texture.dispose();
    this.signMaterials.clear();
    this.signTextures.clear();
    if (this.ownsMaterials) this.materials.dispose();
  }

  private addBoundaryFence(root: Group, width: number, depth: number, material: Material): void {
    const spacing = 3.2;
    const positions: Vector3[] = [];
    for (let x = -width / 2; x <= width / 2 + 0.01; x += spacing) {
      positions.push(new Vector3(x, 0.72, -depth / 2));
      if (Math.abs(x) > 5.6) positions.push(new Vector3(x, 0.72, depth / 2));
    }
    for (let z = -depth / 2 + spacing; z < depth / 2; z += spacing) {
      positions.push(new Vector3(-width / 2, 0.72, z), new Vector3(width / 2, 0.72, z));
    }
    const geometry = new RoundedBoxGeometry(0.13, 1.42, 0.13, 1, 0.025);
    applyWorldUV(geometry, 1);
    ensureAmbientOcclusionUV(geometry);
    const posts = new InstancedMesh(geometry, material, positions.length);
    posts.name = 'instanced boundary fence posts';
    posts.receiveShadow = true;
    const identity = new Quaternion();
    for (const [index, position] of positions.entries()) setInstance(posts, index, position, identity);
    posts.instanceMatrix.needsUpdate = true;
    root.add(posts);

    const railY = [0.55, 1.08];
    for (const y of railY) {
      addBox(root, [width, 0.065, 0.07], [0, y, -depth / 2], material, 'north boundary rail', 0.018, ZERO_ROTATION, false, true);
      addBox(root, [(width - 11.2) / 2, 0.065, 0.07], [-(width + 11.2) / 4, y, depth / 2], material, 'south boundary rail', 0.018, ZERO_ROTATION, false, true);
      addBox(root, [(width - 11.2) / 2, 0.065, 0.07], [(width + 11.2) / 4, y, depth / 2], material, 'south boundary rail', 0.018, ZERO_ROTATION, false, true);
      addBox(root, [0.07, 0.065, depth], [-width / 2, y, 0], material, 'west boundary rail', 0.018, ZERO_ROTATION, false, true);
      addBox(root, [0.07, 0.065, depth], [width / 2, y, 0], material, 'east boundary rail', 0.018, ZERO_ROTATION, false, true);
    }
  }

  private createHumanoid(options: {
    name: string;
    shirt: number;
    trousers: number;
    skin: number;
    hair: number;
    worker: boolean;
  }): Group {
    const root = makeRoot(options.name, 'character');
    const shirt = this.materials.paint(options.shirt, 0.68);
    const trousers = this.materials.paint(options.trousers, 0.74);
    const skin = this.materials.paint(options.skin, 0.6);
    const hair = this.materials.paint(options.hair, 0.78);
    const shoes = this.materials.get('rubber');
    const steel = this.materials.get('steelDark');

    const torso = addBox(root, [0.52, 0.66, 0.29], [0, 1.2, 0], shirt, 'seamed torso garment', 0.14);
    torso.scale.x = 1.02;
    addBox(root, [0.48, 0.12, 0.3], [0, 0.84, 0], trousers, 'waistband', 0.045, ZERO_ROTATION, false, true);
    addCylinder(root, 0.15, 0.16, 0.2, [0, 1.67, 0], skin, 'neck', ZERO_ROTATION, 10, false, true);
    addSphere(root, 0.25, [0, 1.93, 0.01], skin, 'head', [0.9, 1.08, 0.92], true, 14);
    addSphere(root, 0.245, [0, 2.04, -0.025], hair, 'hair cap', [0.93, 0.58, 0.94], true, 12);
    addBox(root, [0.055, 0.035, 0.02], [-0.085, 1.95, 0.235], steel, 'left eye', 0.009, ZERO_ROTATION, false, false);
    addBox(root, [0.055, 0.035, 0.02], [0.085, 1.95, 0.235], steel, 'right eye', 0.009, ZERO_ROTATION, false, false);

    const leftArm = new Group();
    const rightArm = new Group();
    leftArm.name = 'left arm rig';
    rightArm.name = 'right arm rig';
    leftArm.position.set(-0.35, 1.43, 0);
    rightArm.position.set(0.35, 1.43, 0);
    root.add(leftArm, rightArm);
    for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
      addCylinder(arm, 0.075, 0.085, 0.48, [0, -0.22, 0], shirt, 'sleeved upper arm', ZERO_ROTATION, 9);
      addCylinder(arm, 0.065, 0.075, 0.38, [0, -0.62, 0], skin, 'forearm', ZERO_ROTATION, 9);
      addSphere(arm, 0.075, [0, -0.84, 0], skin, 'hand', [0.9, 1.1, 0.8], false, 9);
      arm.rotation.z = side * 0.06;
    }

    const leftLeg = new Group();
    const rightLeg = new Group();
    leftLeg.name = 'left leg rig';
    rightLeg.name = 'right leg rig';
    leftLeg.position.set(-0.145, 0.82, 0);
    rightLeg.position.set(0.145, 0.82, 0);
    root.add(leftLeg, rightLeg);
    for (const leg of [leftLeg, rightLeg]) {
      addCylinder(leg, 0.095, 0.105, 0.68, [0, -0.31, 0], trousers, 'trouser leg', ZERO_ROTATION, 10);
      addBox(leg, [0.21, 0.13, 0.34], [0, -0.7, 0.075], shoes, 'assembled shoe', 0.065);
      addBox(leg, [0.18, 0.035, 0.3], [0, -0.78, 0.09], this.materials.get('steel'), 'shoe sole edge', 0.018, ZERO_ROTATION, false, true);
    }

    const carriedItem = new Group();
    carriedItem.name = 'carried trash prop';
    carriedItem.position.set(0, -0.86, 0.08);
    rightArm.add(carriedItem);
    addBox(carriedItem, [0.16, 0.025, 0.13], [0, 0, 0], this.materials.get('paper'), 'carried wrapper', 0.012, [0.15, 0.25, 0], false, false);
    carriedItem.visible = false;

    if (options.worker) {
      addBox(root, [0.47, 0.08, 0.018], [0, 1.38, 0.16], this.materials.get('paintYellow'), 'high visibility chest stripe', 0.012, ZERO_ROTATION, false, false);
      addBox(root, [0.47, 0.08, 0.018], [0, 1.18, 0.16], this.materials.get('paintYellow'), 'high visibility waist stripe', 0.012, ZERO_ROTATION, false, false);
      addBox(root, [0.48, 0.4, 0.12], [0, 1.25, -0.2], this.materials.get('paintBlue'), 'maintenance backpack', 0.08);
      addBox(root, [0.34, 0.1, 0.38], [0, 2.16, 0.03], shirt, 'caretaker cap crown', 0.07);
      addBox(root, [0.34, 0.035, 0.23], [0, 2.13, 0.24], shirt, 'caretaker cap brim', 0.03, [-0.05, 0, 0], false, true);
      addBrace(root, [0.36, 1.18, -0.05], [0.45, 0.35, 0.18], 0.018, this.materials.get('galvanized'), 'litter picker tool', false);
    } else if ((options.shirt & 1) === 0) {
      addBox(root, [0.34, 0.4, 0.13], [0, 1.24, -0.2], this.materials.paint(options.shirt ^ 0x202020, 0.72), 'guest daypack', 0.07);
      addBox(root, [0.035, 0.46, 0.035], [-0.16, 1.27, -0.15], steel, 'daypack strap', 0.012, ZERO_ROTATION, false, false);
      addBox(root, [0.035, 0.46, 0.035], [0.16, 1.27, -0.15], steel, 'daypack strap', 0.012, ZERO_ROTATION, false, false);
    }

    const visualRig = new Group();
    visualRig.name = 'character vertical motion rig';
    const assembledParts = [...root.children];
    root.add(visualRig);
    visualRig.add(...assembledParts);
    root.userData.characterRig = true;

    this.registerAnimation(root, ({ elapsed, activity }) => {
      const phase = elapsed * (7.2 + activity * 1.6);
      const swing = Math.sin(phase) * 0.55 * activity;
      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = -swing * 0.72;
      rightArm.rotation.x = swing * 0.72;
      visualRig.position.y = Math.abs(Math.sin(phase)) * 0.025 * activity;
      carriedItem.visible = Boolean(root.userData.carryingTrash);
    });
    return root;
  }

  private addSign(
    parent: Object3D,
    text: string,
    size: readonly [number, number],
    position: XYZ,
    background: number,
    foreground: number,
    subtitle = '',
  ): void {
    const material = this.getSignMaterial(text, subtitle, background, foreground);
    const geometry = new PlaneGeometry(size[0], size[1]);
    ensureAmbientOcclusionUV(geometry);
    const sign = new Mesh(geometry, material);
    sign.name = `${text.toLowerCase()} sign decal`;
    sign.position.set(...position);
    sign.castShadow = false;
    sign.receiveShadow = false;
    parent.add(sign);
  }

  private getSignMaterial(
    text: string,
    subtitle: string,
    background: number,
    foreground: number,
  ): MeshStandardMaterial {
    const key = `${text}|${subtitle}|${background}|${foreground}`;
    const cached = this.signMaterials.get(key);
    if (cached) return cached;

    const base = new Color(background);
    const ink = new Color(foreground);
    let texture: CanvasTexture | undefined;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 128;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = `#${base.getHexString()}`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, 'rgba(255,255,255,0.12)');
        gradient.addColorStop(0.45, 'rgba(255,255,255,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = `#${ink.getHexString()}`;
        context.lineWidth = 5;
        context.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = `#${ink.getHexString()}`;
        context.font = `700 ${subtitle ? 42 : 50}px system-ui, sans-serif`;
        context.fillText(text, canvas.width / 2, subtitle ? 50 : 65, canvas.width - 34);
        if (subtitle) {
          context.font = '600 17px system-ui, sans-serif';
          context.letterSpacing = '2px';
          context.fillText(subtitle, canvas.width / 2, 94, canvas.width - 40);
        }
        texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        this.signTextures.add(texture);
      }
    }

    const material = new MeshStandardMaterial({
      name: `parkworks/sign-${text.toLowerCase().replace(/\s+/g, '-')}`,
      color: texture ? 0xffffff : background,
      ...(texture ? { map: texture } : {}),
      roughness: 0.39,
      metalness: 0.04,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.signMaterials.set(key, material);
    return material;
  }

  private registerAnimation(root: Object3D, hook: AssetAnimationHook): void {
    const hooks = this.animationHooks.get(root) ?? [];
    hooks.push(hook);
    this.animationHooks.set(root, hooks);
    root.userData.animated = true;
    // ParkGame discovers this lightweight hook during its existing scene walk.
    root.userData.animate = (elapsed: number, delta: number): void => {
      const activity = root.userData.characterRig
        ? root.userData.isWalking
          ? 1
          : typeof root.userData.motion === 'number'
            ? root.userData.motion
            : 0
        : 1;
      this.animate(root, elapsed, delta, activity);
    };
  }
}

function steelOrDark(materials: MaterialLibrary): Material {
  return materials.get('galvanized');
}

export function createAssetFactory(options: AssetFactoryOptions | MaterialLibrary = {}): AssetFactory {
  return new AssetFactory(options);
}

/** Convenience helper for integration code that only needs one catalog asset. */
export function createPlaceableAsset(
  kind: PlaceableKind,
  materials: MaterialLibrary,
  quality: AssetQuality = 'mobile',
): Group {
  return new AssetFactory({ materials, quality }).createPlaceable(kind);
}
