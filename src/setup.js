// Biome — one-time setup wizard
// Renders into #app, resolves when setup is complete.
// main.js is untouched and loads after this resolves.

const SETUP_KEY = 'biome-setup-v1';

const BIOME_BACKEND = 'https://reminder-karl-touring-viruses.trycloudflare.com';

export function runSetup() {
  return new Promise(resolve => {
    const splash = document.getElementById('splash-screen');
    const app    = document.getElementById('app');

    // Let splash show briefly, then transition into wizard
    setTimeout(() => {
      if (splash) {
        splash.style.transition = 'opacity 0.6s ease';
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 600);
      }
      app.style.transition = 'opacity 0.4s ease';
      app.style.opacity = '1';
      new SetupWizard(app, resolve).render();
    }, 1200);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

class SetupWizard {
  constructor(container, onComplete) {
    this.container  = container;
    this.onComplete = onComplete;
    this.step       = 1;
    this.totalSteps = 5; // 1=key, 2=model, 3=config, 4=install, 5=done
    this.choices    = { modelType: '', provider: '', apiKey: '' };
  }

  render() {
    this.container.innerHTML = `
      <div id="wz-shell" class="w-full h-full flex flex-col items-center justify-center relative overflow-hidden" style="background:#f7faf8">
        <!-- Subtle background blob -->
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <div class="w-[600px] h-[600px] rounded-full blur-[120px]" style="background:rgba(74,100,83,0.06)"></div>
        </div>
        <!-- Progress dots -->
        <div id="wz-dots" class="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10"></div>
        <!-- Content card -->
        <div id="wz-content" class="relative z-10 w-full max-w-sm px-6" style="opacity:0;transform:translateY(18px);transition:opacity 0.4s cubic-bezier(0.2,0.8,0.2,1),transform 0.4s cubic-bezier(0.2,0.8,0.2,1)"></div>
      </div>`;

    this._show(1);
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  _show(n) {
    this.step = n;
    this._updateDots();
    const content = document.getElementById('wz-content');
    // Fade out → swap → fade in
    content.style.opacity = '0';
    content.style.transform = 'translateY(18px)';
    setTimeout(() => {
      switch (n) {
        case 1: content.innerHTML = this._step1HTML(); this._wireStep1(); break;
        case 2: content.innerHTML = this._step2HTML(); this._wireStep2(); break;
        case 3: content.innerHTML = this._step3HTML(); this._wireStep3(); break;
        case 4: content.innerHTML = this._stepInstallHTML(); this._wireStepInstall(); break;
        case 5: content.innerHTML = this._stepDoneHTML(); this._wireStepDone(); break;
      }
      requestAnimationFrame(() => {
        content.style.opacity = '1';
        content.style.transform = 'translateY(0)';
      });
    }, 280);
  }

  _updateDots() {
    const dots = document.getElementById('wz-dots');
    dots.innerHTML = [1, 2, 3, 4, 5].map(n => {
      if (n < this.step)  return `<div class="h-2 w-2 rounded-full bg-primary transition-all duration-300"></div>`;
      if (n === this.step) return `<div class="h-2 w-6 rounded-full bg-primary transition-all duration-300"></div>`;
      return `<div class="h-2 w-2 rounded-full transition-all duration-300" style="background:#a8b5b2"></div>`;
    }).join('');
  }

  // ── Step 1 — Welcome + access key ───────────────────────────────────────────

  _step1HTML() {
    return `
      <div class="text-center mb-8">
        <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg" style="background:#4a6453">
          <span class="material-symbols-outlined text-3xl" style="color:#e2ffe8">filter_vintage</span>
        </div>
        <h1 class="font-headline text-3xl font-extrabold tracking-tight mb-2" style="color:#293533">Welcome to Biome</h1>
        <p class="text-sm leading-relaxed" style="color:#55625f">Your personal AI agent, ready in minutes.<br/>Enter your access key to get started.</p>
      </div>
      <div class="space-y-3">
        <input id="wz-key" type="text" placeholder="Enter your access key"
          class="w-full px-4 py-3.5 rounded-xl border text-sm outline-none transition-all"
          style="background:#eff5f2;border-color:#a8b5b2;color:#293533"
          autocomplete="off" autocorrect="off" spellcheck="false" />
        <p id="wz-key-err" class="text-xs hidden" style="color:#9f403d">Please enter your access key</p>
        <button id="wz-key-btn" class="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:opacity-90" style="background:#4a6453;color:#e2ffe8">
          Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">arrow_forward</span>
        </button>
        <p class="text-center text-xs" style="color:#717d7b">
          Don't have a key? <a href="#" class="underline underline-offset-2" style="color:#4a6453" id="wz-apply-link">Apply for access</a>
        </p>
      </div>`;
  }

  _wireStep1() {
    const input = document.getElementById('wz-key');
    const err   = document.getElementById('wz-key-err');
    const btn   = document.getElementById('wz-key-btn');
    setTimeout(() => input.focus(), 350);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    input.addEventListener('input', () => err.classList.add('hidden'));

    // "Apply for access" — open signup form in system browser
    document.getElementById('wz-apply-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      const url = `${BIOME_BACKEND}/signup`;
      if (window.webkit?.messageHandlers?.biomeInstall) {
        window.webkit.messageHandlers.biomeInstall.postMessage({ action: 'open_url', url });
      } else {
        window.open(url, '_blank');
      }
    });

    btn.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) { err.classList.remove('hidden'); return; }

      // Validate against backend (if unreachable, proceed anyway)
      btn.disabled = true;
      btn.innerHTML = 'Verifying…';
      try {
        const r = await fetch(`${BIOME_BACKEND}/validate-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
          signal: AbortSignal.timeout(4000),
        });
        const data = await r.json();
        if (!data.ok) {
          err.textContent = data.error || 'Invalid access key';
          err.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = 'Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:\'FILL\' 1">arrow_forward</span>';
          return;
        }
        // Personalise with name returned from backend
        if (data.name) this.choices.userName = data.name;
      } catch {
        // Backend unreachable — allow offline / self-hosted use
      }

      this.choices.key = key;
      localStorage.setItem('biome-access-key', key);
      this._show(2);
    });
  }

  // ── Step 2 — Model choice ────────────────────────────────────────────────────

  _step2HTML() {
    return `
      <div class="mb-7">
        <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-2" style="color:#293533">How do you want to<br/>power your AI?</h2>
        <p class="text-sm" style="color:#55625f">Pick whatever works best for you — you can change this later.</p>
      </div>
      <div class="space-y-3">
        ${this._modelCard('cloud', 'cloud', 'tertiary-container', 'tertiary', 'Use my own API key', 'Gemini or OpenAI — paste your key and go')}
        ${this._modelCard('local', 'computer', 'secondary-container', 'secondary', 'Run locally on my Mac', 'Fully private — no internet needed after setup')}
        ${this._modelCard('plan',  'star',     'primary-container',   'primary',   'Biome plan', 'We handle everything — no API key needed', true, true)}
      </div>`;
  }

  _modelCard(type, icon, bg, fg, title, subtitle, badge = false, comingSoon = false) {
    if (comingSoon) {
      return `
        <div class="wz-model-card w-full text-left px-5 py-4 rounded-xl border-2 cursor-not-allowed"
          style="background:#f5f5f5;border-color:#d4d4d4;opacity:0.55" data-type="${type}" data-coming-soon="true">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background:#e0e0e0">
              <span class="material-symbols-outlined text-xl" style="color:#9e9e9e">${icon}</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm" style="color:#757575">${title}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:#9e9e9e;color:#fff">Coming soon</span>
              </div>
              <div class="text-xs mt-0.5" style="color:#9e9e9e">${subtitle}</div>
            </div>
          </div>
        </div>`;
    }
    return `
      <button class="wz-model-card w-full text-left px-5 py-4 rounded-xl border-2 transition-all active:scale-[0.98] hover:border-primary"
        style="background:#eff5f2;border-color:#a8b5b2" data-type="${type}">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-${bg}">
            <span class="material-symbols-outlined text-xl text-${fg}">${icon}</span>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-semibold text-sm" style="color:#293533">${title}</span>
              ${badge ? `<span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:#4a6453;color:#e2ffe8">No API key</span>` : ''}
            </div>
            <div class="text-xs mt-0.5" style="color:#55625f">${subtitle}</div>
          </div>
        </div>
      </button>`;
  }

  _wireStep2() {
    document.querySelectorAll('.wz-model-card').forEach(card => {
      if (card.dataset.comingSoon) return; // disabled — not yet available
      card.addEventListener('click', () => {
        this.choices.modelType = card.dataset.type;
        this._show(3);
      });
    });
  }

  // ── Step 3 — Configure (varies by choice) ───────────────────────────────────

  _step3HTML() {
    const { modelType } = this.choices;
    if (modelType === 'cloud')  return this._step3Cloud();
    if (modelType === 'local')  return this._step3Local();
    if (modelType === 'plan')   return this._step3Plan();
    return '';
  }

  _backBtn() {
    return `<button id="wz-back" class="flex items-center gap-1 text-xs mb-5 transition-colors hover:opacity-70" style="color:#717d7b">
      <span class="material-symbols-outlined text-sm">arrow_back</span> Back
    </button>`;
  }

  _step3Cloud() {
    return `
      ${this._backBtn()}
      <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-1" style="color:#293533">Add your API key</h2>
      <p class="text-sm mb-6" style="color:#55625f">Stored only on this device — never sent anywhere else.</p>
      <div class="space-y-4">
        <div>
          <label class="text-xs font-semibold uppercase tracking-wide block mb-1.5" style="color:#55625f">Provider</label>
          <select id="wz-provider" class="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all" style="background:#eff5f2;border-color:#a8b5b2;color:#293533">
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-wide block mb-1.5" style="color:#55625f">API Key</label>
          <input id="wz-apikey" type="password" placeholder="Paste your key here"
            class="w-full px-4 py-3.5 rounded-xl border text-sm outline-none transition-all font-mono"
            style="background:#eff5f2;border-color:#a8b5b2;color:#293533"
            autocomplete="off" autocorrect="off" spellcheck="false" />
          <p id="wz-apikey-hint" class="text-xs mt-1.5" style="color:#717d7b">
            Get a free key at <a href="#" class="underline underline-offset-2" style="color:#4a6453" onclick="return false">aistudio.google.com</a>
          </p>
        </div>
        <p id="wz-apikey-err" class="text-xs hidden" style="color:#9f403d">Please enter your API key</p>
        <button id="wz-cloud-continue" class="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:opacity-90" style="background:#4a6453;color:#e2ffe8">
          Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">arrow_forward</span>
        </button>
      </div>`;
  }

  _step3Local() {
    return `
      ${this._backBtn()}
      <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-1" style="color:#293533">Set up local AI</h2>
      <p class="text-sm mb-6" style="color:#55625f">Ollama runs models on your Mac. Nothing leaves your device.</p>
      <div class="space-y-3">
        <div class="rounded-xl border p-4" style="background:#eff5f2;border-color:#a8b5b2">
          <div class="flex items-center gap-2.5 mb-2">
            <div id="wz-ollama-dot" class="w-2 h-2 rounded-full transition-colors" style="background:#a8b5b2"></div>
            <span id="wz-ollama-status" class="text-sm font-medium" style="color:#293533">Checking for Ollama…</span>
          </div>
          <p class="text-xs mb-3" style="color:#717d7b">Ollama manages and runs local AI models. It's free and open source.</p>
          <a id="wz-ollama-dl" href="https://ollama.com" target="_blank"
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90" style="background:#4a6453;color:#e2ffe8">
            <span class="material-symbols-outlined text-base">download</span> Download Ollama
          </a>
        </div>
        <button id="wz-ollama-check" class="w-full py-3 rounded-xl border font-medium text-sm flex items-center justify-center gap-2 transition-all hover:opacity-80" style="background:#eff5f2;border-color:#a8b5b2;color:#293533">
          <span class="material-symbols-outlined text-base">refresh</span> Check again
        </button>
        <button id="wz-local-continue" disabled
          class="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-not-allowed"
          style="background:#4a6453;color:#e2ffe8;opacity:0.35">
          Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">arrow_forward</span>
        </button>
      </div>`;
  }

  _step3Plan() {
    return `
      ${this._backBtn()}
      <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-1" style="color:#293533">Choose your plan</h2>
      <p class="text-sm mb-6" style="color:#55625f">We handle the AI — you just open the app and use it.</p>
      <div class="space-y-3">
        <div class="rounded-xl border-2 p-5 relative" style="background:#cdead3;border-color:#4a6453">
          <div class="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:#4a6453;color:#e2ffe8">POPULAR</div>
          <div class="font-headline font-bold text-lg mb-0.5" style="color:#293533">Starter</div>
          <div class="text-2xl font-extrabold mb-1" style="color:#293533">£9<span class="text-sm font-normal" style="color:#55625f">/mo</span></div>
          <div class="text-xs mb-4" style="color:#55625f">500 messages/day · Gemini Flash · Web search</div>
          <button id="wz-plan-starter" class="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90" style="background:#4a6453;color:#e2ffe8">Get started</button>
        </div>
        <div class="rounded-xl border p-5" style="background:#eff5f2;border-color:#a8b5b2">
          <div class="font-headline font-bold text-lg mb-0.5" style="color:#293533">Pro</div>
          <div class="text-2xl font-extrabold mb-1" style="color:#293533">£24<span class="text-sm font-normal" style="color:#55625f">/mo</span></div>
          <div class="text-xs mb-4" style="color:#55625f">Unlimited · Gemini Pro + claude.ai · Priority</div>
          <button id="wz-plan-pro" class="w-full py-2.5 rounded-lg border text-sm font-semibold transition-all hover:opacity-80" style="background:#e8f0ed;border-color:#a8b5b2;color:#293533">Get started</button>
        </div>
      </div>`;
  }

  _wireStep3() {
    // Back button (all variants)
    document.getElementById('wz-back')?.addEventListener('click', () => this._show(2));

    const { modelType } = this.choices;

    if (modelType === 'cloud') {
      const providerEl = document.getElementById('wz-provider');
      const hintEl     = document.getElementById('wz-apikey-hint');
      const errEl      = document.getElementById('wz-apikey-err');
      const input      = document.getElementById('wz-apikey');
      const btn        = document.getElementById('wz-cloud-continue');
      setTimeout(() => input.focus(), 350);

      providerEl.addEventListener('change', () => {
        hintEl.innerHTML = providerEl.value === 'gemini'
          ? `Get a free key at <a href="#" class="underline underline-offset-2" style="color:#4a6453" onclick="return false">aistudio.google.com</a>`
          : `Get a key at <a href="#" class="underline underline-offset-2" style="color:#4a6453" onclick="return false">platform.openai.com</a>`;
      });

      input.addEventListener('input', () => errEl.classList.add('hidden'));
      btn.addEventListener('click', () => {
        const key = input.value.trim();
        if (!key) { errEl.classList.remove('hidden'); return; }
        this.choices.provider = providerEl.value;
        this.choices.apiKey   = key;
        localStorage.setItem('biome-provider', providerEl.value);
        localStorage.setItem('biome-api-key', key);
        this._show(4);
      });
    }

    if (modelType === 'local') {
      const dot       = document.getElementById('wz-ollama-dot');
      const statusEl  = document.getElementById('wz-ollama-status');
      const continueBtn = document.getElementById('wz-local-continue');

      const check = async () => {
        statusEl.textContent = 'Checking…';
        dot.style.background = '#a8b5b2';
        try {
          const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
          if (r.ok) {
            dot.style.background = '#4a6453';
            statusEl.textContent = 'Ollama is running ✓';
            continueBtn.disabled = false;
            continueBtn.style.opacity = '1';
            continueBtn.style.cursor = 'pointer';
          } else throw new Error();
        } catch {
          dot.style.background = '#9f403d';
          statusEl.textContent = 'Ollama not found — download it below';
        }
      };

      check();
      document.getElementById('wz-ollama-check').addEventListener('click', check);
      continueBtn.addEventListener('click', () => {
        if (continueBtn.disabled) return;
        localStorage.setItem('biome-provider', 'ollama');
        this._show(4);
      });
    }

    if (modelType === 'plan') {
      // Placeholder — payment flow goes here
      const goNext = () => {
        localStorage.setItem('biome-provider', 'plan');
        this._show(4);
      };
      document.getElementById('wz-plan-starter')?.addEventListener('click', goNext);
      document.getElementById('wz-plan-pro')?.addEventListener('click', goNext);
    }
  }

  // ── Step 4 — Installing ──────────────────────────────────────────────────────

  _stepInstallHTML() {
    const steps = [
      { id: 'xcode',    label: 'Developer tools' },
      { id: 'homebrew', label: 'Homebrew' },
      { id: 'node',     label: 'Node.js' },
      { id: 'openclaw', label: 'OpenClaw' },
      { id: 'config',   label: 'Agent configuration' },
      { id: 'gateway',  label: 'AI Gateway' },
    ];

    return `
      <div class="text-center mb-5">
        <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-1" style="color:#293533">Setting up your agent</h2>
        <p class="text-sm" style="color:#55625f">Sit back — this usually takes 3–5 minutes.</p>
      </div>

      <!-- AI guide bubble -->
      <div id="inst-ai" class="flex items-start gap-3 mb-4 px-4 py-3 rounded-xl border transition-all" style="background:#f0f7f3;border-color:#c8dfd2;min-height:56px">
        <div class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style="background:#4a6453">
          <span class="material-symbols-outlined text-sm" style="color:#e2ffe8">filter_vintage</span>
        </div>
        <p id="inst-ai-text" class="text-sm leading-relaxed" style="color:#293533">Starting setup…</p>
      </div>

      <!-- Step rows -->
      <div class="space-y-2">
        ${steps.map(s => `
          <div id="inst-${s.id}" class="flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-300" style="background:#eff5f2;border-color:#a8b5b2">
            <div id="inst-${s.id}-icon" class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style="background:#a8b5b2">
              <span class="material-symbols-outlined text-xs" style="color:white;font-size:12px">circle</span>
            </div>
            <span class="text-sm font-medium" style="color:#293533">${s.label}</span>
            <span id="inst-${s.id}-sub" class="text-xs ml-auto" style="color:#717d7b"></span>
          </div>
        `).join('')}
      </div>

      <div id="inst-error" class="hidden mt-3 p-3 rounded-xl text-xs font-mono" style="background:#fde8e8;color:#9f403d;max-height:80px;overflow-y:auto"></div>
      <button id="inst-retry" class="hidden w-full mt-3 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]" style="background:#4a6453;color:#e2ffe8">
        <span class="material-symbols-outlined text-base">refresh</span> Retry
      </button>`;
  }

  _wireStepInstall() {
    // ── AI guide bubble ────────────────────────────────────────────────────────
    window.__installAI = (message) => {
      const el = document.getElementById('inst-ai-text');
      if (!el) return;
      // Typewrite effect
      el.textContent = '';
      let i = 0;
      const type = () => {
        if (i < message.length) { el.textContent += message[i++]; setTimeout(type, 18); }
      };
      type();
    };

    // ── Step progress ──────────────────────────────────────────────────────────
    window.__installProgress = (step, status, message) => {
      if (step === 'complete' && status === 'done') {
        setTimeout(() => this._show(5), 1000);
        return;
      }

      const row  = document.getElementById(`inst-${step}`);
      const icon = document.getElementById(`inst-${step}-icon`);
      const sub  = document.getElementById(`inst-${step}-sub`);
      if (!row) return;

      const iconBase = 'font-size:12px;color:white';

      switch (status) {
        case 'running':
          icon.innerHTML = `<span class="material-symbols-outlined animate-spin" style="${iconBase}">progress_activity</span>`;
          icon.style.background = '#4a6453';
          row.style.borderColor = '#4a6453';
          break;

        case 'done':
          icon.innerHTML = `<span class="material-symbols-outlined" style="${iconBase};font-variation-settings:'FILL' 1">check</span>`;
          icon.style.background = '#4a6453';
          row.style.borderColor = '#4a6453';
          row.style.background  = '#dff0e6';
          if (sub) sub.textContent = '';
          break;

        case 'skip':
          icon.innerHTML = `<span class="material-symbols-outlined" style="${iconBase};font-variation-settings:'FILL' 1">check</span>`;
          icon.style.background = '#7a9e8a';
          row.style.borderColor = '#a8b5b2';
          row.style.background  = '#eff5f2';
          if (sub) sub.textContent = 'already installed';
          break;

        case 'error':
          icon.innerHTML = `<span class="material-symbols-outlined" style="${iconBase}">close</span>`;
          icon.style.background = '#9f403d';
          row.style.borderColor = '#9f403d';
          row.style.background  = '#fde8e8';
          if (message) {
            const errBox = document.getElementById('inst-error');
            errBox.classList.remove('hidden');
            errBox.textContent = message;
          }
          document.getElementById('inst-retry').classList.remove('hidden');
          break;
      }
    };

    // ── Kick off install ───────────────────────────────────────────────────────
    if (window.webkit?.messageHandlers?.biomeInstall) {
      // Native macOS app — send to Swift
      window.webkit.messageHandlers.biomeInstall.postMessage({
        action:    'install',
        provider:  this.choices.provider,
        apiKey:    this.choices.apiKey,
        modelType: this.choices.modelType,
      });
    } else {
      // Browser fallback — simulate for dev
      console.log('[Biome] Browser mode — simulating install');
      const fakeSteps = ['xcode', 'homebrew', 'node', 'openclaw', 'config', 'gateway'];
      const fakeAI = [
        'Installing developer tools — this is a one-time setup on any new Mac.',
        'Homebrew is a package manager that makes installing software safe and easy.',
        'Node.js is needed to run your AI agent. Installing now.',
        'OpenClaw is the core of your AI agent. Almost done.',
        'Writing your configuration and registering the service.',
        'Starting up the AI gateway on your machine.',
      ];
      let i = 0;
      const tick = () => {
        if (i >= fakeSteps.length) {
          window.__installAI('Everything is running. Your AI agent is live!');
          setTimeout(() => window.__installProgress('complete', 'done'), 600);
          return;
        }
        window.__installAI(fakeAI[i]);
        window.__installProgress(fakeSteps[i], 'running');
        setTimeout(() => {
          window.__installProgress(fakeSteps[i], i === 0 ? 'skip' : 'done');
          i++;
          setTimeout(tick, 500);
        }, 900);
      };
      setTimeout(tick, 300);
    }

    document.getElementById('inst-retry')?.addEventListener('click', () => this._show(4));
  }

  // ── Step 5 — All set ─────────────────────────────────────────────────────────

  _stepDoneHTML() {
    return `
      <div class="text-center">
        <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style="background:#cdead3">
          <span class="material-symbols-outlined text-3xl" style="color:#4a6453;font-variation-settings:'FILL' 1">check_circle</span>
        </div>
        <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-2" style="color:#293533">You're all set</h2>
        <p class="text-sm mb-6" style="color:#55625f">Biome is configured and ready.</p>

        <div class="rounded-xl border p-4 text-left mb-6" style="background:#eff5f2;border-color:#a8b5b2">
          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style="background:#4a6453">
              <span class="material-symbols-outlined text-sm" style="color:#e2ffe8">filter_vintage</span>
            </div>
            <div>
              <div class="text-xs font-semibold mb-1" style="color:#4a6453">Biome</div>
              <p id="wz-guide-msg" class="text-sm leading-relaxed" style="color:#293533"></p>
            </div>
          </div>
        </div>

        <button id="wz-open" class="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:opacity-90"
          style="background:#4a6453;color:#e2ffe8;opacity:0;transition:opacity 0.4s ease,transform 0.1s">
          Open Biome <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">arrow_forward</span>
        </button>
      </div>`;
  }

  _wireStepDone() {
    const firstName = (this.choices.userName || '').split(' ')[0];
    const greeting = firstName ? `Welcome, ${firstName}! ` : '';
    const messages = {
      cloud: `${greeting}Your API key is saved and your agent is ready. I'm here whenever you need — just start typing.`,
      local: `${greeting}Your local model is running on your Mac. Everything stays private on your device. Let's get started.`,
      plan:  `${greeting}Your Biome plan is active. No setup, no limits — just open the app and use it. Welcome aboard.`,
    };
    const msg = messages[this.choices.modelType] || `${greeting}Everything is configured. Open Biome whenever you're ready.`;
    const el  = document.getElementById('wz-guide-msg');
    const btn = document.getElementById('wz-open');

    this._typewrite(el, msg, () => {
      btn.style.opacity = '1';
      btn.addEventListener('click', () => {
        localStorage.setItem(SETUP_KEY, '1');
        // Clear wizard, let main.js render into #app
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.opacity = '0';
        this.onComplete();
      });
    });
  }

  _typewrite(el, text, onDone, i = 0) {
    if (i < text.length) {
      el.textContent += text[i];
      setTimeout(() => this._typewrite(el, text, onDone, i + 1), 20);
    } else {
      onDone?.();
    }
  }
}
