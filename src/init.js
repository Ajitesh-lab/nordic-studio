// Entry-point gate — checks if setup is complete before loading the main app.
// This is the only file that imports main.js.

const SETUP_KEY = 'biome-setup-v1';

async function start() {
  if (localStorage.getItem(SETUP_KEY)) {
    // Already set up — load main app directly
    await import('./main.js');
  } else {
    // First time — run setup wizard, then load main app
    const { runSetup } = await import('./setup.js');
    await runSetup();
    await import('./main.js');
    // The page's 'load' event already fired, so main.js's listener that
    // removes opacity-0 won't run. Force the reveal here instead.
    setTimeout(() => {
      const app = document.getElementById('app');
      if (app) { app.classList.remove('opacity-0'); app.style.opacity = '1'; }
    }, 200);
  }
}

start();
