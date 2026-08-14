import {
  CanvasTexture,
  CatmullRomCurve3,
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
  TubeGeometry,
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
  /** Set false when a player-authored path grid supplies all hardscape. */
  includePromenade?: boolean;
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
const WORLD_UP = new Vector3(0, 1, 0);

/** One sample along a track: where the rails are and how a vehicle sits on them. */
interface TrackFrame {
  position: Vector3;
  forward: Vector3;
  right: Vector3;
  up: Vector3;
}

interface TrackOptions {
  name: string;
  /** Centre-to-centre distance between the running rails. */
  gauge: number;
  railRadius: number;
  railMaterial: Material;
  tie: {
    size: XYZ;
    /** Signed height from the centreline, so ties can hang under the rails. */
    offset: number;
    perMetre: number;
    material: Material;
  };
  /** A steel circuit carries its rails on a spine tube; a railway sits on ballast. */
  spine?: { radius: number; offset: number; material: Material };
  /** 0 leaves the track level; higher values roll harder into the turns. */
  bankStrength: number;
  samples: number;
}
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

function assertNever(value: never): never {
  throw new Error(`Unhandled placeable kind: ${String(value)}`);
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
      case 'ice-cream-cart':
        asset = this.createIceCreamCart();
        break;
      case 'pizza-kitchen':
        asset = this.createPizzaKitchen();
        break;
      case 'carousel':
        asset = this.createCarousel();
        break;
      case 'sky-wheel':
        asset = this.createSkyWheel();
        break;
      case 'bumper-cars':
        asset = this.createBumperCars();
        break;
      case 'drop-tower':
        asset = this.createDropTower();
        break;
      case 'pirate-ship':
        asset = this.createPirateShip();
        break;
      case 'mini-railway':
        asset = this.createMiniRailway();
        break;
      case 'meteor-coaster':
        asset = this.createMeteorCoaster();
        break;
      case 'restroom':
        asset = this.createRestroom();
        break;
      case 'first-aid':
        asset = this.createFirstAid();
        break;
      case 'information-booth':
        asset = this.createInformationBooth();
        break;
      case 'cash-machine':
        asset = this.createCashMachine();
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
      case 'tiered-fountain':
        asset = this.createTieredFountain();
        break;
      case 'blossom-planter':
        asset = this.createBlossomPlanter();
        break;
      default:
        asset = assertNever(kind);
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

  createIceCreamCart(): Group {
    const root = makeRoot('Moon Scoop Creamery', 'placeable');
    const concrete = this.materials.get('concrete');
    const cream = this.materials.get('paintCream');
    const teal = this.materials.get('paintTeal');
    const red = this.materials.get('paintRed');
    const steel = this.materials.get('steelDark');
    const galvanized = this.materials.get('galvanized');
    const timber = this.materials.get('timber');
    const rubber = this.materials.get('rubber');

    addBox(root, [2.75, 0.13, 2.7], [0, 0.065, 0], concrete, 'cart paving foundation', 0.065, ZERO_ROTATION, false, true);
    addBox(root, [2.2, 1.05, 1.38], [0, 0.88, -0.05], cream, 'insulated freezer cabinet', 0.09);
    addBox(root, [2.0, 0.72, 0.025], [0, 0.83, 0.655], teal, 'riveted service panel', 0.02, ZERO_ROTATION, false, true);
    addPanelSeams(root, 1.9, 0.83, 0.672, 4, galvanized);
    addBox(root, [2.32, 0.12, 1.52], [0, 1.44, -0.04], galvanized, 'stainless freezer rim', 0.045);
    addBox(root, [1.04, 0.08, 1.22], [-0.54, 1.53, -0.05], cream, 'left freezer lid', 0.035, [0, 0, -0.02]);
    addBox(root, [1.04, 0.08, 1.22], [0.54, 1.53, -0.05], cream, 'right freezer lid', 0.035, [0, 0, 0.02]);
    addBox(root, [2.28, 0.16, 0.52], [0, 1.49, 0.86], timber, 'service counter', 0.045);

    for (const x of [-0.9, 0.9]) {
      addCylinder(root, 0.29, 0.29, 0.13, [x, 0.48, -0.75], rubber, 'pneumatic cart wheel', [Math.PI / 2, 0, 0], 14);
      addCylinder(root, 0.1, 0.1, 0.17, [x, 0.48, -0.75], galvanized, 'wheel hub and axle', [Math.PI / 2, 0, 0], 10, false, true);
      addBox(root, [0.08, 2.0, 0.08], [x, 2.47, -0.58], steel, 'canopy frame post', 0.018);
      addBox(root, [0.08, 2.0, 0.08], [x, 2.47, 0.58], steel, 'canopy frame post', 0.018);
      addBolt(root, [x, 0.28, 0.67], galvanized);
      addBolt(root, [x, 1.24, 0.67], galvanized);
    }
    addBrace(root, [-0.9, 3.44, -0.58], [0.9, 3.44, -0.58], 0.035, steel, 'rear canopy cross rail', false);
    addBrace(root, [-0.9, 3.44, 0.58], [0.9, 3.44, 0.58], 0.035, steel, 'front canopy cross rail', false);
    for (let stripe = 0; stripe < 6; stripe += 1) {
      addBox(
        root,
        [0.43, 0.09, 1.65],
        [-1.075 + stripe * 0.43, 3.5, 0],
        stripe % 2 === 0 ? red : cream,
        'striped canopy panel',
        0.03,
        [0, 0, (stripe - 2.5) * 0.013],
        false,
        true,
      );
    }
    addBox(root, [2.65, 0.09, 0.08], [0, 3.46, 0.81], steel, 'canopy valance rail', 0.018, ZERO_ROTATION, false, false);
    this.addSign(root, 'MOON SCOOP', [1.8, 0.4], [0, 2.92, 0.83], 0x2f7777, 0xffe4b8, 'SMALL-BATCH ICE CREAM');

    const coneGeometry = new ConeGeometry(0.24, 0.6, 12);
    applyWorldUV(coneGeometry, 1);
    ensureAmbientOcclusionUV(coneGeometry);
    const cone = new Mesh(coneGeometry, this.materials.get('cardboard'));
    cone.name = 'waffle cone sign sculpture';
    cone.position.set(0, 2.18, 0.79);
    cone.rotation.z = Math.PI;
    cone.castShadow = false;
    root.add(cone);
    addSphere(root, 0.25, [0, 2.54, 0.79], this.materials.paint(0xf2b4c2, 0.58), 'strawberry scoop', [1, 0.9, 1], false, 10);
    addSphere(root, 0.22, [0.08, 2.82, 0.79], cream, 'vanilla scoop', [1, 0.9, 1], false, 10);
    addBox(root, [0.5, 0.22, 0.34], [-0.72, 1.72, 0.43], red, 'compostable cup dispenser', 0.035, ZERO_ROTATION, false, true);
    addBox(root, [0.38, 0.05, 0.22], [-0.72, 1.83, 0.61], galvanized, 'cup dispenser lip', 0.012, ZERO_ROTATION, false, false);

    root.userData.counterPoints = [[0, 0, 1.75]];
    return root;
  }

  createPizzaKitchen(): Group {
    const root = makeRoot('Ember Stone Pizzeria', 'placeable');
    const concrete = this.materials.get('concrete');
    const brick = this.materials.get('brick');
    const cream = this.materials.get('paintCream');
    const teal = this.materials.get('paintTeal');
    const red = this.materials.get('paintRed');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('steel');
    const copper = this.materials.get('copper');
    const timber = this.materials.get('timber');
    const glass = this.materials.get('glass');
    const glow = this.materials.get('lampGlow');

    addBox(root, [5.9, 0.18, 4.85], [0, 0.09, 0], concrete, 'terrace foundation slab', 0.07, ZERO_ROTATION, false, true);
    addBox(root, [5.5, 0.5, 2.95], [0, 0.33, -0.95], brick, 'masonry plinth course', 0.04);
    addBox(root, [5.3, 2.3, 0.2], [0, 1.68, -2.32], cream, 'rear stucco wall', 0.045);
    addBox(root, [0.2, 2.3, 2.9], [-2.6, 1.68, -0.95], cream, 'left stucco wall', 0.045);
    addBox(root, [0.2, 2.3, 2.9], [2.6, 1.68, -0.95], cream, 'right stucco wall', 0.045);
    addBox(root, [1.0, 2.3, 0.2], [-2.2, 1.68, 0.42], cream, 'left service opening pier', 0.045);
    addBox(root, [1.0, 2.3, 0.2], [2.2, 1.68, 0.42], cream, 'right service opening pier', 0.045);
    addBox(root, [5.3, 0.52, 0.2], [0, 2.57, 0.42], cream, 'service opening lintel', 0.045);
    addBox(root, [5.5, 0.1, 3.05], [0, 0.6, -0.95], concrete, 'plinth weather course', 0.02, ZERO_ROTATION, false, true);

    addBox(root, [3.35, 0.95, 0.44], [0, 1.06, 0.4], brick, 'service counter base', 0.035);
    addBox(root, [3.6, 0.14, 0.66], [0, 1.6, 0.46], concrete, 'honed stone counter top', 0.04);
    addBox(root, [3.3, 0.52, 0.022], [0, 1.95, 0.56], glass, 'counter sneeze guard', 0.008, ZERO_ROTATION, false, false);
    for (const x of [-1.62, 1.62]) {
      addBox(root, [0.05, 0.5, 0.06], [x, 1.95, 0.56], steel, 'sneeze guard mullion', 0.012, ZERO_ROTATION, false, true);
      addBolt(root, [x, 1.5, 0.79], steel, ZERO_ROTATION, 0.028);
    }
    addPanelSeams(root, 3.2, 1.06, 0.63, 4, copper);

    // The oven sits where the counter opening frames it. A wood-fired dome the
    // guest cannot see is a dome that may as well not be modelled.
    const domeGeometry = new SphereGeometry(0.78, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    applyWorldUV(domeGeometry, 1);
    ensureAmbientOcclusionUV(domeGeometry);
    const dome = new Mesh(domeGeometry, brick);
    dome.name = 'wood fired oven dome';
    dome.position.set(-1.35, 1.02, -1.35);
    dome.scale.set(1, 0.86, 1);
    dome.castShadow = true;
    dome.receiveShadow = true;
    root.add(dome);
    addCylinder(root, 0.88, 0.94, 0.16, [-1.35, 0.96, -1.35], concrete, 'oven hearth ring', ZERO_ROTATION, 18);
    addBox(root, [0.56, 0.46, 0.24], [-1.35, 1.16, -0.62], dark, 'oven mouth arch', 0.12);
    addBox(root, [0.4, 0.3, 0.06], [-1.35, 1.14, -0.56], glow, 'oven fire glow', 0.04, ZERO_ROTATION, false, false);
    addCylinder(root, 0.13, 0.15, 1.35, [-1.35, 2.25, -1.35], copper, 'oven flue', ZERO_ROTATION, 12);
    addBrace(root, [-1.9, 1.05, -1.35], [-1.35, 1.55, -0.95], 0.03, steel, 'oven peel handle', false);
    for (let log = 0; log < 8; log += 1) {
      addCylinder(
        root,
        0.07,
        0.07,
        0.52,
        [-2.25, 0.68 + Math.floor(log / 4) * 0.15, -1.72 + (log % 4) * 0.16],
        timber,
        'seasoned firewood',
        [0, Math.PI / 2, 0],
        7,
        false,
        true,
      );
    }

    // Roof: two pitched decks meeting at a ridge, with terracotta pantiles
    // instanced along each. Half-round tiles sunk into the deck read correctly
    // from the ground for a fraction of the geometry a modelled tile costs.
    const pitch = 0.3;
    const ridgeZ = -0.95;
    for (const side of [-1, 1] as const) {
      addBox(
        root,
        [5.95, 0.14, 1.52],
        [0, 3.03, ridgeZ + side * 0.71],
        timber,
        'pitched roof deck',
        0.035,
        [side * pitch, 0, 0],
      );
    }
    const tileCount = this.quality === 'high' ? 76 : 52;
    const tileGeometry = new CylinderGeometry(0.078, 0.078, 1.48, 7, 1, false);
    applyWorldUV(tileGeometry, 1);
    ensureAmbientOcclusionUV(tileGeometry);
    const tiles = new InstancedMesh(tileGeometry, copper, tileCount);
    tiles.name = 'instanced terracotta pantile';
    tiles.castShadow = true;
    tiles.receiveShadow = true;
    const perSide = Math.floor(tileCount / 2);
    for (let index = 0; index < tileCount; index += 1) {
      const side = index < perSide ? -1 : 1;
      const column = index % perSide;
      const x = -2.85 + (column / (perSide - 1)) * 5.7;
      setInstance(
        tiles,
        index,
        new Vector3(
          x,
          3.03 + Math.cos(pitch) * 0.11,
          ridgeZ + side * 0.71 - side * Math.sin(pitch) * 0.11,
        ),
        new Quaternion().setFromEuler(new Euler(Math.PI / 2 + side * pitch, 0, 0)),
      );
    }
    tiles.instanceMatrix.needsUpdate = true;
    root.add(tiles);
    addCylinder(root, 0.13, 0.13, 5.95, [0, 3.34, ridgeZ], copper, 'ridge capping', [0, 0, Math.PI / 2], 10);
    addCylinder(root, 0.075, 0.075, 5.9, [0, 2.78, 0.55], steel, 'eaves gutter', [0, 0, Math.PI / 2], 8, false, true);
    addBox(root, [0.1, 2.2, 0.1], [2.72, 1.7, 0.5], steel, 'rainwater downspout', 0.02, ZERO_ROTATION, false, true);
    addBox(root, [0.68, 1.55, 0.68], [1.5, 3.6, -1.75], brick, 'flue chimney stack', 0.04);
    addBox(root, [0.82, 0.14, 0.82], [1.5, 4.42, -1.75], concrete, 'chimney capping slab', 0.03);
    addCylinder(root, 0.16, 0.2, 0.3, [1.5, 4.62, -1.75], copper, 'chimney cowl', ZERO_ROTATION, 12, false, true);

    addBox(root, [4.1, 0.12, 0.95], [0, 2.42, 1.0], red, 'counter awning deck', 0.03, [-0.16, 0, 0]);
    addBox(root, [4.2, 0.1, 0.09], [0, 2.34, 1.44], cream, 'awning front rail', 0.02, ZERO_ROTATION, false, false);
    for (const x of [-1.85, 1.85]) {
      addBrace(root, [x, 2.6, 0.55], [x, 2.4, 1.4], 0.028, dark, 'awning stay', false);
    }
    for (const x of [-1.05, 0, 1.05]) {
      addCylinder(root, 0.16, 0.09, 0.2, [x, 2.28, 0.28], teal, 'pendant lamp shade', ZERO_ROTATION, 12, false, true);
      addBrace(root, [x, 2.5, 0.28], [x, 2.32, 0.28], 0.012, dark, 'pendant lamp flex', false);
      addSphere(root, 0.065, [x, 2.19, 0.28], glow, 'pendant lamp bulb', [1, 0.9, 1], false, 8);
    }
    addBox(root, [1.5, 0.7, 0.05], [1.6, 2.0, 0.31], dark, 'chalk menu board', 0.02, ZERO_ROTATION, false, true);
    for (let line = 0; line < 4; line += 1) {
      addBox(root, [1.0 - line * 0.12, 0.045, 0.02], [1.55, 2.24 - line * 0.16, 0.28], cream, 'menu chalk line', 0.006, ZERO_ROTATION, false, false);
    }
    this.addSign(root, 'EMBER STONE', [2.5, 0.46], [0, 2.57, 0.53], 0x7c2f28, 0xf6ddb0, 'WOOD FIRED PIZZA');

    for (const x of [-1.72, 1.72]) {
      addCylinder(root, 0.09, 0.16, 0.72, [x, 0.45, 1.62], dark, 'terrace table column', ZERO_ROTATION, 10);
      addCylinder(root, 0.44, 0.44, 0.07, [x, 0.84, 1.62], timber, 'terrace table top', ZERO_ROTATION, 18);
      addCylinder(root, 0.34, 0.34, 0.05, [x, 0.11, 1.62], steel, 'table base plate', ZERO_ROTATION, 14, false, true);
      for (const offset of [-0.72, 0.72]) {
        addCylinder(root, 0.2, 0.2, 0.07, [x + offset, 0.53, 1.62], teal, 'terrace stool seat', ZERO_ROTATION, 12);
        addCylinder(root, 0.06, 0.09, 0.48, [x + offset, 0.27, 1.62], dark, 'terrace stool column', ZERO_ROTATION, 8);
      }
    }

    root.userData.counterPoints = [[-0.7, 0, 2.15], [0.7, 0, 2.15]];
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

  createBumperCars(): Group {
    const root = makeRoot('Voltage Bumper Hall', 'placeable');
    const concrete = this.materials.get('concrete');
    const concreteDark = this.materials.get('concreteDark');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const teal = this.materials.get('paintTeal');
    const yellow = this.materials.get('paintYellow');
    const red = this.materials.get('paintRed');
    const cream = this.materials.get('paintCream');
    const rubber = this.materials.get('rubber');
    const glow = this.materials.get('lampGlow');

    addBox(root, [10.7, 0.2, 8.7], [0, 0.1, 0], concrete, 'reinforced pavilion foundation', 0.09, ZERO_ROTATION, false, true);
    addBox(root, [9.6, 0.18, 7.25], [0, 0.29, -0.2], concreteDark, 'conductive arena floor', 0.075, ZERO_ROTATION, false, true);
    addBox(root, [9.8, 0.38, 0.26], [0, 0.54, -3.72], teal, 'rear impact rail', 0.09);
    addBox(root, [0.26, 0.38, 7.65], [-4.92, 0.54, -0.05], teal, 'left impact rail', 0.09);
    addBox(root, [0.26, 0.38, 7.65], [4.92, 0.54, -0.05], teal, 'right impact rail', 0.09);
    addBox(root, [3.65, 0.38, 0.26], [-3.08, 0.54, 3.62], teal, 'front impact rail left', 0.09);
    addBox(root, [3.65, 0.38, 0.26], [3.08, 0.54, 3.62], teal, 'front impact rail right', 0.09);
    addBox(root, [9.88, 0.08, 0.08], [0, 0.73, -3.73], rubber, 'rear replaceable bumper strip', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [0.08, 0.08, 7.6], [-4.93, 0.73, -0.05], rubber, 'left replaceable bumper strip', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [0.08, 0.08, 7.6], [4.93, 0.73, -0.05], rubber, 'right replaceable bumper strip', 0.025, ZERO_ROTATION, false, true);

    const columnPositions: ReadonlyArray<readonly [number, number]> = [
      [-4.72, -3.5], [0, -3.5], [4.72, -3.5],
      [-4.72, 3.4], [0, 3.4], [4.72, 3.4],
    ];
    for (const [x, z] of columnPositions) {
      addBox(root, [0.34, 4.48, 0.34], [x, 2.55, z], dark, 'bolted pavilion frame column', 0.055);
      addBox(root, [0.68, 0.12, 0.68], [x, 0.28, z], steel, 'column base plate', 0.025);
      for (const bx of [-0.23, 0.23]) {
        for (const bz of [-0.23, 0.23]) addBolt(root, [x + bx, 0.36, z + bz], dark, ZERO_ROTATION, 0.035);
      }
    }
    for (const z of [-3.5, 3.4]) {
      addBox(root, [9.78, 0.28, 0.3], [0, 4.77, z], dark, 'pavilion longitudinal roof beam', 0.04);
      addBrace(root, [-4.55, 4.58, z], [-3.8, 3.72, z], 0.055, steel, 'roof knee brace');
      addBrace(root, [4.55, 4.58, z], [3.8, 3.72, z], 0.055, steel, 'roof knee brace');
    }
    for (const x of [-4.72, 0, 4.72]) {
      addBox(root, [0.3, 0.26, 7.2], [x, 4.76, -0.05], dark, 'pavilion transverse roof beam', 0.04);
    }
    for (let bay = 0; bay < 6; bay += 1) {
      const x = -4.15 + bay * 1.66;
      addBox(root, [1.63, 0.12, 7.3], [x, 5.0 + Math.abs(bay - 2.5) * 0.025, -0.05], bay % 2 === 0 ? cream : teal, 'standing seam canopy panel', 0.035, [0, 0, (bay - 2.5) * 0.014], false, true);
      addBox(root, [0.035, 0.045, 7.18], [x + 0.81, 5.08, -0.05], steel, 'canopy standing seam', 0.008, ZERO_ROTATION, false, false);
    }

    for (let index = 0; index < 7; index += 1) {
      const x = -4.2 + index * 1.4;
      addBox(root, [0.025, 0.025, 6.5], [x, 4.54, -0.05], steel, 'conductive ceiling grid rail', 0.006, ZERO_ROTATION, false, false);
    }
    for (let index = 0; index < 6; index += 1) {
      const z = -3.05 + index * 1.22;
      addBox(root, [8.55, 0.025, 0.025], [0, 4.53, z], steel, 'conductive ceiling cross rail', 0.006, ZERO_ROTATION, false, false);
    }

    const layouts: ReadonlyArray<readonly [number, number, number]> = [
      [-3.2, -2.25, 0.2], [-0.9, -2.1, 1.05], [1.65, -2.25, 2.2], [3.35, -0.65, 2.9],
      [-2.85, 0.4, 3.7], [-0.65, 1.1, 4.5], [1.75, 1.25, 5.1], [3.15, 2.2, 5.85],
    ];
    const carCount = this.quality === 'high' ? 8 : 6;
    const cars: Array<{ group: Group; x: number; z: number; phase: number }> = [];
    for (let index = 0; index < carCount; index += 1) {
      const layout = layouts[index];
      if (!layout) continue;
      const [x, z, phase] = layout;
      const car = new Group();
      car.name = `bumper car animation pivot ${index + 1}`;
      car.position.set(x, 0.48, z);
      car.rotation.y = phase;
      root.add(car);
      cars.push({ group: car, x, z, phase });
      const bodyColor = index % 3 === 0 ? red : index % 3 === 1 ? yellow : teal;
      addTorus(car, 0.78, 0.095, [0, 0.13, 0], rubber, 'perimeter impact bumper', [Math.PI / 2, 0, 0], 24, false);
      addBox(car, [1.28, 0.34, 1.42], [0, 0.35, 0.04], bodyColor, 'pressed bumper car body shell', 0.16);
      addBox(car, [1.05, 0.18, 0.52], [0, 0.52, 0.37], dark, 'moulded two-place seat', 0.11);
      addBox(car, [1.08, 0.42, 0.14], [0, 0.76, 0.12], dark, 'seat back and head restraint', 0.07);
      addBox(car, [0.72, 0.16, 0.12], [0, 0.5, 0.76], cream, 'front number panel', 0.035, ZERO_ROTATION, false, true);
      addTorus(car, 0.17, 0.025, [-0.28, 0.82, 0.52], steel, 'steering wheel', [0, 0, 0], 16, false);
      addBrace(car, [-0.28, 0.82, 0.51], [-0.28, 0.63, 0.45], 0.025, dark, 'steering column', false);
      for (const side of [-1, 1]) {
        addCylinder(car, 0.11, 0.11, 0.08, [side * 0.5, 0.18, 0.55], dark, 'front wheel hub', [Math.PI / 2, 0, 0], 10, false, true);
        addBox(car, [0.08, 0.08, 0.05], [side * 0.46, 0.44, 0.755], glow, 'bumper car marker lamp', 0.018, ZERO_ROTATION, false, false);
      }
      addBrace(car, [0.48, 0.58, -0.35], [0.48, 3.78, -0.35], 0.025, steel, 'spring contact antenna', false);
      addSphere(car, 0.07, [0.48, 3.82, -0.35], steel, 'ceiling contact shoe', [1.5, 0.45, 1], false, 8);
      for (const boltX of [-0.48, 0.48]) addBolt(car, [boltX, 0.45, 0.76], steel, ZERO_ROTATION, 0.024);
    }

    addBox(root, [1.65, 1.05, 0.82], [-3.95, 0.84, 3.95], cream, 'operator control enclosure', 0.065);
    addBox(root, [1.25, 0.42, 0.025], [-3.95, 1.02, 4.38], dark, 'operator control panel', 0.012, ZERO_ROTATION, false, true);
    for (const x of [-4.3, -3.95, -3.6]) addSphere(root, 0.05, [x, 1.1, 4.405], x === -3.95 ? glow : red, 'illuminated control button', [1, 0.45, 1], false, 8);
    addBox(root, [2.2, 0.82, 0.12], [0, 0.78, 3.84], yellow, 'gated loading rail panel', 0.025);
    for (const x of [-1.08, 0, 1.08]) addBox(root, [0.07, 1.05, 0.07], [x, 0.85, 3.85], dark, 'loading rail post', 0.018, ZERO_ROTATION, false, true);
    this.addSign(root, 'VOLTAGE', [3.1, 0.62], [0, 4.32, 3.72], 0x27363b, 0xffd352, 'BUMPER HALL • 8 CARS');

    root.userData.entryPoints = [[0, 0, 4.7]];
    root.userData.operating = true;
    root.userData.animationPivots = cars.map(({ group }) => group.name);
    this.registerAnimation(root, ({ elapsed, activity }) => {
      if (root.userData.operating === false) return;
      for (const [index, car] of cars.entries()) {
        const speed = 0.56 + index * 0.037;
        car.group.position.x = car.x + Math.sin(elapsed * speed + car.phase) * 0.42 * activity;
        car.group.position.z = car.z + Math.cos(elapsed * speed * 0.83 + car.phase) * 0.36 * activity;
        car.group.rotation.y = car.phase + Math.sin(elapsed * speed * 0.7 + index) * 0.7 * activity;
      }
    });
    return root;
  }

  createDropTower(): Group {
    const root = makeRoot('Pulse Drop Tower', 'placeable');
    const concrete = this.materials.get('concrete');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const red = this.materials.get('paintRed');
    const teal = this.materials.get('paintTeal');
    const yellow = this.materials.get('paintYellow');
    const cream = this.materials.get('paintCream');
    const glow = this.materials.get('lampGlow');

    addBox(root, [7.65, 0.24, 7.65], [0, 0.12, 0], concrete, 'deep tower foundation slab', 0.1, ZERO_ROTATION, false, true);
    addBox(root, [2.3, 0.32, 2.3], [0, 0.36, 0], concrete, 'mast pedestal', 0.1);
    for (const x of [-0.58, 0.58]) {
      for (const z of [-0.58, 0.58]) {
        addBox(root, [0.34, 11.65, 0.34], [x, 6.3, z], dark, 'lattice mast vertical column', 0.045);
        addBox(root, [0.58, 0.12, 0.58], [x, 0.52, z], steel, 'mast column base plate', 0.025);
        for (const bx of [-0.18, 0.18]) {
          for (const bz of [-0.18, 0.18]) addBolt(root, [x + bx, 0.6, z + bz], dark, ZERO_ROTATION, 0.032);
        }
      }
    }
    for (let tier = 0; tier < 6; tier += 1) {
      const low = 0.8 + tier * 1.88;
      const high = low + 1.38;
      addBrace(root, [-0.58, low, 0.58], [0.58, high, 0.58], 0.045, steel, 'front mast diagonal brace', false);
      addBrace(root, [0.58, low, 0.58], [-0.58, high, 0.58], 0.045, steel, 'front mast cross brace', false);
      addBrace(root, [-0.58, low, -0.58], [0.58, high, -0.58], 0.045, steel, 'rear mast diagonal brace', false);
      addBrace(root, [0.58, low, -0.58], [-0.58, high, -0.58], 0.045, steel, 'rear mast cross brace', false);
      addBrace(root, [-0.58, low, -0.58], [-0.58, high, 0.58], 0.045, steel, 'left mast diagonal brace', false);
      addBrace(root, [0.58, low, -0.58], [0.58, high, 0.58], 0.045, steel, 'right mast diagonal brace', false);
      addBox(root, [1.42, 0.12, 1.42], [0, high + 0.04, 0], dark, 'mast horizontal tie frame', 0.025, ZERO_ROTATION, false, true);
    }
    addBox(root, [0.12, 11.3, 0.12], [-0.82, 6.2, 0], steel, 'left machined carriage guide rail', 0.018, ZERO_ROTATION, false, true);
    addBox(root, [0.12, 11.3, 0.12], [0.82, 6.2, 0], steel, 'right machined carriage guide rail', 0.018, ZERO_ROTATION, false, true);
    for (let y = 1.25; y < 11.7; y += 1.25) {
      addBox(root, [0.24, 0.05, 0.5], [-0.82, y, 0], yellow, 'left magnetic brake fin', 0.012, ZERO_ROTATION, false, false);
      addBox(root, [0.24, 0.05, 0.5], [0.82, y, 0], yellow, 'right magnetic brake fin', 0.012, ZERO_ROTATION, false, false);
    }
    addBox(root, [1.9, 0.62, 1.9], [0, 12.42, 0], teal, 'upper drive machinery housing', 0.08);
    addBox(root, [1.56, 0.22, 1.56], [0, 12.83, 0], dark, 'weatherproof drive housing roof', 0.05);
    addCylinder(root, 0.23, 0.23, 0.46, [0, 13.18, 0], steel, 'beacon mounting pedestal', ZERO_ROTATION, 12);
    addSphere(root, 0.19, [0, 13.48, 0], glow, 'aviation warning beacon', [1, 0.9, 1], false, 12);
    addCylinder(root, 0.08, 0.08, 10.8, [0, 6.78, 0.78], steel, 'redundant lift cable', ZERO_ROTATION, 8, false, false);

    const carriage = new Group();
    carriage.name = 'guided drop carriage animation pivot';
    carriage.position.y = 1.52;
    root.add(carriage);
    addBox(carriage, [3.55, 0.24, 1.15], [0, 0, 1.12], dark, 'front carriage platform frame', 0.055);
    addBox(carriage, [3.55, 0.24, 1.15], [0, 0, -1.12], dark, 'rear carriage platform frame', 0.055);
    addBox(carriage, [1.15, 0.24, 3.55], [1.12, 0, 0], dark, 'right carriage platform frame', 0.055);
    addBox(carriage, [1.15, 0.24, 3.55], [-1.12, 0, 0], dark, 'left carriage platform frame', 0.055);
    addTorus(carriage, 1.68, 0.075, [0, 0.18, 0], teal, 'carriage perimeter safety rail', [Math.PI / 2, 0, 0], 36, false);
    for (const x of [-0.62, 0.62]) {
      for (const z of [-1.16, 1.16]) {
        addBox(carriage, [0.48, 0.2, 0.52], [x, 0.27, z], red, 'drop tower moulded seat base', 0.09);
        addBox(carriage, [0.48, 0.78, 0.16], [x, 0.7, z - Math.sign(z) * 0.25], cream, 'drop tower padded seat back', 0.07);
        addBrace(carriage, [x - 0.18, 0.92, z], [x + 0.18, 0.48, z], 0.035, yellow, 'over shoulder restraint', false);
      }
    }
    for (const z of [-0.62, 0.62]) {
      for (const x of [-1.16, 1.16]) {
        addBox(carriage, [0.52, 0.2, 0.48], [x, 0.27, z], red, 'side drop tower seat base', 0.09);
        addBox(carriage, [0.16, 0.78, 0.48], [x - Math.sign(x) * 0.25, 0.7, z], cream, 'side padded seat back', 0.07);
        addBrace(carriage, [x, 0.92, z - 0.18], [x, 0.48, z + 0.18], 0.035, yellow, 'side over shoulder restraint', false);
      }
    }
    for (const x of [-0.9, 0.9]) {
      addBox(carriage, [0.25, 0.52, 0.42], [x, 0.28, 0], steel, 'replaceable guide shoe assembly', 0.035);
      for (const y of [0.08, 0.42]) addBolt(carriage, [x, y, 0.23], dark, ZERO_ROTATION, 0.03);
    }

    addBox(root, [2.1, 0.18, 1.8], [0, 0.48, 2.78], dark, 'loading platform', 0.05);
    addBox(root, [2.2, 0.76, 0.12], [0, 0.88, 3.55], teal, 'interlocked loading gate', 0.025);
    for (const x of [-1.05, 0, 1.05]) addBox(root, [0.07, 1.0, 0.07], [x, 0.87, 3.56], steel, 'queue gate post', 0.018, ZERO_ROTATION, false, true);
    addBox(root, [1.45, 1.0, 0.82], [-2.72, 0.72, 2.82], cream, 'tower operator console housing', 0.06);
    addBox(root, [1.05, 0.35, 0.025], [-2.72, 0.88, 3.245], dark, 'tower operator control panel', 0.01, ZERO_ROTATION, false, true);
    for (const x of [-3.0, -2.72, -2.44]) addSphere(root, 0.045, [x, 0.96, 3.27], x === -2.72 ? glow : red, 'tower control indicator', [1, 0.45, 1], false, 8);
    this.addSign(root, 'PULSE DROP', [2.9, 0.55], [0, 2.18, 3.57], 0x28343b, 0xffd352, '13 METRES • MAGNETIC BRAKES');

    root.userData.entryPoints = [[0, 0, 4.4]];
    root.userData.operating = true;
    root.userData.animationPivot = carriage.name;
    this.registerAnimation(root, ({ elapsed, activity }) => {
      if (root.userData.operating === false) return;
      const phase = (elapsed * 0.072) % 1;
      let travel = 0;
      if (phase < 0.58) {
        const t = phase / 0.58;
        travel = t * t * (3 - 2 * t);
      } else if (phase < 0.7) {
        travel = 1;
      } else if (phase < 0.79) {
        const t = (phase - 0.7) / 0.09;
        travel = 1 - t * t;
      }
      carriage.position.y = 1.52 + travel * 9.25 * activity;
    });
    return root;
  }

  createPirateShip(): Group {
    const root = makeRoot('Copper Corsair', 'placeable');
    const concrete = this.materials.get('concrete');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const copper = this.materials.get('copper');
    const brass = this.materials.get('brass');
    const timber = this.materials.get('timber');
    const darkTimber = this.materials.get('timberDark');
    const red = this.materials.get('paintRed');
    const cream = this.materials.get('paintCream');
    const teal = this.materials.get('paintTeal');
    const rubber = this.materials.get('rubber');
    const glow = this.materials.get('lampGlow');

    addBox(root, [11.55, 0.24, 7.55], [0, 0.12, 0], concrete, 'reinforced ride foundation', 0.1, ZERO_ROTATION, false, true);
    for (const x of [-3.65, 3.65]) {
      for (const z of [-1.85, 1.85]) {
        addBox(root, [1.15, 0.3, 1.05], [x, 0.36, z], concrete, 'A-frame concrete footing', 0.08);
        addBox(root, [0.62, 0.12, 0.58], [x, 0.58, z], steel, 'A-frame base plate', 0.025);
        for (const bx of [-0.2, 0.2]) {
          for (const bz of [-0.18, 0.18]) addBolt(root, [x + bx, 0.66, z + bz], dark, ZERO_ROTATION, 0.04);
        }
      }
    }
    for (const z of [-1.85, 1.85]) {
      addBrace(root, [-3.65, 0.64, z], [0, 5.18, z], 0.15, dark, 'left A-frame support leg');
      addBrace(root, [3.65, 0.64, z], [0, 5.18, z], 0.15, dark, 'right A-frame support leg');
      addBrace(root, [-2.65, 1.85, z], [2.65, 1.85, z], 0.075, steel, 'A-frame lower cross tie');
      addBrace(root, [-2.9, 1.55, z], [1.55, 3.25, z], 0.052, steel, 'A-frame diagonal lattice brace', false);
      addBrace(root, [2.9, 1.55, z], [-1.55, 3.25, z], 0.052, steel, 'A-frame diagonal lattice brace', false);
      addCylinder(root, 0.42, 0.42, 0.32, [0, 5.18, z], dark, 'main pivot bearing housing', [Math.PI / 2, 0, 0], 16);
      addCylinder(root, 0.24, 0.24, 0.4, [0, 5.18, z], brass, 'pivot bearing cap', [Math.PI / 2, 0, 0], 14, false, true);
    }
    addCylinder(root, 0.17, 0.17, 4.15, [0, 5.18, 0], steel, 'through pivot axle', [Math.PI / 2, 0, 0], 14);

    const swing = new Group();
    swing.name = 'pirate ship swing animation pivot';
    swing.position.y = 5.18;
    root.add(swing);
    addBrace(swing, [0, 0, -1.62], [0, -1.25, -1.38], 0.08, dark, 'rear suspension hanger');
    addBrace(swing, [0, 0, 1.62], [0, -1.25, 1.38], 0.08, dark, 'front suspension hanger');
    addBox(swing, [7.7, 0.72, 2.55], [0, -2.1, 0], darkTimber, 'laminated lower hull shell', 0.2);
    addBox(swing, [7.05, 0.7, 2.78], [0, -1.58, 0], timber, 'planked upper hull shell', 0.16);
    addBox(swing, [1.3, 0.72, 2.35], [-4.05, -1.76, 0], timber, 'assembled stern quarter', 0.14, [0, 0, -0.24]);
    addBox(swing, [1.3, 0.72, 2.35], [4.05, -1.76, 0], timber, 'assembled bow quarter', 0.14, [0, 0, 0.24]);
    addBox(swing, [8.15, 0.16, 2.82], [0, -1.17, 0], dark, 'steel-backed passenger deck', 0.05);
    addBox(swing, [7.35, 0.16, 0.2], [0, -2.53, 0], copper, 'copper keel band', 0.045);
    for (const z of [-1.35, 1.35]) {
      addBox(swing, [8.0, 0.11, 0.09], [0, -0.45, z], brass, 'ship guard handrail', 0.025, ZERO_ROTATION, false, true);
      for (let x = -3.75; x <= 3.75; x += 0.75) {
        addBox(swing, [0.055, 0.78, 0.055], [x, -0.79, z], dark, 'ship guard rail post', 0.015, ZERO_ROTATION, false, true);
      }
    }
    for (let row = 0; row < 5; row += 1) {
      const x = -2.5 + row * 1.25;
      addBox(swing, [0.18, 0.27, 2.18], [x, -0.86, 0], red, 'two-place ride bench', 0.07);
      addBox(swing, [0.16, 0.54, 2.18], [x - 0.13, -0.62, 0], dark, 'bench back frame', 0.055);
      addBrace(swing, [x + 0.12, -0.52, -0.9], [x + 0.12, -0.9, -0.45], 0.032, brass, 'lap restraint left', false);
      addBrace(swing, [x + 0.12, -0.52, 0.9], [x + 0.12, -0.9, 0.45], 0.032, brass, 'lap restraint right', false);
      for (const z of [-0.82, 0.82]) addBolt(swing, [x + 0.1, -0.72, z], steel, [0, 0, Math.PI / 2], 0.027);
    }
    addCylinder(swing, 0.09, 0.12, 4.0, [0.85, 0.78, 0], dark, 'decorative ship mast', ZERO_ROTATION, 10);
    addCylinder(swing, 0.05, 0.05, 3.15, [0.85, 2.92, 0], brass, 'mast top spar', [0, 0, Math.PI / 2], 8, false, true);
    for (let stripe = 0; stripe < 4; stripe += 1) {
      addBox(
        swing,
        [2.45 - stripe * 0.35, 0.58, 0.045],
        [1.72 - stripe * 0.06, 2.38 - stripe * 0.59, 0],
        stripe % 2 === 0 ? cream : red,
        'stitched sail cloth panel',
        0.018,
        ZERO_ROTATION,
        false,
        true,
      );
      addBox(swing, [2.55 - stripe * 0.35, 0.035, 0.06], [1.72 - stripe * 0.06, 2.67 - stripe * 0.59, 0], dark, 'sail reinforcing batten', 0.008, ZERO_ROTATION, false, false);
    }
    addBrace(swing, [0.85, 2.55, 0], [-3.95, -0.42, 0], 0.018, brass, 'stern rigging cable', false);
    addBrace(swing, [0.85, 2.55, 0], [4.32, -0.42, 0], 0.018, brass, 'bow rigging cable', false);
    addBox(swing, [0.62, 0.62, 0.08], [4.05, -1.52, 1.42], teal, 'corsair crest panel', 0.08, ZERO_ROTATION, false, true);

    addTorus(root, 0.72, 0.15, [0, 1.18, -2.15], rubber, 'friction drive flywheel', ZERO_ROTATION, 28);
    addCylinder(root, 0.2, 0.2, 0.82, [0, 1.18, -2.15], steel, 'flywheel drive shaft', [Math.PI / 2, 0, 0], 12);
    addBox(root, [1.35, 0.72, 0.9], [-1.35, 0.65, -2.22], teal, 'drive motor enclosure', 0.07);
    addBox(root, [0.95, 0.22, 0.025], [-1.35, 0.68, -1.755], dark, 'motor cooling vent panel', 0.01, ZERO_ROTATION, false, true);
    for (let x = -1.72; x <= -0.98; x += 0.185) addBox(root, [0.1, 0.035, 0.025], [x, 0.68, -1.738], steel, 'motor ventilation louver', 0.008, ZERO_ROTATION, false, false);
    addBox(root, [2.55, 0.8, 0.12], [0, 0.88, 3.14], teal, 'interlocked loading gate panel', 0.025);
    for (const x of [-1.25, 0, 1.25]) addBox(root, [0.07, 1.0, 0.07], [x, 0.88, 3.15], dark, 'loading gate post', 0.018, ZERO_ROTATION, false, true);
    addBox(root, [1.5, 1.0, 0.86], [-4.55, 0.72, 2.65], cream, 'pirate ship operator console', 0.065);
    addBox(root, [1.08, 0.34, 0.025], [-4.55, 0.88, 3.095], dark, 'pirate ship control panel', 0.01, ZERO_ROTATION, false, true);
    for (const x of [-4.85, -4.55, -4.25]) addSphere(root, 0.05, [x, 0.96, 3.12], x === -4.55 ? glow : red, 'ship control indicator', [1, 0.45, 1], false, 8);
    this.addSign(root, 'COPPER CORSAIR', [3.4, 0.58], [0, 2.12, 3.2], 0x413329, 0xf1d8a5, '10 SEATS • AIR BRAKES');

    root.userData.entryPoints = [[0, 0, 4.2]];
    root.userData.operating = true;
    root.userData.animationPivot = swing.name;
    this.registerAnimation(root, ({ elapsed, activity }) => {
      if (root.userData.operating === false) return;
      swing.rotation.z = Math.sin(elapsed * 0.72) * 0.64 * activity;
    });
    return root;
  }

  createMiniRailway(): Group {
    const root = makeRoot('Willow Line Railway', 'placeable');
    const concrete = this.materials.get('concrete');
    // Ballast is crushed grey stone, not earth: against dark creosoted sleepers
    // it is the contrast that makes a track read as track from standing height.
    const ballastStone = this.materials.get('concreteDark');
    const sleeper = this.materials.get('timber');
    const steel = this.materials.get('galvanized');
    const dark = this.materials.get('steelDark');
    const galvanized = this.materials.get('galvanized');
    const timber = this.materials.get('timber');
    const cream = this.materials.get('paintCream');
    const green = this.materials.get('paintGreen');
    const red = this.materials.get('paintRed');
    const brass = this.materials.get('brass');
    const glow = this.materials.get('lampGlow');
    const samples = this.quality === 'high' ? 180 : 120;

    // A closed oval of 15-inch-gauge track. The centreline sits at sleeper-top
    // height so everything else — ballast under, rails on top — is measured
    // from the surface a train actually runs on.
    const centreline: Vector3[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      centreline.push(new Vector3(Math.sin(angle) * 4.55, 0.34, Math.cos(angle) * 3.05));
    }
    const circuit = new CatmullRomCurve3(centreline, true, 'catmullrom', 0.5);
    const length = circuit.getLength();

    const ballastCount = Math.round(length / 1.08);
    const ballastGeometry = new RoundedBoxGeometry(1.72, 0.22, 1.02, 1, 0.05);
    applyWorldUV(ballastGeometry, 1);
    ensureAmbientOcclusionUV(ballastGeometry);
    const ballast = new InstancedMesh(ballastGeometry, ballastStone, ballastCount);
    ballast.name = 'instanced ballast bed panel';
    ballast.receiveShadow = true;
    for (let index = 0; index < ballastCount; index += 1) {
      const frame = this.trackFrameAt(circuit, index / ballastCount, 0);
      setInstance(
        ballast,
        index,
        new Vector3(frame.position.x, 0.11, frame.position.z),
        new Quaternion().setFromRotationMatrix(
          new Matrix4().makeBasis(frame.right, frame.up, frame.forward),
        ),
      );
    }
    ballast.instanceMatrix.needsUpdate = true;
    root.add(ballast);

    this.addTrack(root, circuit, {
      name: 'railway',
      gauge: 0.78,
      railRadius: 0.045,
      railMaterial: steel,
      tie: { size: [1.2, 0.1, 0.22], offset: -0.075, perMetre: 2.1, material: sleeper },
      bankStrength: 0,
      samples,
    });

    addBox(root, [5.4, 0.32, 1.3], [0, 0.16, 4.35], concrete, 'station platform slab', 0.05, ZERO_ROTATION, false, true);
    addBox(root, [5.4, 0.09, 0.16], [0, 0.36, 3.78], cream, 'platform edge coping', 0.02, ZERO_ROTATION, false, true);
    for (let mark = -2; mark <= 2; mark += 1) {
      addBox(root, [0.5, 0.02, 0.07], [mark * 1.0, 0.33, 3.62], red, 'platform safety line', 0.006, ZERO_ROTATION, false, false);
    }
    for (const x of [-2.25, 2.25]) {
      addBox(root, [0.1, 2.25, 0.1], [x, 1.45, 4.05], dark, 'canopy support post', 0.022);
      addBox(root, [0.1, 2.25, 0.1], [x, 1.45, 4.78], dark, 'canopy support post', 0.022);
      addBrace(root, [x, 2.3, 4.05], [x + Math.sign(x) * -0.42, 2.58, 4.42], 0.028, steel, 'canopy knee brace', false);
      addBolt(root, [x, 0.42, 4.05], galvanized, ZERO_ROTATION, 0.03);
    }
    addBox(root, [5.2, 0.14, 1.5], [0, 2.66, 4.42], green, 'station canopy deck', 0.045, [-0.06, 0, 0]);
    addBox(root, [5.35, 0.16, 0.14], [0, 2.62, 3.71], cream, 'canopy valance board', 0.03, ZERO_ROTATION, false, true);
    for (let seam = -2; seam <= 2; seam += 1) {
      addBox(root, [0.035, 0.045, 1.45], [seam * 1.05, 2.75, 4.42], steel, 'canopy standing seam', 0.008, [-0.06, 0, 0], false, false);
    }
    addBox(root, [1.6, 0.09, 0.42], [-1.5, 0.7, 4.62], timber, 'platform bench seat', 0.03);
    addBox(root, [1.6, 0.36, 0.07], [-1.5, 0.88, 4.83], timber, 'platform bench back', 0.025);
    for (const x of [-2.15, -0.85]) addBox(root, [0.08, 0.36, 0.34], [x, 0.52, 4.62], dark, 'bench cast frame', 0.02);
    addCylinder(root, 0.14, 0.1, 0.16, [2.6, 2.34, 4.12], brass, 'platform departure bell', ZERO_ROTATION, 12, false, true);
    addBrace(root, [2.6, 2.56, 4.12], [2.6, 2.4, 4.12], 0.02, dark, 'bell hanger', false);
    addBox(root, [1.05, 0.62, 0.08], [1.75, 1.62, 4.7], dark, 'departure board', 0.025, ZERO_ROTATION, false, true);
    for (let row = 0; row < 3; row += 1) {
      addBox(root, [0.78, 0.09, 0.02], [1.75, 1.82 - row * 0.19, 4.65], row === 0 ? glow : cream, 'departure board line', 0.006, ZERO_ROTATION, false, false);
    }
    this.addSign(root, 'WILLOW LINE', [2.4, 0.44], [0, 2.36, 3.66], 0x2f5c3a, 0xf3e3b8, 'NARROW GAUGE RAILWAY');

    addCylinder(root, 0.09, 0.11, 2.35, [4.0, 1.18, 3.35], dark, 'signal post', ZERO_ROTATION, 10);
    addBox(root, [0.3, 0.62, 0.16], [4.0, 2.5, 3.42], dark, 'signal head', 0.04);
    addSphere(root, 0.075, [4.0, 2.66, 3.52], glow, 'signal clear lamp', [1, 1, 0.6], false, 8);
    addSphere(root, 0.075, [4.0, 2.36, 3.52], red, 'signal stop lamp', [1, 1, 0.6], false, 8);
    addBox(root, [0.42, 0.12, 0.42], [4.0, 0.06, 3.35], concrete, 'signal post footing', 0.03, ZERO_ROTATION, false, true);
    for (const [x, z] of [[-5.62, 0.4], [5.62, -0.4]] as const) {
      addBox(root, [0.5, 0.72, 0.5], [x, 0.36, z], timber, 'lineside tool locker', 0.05);
      addBox(root, [0.56, 0.08, 0.56], [x, 0.76, z], dark, 'locker lid', 0.02, ZERO_ROTATION, false, true);
    }

    const locomotive = this.buildRailwayLocomotive();
    root.add(locomotive);
    const carriages = [1, 2].map((index) => {
      const carriage = this.buildRailwayCarriage(index);
      root.add(carriage);
      return carriage;
    });

    // Vehicle spacing is in metres of track, converted to curve parameter, so
    // the rake stays coupled through the curves instead of concertinaing.
    const spacing = [0, 2.35, 4.35].map((metres) => metres / length);
    let travelled = 0.62;
    const place = (): void => {
      this.setOnTrack(locomotive, this.trackFrameAt(circuit, travelled - spacing[0], 0), 0.02);
      for (const [index, carriage] of carriages.entries()) {
        this.setOnTrack(carriage, this.trackFrameAt(circuit, travelled - spacing[index + 1], 0), 0.02);
      }
    };
    place();

    root.userData.entryPoints = [[0, 0, 5.1]];
    root.userData.operating = true;
    root.userData.animationPivot = locomotive.name;
    this.registerAnimation(root, ({ delta, activity }) => {
      if (root.userData.operating === false) return;
      // 2.4 m/s is a walking-pace park railway; the ride is the circuit, not the speed.
      travelled = (travelled + (delta * 2.4 * activity) / length) % 1;
      place();
    });
    return root;
  }

  createMeteorCoaster(): Group {
    const root = makeRoot('Meteor Chase', 'placeable');
    const concrete = this.materials.get('concrete');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    // Running rails are galvanised rather than bright steel: at 0.86 metalness
    // and no environment map, polished steel reads as a black line against the
    // sky, which is the one thing a coaster's silhouette cannot afford.
    const rail = this.materials.get('galvanized');
    const teal = this.materials.get('paintTeal');
    const red = this.materials.get('paintRed');
    const yellow = this.materials.get('paintYellow');
    const cream = this.materials.get('paintCream');
    const blue = this.materials.get('paintBlue');
    const glow = this.materials.get('lampGlow');
    const samples = this.quality === 'high' ? 240 : 160;

    // The layout, as a rider takes it: out of the station, up the chain lift at
    // the back of the plot, over the crest, down the first drop, through an
    // airtime hill, then a banked helix that passes under its own first drop
    // before the brake run. The crossing is deliberate — a circuit that folds
    // over itself is what makes a coaster read as a coaster from the ground.
    const layout: XYZ[] = [
      [-4.6, 1.55, 5.05],
      [0, 1.55, 5.15],
      [4.55, 1.62, 5.0],
      [6.55, 3.15, 2.4],
      [6.85, 5.95, -0.6],
      [5.35, 8.55, -3.4],
      [2.35, 9.15, -4.85],
      [-1.0, 5.6, -4.55],
      [-3.4, 2.05, -2.95],
      [-4.2, 3.6, -0.4],
      [-2.6, 4.85, 1.85],
      [0.65, 2.95, 3.0],
      [3.4, 2.6, 1.4],
      [2.0, 2.2, -1.4],
      [-1.2, 2.0, -1.85],
      [-3.6, 1.9, 0.6],
      [-5.65, 1.7, 3.0],
    ];
    const circuit = new CatmullRomCurve3(
      layout.map((point) => new Vector3(...point)),
      true,
      'catmullrom',
      0.5,
    );
    const length = circuit.getLength();
    const crestHeight = 9.15;

    const frames = this.addTrack(root, circuit, {
      name: 'coaster',
      gauge: 0.86,
      railRadius: 0.062,
      railMaterial: rail,
      tie: { size: [1.05, 0.075, 0.1], offset: -0.12, perMetre: 1.1, material: dark },
      spine: { radius: 0.14, offset: -0.52, material: teal },
      bankStrength: 6.5,
      samples,
    });
    this.addTrackSupports(root, frames, dark, steel, concrete, this.quality === 'high' ? 9 : 13);

    // Chain lift: the dogs the train's anti-rollback rides over, laid between
    // the two curve parameters where the track is actually climbing.
    const chainPoints = this.trackSection(circuit, 0.175, 0.315, 26);
    const chainCurve = new CatmullRomCurve3(chainPoints, false, 'catmullrom', 0.5);
    const chainGeometry = new TubeGeometry(chainCurve, 40, 0.035, 6, false);
    applyWorldUV(chainGeometry, 1);
    ensureAmbientOcclusionUV(chainGeometry);
    const chain = new Mesh(chainGeometry, steel);
    chain.name = 'lift hill drive chain';
    chain.castShadow = true;
    chain.position.y = -0.2;
    root.add(chain);
    for (let index = 0; index <= 12; index += 1) {
      const point = chainCurve.getPointAt(index / 12);
      addBox(root, [0.3, 0.06, 0.12], [point.x, point.y - 0.28, point.z], yellow, 'anti rollback ratchet', 0.014, ZERO_ROTATION, false, false);
    }
    addBox(root, [1.5, 0.9, 1.2], [3.0, 9.35, -5.55], teal, 'lift drive machinery house', 0.08);
    addBox(root, [1.65, 0.16, 1.35], [3.0, 9.86, -5.55], dark, 'machinery house roof', 0.04);
    addCylinder(root, 0.34, 0.34, 0.9, [2.05, 9.3, -5.55], steel, 'chain drive sheave', [0, 0, Math.PI / 2], 14);
    addSphere(root, 0.16, [3.0, 10.1, -5.55], glow, 'circuit warning beacon', [1, 0.9, 1], false, 10);

    // Brake fins along the run back into the station, in pairs either side.
    for (let index = 0; index <= 9; index += 1) {
      const frame = this.trackFrameAt(circuit, 0.955 + index * 0.0055, 6.5);
      for (const side of [-1, 1] as const) {
        const at = frame.position.clone().addScaledVector(frame.right, side * 0.62).addScaledVector(frame.up, -0.16);
        addBox(root, [0.06, 0.3, 0.44], [at.x, at.y, at.z], yellow, 'magnetic brake fin', 0.012, ZERO_ROTATION, false, false);
      }
    }

    addBox(root, [9.4, 0.24, 7.2], [-0.4, 0.12, 1.0], concrete, 'ride foundation slab', 0.09, ZERO_ROTATION, false, true);
    // Two platforms, one either side of the running line, rather than one slab
    // the track would pass through. The corridor between them is set by the car
    // body plus the hand's breadth of platform gap a real station leaves.
    for (const [z, side] of [[3.75, 'boarding'], [6.45, 'unloading']] as const) {
      addBox(root, [6.6, 1.3, 1.1], [-0.4, 0.78, z], concrete, `${side} platform substructure`, 0.06);
      addBox(root, [6.9, 0.16, 1.35], [-0.4, 1.5, z], dark, `${side} platform deck`, 0.045);
      addBox(root, [6.9, 0.1, 0.13], [-0.4, 1.62, z + (z < 5 ? 0.61 : -0.61)], yellow, `${side} platform edge marking`, 0.02, ZERO_ROTATION, false, true);
    }
    for (const x of [-3.5, -1.1, 1.3, 3.7]) {
      addBox(root, [0.14, 2.6, 0.14], [x, 2.88, 6.78], dark, 'station roof column', 0.03);
      addBox(root, [0.14, 2.6, 0.14], [x, 2.88, 3.42], dark, 'station roof column', 0.03);
      addBrace(root, [x, 4.1, 6.78], [x, 4.42, 6.1], 0.035, steel, 'station roof knee brace', false);
      addBolt(root, [x, 1.7, 6.78], steel, ZERO_ROTATION, 0.032);
    }
    addBox(root, [7.4, 0.18, 3.7], [-0.4, 4.5, 5.1], dark, 'station roof beam frame', 0.04);
    for (let bay = 0; bay < 5; bay += 1) {
      addBox(root, [1.44, 0.11, 3.6], [-3.35 + bay * 1.48, 4.66, 5.1], bay % 2 === 0 ? cream : teal, 'station canopy panel', 0.03, [0, 0, (bay - 2) * 0.012], false, true);
      addBox(root, [0.035, 0.04, 3.55], [-2.63 + bay * 1.48, 4.73, 5.1], steel, 'canopy standing seam', 0.008, ZERO_ROTATION, false, false);
    }
    for (const x of [-2.6, 0, 2.6]) {
      addBox(root, [1.5, 1.05, 0.09], [x, 2.15, 4.31], yellow, 'air gate leaf', 0.025);
      addBox(root, [0.09, 1.2, 0.09], [x - 0.78, 2.2, 4.31], dark, 'air gate post', 0.02, ZERO_ROTATION, false, true);
      addBox(root, [0.09, 1.2, 0.09], [x + 0.78, 2.2, 4.31], dark, 'air gate post', 0.02, ZERO_ROTATION, false, true);
    }
    addBox(root, [1.6, 1.1, 0.9], [-4.6, 2.05, 3.7], cream, 'coaster operator console housing', 0.06);
    addBox(root, [1.15, 0.38, 0.025], [-4.6, 2.24, 3.25], dark, 'coaster operator control panel', 0.01, ZERO_ROTATION, false, true);
    for (const x of [-4.9, -4.6, -4.3]) addSphere(root, 0.05, [x, 2.33, 3.22], x === -4.6 ? glow : red, 'dispatch indicator', [1, 0.45, 1], false, 8);
    addBox(root, [1.4, 0.9, 0.12], [-2.4, 1.05, 2.85], dark, 'station access stair stringer', 0.03, [-0.42, 0, 0]);
    for (let step = 0; step < 4; step += 1) {
      addBox(root, [1.4, 0.07, 0.34], [-2.4, 0.42 + step * 0.3, 2.45 + step * 0.32], concrete, 'station access step', 0.02, ZERO_ROTATION, false, true);
    }
    this.addSign(root, 'METEOR CHASE', [3.6, 0.6], [-0.4, 5.05, 3.24], 0x1f2f3c, 0xffd352, 'CHAIN LIFT • 9 METRE DROP');

    const cars = [0, 1].map((index) => {
      const car = this.buildCoasterCar(index, index === 0 ? red : blue, dark, steel, yellow, glow);
      root.add(car);
      return car;
    });
    const carSpacing = 2.5 / length;
    let travelled = 0.02;
    const place = (): void => {
      for (const [index, car] of cars.entries()) {
        this.setOnTrack(car, this.trackFrameAt(circuit, travelled - index * carSpacing, 6.5), 0.42);
      }
    };
    place();

    root.userData.entryPoints = [[-0.4, 0, 7.6]];
    root.userData.operating = true;
    root.userData.animationPivot = cars[0]?.name;
    this.registerAnimation(root, ({ delta, activity }) => {
      if (root.userData.operating === false) return;
      const height = this.trackFrameAt(circuit, travelled, 0).position.y;
      // Speed comes from the drop the train has taken, the way it does on the
      // real thing: v = sqrt(2gh) from the crest, floored so it still crawls
      // over the top, and overridden by the chain on the lift itself. This is
      // why it hangs at the crest and tears through the bottom of the drop
      // without a single hand-tuned keyframe.
      const onLift = travelled > 0.17 && travelled < 0.32;
      const speed = onLift
        ? 2.1
        : Math.min(19, Math.sqrt(Math.max(0.9, 2 * 9.81 * (crestHeight + 0.7 - height))));
      travelled = (travelled + (delta * speed * activity) / length) % 1;
      place();
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

  createFirstAid(): Group {
    const root = makeRoot('Pulse Point First Aid', 'placeable');
    const concrete = this.materials.get('concrete');
    const cream = this.materials.get('paintCream');
    const white = this.materials.get('paintWhite');
    const red = this.materials.get('paintRed');
    const teal = this.materials.get('paintTeal');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const glass = this.materials.get('glass');
    const rubber = this.materials.get('rubber');
    const glow = this.materials.get('lampGlow');

    addBox(root, [4.85, 0.18, 3.85], [0, 0.09, 0], concrete, 'accessible clinic foundation', 0.075, ZERO_ROTATION, false, true);
    addBox(root, [4.48, 2.55, 0.2], [0, 1.47, -1.62], cream, 'rear insulated wall assembly', 0.045);
    addBox(root, [0.2, 2.55, 3.08], [-2.14, 1.47, -0.08], cream, 'left insulated wall assembly', 0.045);
    addBox(root, [0.2, 2.55, 3.08], [2.14, 1.47, -0.08], cream, 'right insulated wall assembly', 0.045);
    addBox(root, [0.38, 2.55, 0.2], [-1.95, 1.47, 1.46], cream, 'left front wall return', 0.04);
    addBox(root, [0.42, 2.55, 0.2], [1.93, 1.47, 1.46], cream, 'right front wall return', 0.04);
    addBox(root, [0.28, 2.55, 0.2], [0.15, 1.47, 1.46], cream, 'front opening mullion wall', 0.04);
    addBox(root, [4.1, 0.5, 0.2], [0, 2.5, 1.46], cream, 'front structural lintel', 0.04);

    addBox(root, [1.65, 2.08, 0.1], [1.13, 1.31, 1.59], teal, 'accessible clinic door', 0.045);
    addBox(root, [1.82, 0.08, 0.17], [1.13, 2.4, 1.55], dark, 'door head frame', 0.018);
    for (const x of [0.24, 2.02]) addBox(root, [0.08, 2.22, 0.17], [x, 1.34, 1.55], dark, 'door jamb frame', 0.018);
    addBox(root, [0.72, 0.46, 0.018], [1.13, 1.7, 1.65], glass, 'door observation glazing', 0.012, ZERO_ROTATION, false, false);
    addBox(root, [0.62, 0.09, 0.025], [1.13, 0.48, 1.66], steel, 'door kick plate trim', 0.012, ZERO_ROTATION, false, false);
    addCylinder(root, 0.045, 0.045, 0.16, [1.72, 1.24, 1.69], steel, 'clinic lever handle', [Math.PI / 2, 0, 0], 10, false, true);
    for (const y of [0.68, 1.28, 1.88]) addBox(root, [0.035, 0.18, 0.025], [0.28, y, 1.67], steel, 'door hinge leaf', 0.008, ZERO_ROTATION, false, false);

    addBox(root, [1.76, 1.32, 0.025], [-0.87, 1.47, 1.58], glass, 'reception window glazing', 0.012, ZERO_ROTATION, false, false);
    addBox(root, [1.94, 0.09, 0.17], [-0.87, 2.16, 1.55], dark, 'window head frame', 0.018);
    addBox(root, [1.94, 0.09, 0.17], [-0.87, 0.78, 1.55], dark, 'window sill frame', 0.018);
    for (const x of [-1.83, 0.09]) addBox(root, [0.08, 1.48, 0.17], [x, 1.47, 1.55], dark, 'window jamb frame', 0.018);
    addBox(root, [0.07, 1.34, 0.06], [-0.87, 1.47, 1.6], dark, 'window center mullion', 0.015, ZERO_ROTATION, false, true);
    addBox(root, [1.98, 0.12, 0.55], [-0.87, 0.77, 1.78], steel, 'reception pass-through counter', 0.04);

    addBox(root, [4.7, 0.2, 3.55], [0, 2.85, -0.05], white, 'clinic roof deck assembly', 0.06, [-0.025, 0, 0]);
    addBox(root, [4.78, 0.11, 0.14], [0, 2.75, 1.7], dark, 'roof drip edge', 0.025);
    addBox(root, [0.12, 2.3, 0.12], [2.3, 1.62, -1.52], dark, 'rainwater downspout', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [1.02, 0.46, 0.72], [-1.18, 3.18, -0.38], steel, 'roof HVAC enclosure', 0.055);
    for (let x = -1.55; x <= -0.81; x += 0.185) addBox(root, [0.1, 0.23, 0.025], [x, 3.17, -0.005], dark, 'HVAC ventilation louver', 0.008, ZERO_ROTATION, false, false);
    addCylinder(root, 0.13, 0.13, 0.34, [0.78, 3.12, -0.62], steel, 'clinic exhaust vent', ZERO_ROTATION, 12);
    addCylinder(root, 0.22, 0.13, 0.07, [0.78, 3.32, -0.62], steel, 'exhaust rain cap', ZERO_ROTATION, 12, false, true);

    addBox(root, [2.16, 0.14, 1.02], [1.12, 2.48, 1.96], white, 'entry canopy roof', 0.045, [-0.08, 0, 0]);
    for (const x of [0.22, 2.02]) {
      addBox(root, [0.07, 1.05, 0.07], [x, 1.95, 2.35], dark, 'entry canopy support post', 0.018);
      addBrace(root, [x, 2.36, 1.48], [x, 2.2, 2.32], 0.028, steel, 'canopy wall stay', false);
      addBolt(root, [x, 1.46, 2.39], steel, ZERO_ROTATION, 0.028);
    }
    addBox(root, [1.84, 0.07, 0.07], [1.12, 2.48, 2.42], dark, 'canopy front fascia rail', 0.018, ZERO_ROTATION, false, false);

    addBox(root, [0.68, 0.68, 0.09], [-1.25, 2.43, 1.61], white, 'first aid emblem backplate', 0.035, ZERO_ROTATION, false, true);
    addBox(root, [0.18, 0.54, 0.035], [-1.25, 2.43, 1.67], red, 'first aid vertical cross bar', 0.025, ZERO_ROTATION, false, false);
    addBox(root, [0.54, 0.18, 0.035], [-1.25, 2.43, 1.67], red, 'first aid horizontal cross bar', 0.025, ZERO_ROTATION, false, false);
    this.addSign(root, 'FIRST AID', [1.52, 0.38], [-0.25, 2.43, 1.66], 0xf2eee5, 0xb83f38, 'PULSE POINT');
    addBox(root, [0.24, 0.12, 0.2], [-1.92, 2.48, 1.64], dark, 'shielded clinic wall light', 0.03, [0.16, 0, 0], false, true);
    addSphere(root, 0.075, [-1.92, 2.39, 1.74], glow, 'clinic wall light lens', [1.3, 0.6, 0.8], false, 8);

    addBox(root, [1.72, 0.09, 0.7], [1.13, 0.22, 2.0], concrete, 'flush accessible threshold', 0.03, ZERO_ROTATION, false, true);
    addBox(root, [1.7, 0.07, 0.55], [1.13, 0.17, 2.58], concrete, 'accessible approach ramp', 0.025, [-0.04, 0, 0], false, true);
    addBox(root, [1.65, 0.18, 0.62], [-0.88, 0.63, -0.2], cream, 'treatment cot mattress', 0.06);
    addBox(root, [1.72, 0.08, 0.68], [-0.88, 0.5, -0.2], dark, 'treatment cot frame', 0.025);
    for (const x of [-1.57, -0.19]) {
      addBox(root, [0.06, 0.42, 0.06], [x, 0.28, -0.2], dark, 'cot folding leg', 0.018);
      addCylinder(root, 0.075, 0.075, 0.05, [x, 0.11, -0.2], rubber, 'cot caster', [Math.PI / 2, 0, 0], 10, false, true);
    }

    root.userData.entryPoints = [[1.13, 0, 2.75], [-0.87, 0, 2.45]];
    return root;
  }

  createInformationBooth(): Group {
    const root = makeRoot('Park Pathfinder', 'placeable');
    const concrete = this.materials.get('concrete');
    const cream = this.materials.get('paintCream');
    const teal = this.materials.get('paintTeal');
    const yellow = this.materials.get('paintYellow');
    const red = this.materials.get('paintRed');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('galvanized');
    const glass = this.materials.get('glass');
    const timber = this.materials.get('timber');
    const glow = this.materials.get('lampGlow');

    addBox(root, [3.82, 0.15, 2.82], [0, 0.075, 0], concrete, 'booth paving foundation', 0.07, ZERO_ROTATION, false, true);
    addBox(root, [3.38, 1.02, 2.25], [0, 0.72, -0.04], teal, 'panelized lower booth cabinet', 0.075);
    addBox(root, [3.04, 0.73, 0.025], [0, 0.7, 1.1], cream, 'front service cabinet panels', 0.025, ZERO_ROTATION, false, true);
    addPanelSeams(root, 2.9, 0.7, 1.118, 4, steel);
    addBox(root, [3.52, 0.13, 2.42], [0, 1.27, -0.04], timber, 'continuous service counter sill', 0.045);

    for (const x of [-1.52, 0, 1.52]) {
      addBox(root, [0.09, 1.56, 0.09], [x, 2.01, 0.97], dark, 'front glazing frame post', 0.02);
      addBox(root, [0.09, 1.56, 0.09], [x, 2.01, -1.05], dark, 'rear glazing frame post', 0.02);
    }
    for (const z of [-1.05, 0.97]) {
      addBox(root, [3.14, 0.09, 0.09], [0, 2.72, z], dark, 'booth glazing head rail', 0.02);
      addBox(root, [3.14, 0.09, 0.09], [0, 1.3, z], dark, 'booth glazing sill rail', 0.02);
    }
    addBox(root, [1.42, 1.3, 0.025], [-0.76, 2.01, 1.03], glass, 'left service window glazing', 0.01, ZERO_ROTATION, false, false);
    addBox(root, [1.42, 1.3, 0.025], [0.76, 2.01, 1.03], glass, 'right service window glazing', 0.01, ZERO_ROTATION, false, false);
    addBox(root, [1.42, 1.3, 0.025], [-0.76, 2.01, -1.1], glass, 'left rear booth glazing', 0.01, ZERO_ROTATION, false, false);
    addBox(root, [1.42, 1.3, 0.025], [0.76, 2.01, -1.1], glass, 'right rear booth glazing', 0.01, ZERO_ROTATION, false, false);
    for (const x of [-1.56, 1.56]) {
      addBox(root, [0.025, 1.3, 1.92], [x, 2.01, -0.04], glass, 'side booth glazing', 0.01, ZERO_ROTATION, false, false);
      addBox(root, [0.09, 0.09, 2.05], [x, 2.72, -0.04], dark, 'side glazing head rail', 0.02);
      addBolt(root, [x, 1.32, 1.1], steel, ZERO_ROTATION, 0.026);
      addBolt(root, [x, 2.68, 1.1], steel, ZERO_ROTATION, 0.026);
    }

    addBox(root, [3.75, 0.18, 2.82], [0, 2.88, -0.04], cream, 'overhanging booth roof deck', 0.065);
    addBox(root, [3.42, 0.2, 2.48], [0, 3.04, -0.04], teal, 'raised roof weather cap', 0.055);
    addBox(root, [3.82, 0.09, 0.09], [0, 2.83, 1.38], dark, 'front roof drip rail', 0.018, ZERO_ROTATION, false, false);
    for (const x of [-1.55, -0.52, 0.52, 1.55]) addBox(root, [0.035, 0.04, 2.55], [x, 3.16, -0.04], steel, 'roof standing seam', 0.008, ZERO_ROTATION, false, false);
    addCylinder(root, 0.42, 0.42, 0.1, [0, 3.22, 0.02], yellow, 'information roof medallion', [Math.PI / 2, 0, 0], 20, false, true);
    addCylinder(root, 0.31, 0.31, 0.105, [0, 3.22, 0.075], cream, 'information medallion inset', [Math.PI / 2, 0, 0], 20, false, true);
    addBox(root, [0.075, 0.32, 0.035], [0, 3.18, 0.14], teal, 'information symbol stem', 0.025, ZERO_ROTATION, false, false);
    addSphere(root, 0.055, [0, 3.4, 0.14], teal, 'information symbol dot', [1, 1, 0.55], false, 8);

    addBox(root, [3.28, 0.11, 0.6], [0, 1.29, 1.32], timber, 'two-window public counter', 0.04);
    addBox(root, [1.18, 0.46, 0.05], [-0.75, 1.78, 1.075], yellow, 'park map display panel', 0.025, ZERO_ROTATION, false, true);
    addBox(root, [0.9, 0.035, 0.02], [-0.75, 1.78, 1.11], teal, 'map primary route decal', 0.008, [0, 0, 0.22], false, false);
    addBox(root, [0.035, 0.32, 0.02], [-0.58, 1.78, 1.115], red, 'map destination route decal', 0.008, [0, 0, -0.35], false, false);
    for (const [x, y] of [[-1.34, 1.85], [-1.34, 1.62], [1.32, 1.85], [1.32, 1.62]] as const) {
      addBox(root, [0.28, 0.16, 0.08], [x, y, 1.16], cream, 'brochure rack pocket', 0.025, [0.08, 0, 0], false, true);
      addBox(root, [0.2, 0.12, 0.02], [x, y + 0.07, 1.215], x > 0 ? red : teal, 'printed brochure stack', 0.006, [0.08, 0, 0], false, false);
    }
    addBox(root, [0.22, 0.12, 0.2], [1.22, 2.48, 1.12], dark, 'shielded counter light', 0.03, [0.15, 0, 0], false, true);
    addSphere(root, 0.07, [1.22, 2.4, 1.22], glow, 'counter light lens', [1.3, 0.6, 0.8], false, 8);
    this.addSign(root, 'PARK PATHFINDER', [2.25, 0.36], [0, 2.54, 1.105], 0x2f7777, 0xffe6ae, 'MAPS • ACCESS • EVENTS');

    root.userData.counterPoints = [[-0.72, 0, 1.9], [0.72, 0, 1.9]];
    return root;
  }

  createCashMachine(): Group {
    const root = makeRoot('Ledger Point Cash Machine', 'placeable');
    const concreteDark = this.materials.get('concreteDark');
    const concrete = this.materials.get('concrete');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('steel');
    const galvanized = this.materials.get('galvanized');
    const teal = this.materials.get('paintTeal');
    const yellow = this.materials.get('paintYellow');
    const rubber = this.materials.get('rubber');
    const brass = this.materials.get('brass');
    const glass = this.materials.get('glass');
    const glow = this.materials.get('lampGlow');

    addBox(root, [1.85, 0.12, 1.7], [0, 0.06, 0], concreteDark, 'machine anchor pad', 0.04, ZERO_ROTATION, false, true);
    addBox(root, [1.02, 0.26, 0.76], [0, 0.25, -0.02], concrete, 'levelling plinth', 0.03);
    addBox(root, [0.9, 1.5, 0.68], [0, 1.13, -0.02], dark, 'safe body enclosure', 0.06);
    addBox(root, [0.82, 1.28, 0.05], [0, 1.22, 0.34], steel, 'stainless fascia panel', 0.02);
    addBox(root, [0.9, 0.12, 0.72], [0, 1.94, -0.02], dark, 'enclosure top cap', 0.03);

    addBox(root, [0.48, 0.36, 0.03], [0, 1.62, 0.372], dark, 'screen bezel', 0.012, ZERO_ROTATION, false, true);
    addBox(root, [0.4, 0.29, 0.012], [0, 1.62, 0.381], glow, 'screen backlight', 0.004, ZERO_ROTATION, false, false);
    addBox(root, [0.41, 0.3, 0.012], [0, 1.62, 0.392], glass, 'screen glazing', 0.004, ZERO_ROTATION, false, false);
    for (const side of [-1, 1] as const) {
      for (const y of [1.72, 1.62, 1.52]) {
        addBox(root, [0.055, 0.03, 0.02], [side * 0.31, y, 0.375], teal, 'soft function key', 0.008, ZERO_ROTATION, false, false);
      }
    }
    addBox(root, [0.34, 0.28, 0.035], [0, 1.28, 0.372], dark, 'keypad surround', 0.012, ZERO_ROTATION, false, true);
    for (let key = 0; key < 12; key += 1) {
      addBox(
        root,
        [0.055, 0.04, 0.02],
        [-0.09 + (key % 3) * 0.09, 1.37 - Math.floor(key / 3) * 0.065, 0.385],
        key === 10 ? teal : steel,
        'keypad key',
        0.008,
        ZERO_ROTATION,
        false,
        false,
      );
    }
    addBox(root, [0.14, 0.035, 0.05], [0.27, 1.4, 0.375], brass, 'card reader slot', 0.01, ZERO_ROTATION, false, true);
    addBox(root, [0.15, 0.025, 0.05], [-0.27, 1.4, 0.375], steel, 'receipt printer slot', 0.008, ZERO_ROTATION, false, true);
    addBox(root, [0.3, 0.06, 0.06], [0, 1.02, 0.375], rubber, 'cash dispenser lip', 0.014, ZERO_ROTATION, false, true);
    addBox(root, [0.36, 0.02, 0.04], [0, 1.09, 0.38], steel, 'dispenser shutter', 0.006, ZERO_ROTATION, false, false);

    addBox(root, [1.02, 0.1, 0.62], [0, 2.16, 0.24], dark, 'privacy hood', 0.03, [-0.14, 0, 0]);
    for (const side of [-1, 1] as const) {
      addBox(root, [0.06, 0.34, 0.56], [side * 0.48, 1.98, 0.22], dark, 'privacy hood cheek', 0.02, ZERO_ROTATION, false, true);
      addBrace(root, [side * 0.44, 1.98, -0.3], [side * 0.44, 2.14, 0.18], 0.022, steel, 'hood support stay', false);
      addCylinder(root, 0.085, 0.095, 0.86, [side * 0.76, 0.43, 0.42], galvanized, 'protective bollard', ZERO_ROTATION, 12);
      addCylinder(root, 0.095, 0.095, 0.09, [side * 0.76, 0.7, 0.42], yellow, 'bollard reflective band', ZERO_ROTATION, 12, false, true);
      addBolt(root, [side * 0.4, 0.34, 0.36], galvanized, ZERO_ROTATION, 0.032);
      addBolt(root, [side * 0.4, 0.34, -0.38], galvanized, ZERO_ROTATION, 0.032);
    }
    addSphere(root, 0.055, [0, 2.05, 0.26], glow, 'hood service light', [1.6, 0.5, 1], false, 8);
    addBox(root, [0.72, 1.05, 0.03], [0, 1.12, -0.375], steel, 'rear service door', 0.015, ZERO_ROTATION, false, true);
    for (const y of [0.74, 1.5]) addBox(root, [0.05, 0.16, 0.03], [-0.3, y, -0.39], galvanized, 'service door hinge', 0.01, ZERO_ROTATION, false, false);
    addCylinder(root, 0.045, 0.045, 0.05, [0.26, 1.12, -0.395], brass, 'service door lock', [Math.PI / 2, 0, 0], 10, false, true);
    this.addSign(root, 'CASH', [0.74, 0.2], [0, 1.945, 0.372], 0x1f4f4f, 0xffe27f, 'WITHDRAWALS');

    root.userData.counterPoints = [[0, 0, 1.15]];
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
    // The pool of light the luminaire casts. An additive ground decal costs one
    // draw call instead of a real light, which is what keeps a park full of
    // lamps inside the phone budget after dark.
    const pool = new Mesh(new PlaneGeometry(6.4, 6.4), this.materials.getLightPoolMaterial());
    pool.name = 'lamp light pool';
    // Flagged so scale checks measure assembled construction, not light spill.
    pool.userData.decal = true;
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.02, 0.75);
    pool.renderOrder = 2;
    pool.matrixAutoUpdate = false;
    pool.updateMatrix();
    root.add(pool);

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

  createTieredFountain(): Group {
    const root = makeRoot('Tiered Bronze Fountain', 'placeable');
    const concrete = this.materials.get('concrete');
    const concreteDark = this.materials.get('concreteDark');
    // Cast bronze, not polished brass. The shared metals are near-fully
    // metallic, and with no environment map to reflect a large metal bowl goes
    // black; weathered bronze is a dielectric patina anyway, so a painted
    // surface is both truer and readable in a shaded plaza.
    const bronze = this.materials.paint(0xa8804a, 0.42);
    const bronzeDark = this.materials.paint(0x7d5c31, 0.5);
    const brass = this.materials.get('brass');
    // Opaque, glossy, and slightly blue: water reads better as a bright surface
    // than as transparency, which at this scale only sorts badly against the
    // basin behind it.
    const water = this.materials.paint(0x8fc4d4, 0.14);
    const dark = this.materials.get('steelDark');
    const segments = this.quality === 'high' ? 36 : 24;

    addCylinder(root, 2.36, 2.42, 0.14, [0, 0.07, 0], concrete, 'basin foundation ring', ZERO_ROTATION, segments, false, true);
    // The basin drum stops below the coping so the water surface can sit on top
    // of it and still be seen: a wall taller than the water hides the water.
    addCylinder(root, 2.16, 2.22, 0.46, [0, 0.23, 0], concrete, 'stone basin wall', ZERO_ROTATION, segments);
    addCylinder(root, 2.03, 2.03, 0.02, [0, 0.48, 0], water, 'basin water surface', ZERO_ROTATION, segments, false, false);
    addTorus(root, 2.16, 0.13, [0, 0.5, 0], concrete, 'basin coping ring', [Math.PI / 2, 0, 0], segments);
    for (let seam = 0; seam < 8; seam += 1) {
      const angle = (seam / 8) * Math.PI * 2;
      const at = polar(2.2, angle, 0.24);
      addBox(root, [0.05, 0.42, 0.05], [at.x, at.y, at.z], concreteDark, 'basin masonry joint', 0.012, [0, -angle, 0], false, false);
    }

    addCylinder(root, 0.52, 0.66, 0.78, [0, 0.89, 0], concreteDark, 'fountain pedestal', ZERO_ROTATION, 18);
    addTorus(root, 0.56, 0.07, [0, 1.24, 0], bronze, 'pedestal collar', [Math.PI / 2, 0, 0], 20, false);
    addCylinder(root, 1.24, 0.56, 0.42, [0, 1.46, 0], bronze, 'lower bronze bowl', ZERO_ROTATION, 24);
    addTorus(root, 1.24, 0.07, [0, 1.65, 0], bronzeDark, 'lower bowl rim', [Math.PI / 2, 0, 0], 28);
    for (let rib = 0; rib < 10; rib += 1) {
      const angle = (rib / 10) * Math.PI * 2;
      const outer = polar(1.16, angle, 1.34);
      addBrace(root, [0, 1.2, 0], [outer.x, outer.y, outer.z], 0.035, bronzeDark, 'bowl support rib', false);
    }
    addCylinder(root, 0.2, 0.28, 0.98, [0, 2.14, 0], bronze, 'bronze standpipe', ZERO_ROTATION, 14);
    addCylinder(root, 0.66, 0.28, 0.28, [0, 2.68, 0], bronze, 'upper bronze bowl', ZERO_ROTATION, 20);
    addTorus(root, 0.66, 0.05, [0, 2.8, 0], bronzeDark, 'upper bowl rim', [Math.PI / 2, 0, 0], 22, false);
    addSphere(root, 0.14, [0, 3.0, 0], bronzeDark, 'fountain finial', [1, 1.2, 1], false, 12);
    addCylinder(root, 0.035, 0.075, 0.95, [0, 3.55, 0], water, 'central water jet', ZERO_ROTATION, 10, false, false);

    // Water leaves each bowl as a flared skirt at the rim. Sweeping a sheet all
    // the way down to the basin instead reads as a glass drum standing around
    // the fountain, and discrete falling columns read as legs holding the bowls
    // up; the lip itself is where the eye looks for overflow.
    const curtains: Mesh[] = [];
    for (const sheet of [
      { top: 1.24, bottom: 1.34, height: 0.46, y: 1.44, name: 'lower bowl overflow skirt' },
      { top: 0.66, bottom: 0.74, height: 0.34, y: 2.65, name: 'upper bowl overflow skirt' },
    ]) {
      const geometry = new CylinderGeometry(sheet.top, sheet.bottom, sheet.height, 20, 1, true);
      applyWorldUV(geometry, 1);
      ensureAmbientOcclusionUV(geometry);
      const curtain = new Mesh(geometry, water);
      curtain.name = sheet.name;
      curtain.position.y = sheet.y;
      root.add(curtain);
      curtains.push(curtain);
    }
    for (let jet = 0; jet < 6; jet += 1) {
      const angle = (jet / 6) * Math.PI * 2 + 0.26;
      const nozzle = polar(1.86, angle, 0.72);
      addCylinder(root, 0.055, 0.075, 0.22, [nozzle.x, nozzle.y, nozzle.z], brass, 'basin jet nozzle', [0, 0, 0], 10);
      // Spray leans inwards over the basin, the way a rim jet is aimed so the
      // wind does not put it on the paving.
      addBrace(root, [nozzle.x, nozzle.y + 0.08, nozzle.z], [nozzle.x * 0.74, 1.36, nozzle.z * 0.74], 0.022, water, 'arcing water jet', false);
    }
    addBox(root, [0.52, 0.3, 0.05], [0, 0.4, 2.2], bronzeDark, 'dedication plaque', 0.015, ZERO_ROTATION, false, true);
    for (let bolt = 0; bolt < 6; bolt += 1) {
      const angle = (bolt / 6) * Math.PI * 2 + 0.5;
      const at = polar(2.02, angle, 0.7);
      addBolt(root, [at.x, at.y, at.z], dark, ZERO_ROTATION, 0.03);
    }

    const rippleGeometry = new TorusGeometry(1, 0.035, 6, segments);
    applyWorldUV(rippleGeometry, 1);
    ensureAmbientOcclusionUV(rippleGeometry);
    const ripples = [0, 1, 2].map((index) => {
      const ring = new Mesh(rippleGeometry, water);
      ring.name = `basin ripple ring ${index + 1}`;
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.51;
      root.add(ring);
      return ring;
    });

    this.registerAnimation(root, ({ elapsed, delta, activity }) => {
      for (const curtain of curtains) curtain.rotation.y += delta * 0.42;
      for (const [index, ring] of ripples.entries()) {
        // Each ring runs the same expansion a third of a cycle apart, so the
        // basin always has water arriving somewhere on it.
        const phase = ((elapsed * 0.35 + index / ripples.length) % 1);
        const radius = 0.3 + phase * 1.6;
        ring.scale.set(radius, 1 - phase * 0.55, radius);
        ring.visible = activity > 0;
      }
    });
    return root;
  }

  createBlossomPlanter(): Group {
    const root = makeRoot('Blossom Planter', 'placeable');
    const concrete = this.materials.get('concrete');
    const timber = this.materials.get('timber');
    const timberDark = this.materials.get('timberDark');
    const dark = this.materials.get('steelDark');
    const steel = this.materials.get('steel');
    const soil = this.materials.get('soil');
    const leaf = this.materials.get('leaf');
    const leafLight = this.materials.get('leafLight');
    const brass = this.materials.get('brass');
    const blossomPink = this.materials.paint(0xe4879d, 0.62);
    const blossomCream = this.materials.paint(0xf3dfa6, 0.62);

    addBox(root, [1.74, 0.08, 1.74], [0, 0.04, 0], concrete, 'planter paving pad', 0.03, ZERO_ROTATION, false, true);
    for (const x of [-0.7, 0.7]) {
      for (const z of [-0.7, 0.7]) {
        addBox(root, [0.12, 0.66, 0.12], [x, 0.37, z], dark, 'planter corner post', 0.022);
        addBolt(root, [x, 0.24, z + Math.sign(z) * 0.06], steel, [Math.PI / 2, 0, 0], 0.024);
      }
    }
    for (const [axis, offset] of [['x', -0.7], ['x', 0.7], ['z', -0.7], ['z', 0.7]] as const) {
      for (let slat = 0; slat < 3; slat += 1) {
        const size: XYZ = axis === 'z' ? [1.42, 0.17, 0.07] : [0.07, 0.17, 1.42];
        const position: XYZ = axis === 'z' ? [0, 0.24 + slat * 0.2, offset] : [offset, 0.24 + slat * 0.2, 0];
        addBox(root, size, position, slat === 1 ? timberDark : timber, 'planter side slat', 0.02);
      }
      const capSize: XYZ = axis === 'z' ? [1.6, 0.08, 0.16] : [0.16, 0.08, 1.6];
      const capPosition: XYZ = axis === 'z' ? [0, 0.72, offset] : [offset, 0.72, 0];
      addBox(root, capSize, capPosition, timberDark, 'planter rim cap', 0.02, ZERO_ROTATION, false, true);
    }
    addBox(root, [1.32, 0.18, 1.32], [0, 0.6, 0], soil, 'planting compost', 0.03, ZERO_ROTATION, false, true);

    const clusters: ReadonlyArray<{ p: XYZ; s: number; light: boolean }> = [
      { p: [-0.32, 0.86, -0.28], s: 0.34, light: false },
      { p: [0.3, 0.9, -0.22], s: 0.3, light: true },
      { p: [0.02, 0.98, 0.06], s: 0.36, light: false },
      { p: [-0.28, 0.84, 0.34], s: 0.28, light: true },
      { p: [0.34, 0.86, 0.32], s: 0.3, light: false },
    ];
    for (const [index, cluster] of clusters.entries()) {
      const geometry = new IcosahedronGeometry(cluster.s, this.quality === 'high' ? 2 : 1);
      applyWorldUV(geometry, 1);
      ensureAmbientOcclusionUV(geometry);
      const mesh = new Mesh(geometry, cluster.light ? leafLight : leaf);
      mesh.name = `planted foliage cluster ${index + 1}`;
      mesh.position.set(...cluster.p);
      mesh.scale.set(1, 0.82, 1);
      mesh.rotation.set(index * 0.31, index * 0.87, index * 0.19);
      mesh.castShadow = index < 3;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    // Blossoms sit in the canopy, not on stalks above it: standing them proud
    // of the foliage turned a planter into a tray of lollipops.
    for (let flower = 0; flower < 14; flower += 1) {
      const angle = (flower / 14) * Math.PI * 2 + 0.4;
      const radius = 0.26 + (flower % 3) * 0.14;
      const height = 1.03 + (flower % 4) * 0.05;
      const at = polar(radius, angle, height);
      addBrace(root, [at.x, at.y - 0.16, at.z], [at.x, at.y, at.z], 0.014, leaf, 'blossom stem', false);
      addSphere(root, 0.065, [at.x, at.y, at.z], flower % 2 === 0 ? blossomPink : blossomCream, 'open blossom', [1, 0.7, 1], false, 8);
    }
    addBox(root, [0.2, 0.11, 0.02], [0.38, 0.5, 0.755], brass, 'nursery name tag', 0.006, ZERO_ROTATION, false, true);
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
    if (options.includePromenade !== false) {
      addBox(root, [5.8, 0.11, depth - 4], [0, -0.005, 0], path, 'north south promenade', 0.08, ZERO_ROTATION, false, true);
      addBox(root, [width - 8, 0.11, 5.8], [0, 0.002, -0.6], path, 'east west promenade', 0.08, ZERO_ROTATION, false, true);

      for (const x of [-3.02, 3.02]) {
        addBox(root, [0.16, 0.14, depth - 4], [x, 0.02, 0], concrete, 'promenade edge restraint', 0.035, ZERO_ROTATION, false, true);
      }
      for (const z of [-3.62, 2.42]) {
        addBox(root, [width - 8, 0.14, 0.16], [0, 0.025, z], concrete, 'cross path edge restraint', 0.035, ZERO_ROTATION, false, true);
      }

      for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
        addCylinder(root, 1.4, 1.55, 0.12, [x, 0.01, z], soil, 'ornamental planting bed', ZERO_ROTATION, 18, false, true);
        addTorus(root, 1.47, 0.055, [x, 0.08, z], concrete, 'planting bed curb', [Math.PI / 2, 0, 0], 24, false);
        for (let plant = 0; plant < 5; plant += 1) {
          const angle = (plant / 5) * Math.PI * 2 + x * 0.03;
          const p = polar(0.72, angle, 0.24);
          addSphere(root, 0.23, [x + p.x, p.y, z + p.z], plant % 2 === 0 ? this.materials.get('leafLight') : this.materials.get('leaf'), 'planting mound', [1, 0.75, 1], false, 8);
        }
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

  /** A live-steam park locomotive, built around a boiler at rider scale. */
  private buildRailwayLocomotive(): Group {
    const engine = new Group();
    engine.name = 'miniature railway train animation pivot';
    const dark = this.materials.get('steelDark');
    const green = this.materials.get('paintGreen');
    const red = this.materials.get('paintRed');
    const brass = this.materials.get('brass');
    const steel = this.materials.get('steel');
    const rubber = this.materials.get('rubber');
    const glow = this.materials.get('lampGlow');
    const timber = this.materials.get('timber');

    addBox(engine, [1.06, 0.14, 2.42], [0, 0.24, 0], dark, 'locomotive footplate', 0.03);
    addCylinder(engine, 0.31, 0.31, 1.44, [0, 0.66, 0.28], green, 'boiler barrel', [Math.PI / 2, 0, 0], 16);
    addCylinder(engine, 0.34, 0.34, 0.24, [0, 0.66, 1.05], dark, 'smokebox', [Math.PI / 2, 0, 0], 16);
    addCylinder(engine, 0.19, 0.19, 0.05, [0, 0.66, 1.19], brass, 'smokebox door ring', [Math.PI / 2, 0, 0], 14, false, true);
    for (const band of [-0.15, 0.42]) {
      addCylinder(engine, 0.32, 0.32, 0.055, [0, 0.66, band], brass, 'boiler band', [Math.PI / 2, 0, 0], 16, false, true);
    }
    addCylinder(engine, 0.1, 0.12, 0.4, [0, 1.12, 0.86], dark, 'chimney', ZERO_ROTATION, 12);
    addCylinder(engine, 0.16, 0.13, 0.09, [0, 1.34, 0.86], brass, 'chimney cap', ZERO_ROTATION, 12, false, true);
    addCylinder(engine, 0.15, 0.15, 0.2, [0, 1.0, 0.22], brass, 'steam dome', ZERO_ROTATION, 12);
    addCylinder(engine, 0.045, 0.045, 0.14, [0, 1.14, 0.22], brass, 'safety valve', ZERO_ROTATION, 8, false, true);
    addBox(engine, [0.16, 0.12, 0.1], [0, 0.98, -0.16], brass, 'whistle mount', 0.02, ZERO_ROTATION, false, true);

    addBox(engine, [1.02, 0.86, 0.86], [0, 0.79, -0.78], green, 'driver cab', 0.06);
    addBox(engine, [1.16, 0.09, 0.98], [0, 1.28, -0.8], dark, 'cab roof', 0.03);
    for (const side of [-1, 1] as const) {
      addBox(engine, [0.02, 0.36, 0.42], [side * 0.52, 0.92, -0.72], this.materials.get('glass'), 'cab side window', 0.006, ZERO_ROTATION, false, false);
      addBrace(engine, [side * 0.34, 0.92, 1.16], [side * 0.34, 0.92, -0.28], 0.016, brass, 'boiler handrail', false);
      addCylinder(engine, 0.06, 0.06, 0.08, [side * 0.34, 0.92, 0.44], brass, 'handrail knob', [Math.PI / 2, 0, 0], 8, false, false);
    }
    addBox(engine, [0.72, 0.1, 0.5], [0, 0.34, -1.06], timber, 'coal bunker lid', 0.02, ZERO_ROTATION, false, true);
    addBox(engine, [1.12, 0.19, 0.11], [0, 0.31, 1.24], red, 'front buffer beam', 0.025);
    for (const side of [-1, 1] as const) {
      addCylinder(engine, 0.075, 0.075, 0.13, [side * 0.36, 0.31, 1.32], steel, 'buffer head', [Math.PI / 2, 0, 0], 10, false, true);
    }
    addBox(engine, [0.18, 0.18, 0.14], [0, 0.55, 1.28], dark, 'headlamp housing', 0.03, ZERO_ROTATION, false, true);
    addSphere(engine, 0.06, [0, 0.55, 1.37], glow, 'headlamp lens', [1, 1, 0.55], false, 8);
    addBrace(engine, [0, 0.24, -1.28], [0, 0.24, -1.42], 0.035, dark, 'drawbar coupling', false);

    for (const side of [-1, 1] as const) {
      for (const z of [0.72, 0.06, -0.62]) {
        addCylinder(engine, 0.21, 0.21, 0.09, [side * 0.47, 0.21, z], rubber, 'driving wheel tyre', [Math.PI / 2, 0, 0], 14);
        addCylinder(engine, 0.07, 0.07, 0.13, [side * 0.47, 0.21, z], brass, 'wheel bearing hub', [Math.PI / 2, 0, 0], 10, false, true);
      }
      addBox(engine, [0.045, 0.07, 1.44], [side * 0.55, 0.29, 0.05], steel, 'coupling rod', 0.014, ZERO_ROTATION, false, false);
      addBox(engine, [0.2, 0.24, 0.34], [side * 0.44, 0.36, 0.98], dark, 'cylinder block', 0.04);
    }
    return engine;
  }

  /** An open bench carriage. Two of these are the twelve places the ride sells. */
  private buildRailwayCarriage(index: number): Group {
    const carriage = new Group();
    carriage.name = `railway carriage ${index} animation pivot`;
    const dark = this.materials.get('steelDark');
    const timber = this.materials.get('timber');
    const cream = this.materials.get('paintCream');
    const brass = this.materials.get('brass');
    const rubber = this.materials.get('rubber');
    const paint = index === 1 ? this.materials.get('paintRed') : this.materials.get('paintTeal');

    addBox(carriage, [1.04, 0.12, 1.86], [0, 0.26, 0], dark, 'carriage underframe', 0.03);
    addBox(carriage, [1.0, 0.09, 1.74], [0, 0.35, 0], timber, 'carriage floor planking', 0.02, ZERO_ROTATION, false, true);
    for (const side of [-1, 1] as const) {
      for (let slat = 0; slat < 3; slat += 1) {
        addBox(carriage, [0.07, 0.13, 1.74], [side * 0.48, 0.5 + slat * 0.17, 0], paint, 'carriage side slat', 0.02);
      }
      addBrace(carriage, [side * 0.48, 0.94, 0.85], [side * 0.48, 0.94, -0.85], 0.022, brass, 'carriage grab rail', false);
      for (const z of [0.6, -0.6]) {
        addCylinder(carriage, 0.17, 0.17, 0.08, [side * 0.5, 0.18, z], rubber, 'carriage wheel', [Math.PI / 2, 0, 0], 12);
        addCylinder(carriage, 0.055, 0.055, 0.11, [side * 0.5, 0.18, z], brass, 'carriage axle bearing', [Math.PI / 2, 0, 0], 8, false, true);
      }
    }
    for (const z of [0.88, -0.88]) {
      addBox(carriage, [1.02, 0.62, 0.07], [0, 0.66, z], paint, 'carriage end panel', 0.025);
    }
    for (const z of [0.42, -0.42]) {
      addBox(carriage, [0.88, 0.09, 0.36], [0, 0.55, z], timber, 'carriage bench seat', 0.025);
      addBox(carriage, [0.88, 0.24, 0.07], [0, 0.68, z + Math.sign(z) * 0.18], cream, 'carriage seat back', 0.025);
    }
    addBrace(carriage, [0, 0.26, 1.0], [0, 0.26, 1.16], 0.03, dark, 'carriage coupling', false);
    return carriage;
  }

  /** One four-place coaster car: moulded shell, restraints, and the wheels that hold it on. */
  private buildCoasterCar(
    index: number,
    shell: Material,
    dark: Material,
    steel: Material,
    restraint: Material,
    lamp: Material,
  ): Group {
    const car = new Group();
    car.name = index === 0 ? 'meteor coaster train animation pivot' : `meteor coaster car ${index + 1} pivot`;
    const cream = this.materials.get('paintCream');
    const rubber = this.materials.get('rubber');

    addBox(car, [1.02, 0.28, 2.25], [0, 0.06, 0], dark, 'car chassis frame', 0.05);
    addBox(car, [1.12, 0.56, 2.1], [0, 0.42, 0], shell, 'moulded car shell', 0.22);
    if (index === 0) {
      const noseGeometry = new ConeGeometry(0.52, 0.85, 14);
      applyWorldUV(noseGeometry, 1);
      ensureAmbientOcclusionUV(noseGeometry);
      const nose = new Mesh(noseGeometry, shell);
      nose.name = 'car nose cone';
      nose.position.set(0, 0.42, 1.42);
      nose.rotation.x = Math.PI / 2;
      nose.castShadow = true;
      nose.receiveShadow = true;
      car.add(nose);
      addSphere(car, 0.07, [0, 0.5, 1.78], lamp, 'train marker lamp', [1, 0.7, 0.7], false, 8);
    }
    addBox(car, [0.94, 0.06, 1.9], [0, 0.72, -0.05], cream, 'car body trim stripe', 0.02, ZERO_ROTATION, false, true);
    for (const z of [0.52, -0.52]) {
      addBox(car, [0.94, 0.16, 0.46], [0, 0.66, z], dark, 'seat pan', 0.06);
      addBox(car, [0.94, 0.52, 0.14], [0, 0.94, z - 0.28], cream, 'seat back', 0.05);
      for (const side of [-1, 1] as const) {
        addBrace(car, [side * 0.24, 1.16, z - 0.2], [side * 0.24, 0.78, z + 0.16], 0.05, restraint, 'over shoulder restraint', false);
        addBox(car, [0.1, 0.1, 0.16], [side * 0.24, 1.2, z - 0.24], dark, 'restraint pivot housing', 0.02, ZERO_ROTATION, false, false);
      }
    }
    for (const side of [-1, 1] as const) {
      for (const z of [0.78, -0.78]) {
        addCylinder(car, 0.13, 0.13, 0.1, [side * 0.5, 0.06, z], rubber, 'road wheel', [0, 0, Math.PI / 2], 10, false, true);
        addCylinder(car, 0.1, 0.1, 0.08, [side * 0.58, -0.16, z], rubber, 'upstop wheel', [0, 0, Math.PI / 2], 10, false, true);
        addCylinder(car, 0.1, 0.1, 0.08, [side * 0.62, -0.05, z], rubber, 'side friction wheel', [Math.PI / 2, 0, 0], 10, false, true);
      }
      addBox(car, [0.07, 0.3, 1.7], [side * 0.56, -0.08, 0], steel, 'wheel carrier bogie', 0.02, ZERO_ROTATION, false, true);
    }
    addBrace(car, [0, 0.06, -1.2], [0, 0.06, -1.38], 0.045, steel, 'car coupling', false);
    return car;
  }

  /**
   * One sample of a track: where it is, and which way is forward, sideways and
   * up for a vehicle standing on it.
   *
   * Three.js will hand out Frenet frames for a curve, but their normal flips
   * through straights and inflections, which puts a coaster train briefly
   * upside down. Deriving the frame from world up instead keeps it stable, and
   * leaves banking as something the track author asks for rather than something
   * the curve's second derivative decides.
   */
  private trackFrameAt(curve: CatmullRomCurve3, t: number, bankStrength: number): TrackFrame {
    const at = ((t % 1) + 1) % 1;
    const position = curve.getPointAt(at);
    const forward = curve.getTangentAt(at).normalize();
    const right = new Vector3().crossVectors(WORLD_UP, forward);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(forward, right).normalize();

    if (bankStrength !== 0) {
      // How hard the track is turning here, as the change in compass heading
      // over a short step ahead. Rolling by that amount tips the outer rail up,
      // which is what makes a banked curve look like it is holding the train in
      // rather than throwing it out.
      const ahead = curve.getTangentAt((at + 0.008) % 1).normalize();
      const turn = Math.atan2(ahead.x, ahead.z) - Math.atan2(forward.x, forward.z);
      const shortest = Math.atan2(Math.sin(turn), Math.cos(turn));
      const bank = Math.max(-0.7, Math.min(0.7, shortest * bankStrength));
      const roll = new Quaternion().setFromAxisAngle(forward, bank);
      right.applyQuaternion(roll);
      up.applyQuaternion(roll);
    }
    return { position, forward, right, up };
  }

  /** Places a vehicle on the track: standing on the rails, facing the way it runs. */
  private setOnTrack(vehicle: Object3D, frame: TrackFrame, rideHeight: number): void {
    vehicle.position.copy(frame.position).addScaledVector(frame.up, rideHeight);
    vehicle.quaternion.setFromRotationMatrix(
      new Matrix4().makeBasis(frame.right, frame.up, frame.forward),
    );
  }

  /**
   * Builds a run of track from a curve: two running rails swept along it, and
   * the ties and spine that hold them apart.
   *
   * The rails are tubes swept down curves offset sideways from the centreline,
   * so gauge stays constant through the banking rather than pinching in the
   * turns. Ties are instanced — a circuit carries a few hundred of them and
   * they are the same tie every time.
   */
  private addTrack(parent: Object3D, curve: CatmullRomCurve3, options: TrackOptions): TrackFrame[] {
    const frames: TrackFrame[] = [];
    for (let index = 0; index < options.samples; index += 1) {
      frames.push(this.trackFrameAt(curve, index / options.samples, options.bankStrength));
    }

    for (const side of [-1, 1] as const) {
      const rail = new CatmullRomCurve3(
        frames.map((frame) =>
          frame.position.clone().addScaledVector(frame.right, (side * options.gauge) / 2),
        ),
        true,
        'catmullrom',
        0.5,
      );
      const geometry = new TubeGeometry(rail, options.samples, options.railRadius, 6, true);
      applyWorldUV(geometry, 1);
      ensureAmbientOcclusionUV(geometry);
      const mesh = new Mesh(geometry, options.railMaterial);
      mesh.name = `${options.name} running rail`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }

    if (options.spine) {
      const spineCurve = new CatmullRomCurve3(
        frames.map((frame) => frame.position.clone().addScaledVector(frame.up, options.spine!.offset)),
        true,
        'catmullrom',
        0.5,
      );
      const geometry = new TubeGeometry(spineCurve, options.samples, options.spine.radius, 8, true);
      applyWorldUV(geometry, 1);
      ensureAmbientOcclusionUV(geometry);
      const spine = new Mesh(geometry, options.spine.material);
      spine.name = `${options.name} structural spine`;
      spine.castShadow = true;
      spine.receiveShadow = true;
      parent.add(spine);
    }

    const tieCount = Math.max(8, Math.round(curve.getLength() * options.tie.perMetre));
    const tieGeometry = new RoundedBoxGeometry(...options.tie.size, 1, 0.018);
    applyWorldUV(tieGeometry, 1);
    ensureAmbientOcclusionUV(tieGeometry);
    const ties = new InstancedMesh(tieGeometry, options.tie.material, tieCount);
    ties.name = `${options.name} instanced cross tie`;
    ties.castShadow = true;
    ties.receiveShadow = true;

    const strutDrop = options.spine ? options.tie.offset - options.spine.offset : 0;
    const struts = options.spine
      ? new InstancedMesh(
          (() => {
            const geometry = new RoundedBoxGeometry(0.075, Math.abs(strutDrop), 0.075, 1, 0.015);
            applyWorldUV(geometry, 1);
            ensureAmbientOcclusionUV(geometry);
            return geometry;
          })(),
          options.spine.material,
          tieCount,
        )
      : null;
    if (struts) {
      struts.name = `${options.name} instanced spine strut`;
      struts.castShadow = true;
      struts.receiveShadow = true;
    }

    const scale = new Vector3(1, 1, 1);
    for (let index = 0; index < tieCount; index += 1) {
      const frame = this.trackFrameAt(curve, index / tieCount, options.bankStrength);
      const rotation = new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(frame.right, frame.up, frame.forward),
      );
      setInstance(
        ties,
        index,
        frame.position.clone().addScaledVector(frame.up, options.tie.offset),
        rotation,
        scale,
      );
      if (struts) {
        setInstance(
          struts,
          index,
          frame.position.clone().addScaledVector(frame.up, options.tie.offset - strutDrop / 2),
          rotation,
          scale,
        );
      }
    }
    ties.instanceMatrix.needsUpdate = true;
    parent.add(ties);
    if (struts) {
      struts.instanceMatrix.needsUpdate = true;
      parent.add(struts);
    }
    return frames;
  }

  /**
   * Stands the track up on columns, skipping any that would come down through
   * a lower pass of the same circuit. The alternative is authoring every
   * support by hand and re-authoring them whenever the layout moves.
   */
  private addTrackSupports(
    parent: Object3D,
    frames: readonly TrackFrame[],
    column: Material,
    brace: Material,
    footing: Material,
    everyNth: number,
  ): void {
    for (let index = 0; index < frames.length; index += everyNth) {
      const frame = frames[index];
      if (!frame || frame.position.y < 2.2) continue;
      const { x, y, z } = frame.position;
      const blocked = frames.some((other) => {
        if (other === frame) return false;
        if (other.position.y > y - 1.1 || other.position.y < 0.4) return false;
        return Math.hypot(other.position.x - x, other.position.z - z) < 1.35;
      });
      if (blocked) continue;

      const top = y - 0.42;
      addBox(parent, [0.26, top, 0.26], [x, top / 2, z], column, 'track support column', 0.04);
      addBox(parent, [0.68, 0.16, 0.68], [x, 0.1, z], footing, 'support column footing', 0.03, ZERO_ROTATION, false, true);
      // Feet spread along the ground, not along the banked frame: on a rolled
      // section the track's own right vector points partly into the earth.
      const spread = new Vector3(frame.right.x, 0, frame.right.z);
      if (spread.lengthSq() < 1e-6) spread.set(1, 0, 0);
      spread.normalize();
      for (const side of [-1, 1] as const) {
        const foot = new Vector3(x, 0.22, z).addScaledVector(spread, side * 1.05);
        addBrace(parent, [x, top * 0.62, z], [foot.x, foot.y, foot.z], 0.045, brace, 'support diagonal brace', false);
      }
      for (const bolt of [-0.19, 0.19]) addBolt(parent, [x + bolt, 0.2, z + 0.2], brace, ZERO_ROTATION, 0.03);
    }
  }

  /** A section of a closed circuit, as its own open curve. Used for lift chains and brake runs. */
  private trackSection(
    curve: CatmullRomCurve3,
    from: number,
    to: number,
    samples: number,
  ): Vector3[] {
    const points: Vector3[] = [];
    for (let index = 0; index <= samples; index += 1) {
      points.push(curve.getPointAt(((from + ((to - from) * index) / samples) % 1 + 1) % 1));
    }
    return points;
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
