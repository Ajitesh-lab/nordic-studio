// Entry-point gate — checks if setup is complete before loading the main app.
// This is the only file that imports main.js.

const SETUP_KEY = 'biome-setup-v1';

function revealApp(delay = 2000) {
  // main.js registers a window 'load' listener to reveal the app, but by the
  // time it's dynamically imported that event has already fired — so we handle
  // it here instead, mirroring main.js's original 2-second splash duration.
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

async function gatewayAlive() {
  try {
    const r = await fetch('http://127.0.0.1:18789/', { signal: AbortSignal.timeout(2000) });
    return true; // any response means the gateway is running
  } catch {
    return false;
  }
}

async function start() {
  const hasSetupFlag = localStorage.getItem(SETUP_KEY);

  if (hasSetupFlag) {
    // Returning user — load main app directly. Offline state is handled in-app.
    // Do NOT clear the setup flag based on gateway health; gateway may still be
    // starting up. User can click "Restart Setup" if they need to re-run.
    await import('./main.js');
    revealApp(2000);
  } else {
    // First launch — wizard handles the splash itself, then loads main app.
    const { runSetup } = await import('./setup.js');
    await runSetup();
    await import('./main.js');
    revealApp(200); // splash already gone, just ensure app is visible
  }
}

start();
