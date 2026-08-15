import { Box3, BufferGeometry, Mesh, Object3D, Vector3 } from 'three';
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
  object.updateMatrixWorld(true);
  // Bounds measure assembled construction only. Meshes flagged as decals are
  // lighting effects such as the pool a lamp casts on the ground: they are
  // meant to spill past the footprint, and including them would turn this
  // real-world-scale guard into noise.
  const bounds = new Box3();
  let meshes = 0;
  let triangles = 0;
  const names: string[] = [];
  object.traverse((child) => {
    names.push(child.name.toLowerCase());
    if (!(child instanceof Mesh)) return;
    if (child.userData.decal !== true) bounds.expandByObject(child);
    meshes += 1;
    const geometry = child.geometry as BufferGeometry;
    triangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  const size = bounds.getSize(new Vector3());
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

  it.each([
    'burger-kiosk',
    'lemonade-stand',
    'ice-cream-cart',
    'pizza-kitchen',
    'carousel',
    'sky-wheel',
    'bumper-cars',
    'drop-tower',
    'pirate-ship',
    'mini-railway',
    'meteor-coaster',
    'restroom',
    'first-aid',
    'information-booth',
    'cash-machine',
    'maintenance-hut',
  ] as const)(
    '%s exposes secondary and tertiary construction layers',
    (kind) => {
      const report = inspectAsset(kind);
      const constructionNames = report.names.filter((name) =>
        /frame|brace|bolt|panel|seam|hinge|vent|rail|conduit|support|post|bearing|mast|trim|hub|tap|wheel|restraint|mullion|jamb|axle|cable/.test(name),
      );
      expect(report.meshes).toBeGreaterThan(20);
      expect(constructionNames.length).toBeGreaterThan(4);
    },
  );

  const ANIMATION_PIVOTS = {
    'bumper-cars': 'bumper car animation pivot 1',
    'drop-tower': 'guided drop carriage animation pivot',
    'pirate-ship': 'pirate ship swing animation pivot',
    'mini-railway': 'miniature railway train animation pivot',
    'meteor-coaster': 'meteor coaster train animation pivot',
  } as const;

  it.each(Object.keys(ANIMATION_PIVOTS) as Array<keyof typeof ANIMATION_PIVOTS>)(
    '%s provides an operating animation pivot that moves',
    (kind) => {
      const report = inspectAsset(kind);
      const pivot = report.object.getObjectByName(ANIMATION_PIVOTS[kind]);
      expect(report.object.userData.animated).toBe(true);
      expect(typeof report.object.userData.animate).toBe('function');
      expect(pivot).toBeDefined();
      if (!pivot) return;
      const before = [...pivot.position.toArray(), ...pivot.rotation.toArray()];
      factory.animate(report.object, 7.25, 0.016, 1);
      const after = [...pivot.position.toArray(), ...pivot.rotation.toArray()];
      expect(after).not.toEqual(before);
    },
  );

  // A vehicle on a track has one failure that a swinging or spinning ride does
  // not: it can leave the rails. Running a full circuit and watching where the
  // train ends up catches a broken frame or a curve the animation walks off.
  it.each(['mini-railway', 'meteor-coaster'] as const)(
    '%s keeps its train on the track for a full circuit',
    (kind) => {
      const report = inspectAsset(kind);
      const train = report.object.getObjectByName(ANIMATION_PIVOTS[kind]);
      expect(train).toBeDefined();
      if (!train) return;

      const railHeight = kind === 'mini-railway' ? 0.36 : 1.9;
      let travelled = 0;
      for (let step = 0; step < 900; step += 1) {
        factory.animate(report.object, step * 0.05, 0.05, 1);
        const { x, y, z } = train.position;
        expect(Number.isFinite(x + y + z)).toBe(true);
        expect(y).toBeGreaterThan(railHeight - 0.9);
        expect(y).toBeLessThan(11.5);
        expect(Math.hypot(x, z)).toBeLessThan(9.5);
        // Neither ride has an inversion, so the car's own up axis stays up.
        // The bar allows a hard banked turn taken on a steep drop — the two
        // tilts compound — and nothing beyond it.
        const up = new Vector3(0, 1, 0).applyQuaternion(train.quaternion);
        expect(up.y).toBeGreaterThan(0.45);
        travelled += Math.hypot(x, z);
      }
      expect(travelled).toBeGreaterThan(0);
    },
  );

  it('lands the fountain and the planter on the ground with their own detail', () => {
    for (const kind of ['tiered-fountain', 'blossom-planter'] as const) {
      const report = inspectAsset(kind);
      expect(report.bounds.min.y).toBeGreaterThanOrEqual(-0.02);
      expect(report.meshes).toBeGreaterThan(20);
      expect(report.names.some((name) => /blossom|water|ripple|jet|slat|rib|coping/.test(name))).toBe(true);
    }
  });

  it('keeps the expanded ride set inside the mobile geometry budget', () => {
    const mobileFactory = new AssetFactory({ materials, quality: 'mobile' });
    for (const kind of ['bumper-cars', 'drop-tower', 'pirate-ship', 'mini-railway', 'meteor-coaster'] as const) {
      const object = mobileFactory.createPlaceable(kind);
      let triangles = 0;
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const geometry = child.geometry as BufferGeometry;
        triangles += geometry.index
          ? geometry.index.count / 3
          : (geometry.getAttribute('position')?.count ?? 0) / 3;
      });
      expect(triangles).toBeLessThan(125_000);
    }
    mobileFactory.dispose();
  });

  it('kits the crew post out as somewhere people work from', () => {
    const report = inspectAsset('maintenance-hut');
    // The bay is open and the tools are on the wall; a closed box would read as
    // storage rather than as staff.
    for (const part of ['barrow', 'broom', 'shutter', 'bin', 'bollard']) {
      expect(report.names.some((name) => name.includes(part))).toBe(true);
    }
    // Nothing overhangs land the placement rules say the hut does not occupy.
    expect(report.bounds.min.x).toBeGreaterThanOrEqual(-2.05);
    expect(report.bounds.max.x).toBeLessThanOrEqual(2.05);
    expect(report.bounds.min.z).toBeGreaterThanOrEqual(-1.55);
    expect(report.bounds.max.z).toBeLessThanOrEqual(1.55);
  });

  /**
   * The whole job of the janitor's silhouette is being told apart from a guest
   * at phone scale, so the test is about difference rather than detail: staff
   * kit no guest has, and a body wider through the chest than any guest's.
   */
  it('gives the janitor a silhouette no guest shares', () => {
    const janitor = factory.createJanitor(0);
    janitor.updateMatrixWorld(true);
    const guest = factory.createGuest(0);
    guest.updateMatrixWorld(true);

    const names = (object: Object3D): string[] => {
      const collected: string[] = [];
      object.traverse((child) => collected.push(child.name.toLowerCase()));
      return collected;
    };
    const janitorNames = names(janitor);
    for (const part of ['over vest', 'hard hat shell', 'litter picker tool', 'retroreflective']) {
      expect(janitorNames.some((name) => name.includes(part))).toBe(true);
    }
    expect(names(guest).some((name) => name.includes('vest'))).toBe(false);

    const widthOf = (object: Object3D, part: string): number => {
      const mesh = object.getObjectByName(part);
      expect(mesh, part).toBeDefined();
      return new Box3().setFromObject(mesh!).getSize(new Vector3()).x;
    };
    // The chest block is the thing that survives being four pixels wide, so the
    // vest has to be broader than the shirt it goes over rather than a decal on
    // top of it.
    expect(widthOf(janitor, 'high visibility over vest')).toBeGreaterThan(
      widthOf(guest, 'seamed torso garment'),
    );

    // Still a person standing on the ground, not one floating over it or sunk
    // into it.
    const bounds = new Box3().setFromObject(janitor);
    expect(bounds.min.y).toBeGreaterThan(-0.05);
    expect(bounds.min.y).toBeLessThan(0.05);
    const height = bounds.getSize(new Vector3()).y;
    expect(height).toBeGreaterThan(1.9);
    expect(height).toBeLessThan(2.4);
  });

  it('can omit the baked promenade for player-authored path grids', () => {
    const landscape = factory.createLandscape({ includePromenade: false, includeFence: false });
    const names: string[] = [];
    landscape.traverse((child) => names.push(child.name.toLowerCase()));
    expect(names.some((name) => /promenade|cross path|planting bed/.test(name))).toBe(false);
    expect(names).toContain('meter-scaled grass parcel');
  });
});
