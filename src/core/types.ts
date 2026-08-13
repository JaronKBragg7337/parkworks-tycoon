import type { Object3D } from 'three';

export type PlaceableCategory = 'food' | 'rides' | 'facilities' | 'decor';

export type PlaceableKind =
  | 'burger-kiosk'
  | 'lemonade-stand'
  | 'carousel'
  | 'sky-wheel'
  | 'restroom'
  | 'trash-bin'
  | 'bench'
  | 'park-lamp'
  | 'shade-tree';

export type ServiceNeed = 'hunger' | 'fun' | 'bladder' | 'rest' | 'trash' | null;

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlaceableSpec {
  kind: PlaceableKind;
  name: string;
  shortName: string;
  category: PlaceableCategory;
  icon: string;
  description: string;
  cost: number;
  upkeep: number;
  footprint: readonly [number, number];
  serviceNeed: ServiceNeed;
  capacity: number;
  serviceSeconds: number;
  revenue: number;
  appeal: number;
}

export interface FacilitySnapshot {
  id: string;
  kind: PlaceableKind;
  position: Vec2;
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
  | { type: 'insufficient-funds'; required: number };
