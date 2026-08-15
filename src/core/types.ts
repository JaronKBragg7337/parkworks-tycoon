import type { Object3D } from 'three';

export type PlaceableCategory = 'food' | 'rides' | 'facilities' | 'decor';

export type PlaceableKind =
  | 'burger-kiosk'
  | 'lemonade-stand'
  | 'ice-cream-cart'
  | 'pizza-kitchen'
  | 'carousel'
  | 'sky-wheel'
  | 'bumper-cars'
  | 'drop-tower'
  | 'pirate-ship'
  | 'mini-railway'
  | 'meteor-coaster'
  | 'restroom'
  | 'first-aid'
  | 'information-booth'
  | 'cash-machine'
  | 'maintenance-hut'
  | 'trash-bin'
  | 'bench'
  | 'park-lamp'
  | 'shade-tree'
  | 'tiered-fountain'
  | 'blossom-planter';

export type PlaceableIcon =
  | 'burger'
  | 'cup'
  | 'ice-cream'
  | 'pizza'
  | 'carousel'
  | 'wheel'
  | 'bumper-car'
  | 'drop-tower'
  | 'pirate-ship'
  | 'train'
  | 'coaster'
  | 'restroom'
  | 'first-aid'
  | 'information'
  | 'cash-machine'
  | 'broom'
  | 'bin'
  | 'bench'
  | 'lamp'
  | 'tree'
  | 'fountain'
  | 'planter';

export type ServiceNeed =
  | 'hunger'
  | 'fun'
  | 'bladder'
  | 'rest'
  | 'trash'
  | 'information'
  | 'cash'
  | null;

/**
 * A job the park pays somebody to do. Staff are hired by building the post they
 * work out of, so the role belongs to the building's spec rather than to a
 * separate roster: one janitor per crew post, and the wage is that post's
 * upkeep.
 *
 * Only the janitor exists. The mechanic and the entertainer are named in
 * docs/NEXT.md and will want the same shape, which is why this is a role rather
 * than a boolean.
 */
export type StaffRole = 'janitor';

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlaceableSpec {
  kind: PlaceableKind;
  name: string;
  shortName: string;
  category: PlaceableCategory;
  icon: PlaceableIcon;
  description: string;
  cost: number;
  upkeep: number;
  footprint: readonly [number, number];
  serviceNeed: ServiceNeed;
  capacity: number;
  serviceSeconds: number;
  revenue: number;
  appeal: number;
  /**
   * Metres over which this item's appeal reaches, for things whose appeal is
   * about where they are rather than what they are. A lamp only flatters the
   * stall it stands beside; a ride is a reason to visit the park from anywhere
   * in it. Omitting the field means the old behaviour — the full appeal counts
   * wherever the thing stands — so specs written before radii existed, and the
   * saved parks built from them, need no migration.
   */
  radius?: number;
  /**
   * The job this building puts somebody on the payroll to do. Present only on
   * buildings bought to employ staff rather than to serve a guest directly, so
   * every spec written before staff existed keeps meaning exactly what it did.
   * One post employs one worker; a second janitor is a second post.
   */
  staff?: StaffRole;
}

export interface FacilitySnapshot {
  id: string;
  kind: PlaceableKind;
  position: Vec2;
  /** Nearest connected guest-path cell, when pathfinding is enabled. */
  accessPoint?: Vec2;
  rotation: number;
  queueLength: number;
  activeUsers: number;
  enabled: boolean;
}

export interface PlacedObject {
  id: string;
  spec: PlaceableSpec;
  position: Vec2;
  rotation: number;
  object: Object3D;
  queueLength: number;
  activeUsers: number;
}

export type GuestState =
  | 'arriving'
  | 'wandering'
  | 'seeking'
  | 'queueing'
  | 'using'
  | 'leaving';

export interface GuestNeeds {
  hunger: number;
  fun: number;
  bladder: number;
  rest: number;
}

export interface GuestSnapshot {
  id: string;
  position: Vec2;
  heading: number;
  speed: number;
  state: GuestState;
  targetFacilityId: string | null;
  needs: GuestNeeds;
  happiness: number;
  carryingTrash: boolean;
  paletteIndex: number;
  ageScale: number;
  /**
   * Money this guest still has. They arrive with a wallet sized by the park's
   * reputation and spend it down; when it runs out they stop buying, which is
   * what stops a price rise from being free money.
   */
  wallet: number;
}

export type StaffState = 'idle' | 'walking' | 'collecting';

/**
 * One member of staff on the paths.
 *
 * Deliberately not a guest: staff have no needs, no wallet and no happiness,
 * they never leave, and nothing about them belongs in the reputation average.
 * What they share with a guest is the walking, which is why both are moved by
 * the same route code.
 */
export interface StaffSnapshot {
  id: string;
  role: StaffRole;
  /** The building that employs them. Sell the post and the worker goes with it. */
  postId: string;
  position: Vec2;
  heading: number;
  speed: number;
  state: StaffState;
  /** The piece of litter this worker is on their way to, if any. */
  targetLitterId: string | null;
  paletteIndex: number;
}

export interface LitterSnapshot {
  id: string;
  position: Vec2;
  variant: number;
  age: number;
}

export interface ParkStats {
  cash: number;
  reputation: number;
  cleanliness: number;
  guestCount: number;
  guestsServed: number;
  guestsVisited: number;
  litterCleaned: number;
  revenue: number;
  expenses: number;
  day: number;
  minuteOfDay: number;
}

export type SimulationEvent =
  | { type: 'guest-spawned'; guest: GuestSnapshot }
  | { type: 'guest-left'; guestId: string; happy: boolean }
  | { type: 'service-complete'; guestId: string; facilityId: string; revenue: number }
  | { type: 'litter-created'; litter: LitterSnapshot }
  | { type: 'litter-removed'; litterId: string; byPlayer: boolean }
  | { type: 'reputation-changed'; delta: number }
  | { type: 'price-changed'; kind: PlaceableKind; price: number }
  | { type: 'insufficient-funds'; required: number };
