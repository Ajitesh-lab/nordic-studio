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
    // Check if gateway is actually running — if openclaw was wiped, re-run setup
    const alive = await gatewayAlive();
    if (!alive) {
      // Give Swift side a moment to start gateway, then check again
      await new Promise(r => setTimeout(r, 4000));
      const aliveRetry = await gatewayAlive();
      if (!aliveRetry) {
        // Gateway is genuinely gone — clear setup flag and re-run wizard
        localStorage.removeItem(SETUP_KEY);
        const { runSetup } = await import('./setup.js');
        await runSetup();
        await import('./main.js');
        revealApp(200);
        return;
      }
    }
    // Returning user — gateway is running, load main app
    await import('./main.js');
    revealApp(2000);
  } else {
    // First launch — wizard handles the splash itself, then loads main app
    const { runSetup } = await import('./setup.js');
    await runSetup();
    await import('./main.js');
    revealApp(200); // splash already gone, just ensure app is visible
  }
}

start();
