import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface MeshBuildOptions {
  name?: string;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Approximate metres covered by one UV unit. */
  texelScale?: number;
}

const UNIT_Y = new Vector3(0, 1, 0);
const scratchDirection = new Vector3();
const scratchMidpoint = new Vector3();
const scratchQuaternion = new Quaternion();

function finishMesh<T extends BufferGeometry>(
  geometry: T,
  material: Material,
  options: MeshBuildOptions,
): Mesh<T, Material> {
  if (options.texelScale) applyWorldUV(geometry, options.texelScale);
  ensureAmbientOcclusionUV(geometry);
  const mesh = new Mesh(geometry, material);
  if (options.name) mesh.name = options.name;
  if (options.position) mesh.position.set(...options.position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  return mesh;
}

/** Rounded construction panel with UVs scaled in approximate world metres. */
export function roundedBoxMesh(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: Material,
  options: MeshBuildOptions = {},
  bevelSegments = 2,
): Mesh {
  const safeRadius = Math.max(0.002, Math.min(radius, Math.min(width, height, depth) * 0.48));
  const geometry = new RoundedBoxGeometry(
    width,
    height,
    depth,
    Math.max(1, bevelSegments),
    safeRadius,
  );
  return finishMesh(geometry, material, options);
}

export function cylinderMesh(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
  material: Material,
  options: MeshBuildOptions = {},
): Mesh {
  const geometry = new CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    Math.max(6, radialSegments),
    1,
    false,
  );
  return finishMesh(geometry, material, options);
}

export function sphereMesh(
  radius: number,
  material: Material,
  options: MeshBuildOptions = {},
  widthSegments = 12,
  heightSegments = 8,
): Mesh {
  const geometry = new SphereGeometry(radius, Math.max(8, widthSegments), Math.max(6, heightSegments));
  return finishMesh(geometry, material, options);
}

export function planeMesh(
  width: number,
  height: number,
  material: Material,
  options: MeshBuildOptions = {},
): Mesh {
  const geometry = new PlaneGeometry(width, height);
  // PlaneGeometry's local XY positions become stable, metre-scaled UVs.
  const positions = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const scale = options.texelScale ?? 1;
  for (let index = 0; index < positions.count; index += 1) {
    uv.setXY(index, positions.getX(index) / scale, positions.getY(index) / scale);
  }
  uv.needsUpdate = true;
  const { texelScale: _texelScale, ...rest } = options;
  void _texelScale;
  return finishMesh(geometry, material, rest);
}

/** A cylinder aligned between two local-space points, useful for real bracing. */
export function beamBetween(
  start: Vector3,
  end: Vector3,
  radius: number,
  material: Material,
  radialSegments = 8,
  options: Omit<MeshBuildOptions, 'position' | 'rotation'> = {},
): Mesh {
  scratchDirection.subVectors(end, start);
  const length = Math.max(0.0001, scratchDirection.length());
  scratchMidpoint.addVectors(start, end).multiplyScalar(0.5);
  scratchQuaternion.setFromUnitVectors(UNIT_Y, scratchDirection.normalize());
  const mesh = cylinderMesh(radius, radius, length, radialSegments, material, options);
  mesh.position.copy(scratchMidpoint);
  mesh.quaternion.copy(scratchQuaternion);
  return mesh;
}

/**
 * Projects UVs from the dominant face normal. Rounded edges switch projection
 * at their least-visible tangent, keeping texture density consistent across
 * objects with very different proportions.
 */
export function applyWorldUV(geometry: BufferGeometry, metresPerUv = 1): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return;

  const scale = 1 / Math.max(0.001, metresPerUv);
  const values = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    values[index * 2] = u * scale;
    values[index * 2 + 1] = v * scale;
  }
  geometry.setAttribute('uv', new BufferAttribute(values, 2));
}

/** AO maps need a secondary UV channel in current and older Three.js builds. */
export function ensureAmbientOcclusionUV(geometry: BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  if (!geometry.getAttribute('uv1')) geometry.setAttribute('uv1', uv.clone());
  if (!geometry.getAttribute('uv2')) geometry.setAttribute('uv2', uv.clone());
}

export function setTransform(
  target: { position: Vector3; quaternion: Quaternion; scale: Vector3 },
  position: Vector3,
  rotation: Quaternion = new Quaternion(),
  scale: Vector3 = new Vector3(1, 1, 1),
): Matrix4 {
  target.position.copy(position);
  target.quaternion.copy(rotation);
  target.scale.copy(scale);
  return new Matrix4().compose(position, rotation, scale);
}

export function polar(radius: number, angle: number, y = 0): Vector3 {
  return new Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
}

export function uvScaleForSize(size: readonly [number, number]): Vector2 {
  return new Vector2(1 / Math.max(0.01, size[0]), 1 / Math.max(0.01, size[1]));
}
