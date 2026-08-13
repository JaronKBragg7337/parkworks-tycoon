import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';
import type {
  GridCell,
  ParkGridCellSnapshot,
  ParkGridSnapshot,
  ParcelSnapshot,
} from '../core/ParkGrid';
import type { MaterialLibrary } from '../world/Materials';
import type { InfrastructureTool } from './InfrastructureBuilder';

function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}

function makeInstances(
  name: string,
  transforms: readonly Matrix4[],
  geometry: BoxGeometry,
  material: Material | Material[],
): InstancedMesh | null {
  if (transforms.length === 0) return null;
  const mesh = new InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  transforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function tileTransform(cell: GridCell, y: number, rotation = 0): Matrix4 {
  const helper = new Object3D();
  helper.position.set(cell.x, y, cell.z);
  helper.rotation.y = rotation;
  helper.updateMatrix();
  return helper.matrix.clone();
}

/** Draw-call-conscious visual mirror of the authoritative ParkGrid model. */
export class ParkInfrastructureView {
  readonly object = new Group();

  private readonly surfaces = new Group();
  private readonly ownership = new Group();
  private readonly parcelOverlays = new Group();
  private readonly preview = new Group();
  private readonly tileGeometry = new BoxGeometry(0.97, 0.085, 0.97);
  private readonly curbGeometry = new BoxGeometry(1, 0.075, 0.075);
  private readonly markingGeometry = new BoxGeometry(0.065, 0.018, 0.34);
  private readonly drainGeometry = new BoxGeometry(0.34, 0.018, 0.12);
  private readonly previewGeometry = new BoxGeometry(0.9, 0.035, 0.9);
  private readonly parcelGeometry = new BoxGeometry(1, 0.025, 1);
  private readonly boundaryMaterial = new LineBasicMaterial({
    color: 0x70e3b3,
    transparent: true,
    opacity: 0.72,
  });
  private readonly previewMaterial = new MeshBasicMaterial({
    color: 0x51d9a3,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  private readonly availableMaterial = new MeshBasicMaterial({
    color: 0xf0b55a,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  });
  private readonly lockedMaterial = new MeshBasicMaterial({
    color: 0x40575a,
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
  });
  private readonly materials: MaterialLibrary;
  private landMode = false;

  constructor(materials: MaterialLibrary) {
    this.materials = materials;
    this.object.name = 'Park infrastructure';
    this.surfaces.name = 'Roads and sidewalks';
    this.ownership.name = 'Owned land perimeter';
    this.parcelOverlays.name = 'Expansion parcel overlays';
    this.preview.name = 'Infrastructure stroke preview';
    this.parcelOverlays.visible = false;
    this.object.add(this.surfaces, this.ownership, this.parcelOverlays, this.preview);
  }

  update(snapshot: ParkGridSnapshot): void {
    this.disposeInstanceBuffers(this.surfaces);
    this.surfaces.clear();
    this.ownership.traverse((child) => {
      if (child instanceof LineSegments) child.geometry.dispose();
    });
    this.ownership.clear();
    this.parcelOverlays.clear();

    const cellMap = new Map(snapshot.cells.map((cell) => [cellKey(cell.x, cell.z), cell]));
    const sidewalks = snapshot.cells.filter((cell) => cell.surface === 'sidewalk');
    const roads = snapshot.cells.filter((cell) => cell.surface === 'road');
    const sidewalkTiles = sidewalks.map((cell) => tileTransform(cell, 0.015));
    const roadTiles = roads.map((cell) => tileTransform(cell, 0.012));

    const sidewalkMesh = makeInstances(
      'Paving modules with construction joints',
      sidewalkTiles,
      this.tileGeometry,
      this.materials.get('path'),
    );
    const roadMesh = makeInstances(
      'Park road asphalt modules',
      roadTiles,
      this.tileGeometry,
      this.materials.get('concreteDark'),
    );
    if (sidewalkMesh) this.surfaces.add(sidewalkMesh);
    if (roadMesh) this.surfaces.add(roadMesh);

    const curbs: Matrix4[] = [];
    for (const cell of [...sidewalks, ...roads]) {
      this.addMissingEdgeCurbs(cell, cellMap, curbs);
    }
    const curbMesh = makeInstances(
      'Segmented concrete edge restraints',
      curbs,
      this.curbGeometry,
      this.materials.get('concrete'),
    );
    if (curbMesh) this.surfaces.add(curbMesh);

    const markings: Matrix4[] = [];
    const drains: Matrix4[] = [];
    for (const cell of roads) {
      const northSouth = this.isRoad(cellMap, cell.x, cell.z - 1) || this.isRoad(cellMap, cell.x, cell.z + 1);
      const eastWest = this.isRoad(cellMap, cell.x - 1, cell.z) || this.isRoad(cellMap, cell.x + 1, cell.z);
      if (Math.abs(cell.x * 13 + cell.z * 5) % 3 !== 1) {
        markings.push(tileTransform(cell, 0.064, eastWest && !northSouth ? Math.PI / 2 : 0));
      }
      if (Math.abs(cell.x * 19 + cell.z * 7) % 9 === 0) {
        const offset = tileTransform({ x: cell.x + 0.34, z: cell.z }, 0.066, Math.PI / 2);
        drains.push(offset);
      }
    }
    const markingMesh = makeInstances(
      'Short anti-slip road centre markings',
      markings,
      this.markingGeometry,
      this.materials.get('paintYellow'),
    );
    const drainMesh = makeInstances(
      'Galvanized road drainage grates',
      drains,
      this.drainGeometry,
      this.materials.get('galvanized'),
    );
    if (markingMesh) this.surfaces.add(markingMesh);
    if (drainMesh) this.surfaces.add(drainMesh);

    this.rebuildOwnedBoundary(snapshot.cells, cellMap);
    this.rebuildParcelOverlays(snapshot.parcels);
    this.parcelOverlays.visible = this.landMode;
  }

  setLandMode(visible: boolean): void {
    this.landMode = visible;
    this.parcelOverlays.visible = visible;
  }

  setPreview(cells: readonly GridCell[], tool: InfrastructureTool, valid: boolean): void {
    this.disposeInstanceBuffers(this.preview);
    this.preview.clear();
    if (cells.length === 0) return;
    const color = !valid ? 0xff6b5d : tool === 'road' ? 0x66a8db : tool === 'demolish' ? 0xf0b55a : 0x51d9a3;
    this.previewMaterial.color.setHex(color);
    const instances = makeInstances(
      'Selected construction stroke',
      cells.map((cell) => tileTransform(cell, 0.105)),
      this.previewGeometry,
      this.previewMaterial,
    );
    if (instances) this.preview.add(instances);
  }

  clearPreview(): void {
    this.disposeInstanceBuffers(this.preview);
    this.preview.clear();
  }

  dispose(): void {
    this.object.removeFromParent();
    this.tileGeometry.dispose();
    this.curbGeometry.dispose();
    this.markingGeometry.dispose();
    this.drainGeometry.dispose();
    this.previewGeometry.dispose();
    this.parcelGeometry.dispose();
    this.boundaryMaterial.dispose();
    this.previewMaterial.dispose();
    this.availableMaterial.dispose();
    this.lockedMaterial.dispose();
  }

  private isRoad(cells: ReadonlyMap<string, ParkGridCellSnapshot>, x: number, z: number): boolean {
    return cells.get(cellKey(x, z))?.surface === 'road';
  }

  private addMissingEdgeCurbs(
    cell: ParkGridCellSnapshot,
    cells: ReadonlyMap<string, ParkGridCellSnapshot>,
    transforms: Matrix4[],
  ): void {
    const neighbors: Array<[number, number, number]> = [
      [0, -0.5, 0],
      [0, 0.5, 0],
      [-0.5, 0, Math.PI / 2],
      [0.5, 0, Math.PI / 2],
    ];
    for (const [offsetX, offsetZ, rotation] of neighbors) {
      const neighborX = cell.x + Math.round(offsetX * 2);
      const neighborZ = cell.z + Math.round(offsetZ * 2);
      if (cells.get(cellKey(neighborX, neighborZ))?.walkable) continue;
      transforms.push(tileTransform({ x: cell.x + offsetX, z: cell.z + offsetZ }, 0.082, rotation));
    }
  }

  private rebuildOwnedBoundary(
    cells: readonly ParkGridCellSnapshot[],
    cellMap: ReadonlyMap<string, ParkGridCellSnapshot>,
  ): void {
    const vertices: number[] = [];
    const addEdge = (ax: number, az: number, bx: number, bz: number): void => {
      vertices.push(ax, 0.085, az, bx, 0.085, bz);
    };
    for (const cell of cells) {
      if (!cell.owned) continue;
      if (!cellMap.get(cellKey(cell.x, cell.z - 1))?.owned) addEdge(cell.x - 0.5, cell.z - 0.5, cell.x + 0.5, cell.z - 0.5);
      if (!cellMap.get(cellKey(cell.x, cell.z + 1))?.owned) addEdge(cell.x - 0.5, cell.z + 0.5, cell.x + 0.5, cell.z + 0.5);
      if (!cellMap.get(cellKey(cell.x - 1, cell.z))?.owned) addEdge(cell.x - 0.5, cell.z - 0.5, cell.x - 0.5, cell.z + 0.5);
      if (!cellMap.get(cellKey(cell.x + 1, cell.z))?.owned) addEdge(cell.x + 0.5, cell.z - 0.5, cell.x + 0.5, cell.z + 0.5);
    }
    if (vertices.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    const lines = new LineSegments(geometry, this.boundaryMaterial);
    lines.name = 'Surveyed owned-land boundary';
    this.ownership.add(lines);
  }

  private rebuildParcelOverlays(parcels: readonly ParcelSnapshot[]): void {
    for (const parcel of parcels) {
      if (parcel.owned) continue;
      const width = parcel.bounds.maxX - parcel.bounds.minX + 1;
      const depth = parcel.bounds.maxZ - parcel.bounds.minZ + 1;
      const mesh = new Mesh(
        this.parcelGeometry,
        parcel.purchasable ? this.availableMaterial : this.lockedMaterial,
      );
      mesh.name = `${parcel.name} — ${parcel.status}`;
      mesh.position.set(
        (parcel.bounds.minX + parcel.bounds.maxX) / 2,
        -0.055,
        (parcel.bounds.minZ + parcel.bounds.maxZ) / 2,
      );
      mesh.scale.set(width - 0.12, 1, depth - 0.12);
      mesh.userData.parcelId = parcel.id;
      this.parcelOverlays.add(mesh);
    }
  }

  private disposeInstanceBuffers(group: Group): void {
    group.traverse((child) => {
      if (child instanceof InstancedMesh) child.dispose();
    });
  }
}
