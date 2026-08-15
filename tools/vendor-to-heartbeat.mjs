#!/usr/bin/env node
/**
 * Refreshes the copy of this game that lives inside Heartbeat Observatory.
 *
 * `vite build` regenerates `index.html` from scratch every time, which drops the
 * two script tags the Heartbeat copy needs. The old instructions said to add
 * them back by hand after every rebuild — a step that works right up until the
 * once somebody forgets, at which point the game silently stops using the
 * cloud save backend and falls back to browser storage with no error anywhere.
 * That is a bad failure: it looks fine and quietly loses a signed-in player's
 * park. So the injection happens here instead of in someone's memory.
 *
 *   node tools/vendor-to-heartbeat.mjs [path-to-heartbeat-observatory]
 *
 * Run `npm run build` first, or pass --build to have it done for you.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const args = process.argv.slice(2);
const shouldBuild = args.includes('--build');
const target = resolve(
  args.find((arg) => !arg.startsWith('--')) ?? join(projectRoot, '..', 'heartbeat-observatory'),
);
const gameDir = join(target, 'games', 'parkworks');

/** The classic script must run before the deferred module, or the hook is late. */
const BACKEND_TAG = '<script src="./hb-save-backend.js"></script>';
const DEVICE_TIER_TAG = '<script src="/hb-device-tier.js"></script>';

function fail(message) {
  console.error(`vendor-to-heartbeat: ${message}`);
  process.exit(1);
}

if (!existsSync(gameDir)) fail(`no games/parkworks in ${target}`);
if (!existsSync(join(gameDir, 'hb-save-backend.js'))) {
  fail('games/parkworks/hb-save-backend.js is missing — refusing to overwrite the directory');
}

if (shouldBuild) {
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
}

const dist = join(projectRoot, 'dist');
if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html not found — run npm run build');

// Hashed bundle names mean stale asset files would otherwise pile up forever.
rmSync(join(gameDir, 'assets'), { recursive: true, force: true });
cpSync(dist, gameDir, { recursive: true });

const indexPath = join(gameDir, 'index.html');
let html = readFileSync(indexPath, 'utf8');

if (!html.includes(DEVICE_TIER_TAG)) {
  html = html.replace('</head>', `  ${DEVICE_TIER_TAG}\n  </head>`);
}

if (!html.includes(BACKEND_TAG)) {
  const moduleTag = html.match(/<script type="module"[^>]*><\/script>/);
  if (!moduleTag) fail('could not find the game module tag to inject before');
  html = html.replace(
    moduleTag[0],
    `${BACKEND_TAG}\n    ${moduleTag[0]}`,
  );
}

writeFileSync(indexPath, html);

// Prove it rather than assume it: a silent miss here is the whole failure mode
// this script exists to prevent.
const written = readFileSync(indexPath, 'utf8');
const backendAt = written.indexOf(BACKEND_TAG);
const moduleAt = written.search(/<script type="module"/);
if (backendAt < 0) fail('save backend tag missing after write');
if (moduleAt < 0) fail('game module tag missing after write');
if (backendAt > moduleAt) fail('save backend tag must come before the module tag');
if (!written.includes(DEVICE_TIER_TAG)) fail('device tier tag missing after write');

console.log(`vendor-to-heartbeat: refreshed ${gameDir}`);
console.log('  save backend tag: present, before the module tag');
console.log('  device tier tag:  present');
