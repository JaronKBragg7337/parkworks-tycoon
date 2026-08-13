import { Box3, BufferGeometry, Mesh, Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { PLACEABLE_SPECS } from '../src/core/catalog';
import { AssetFactory } from '../src/world/AssetFactory';
import { MaterialLibrary } from '../src/world/Materials';

const materials = new MaterialLibrary({
  loadBundledCc0: false,
  proceduralTextureSize: 32,
});
const factory = new AssetFactory({ materials, quality: 'high' });

afterAll(() => {
  factory.dispose();
  materials.dispose();
});

function inspectAsset(kind: (typeof PLACEABLE_SPECS)[number]['kind']) {
  const object = factory.createPlaceable(kind);
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  let meshes = 0;
  let triangles = 0;
  const names: string[] = [];
  object.traverse((child) => {
    names.push(child.name.toLowerCase());
    if (!(child instanceof Mesh)) return;
    meshes += 1;
    const geometry = child.geometry as BufferGeometry;
    triangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return { object, bounds, size, meshes, triangles, names };
}

describe('procedural placeable assets', () => {
  for (const spec of PLACEABLE_SPECS) {
    it(`${spec.kind} has finite metre-scale assembled geometry`, () => {
      const report = inspectAsset(spec.kind);
      expect(report.bounds.isEmpty()).toBe(false);
      expect(Number.isFinite(report.size.x + report.size.y + report.size.z)).toBe(true);
      expect(report.bounds.min.y).toBeGreaterThanOrEqual(-0.25);
      expect(report.size.y).toBeGreaterThan(0.45);
      expect(report.size.x).toBeLessThan(spec.footprint[0] * 1.7 + 1);
      expect(report.size.z).toBeLessThan(spec.footprint[1] * 1.7 + 1);
      expect(report.meshes).toBeGreaterThanOrEqual(4);
      expect(report.triangles).toBeGreaterThan(60);
      expect(report.triangles).toBeLessThan(220_000);
      expect(report.object.userData.footprint).toEqual([...spec.footprint]);
    });
  }

  it.each(['burger-kiosk', 'lemonade-stand', 'carousel', 'sky-wheel', 'restroom'] as const)(
    '%s exposes secondary and tertiary construction layers',
    (kind) => {
      const report = inspectAsset(kind);
      const constructionNames = report.names.filter((name) =>
        /frame|brace|bolt|panel|seam|hinge|vent|rail|conduit|support|post|bearing|mast|trim|hub|tap|wheel/.test(name),
      );
      expect(report.meshes).toBeGreaterThan(20);
      expect(constructionNames.length).toBeGreaterThan(4);
    },
  );
});
