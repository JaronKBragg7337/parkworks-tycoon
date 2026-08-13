import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  UnsignedByteType,
  type WebGLRenderer,
} from 'three';

/** Materials used by the procedural park assets. */
export type MaterialKey =
  | 'grass'
  | 'soil'
  | 'path'
  | 'concrete'
  | 'concreteDark'
  | 'brick'
  | 'porcelain'
  | 'paintCream'
  | 'paintWhite'
  | 'paintRed'
  | 'paintYellow'
  | 'paintTeal'
  | 'paintBlue'
  | 'paintGreen'
  | 'steel'
  | 'steelDark'
  | 'galvanized'
  | 'copper'
  | 'brass'
  | 'rubber'
  | 'timber'
  | 'timberDark'
  | 'bark'
  | 'leaf'
  | 'leafLight'
  | 'glass'
  | 'lampGlow'
  | 'paper'
  | 'cardboard';

export type GroundMaterialKey = 'grass' | 'soil' | 'path';

/**
 * Optional externally sourced maps for a ground surface. The procedural maps
 * remain the fallback, so a later CC0 texture download can be plugged in
 * without changing any asset-building code.
 */
export interface GroundTextureSet {
  color?: Texture | null;
  normal?: Texture | null;
  roughness?: Texture | null;
  ambientOcclusion?: Texture | null;
  displacement?: Texture | null;
  metersPerRepeat?: number | readonly [number, number];
}

export interface MaterialLibraryOptions {
  renderer?: WebGLRenderer;
  /** 64 is intentionally enough for non-photographic micro-variation on mobile. */
  proceduralTextureSize?: number;
  groundMaps?: Partial<Record<GroundMaterialKey, GroundTextureSet>>;
  /** Automatically upgrades five core surfaces from local ambientCG CC0 maps. */
  loadBundledCc0?: boolean;
  textureAssetBaseUrl?: string;
}

interface ProceduralSurfaceOptions {
  color: number;
  roughness: number;
  metalness?: number;
  colorVariation?: number;
  roughnessVariation?: number;
  bumpScale?: number;
  seed: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissive?: number;
  emissiveIntensity?: number;
}

interface GroundFallback {
  color: Texture | null;
  normal: Texture | null;
  roughness: Texture | null;
  ambientOcclusion: Texture | null;
  displacement: Texture | null;
  metersPerRepeat: readonly [number, number];
}

const DEFAULT_TEXTURE_SIZE = 64;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function hash2(seed: number, x: number, y: number): number {
  let value = Math.imul(x + seed * 17, 0x45d9f3b) ^ Math.imul(y - seed * 29, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}

/** Seamless periodic value noise. */
function valueNoise(seed: number, x: number, y: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const wrap = (value: number): number => ((value % period) + period) % period;
  const a = hash2(seed, wrap(x0), wrap(y0));
  const b = hash2(seed, wrap(x0 + 1), wrap(y0));
  const c = hash2(seed, wrap(x0), wrap(y0 + 1));
  const d = hash2(seed, wrap(x0 + 1), wrap(y0 + 1));
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

function fbm(seed: number, u: number, v: number): number {
  let total = 0;
  let weight = 0;
  let amplitude = 0.58;
  for (let octave = 0; octave < 4; octave += 1) {
    const frequency = 2 ** (octave + 1);
    total += valueNoise(seed + octave * 97, u * frequency, v * frequency, frequency) * amplitude;
    weight += amplitude;
    amplitude *= 0.48;
  }
  return total / weight;
}

function makeDataTexture(data: Uint8Array, size: number, colorTexture: boolean): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  if (colorTexture) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createColorNoiseTexture(
  colorValue: number,
  variation: number,
  seed: number,
  size: number,
): DataTexture {
  const base = new Color(colorValue);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const broad = fbm(seed, u, v) - 0.5;
      const grain = hash2(seed + 509, x, y) - 0.5;
      const speck = hash2(seed + 911, x, y) > 0.985 ? -variation * 0.75 : 0;
      const brightness = 1 + broad * variation * 1.35 + grain * variation * 0.28 + speck;
      const index = (y * size + x) * 4;
      data[index] = Math.round(clamp(base.r * brightness) * 255);
      data[index + 1] = Math.round(clamp(base.g * brightness) * 255);
      data[index + 2] = Math.round(clamp(base.b * brightness) * 255);
      data[index + 3] = 255;
    }
  }
  return makeDataTexture(data, size, true);
}

function createScalarNoiseTexture(
  center: number,
  variation: number,
  seed: number,
  size: number,
): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = fbm(seed, x / size, y / size) - 0.5;
      const grain = hash2(seed + 313, x, y) - 0.5;
      const value = Math.round(clamp(center + broad * variation + grain * variation * 0.24) * 255);
      const index = (y * size + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return makeDataTexture(data, size, false);
}

/**
 * A compact, reusable PBR palette for every generated asset.
 *
 * All bundled texture detail is produced by the code above and released with
 * the CC0 project. Materials deliberately use measured-style values: paint is
 * mostly dielectric, bare alloys are metallic, masonry is rough, and glass is
 * a thin transparent dielectric. Multi-octave seamless noise adds micro and
 * macro breakup without obvious tiling or network requests.
 */
export class MaterialLibrary {
  private readonly materialMap = new Map<MaterialKey, MeshStandardMaterial>();
  private readonly ownedTextures = new Set<Texture>();
  private readonly generatedGround = new Map<GroundMaterialKey, GroundFallback>();
  private readonly tintCache = new Map<string, MeshStandardMaterial>();
  private readonly textureSize: number;
  private readonly maxAnisotropy: number;
  /** Resolves after optional local CC0 surface upgrades have loaded or cleanly fallen back. */
  readonly ready: Promise<void>;

  constructor(options: MaterialLibraryOptions = {}) {
    this.textureSize = Math.max(32, Math.min(128, options.proceduralTextureSize ?? DEFAULT_TEXTURE_SIZE));
    this.maxAnisotropy = options.renderer
      ? Math.min(8, options.renderer.capabilities.getMaxAnisotropy())
      : 4;

    this.addSurface('grass', {
      color: 0x476b3b,
      roughness: 0.96,
      colorVariation: 0.28,
      roughnessVariation: 0.12,
      bumpScale: 0.065,
      seed: 11,
    });
    this.addSurface('soil', {
      color: 0x5a3f2c,
      roughness: 0.97,
      colorVariation: 0.3,
      roughnessVariation: 0.11,
      bumpScale: 0.075,
      seed: 23,
    });
    this.addSurface('path', {
      color: 0xb2946c,
      roughness: 0.9,
      colorVariation: 0.22,
      roughnessVariation: 0.14,
      bumpScale: 0.045,
      seed: 37,
    });
    this.addSurface('concrete', {
      color: 0xb7b2a6,
      roughness: 0.86,
      colorVariation: 0.13,
      roughnessVariation: 0.1,
      bumpScale: 0.025,
      seed: 41,
    });
    this.addSurface('concreteDark', {
      color: 0x5a5f60,
      roughness: 0.82,
      colorVariation: 0.11,
      roughnessVariation: 0.1,
      bumpScale: 0.022,
      seed: 43,
    });
    this.addSurface('brick', {
      color: 0x8b493b,
      roughness: 0.89,
      colorVariation: 0.16,
      roughnessVariation: 0.09,
      bumpScale: 0.03,
      seed: 47,
    });
    this.addSurface('porcelain', {
      color: 0xe5e2d8,
      roughness: 0.28,
      colorVariation: 0.02,
      roughnessVariation: 0.04,
      bumpScale: 0.002,
      clearcoat: 0.2,
      clearcoatRoughness: 0.18,
      seed: 53,
    });

    this.addPaint('paintCream', 0xf1d8a5, 59);
    this.addPaint('paintWhite', 0xeee9df, 61);
    this.addPaint('paintRed', 0xb83f38, 67);
    this.addPaint('paintYellow', 0xe2ad3a, 71);
    this.addPaint('paintTeal', 0x2f7777, 73);
    this.addPaint('paintBlue', 0x315c85, 79);
    this.addPaint('paintGreen', 0x3f7650, 83);

    this.addSurface('steel', {
      color: 0x858b8d,
      roughness: 0.34,
      metalness: 0.86,
      colorVariation: 0.06,
      roughnessVariation: 0.16,
      bumpScale: 0.008,
      seed: 89,
    });
    this.addSurface('steelDark', {
      color: 0x242b2e,
      roughness: 0.43,
      metalness: 0.72,
      colorVariation: 0.08,
      roughnessVariation: 0.15,
      bumpScale: 0.009,
      seed: 97,
    });
    this.addSurface('galvanized', {
      color: 0xaab0ae,
      roughness: 0.48,
      metalness: 0.72,
      colorVariation: 0.1,
      roughnessVariation: 0.18,
      bumpScale: 0.012,
      seed: 101,
    });
    this.addSurface('copper', {
      color: 0x9f5c3b,
      roughness: 0.4,
      metalness: 0.79,
      colorVariation: 0.13,
      roughnessVariation: 0.14,
      bumpScale: 0.008,
      seed: 103,
    });
    this.addSurface('brass', {
      color: 0xb78a36,
      roughness: 0.31,
      metalness: 0.82,
      colorVariation: 0.09,
      roughnessVariation: 0.12,
      bumpScale: 0.006,
      seed: 107,
    });
    this.addSurface('rubber', {
      color: 0x181b1c,
      roughness: 0.91,
      colorVariation: 0.07,
      roughnessVariation: 0.08,
      bumpScale: 0.014,
      seed: 109,
    });
    this.addSurface('timber', {
      color: 0x93653c,
      roughness: 0.72,
      colorVariation: 0.18,
      roughnessVariation: 0.13,
      bumpScale: 0.025,
      seed: 113,
    });
    this.addSurface('timberDark', {
      color: 0x503824,
      roughness: 0.78,
      colorVariation: 0.15,
      roughnessVariation: 0.12,
      bumpScale: 0.024,
      seed: 127,
    });
    this.addSurface('bark', {
      color: 0x4d392c,
      roughness: 0.98,
      colorVariation: 0.27,
      roughnessVariation: 0.09,
      bumpScale: 0.07,
      seed: 131,
    });
    this.addSurface('leaf', {
      color: 0x315f37,
      roughness: 0.81,
      colorVariation: 0.2,
      roughnessVariation: 0.08,
      bumpScale: 0.012,
      seed: 137,
    });
    this.addSurface('leafLight', {
      color: 0x598248,
      roughness: 0.8,
      colorVariation: 0.2,
      roughnessVariation: 0.08,
      bumpScale: 0.012,
      seed: 139,
    });
    this.addSurface('paper', {
      color: 0xe2ddd0,
      roughness: 0.89,
      colorVariation: 0.08,
      roughnessVariation: 0.05,
      bumpScale: 0.004,
      seed: 149,
    });
    this.addSurface('cardboard', {
      color: 0xa77849,
      roughness: 0.94,
      colorVariation: 0.13,
      roughnessVariation: 0.08,
      bumpScale: 0.012,
      seed: 151,
    });

    const glass = new MeshPhysicalMaterial({
      name: 'parkworks/glass',
      color: 0xaed1d5,
      metalness: 0,
      roughness: 0.09,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      clearcoat: 0.8,
      clearcoatRoughness: 0.08,
    });
    this.materialMap.set('glass', glass);

    const glow = new MeshStandardMaterial({
      name: 'parkworks/lamp-glow',
      color: 0xffe3a0,
      emissive: 0xffc45b,
      emissiveIntensity: 2.1,
      roughness: 0.35,
      metalness: 0,
      toneMapped: true,
    });
    this.materialMap.set('lampGlow', glow);

    for (const key of ['grass', 'soil', 'path'] as const) {
      const material = this.get(key);
      this.generatedGround.set(key, {
        color: material.map,
        normal: material.normalMap,
        roughness: material.roughnessMap,
        ambientOcclusion: material.aoMap,
        displacement: material.displacementMap,
        metersPerRepeat: key === 'grass' ? [1.25, 1.25] : [0.9, 0.9],
      });
      this.setGroundMaps(key, null);
    }

    if (options.groundMaps) {
      for (const key of ['grass', 'soil', 'path'] as const) {
        const maps = options.groundMaps[key];
        if (maps) this.setGroundMaps(key, maps);
      }
    }

    this.ready =
      options.loadBundledCc0 === false || typeof document === 'undefined'
        ? Promise.resolve()
        : this.loadBundledCc0Textures(
            options.textureAssetBaseUrl ?? `${import.meta.env.BASE_URL}assets/textures`,
          );
  }

  /** Retrieve a shared material. Do not dispose individual shared materials. */
  get<T extends MeshStandardMaterial = MeshStandardMaterial>(key: MaterialKey): T {
    const material = this.materialMap.get(key);
    if (!material) throw new Error(`Unknown Parkworks material: ${key}`);
    return material as T;
  }

  /**
   * Returns a cached painted dielectric. This is used for character palettes
   * and small accents while preserving the same PBR response as factory paint.
   */
  paint(color: number | string, roughness = 0.47): MeshStandardMaterial {
    const parsed = new Color(color);
    const cacheKey = `${parsed.getHexString()}:${roughness.toFixed(3)}`;
    const cached = this.tintCache.get(cacheKey);
    if (cached) return cached;

    const material = this.createSurface({
      color: parsed.getHex(),
      roughness,
      metalness: 0.035,
      colorVariation: 0.045,
      roughnessVariation: 0.08,
      bumpScale: 0.004,
      seed: parseInt(parsed.getHexString(), 16) ^ 0x5041524b,
      clearcoat: 0.08,
      clearcoatRoughness: 0.42,
    });
    material.name = `parkworks/custom-paint-${parsed.getHexString()}`;
    this.tintCache.set(cacheKey, material);
    return material;
  }

  /**
   * Apply future CC0 ground maps without replacing the shared material object.
   * UVs generated by AssetFactory are expressed in world metres; callers can
   * use `metersPerRepeat` as metadata when preparing authored textures.
   */
  setGroundMaps(key: GroundMaterialKey, maps: GroundTextureSet | null): void {
    const material = this.get(key);
    const fallback = this.generatedGround.get(key);
    if (!fallback) return;
    const resolved = maps ?? {};

    material.map = resolved.color === undefined ? fallback.color : resolved.color;
    material.normalMap = resolved.normal === undefined ? fallback.normal : resolved.normal;
    material.roughnessMap =
      resolved.roughness === undefined ? fallback.roughness : resolved.roughness;
    material.aoMap =
      resolved.ambientOcclusion === undefined
        ? fallback.ambientOcclusion
        : resolved.ambientOcclusion;
    material.displacementMap =
      resolved.displacement === undefined ? fallback.displacement : resolved.displacement;

    const tileSize = this.resolveTileSize(resolved.metersPerRepeat ?? fallback.metersPerRepeat);
    for (const texture of [
      material.map,
      material.normalMap,
      material.roughnessMap,
      material.aoMap,
      material.displacementMap,
    ]) {
      if (texture) this.prepareExternalTexture(texture, texture === material.map, tileSize);
    }
    material.userData.metersPerRepeat = tileSize;
    material.needsUpdate = true;
  }

  getGroundMetersPerRepeat(key: GroundMaterialKey): readonly [number, number] {
    const material = this.get(key);
    const value = material.userData.metersPerRepeat;
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
      return [value[0], value[1]];
    }
    return this.generatedGround.get(key)?.metersPerRepeat ?? [1, 1];
  }

  /**
   * Load the project's ambientCG CC0 maps. Each required map set is committed
   * only after every image succeeds, so an absent asset never replaces the colorful
   * procedural fallback with a half-loaded or blank material.
   */
  async loadBundledCc0Textures(
    baseUrl = `${import.meta.env.BASE_URL}assets/textures`,
  ): Promise<void> {
    const loader = new TextureLoader();
    const definitions: ReadonlyArray<{
      id: string;
      key: MaterialKey;
      meters: readonly [number, number];
      requiresAo?: boolean;
    }> = [
      { id: 'Grass005', key: 'grass', meters: [2, 2] },
      { id: 'Concrete034', key: 'concrete', meters: [1.1, 0.55], requiresAo: false },
      { id: 'PavingStones138', key: 'path', meters: [1.25, 2.5] },
      { id: 'Bark014', key: 'bark', meters: [1.2, 1.2] },
      { id: 'Planks037A', key: 'timber', meters: [2, 2] },
    ];

    await Promise.allSettled(
      definitions.map(async ({ id, key, meters, requiresAo = true }) => {
        const prefix = `${baseUrl.replace(/\/$/, '')}/${id}/${id}`;
        const [color, normal, roughness] = await Promise.all([
          loader.loadAsync(`${prefix}_color.webp`),
          loader.loadAsync(`${prefix}_normal.webp`),
          loader.loadAsync(`${prefix}_roughness.webp`),
        ]);
        const ambientOcclusion = requiresAo ? await loader.loadAsync(`${prefix}_ao.webp`) : null;
        for (const texture of [color, normal, roughness, ambientOcclusion]) {
          if (!texture) continue;
          this.ownedTextures.add(texture);
        }
        this.applySurfaceMaps(key, { color, normal, roughness, ambientOcclusion }, meters);
      }),
    );
  }

  /** Dispose factory-owned materials and generated maps; external maps remain caller-owned. */
  dispose(): void {
    for (const material of this.materialMap.values()) material.dispose();
    for (const material of this.tintCache.values()) material.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.materialMap.clear();
    this.tintCache.clear();
    this.ownedTextures.clear();
  }

  private addPaint(key: MaterialKey, color: number, seed: number): void {
    this.addSurface(key, {
      color,
      roughness: 0.47,
      metalness: 0.035,
      colorVariation: 0.055,
      roughnessVariation: 0.1,
      bumpScale: 0.005,
      clearcoat: 0.1,
      clearcoatRoughness: 0.38,
      seed,
    });
  }

  private addSurface(key: MaterialKey, options: ProceduralSurfaceOptions): void {
    const material = this.createSurface(options);
    material.name = `parkworks/${key}`;
    this.materialMap.set(key, material);
  }

  private createSurface(options: ProceduralSurfaceOptions): MeshStandardMaterial {
    const colorMap = createColorNoiseTexture(
      options.color,
      options.colorVariation ?? 0.06,
      options.seed,
      this.textureSize,
    );
    const roughnessMap = createScalarNoiseTexture(
      0.9,
      options.roughnessVariation ?? 0.08,
      options.seed + 1_003,
      this.textureSize,
    );
    const bumpMap = createScalarNoiseTexture(
      0.5,
      0.42,
      options.seed + 2_003,
      this.textureSize,
    );
    for (const texture of [colorMap, roughnessMap, bumpMap]) {
      texture.anisotropy = this.maxAnisotropy;
      this.ownedTextures.add(texture);
    }

    const usePhysical = options.clearcoat !== undefined;
    const parameters = {
      color: 0xffffff,
      map: colorMap,
      roughness: options.roughness,
      roughnessMap,
      metalness: options.metalness ?? 0,
      bumpMap,
      bumpScale: options.bumpScale ?? 0.008,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
    };
    if (usePhysical) {
      return new MeshPhysicalMaterial({
        ...parameters,
        clearcoat: options.clearcoat,
        clearcoatRoughness: options.clearcoatRoughness ?? 0.4,
      });
    }
    return new MeshStandardMaterial(parameters);
  }

  private applySurfaceMaps(
    key: MaterialKey,
    maps: Required<Pick<GroundTextureSet, 'color' | 'normal' | 'roughness' | 'ambientOcclusion'>>,
    metersPerRepeat: readonly [number, number],
  ): void {
    const material = this.get(key);
    material.map = maps.color;
    material.normalMap = maps.normal;
    material.roughnessMap = maps.roughness;
    material.aoMap = maps.ambientOcclusion;
    for (const texture of [material.map, material.normalMap, material.roughnessMap, material.aoMap]) {
      if (texture) this.prepareExternalTexture(texture, texture === material.map, metersPerRepeat);
    }
    material.userData.metersPerRepeat = metersPerRepeat;
    material.needsUpdate = true;
  }

  private resolveTileSize(value: number | readonly [number, number]): readonly [number, number] {
    if (typeof value === 'number') return [Math.max(0.01, value), Math.max(0.01, value)];
    return [Math.max(0.01, value[0]), Math.max(0.01, value[1])];
  }

  private prepareExternalTexture(
    texture: Texture,
    isColor: boolean,
    metersPerRepeat: readonly [number, number],
  ): void {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(1 / metersPerRepeat[0], 1 / metersPerRepeat[1]);
    texture.anisotropy = this.maxAnisotropy;
    if (isColor) texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
  }
}

export function createMaterialLibrary(options: MaterialLibraryOptions = {}): MaterialLibrary {
  return new MaterialLibrary(options);
}
