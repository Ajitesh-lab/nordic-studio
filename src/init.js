// Entry-point gate — checks if setup is complete before loading the main app.
// Uses a device fingerprint stored in multiple places for persistence across
// WKWebView restarts (localStorage + sessionStorage + cookie).

const SETUP_KEY  = 'biome-setup-v1';
const DEVICE_KEY = 'biome-device-id';

// ── Device fingerprint ────────────────────────────────────────────────────────
// A lightweight, stable ID based on browser environment.
// Not for security — just to recognise "same device, already set up".
function makeDeviceId() {
  const parts = [
    navigator.platform || '',
    navigator.language || '',
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  ];
  // Simple djb2 hash
  let hash = 5381;
  for (const c of parts.join('|')) hash = ((hash << 5) + hash) ^ c.charCodeAt(0);
  return 'dev-' + Math.abs(hash).toString(36);
}

function getStoredDeviceId() {
  // Check localStorage first, then cookie fallback
  const ls = localStorage.getItem(DEVICE_KEY);
  if (ls) return ls;
  const match = document.cookie.match(new RegExp('(?:^|;)\\s*' + DEVICE_KEY + '=([^;]+)'));
  return match ? match[1] : null;
}

function storeDeviceId(id) {
  localStorage.setItem(DEVICE_KEY, id);
  // Also write cookie — survives localStorage clears in some WKWebView configs
  // Expires in 10 years
  const exp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3650).toUTCString();
  document.cookie = `${DEVICE_KEY}=${id};expires=${exp};path=/;SameSite=Lax`;
}

function isKnownDevice() {
  const stored = getStoredDeviceId();
  if (!stored) return false;
  const current = makeDeviceId();
  return stored === current;
}

function markDeviceKnown() {
  storeDeviceId(makeDeviceId());
}

// ── Setup flag — check localStorage + cookie for redundancy ──────────────────
function hasSetup() {
  if (localStorage.getItem(SETUP_KEY)) return true;
  // Cookie fallback
  return document.cookie.includes(SETUP_KEY + '=1');
}

function markSetupDone() {
  localStorage.setItem(SETUP_KEY, '1');
  const exp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3650).toUTCString();
  document.cookie = `${SETUP_KEY}=1;expires=${exp};path=/;SameSite=Lax`;
  markDeviceKnown();
}

// ── App reveal ────────────────────────────────────────────────────────────────
function revealApp(delay = 2000) {
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    const app    = document.getElementById('app');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.pointerEvents = 'none';
      setTimeout(() => splash.remove(), 1000);
    }
    if (app) {
      app.classList.remove('opacity-0');
      app.style.opacity = '1';
    }
  }, delay);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  // Known device + setup flag → straight to dashboard, no splash delay
  if (hasSetup() && isKnownDevice()) {
    await import('./main.js');
    revealApp(800); // short reveal — device is recognised, skip long wait
    return;
  }

  if (hasSetup()) {
    // Setup done but device fingerprint missing (e.g. first boot after update)
    // Trust the setup flag, store fingerprint, go straight in
    markDeviceKnown();
    await import('./main.js');
    revealApp(1200);
    return;
  }

  // First launch — run wizard
  const { runSetup } = await import('./setup.js');
  await runSetup();
  markSetupDone(); // persist setup + fingerprint after wizard completes
  await import('./main.js');
  revealApp(200);
}

// Expose markSetupDone so setup.js can call it on completion if needed
window.__biomeMarkSetupDone = markSetupDone;

start();
