import type { PlaceableIcon } from '../core/types';

export type IconName = PlaceableIcon
  | 'build'
  | 'walk'
  | 'rotate'
  | 'check'
  | 'close'
  | 'pause'
  | 'play'
  | 'camera'
  | 'follow'
  | 'reframe'
  | 'broom'
  | 'spark';

const paths: Record<IconName, string> = {
  burger: '<path d="M5 10.5h14M6.5 8.5c.4-3 2.5-4.5 5.5-4.5s5.1 1.5 5.5 4.5M5 13.5h14l-1 4H6l-1-4Z"/>',
  cup: '<path d="m8 7 1 12h7l1-12H8Zm1-3h8M14 7l2-4"/>',
  'ice-cream': '<path d="M9 10h6l-3 10-3-10Zm-.5-2.5a3.5 3.5 0 1 1 7 0c0 .9-.3 1.7-.9 2.5H9.4a4 4 0 0 1-.9-2.5Z"/>',
  carousel: '<path d="M5 9h14L16 4H8L5 9Zm2 0v10m10-10v10M4 19h16M9 12h2v4H9v-4Zm5 0h2v4h-2v-4Z"/>',
  wheel: '<circle cx="12" cy="11" r="8"/><circle cx="12" cy="11" r="1.5"/><path d="M12 3v16M4 11h16m-2.3-5.7L6.3 16.7m0-11.4 11.4 11.4M9 21l3-10 3 10"/>',
  'bumper-car': '<path d="M5 13h14l1 3v2h-2l-1 2H7l-1-2H4v-2l1-3Zm2 0 1-4h8l1 4M8 9l2-3h4l2 3M7 16h.01M17 16h.01"/>',
  'drop-tower': '<path d="M10 21V4h4v17M8 21h8M9 7h6M9 11h6M9 15h6M6 14h12v4H6v-4Zm6-10V2"/>',
  'pirate-ship': '<path d="M4 14h16l-2 5H7l-3-5Zm8 0V4m0 1 5 4h-5M6 14l2-3m10 3-2-3M3 21h18"/>',
  restroom: '<path d="M8 4a2 2 0 1 0 0 .01M6 8h4v5H9v7H7v-7H6V8Zm10-4a2 2 0 1 0 0 .01M14 8h4l1 6h-2v6h-2v-6h-2l1-6Z"/>',
  'first-aid': '<path d="M9 3h6l1 4h4v13H4V7h4l1-4Zm1 7v3H7v3h3v3h4v-3h3v-3h-3v-3h-4Z"/>',
  information: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  bin: '<path d="M7 7h10l-1 13H8L7 7Zm-2 0h14M9 7V4h6v3m-4 3v7m3-7v7"/>',
  bench: '<path d="M5 8h14v4H5V8Zm1 4v7m12-7v7M4 15h16"/>',
  lamp: '<path d="M12 20V8m-5 0h10l-2-4H9L7 8Zm2 12h6M9 8l1 3h4l1-3"/>',
  tree: '<path d="M12 20v-6m0 1-3-3m3 1 3-3M8 14a4 4 0 0 1-.5-7.97A5 5 0 0 1 17 8a3.5 3.5 0 0 1-2 6H8Z"/>',
  build: '<path d="M4 20h16M6 17V8l6-4 6 4v9M9 17v-5h6v5"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m10 21 2-7-3-3m3 3 3 2 2 5m-5-12 3 3 4-1M6 14l3-3 1-4 4 1"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2 5.3M20 5v6h-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  camera: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/><path d="M17 10h.01"/>',
  follow: '<circle cx="12" cy="8" r="2.5"/><path d="M7.5 20v-2.5a4.5 4.5 0 0 1 9 0V20M4 9V5h4m12 4V5h-4"/>',
  reframe: '<path d="M8 4H4v4m12-4h4v4M8 20H4v-4m12 4h4v-4"/><circle cx="12" cy="12" r="3"/>',
  broom: '<path d="m15 3-5 10m1-1 5 3-4 6-7-4 4-6 2 1Z"/>',
  spark: '<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Zm7 14 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
};

export function icon(name: IconName, label?: string): string {
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${aria}>${paths[name]}</svg>`;
}
