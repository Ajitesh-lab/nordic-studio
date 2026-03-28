// Biome — one-time setup wizard
// Renders into #app, resolves when setup is complete.
// main.js is untouched and loads after this resolves.

const SETUP_KEY = 'biome-setup-v1';
const MASTER_KEY = 'biome-dev';

const BIOME_BACKEND = 'https://assuming-increasingly-stomach-verified.trycloudflare.com';

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

      // Master bypass
      if (key === MASTER_KEY) {
        this.choices.userName = 'Admin';
        this.choices.key = key;
        localStorage.setItem('biome-access-key', key);
        this._show(2);
        return;
      }

      // Validate against backend
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
        err.textContent = 'Could not reach Biome server. Check your connection.';
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = 'Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:\'FILL\' 1">arrow_forward</span>';
        return;
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
    return `<button id="wz-back" style="display:flex;align-items:center;gap:4px;margin-bottom:20px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:#717d7b;background:none;border:none;cursor:pointer;position:relative;letter-spacing:0.05em;text-transform:uppercase;transition:color 0.2s;padding:0">
      <span class="material-symbols-outlined" style="font-size:14px">arrow_back</span> Back
    </button>`;
  }

  _step3Cloud() {
    const PROVIDERS = [
      { id: 'gemini',    label: 'Google Gemini',  color: '#4285F4', icon: 'auto_awesome',   prefix: 'AIza',    hint: 'aistudio.google.com/apikey',        url: 'https://aistudio.google.com/apikey',        placeholder: 'AIzaSy…',   note: 'Free tier available' },
      { id: 'anthropic', label: 'Anthropic Claude', color: '#D97757', icon: 'psychology',    prefix: 'sk-ant-', hint: 'console.anthropic.com/settings/keys', url: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-…',  note: 'Claude 3.5 Sonnet, Haiku' },
      { id: 'openai',    label: 'OpenAI',          color: '#10A37F', icon: 'smart_toy',      prefix: 'sk-',     hint: 'platform.openai.com/api-keys',       url: 'https://platform.openai.com/api-keys',        placeholder: 'sk-…',      note: 'GPT-4o, o1' },
      { id: 'grok',      label: 'xAI / Grok',      color: '#1A1A1A', icon: 'bolt',          prefix: 'xai-',    hint: 'console.x.ai',                       url: 'https://console.x.ai',                        placeholder: 'xai-…',     note: 'Grok-2' },
      { id: 'mistral',   label: 'Mistral AI',       color: '#FA520F', icon: 'flare',         prefix: '',        hint: 'console.mistral.ai/api-keys',        url: 'https://console.mistral.ai/api-keys',         placeholder: 'mistral key…', note: 'Mistral Large, Nemo' },
      { id: 'perplexity',label: 'Perplexity',       color: '#20B2AA', icon: 'travel_explore', prefix: 'pplx-',  hint: 'perplexity.ai/settings/api',         url: 'https://www.perplexity.ai/settings/api',      placeholder: 'pplx-…',   note: 'Real-time web search' },
    ];

    return `
      ${this._backBtn()}
      <h2 class="font-headline text-2xl font-extrabold tracking-tight mb-1" style="color:#293533">Connect your AI providers</h2>
      <p class="text-sm mb-5" style="color:#55625f">Add one or more keys — the more you add, the more models you unlock. Stored only on this device.</p>
      <div class="space-y-2 mb-4" id="wz-providers-list">
        ${PROVIDERS.map(p => `
          <div class="wz-provider-row rounded-xl border transition-all overflow-hidden" style="background:#eff5f2;border-color:#a8b5b2" data-id="${p.id}">
            <button type="button" class="wz-provider-toggle w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container transition-colors" data-id="${p.id}">
              <div class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style="background:${p.color}18;border:1px solid ${p.color}30">
                <span class="material-symbols-outlined" style="font-size:15px;color:${p.color}">${p.icon}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold flex items-center gap-2" style="color:#293533">
                  ${p.label}
                  <span class="text-[9px] font-normal px-1.5 py-0.5 rounded-full" style="background:#e8f0ed;color:#717d7b">${p.note}</span>
                </div>
              </div>
              <span class="wz-provider-status text-[10px] font-semibold px-2 py-0.5 rounded-full" id="wz-status-${p.id}" style="background:#e8f0ed;color:#a8b5b2">not set</span>
              <span class="material-symbols-outlined text-base wz-chevron" style="color:#a8b5b2;transition:transform .2s">expand_more</span>
            </button>
            <div class="wz-provider-body hidden px-4 pb-4" id="wz-body-${p.id}">
              <div class="flex gap-2 mb-1.5">
                <input type="password" id="wz-key-${p.id}"
                  class="flex-1 px-3 py-2.5 rounded-lg border text-xs outline-none transition-all font-mono"
                  style="background:#fff;border-color:#c8dfd2;color:#293533"
                  placeholder="${p.placeholder}" autocomplete="off" spellcheck="false"/>
                <button type="button" class="wz-verify-btn px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-80 active:scale-95" data-id="${p.id}" style="background:#4a6453;color:#e2ffe8;white-space:nowrap">Verify</button>
              </div>
              <p class="text-[10px]" style="color:#717d7b">Get a key at <a href="#" class="underline" style="color:#4a6453" id="wz-link-${p.id}" data-url="${p.url}">${p.hint}</a></p>
              <p id="wz-err-${p.id}" class="text-[10px] mt-1 hidden" style="color:#9f403d"></p>
            </div>
          </div>`).join('')}
      </div>
      <p id="wz-cloud-err" class="text-xs mb-3 hidden" style="color:#9f403d">Please add at least one API key to continue.</p>
      <button id="wz-cloud-continue" class="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:opacity-90" style="background:#4a6453;color:#e2ffe8">
        Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">arrow_forward</span>
      </button>`;
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
      const openLink = (url) => {
        if (window.webkit?.messageHandlers?.biomeInstall) {
          window.webkit.messageHandlers.biomeInstall.postMessage({ action: 'open_url', url });
        } else { window.open(url, '_blank'); }
      };

      // Provider accordion toggle
      document.querySelectorAll('.wz-provider-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const body = document.getElementById(`wz-body-${id}`);
          const chevron = btn.querySelector('.wz-chevron');
          const isOpen = !body.classList.contains('hidden');
          // Close all others
          document.querySelectorAll('.wz-provider-body').forEach(b => b.classList.add('hidden'));
          document.querySelectorAll('.wz-chevron').forEach(c => c.style.transform = '');
          if (!isOpen) {
            body.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
            setTimeout(() => document.getElementById(`wz-key-${id}`)?.focus(), 50);
          }
        });
      });

      // External key links
      document.querySelectorAll('[id^="wz-link-"]').forEach(a => {
        a.addEventListener('click', (e) => { e.preventDefault(); openLink(a.dataset.url); });
      });

      // Verify buttons
      document.querySelectorAll('.wz-verify-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const input = document.getElementById(`wz-key-${id}`);
          const statusEl = document.getElementById(`wz-status-${id}`);
          const errEl = document.getElementById(`wz-err-${id}`);
          const key = input?.value?.trim();
          if (!key) { errEl.textContent = 'Please paste your key first'; errEl.classList.remove('hidden'); return; }
          errEl.classList.add('hidden');
          btn.textContent = '…';
          btn.disabled = true;

          let valid = false;
          try {
            if (id === 'gemini') {
              if (!key.startsWith('AIza')) { errEl.textContent = 'Gemini keys start with "AIza"'; errEl.classList.remove('hidden'); btn.textContent = 'Verify'; btn.disabled = false; return; }
              const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(7000) });
              valid = r.ok;
              if (!valid) { const d = await r.json().catch(() => ({})); errEl.textContent = d?.error?.message || 'Invalid key'; errEl.classList.remove('hidden'); }
            } else if (id === 'openai') {
              if (!key.startsWith('sk-')) { errEl.textContent = 'OpenAI keys start with "sk-"'; errEl.classList.remove('hidden'); btn.textContent = 'Verify'; btn.disabled = false; return; }
              const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(7000) });
              valid = r.ok;
              if (!valid) { const d = await r.json().catch(() => ({})); errEl.textContent = d?.error?.message || 'Invalid key'; errEl.classList.remove('hidden'); }
            } else if (id === 'anthropic') {
              if (!key.startsWith('sk-ant-')) { errEl.textContent = 'Anthropic keys start with "sk-ant-"'; errEl.classList.remove('hidden'); btn.textContent = 'Verify'; btn.disabled = false; return; }
              // Anthropic doesn't have a free validation endpoint — just check prefix and save
              valid = true;
            } else {
              // grok, mistral, perplexity — trust the key, no public validation endpoint
              valid = key.length > 10;
              if (!valid) { errEl.textContent = 'Key looks too short'; errEl.classList.remove('hidden'); }
            }
          } catch {
            valid = true; // offline — trust the key
          }

          btn.textContent = 'Verify';
          btn.disabled = false;

          if (valid) {
            localStorage.setItem(`biome-key-${id}`, key);
            // Also set biome-provider / biome-api-key to first saved key for backward compat
            if (!localStorage.getItem('biome-api-key')) {
              localStorage.setItem('biome-provider', id);
              localStorage.setItem('biome-api-key', key);
            }
            statusEl.textContent = '✓ set';
            statusEl.style.background = '#dcfce7';
            statusEl.style.color = '#16a34a';
            // Close accordion
            document.getElementById(`wz-body-${id}`)?.classList.add('hidden');
            document.querySelectorAll('.wz-chevron').forEach(c => c.style.transform = '');
          }
        });
      });

      // Continue button
      document.getElementById('wz-cloud-continue').addEventListener('click', () => {
        const hasKey = ['gemini','anthropic','openai','grok','mistral','perplexity'].some(id => localStorage.getItem(`biome-key-${id}`));
        if (!hasKey) { document.getElementById('wz-cloud-err').classList.remove('hidden'); return; }
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
      </button>
      <button id="inst-continue" class="hidden w-full mt-3 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]" style="background:#4a6453;color:#e2ffe8">
        Continue <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">arrow_forward</span>
      </button>`;
  }

  _wireStepInstall() {
    // ── AI guide bubble (cancel previous typewriter on new message) ──────────
    let _aiTimer = null;
    window.__installAI = (message) => {
      const el = document.getElementById('inst-ai-text');
      if (!el) return;
      if (_aiTimer) clearTimeout(_aiTimer);
      el.textContent = '';
      let i = 0;
      const type = () => {
        if (i < message.length) { el.textContent += message[i++]; _aiTimer = setTimeout(type, 18); }
        else { _aiTimer = null; }
      };
      type();
    };

    // ── Continue button (failsafe) ──────────────────────────────────────────
    const continueBtn = document.getElementById('inst-continue');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => this._show(5));
    }

    // ── Step progress ──────────────────────────────────────────────────────────
    window.__installProgress = (step, status, message) => {
      if (step === 'complete' && status === 'done') {
        // Show continue button immediately as failsafe
        if (continueBtn) continueBtn.classList.remove('hidden');
        // Also auto-advance after 1.5s
        setTimeout(() => this._show(5), 1500);
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
