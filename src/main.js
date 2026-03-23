import { Gateway } from './gateway.js';

// ── State ─────────────────────────────────────────────────────────────────────
const _freshSessionKey = () => 'ns-' + Date.now();
const state = window.__nordicState || {
  view: location.hash?.slice(1) === 'code' ? 'chat' : (location.hash?.slice(1) || 'chat'),
  connected: false,
  sessions: [],
  messages: [],
  sessionKey: _freshSessionKey(),   // fresh session on every cold start
  streaming: false,
  streamText: '',
  runId: null,
  sidebarPanel: null,
  // Mindmap
  mindmapNodes: [
    { id: 'center', label: 'OpenClaw', sub: 'Main Chat AI', icon: 'neurology', x: 2500, y: 2500, type: 'center' },
  ],
  skillsData: {},
  skillsLoaded: false,
  expandedCategories: {},   // catId → true/false
  selectedSkillKey: null,
  pendingSkillRefresh: false,
  // Mindmap pan/zoom
  mapPanX: 0, mapPanY: 0, mapScale: 1.0,
  _mapCentered: false,
  // Presence
  presence: [],
  presenceLog: [],
  monitorOpen: false,
  // Thinking label
  thinkingLabel: 'thinking',
  // Custom data sources
  customSources: JSON.parse(localStorage.getItem('nordic-custom-sources') || '[]'),
};
window.__nordicState = state;

// ── Gateway ───────────────────────────────────────────────────────────────────
if (window.__nordicGw) window.__nordicGw.disconnect();
const gw = new Gateway({ token: 'b7cefe215311bb01bcbbf85dcc2d753fbbb69371e2697467' });
window.__nordicGw = gw;

gw.on('state', (s) => {
  state.connected = s === 'connected';
  updateStatusDot();
  if (state.connected) {
    if (state.messages.length === 0) loadHistory();
    loadSkills();
    loadPresence();
  }
});

// Thinking label — set based on actual gateway events only (no auto-cycle)
function setThinkingLabel(label) {
  state.thinkingLabel = label;
  if (state.streaming && !state.streamText) updateStreamingMessage();
}
function resetThinkingLabel() { state.thinkingLabel = 'thinking'; }

// Tool events from gateway → map to correct label
['tool', 'tool.start', 'tool.call', 'tool.result', 'tool.end'].forEach(evt => {
  gw.on(evt, (payload) => {
    const raw = (payload?.name || payload?.tool || payload?.toolName || payload?.function?.name || '').toLowerCase();
    const url = (payload?.input?.url || payload?.params?.url || '').toLowerCase();
    if (raw.includes('search') || raw.includes('web_search') || raw.includes('brave') || raw.includes('perplexity') || raw.includes('tavily') || raw.includes('exa')) {
      setThinkingLabel('researching');
    } else if (raw.includes('claude') || raw.includes('anthropic') || url.includes('claude.ai') || url.includes('anthropic.com')) {
      setThinkingLabel('pondering');
    } else if (raw || url) {
      setThinkingLabel('navigating');
    }
  });
});

// Also catch browser-navigation events if gateway emits them
gw.on('browser', (payload) => {
  const url = (payload?.url || '').toLowerCase();
  if (url.includes('claude.ai') || url.includes('anthropic.com')) setThinkingLabel('pondering');
  else if (url) setThinkingLabel('navigating');
});

// ── Response watchdog — fires if no final arrives within 75s ─────────────────
let _responseTimer = null;
function armResponseTimer() {
  clearTimeout(_responseTimer);
  _responseTimer = setTimeout(() => {
    if (!state.streaming) return;
    if (state.streamText) {
      // We got partial text — commit it
      finalizeMessage();
    } else {
      // No text at all — likely stuck on a browser tool with no relay
      state.streaming = false;
      resetThinkingLabel();
      updateSendBtn();
      document.getElementById('streaming-msg')?.remove();
      appendMessage('assistant',
        'No response received — OpenClaw may be waiting on a browser tool that isn\'t reachable. ' +
        'Try asking again, or check that the OpenClaw browser relay is running if you need web navigation.');
    }
  }, 75000);
}
function clearResponseTimer() { clearTimeout(_responseTimer); _responseTimer = null; }

gw.on('chat', (payload) => {
  if (!payload) return;
  const evtText = extractText(payload.message?.content || payload.message?.text || '');

  if (payload.state === 'delta') {
    state.streaming = true;
    if (evtText) {
      state.thinkingLabel = 'collating';
      state.streamText = evtText;
    }
    state.runId = payload.runId;
    updateStreamingMessage();

  } else if (payload.state === 'final') {
    clearResponseTimer();
    state.streaming = false;
    if (evtText && evtText.length > (state.streamText?.length || 0)) state.streamText = evtText;
    // Guard: if no text after tool use, nudge Gemini once — include the original question
    if (!state.streamText) {
      if (!state._nudged) {
        state._nudged = true;
        state.streaming = true;
        setThinkingLabel('collating');
        updateStreamingMessage();
        // Include the user's question so Gemini answers IT, not the nudge instruction
        const lastQ = state.messages.filter(m => m.role === 'user').slice(-1)[0]?.text || '';
        const nudgeMsg = lastQ
          ? `The user asked: "${lastQ}"\nPlease answer their question directly as plain text. Do NOT use any tools, browser, or URLs. Just answer from what you know.`
          : 'Write your answer as plain text right now. Do NOT use any tools or browser.';
        gw.chatSend(nudgeMsg, state.sessionKey)
          .catch(() => { state.streaming = false; state._nudged = false; updateSendBtn(); });
        return; // wait for nudge response
      }
      // Already nudged and still no text — give up, keep _nudged true to block further loops
      state.streamText = 'Gemini completed but returned no text. The tool may have failed silently — try rephrasing your question.';
    } else {
      // Got real text — safe to allow future nudges on next user message
      state._nudged = false;
    }
    finalizeMessage();
    resetThinkingLabel();
    if (state.pendingSkillRefresh) {
      state.pendingSkillRefresh = false;
      setTimeout(() => loadSkills(), 3000);
      setTimeout(() => loadSkills(), 10000);
    }

  } else if (payload.state === 'error') {
    clearResponseTimer();
    state.streaming = false;
    resetThinkingLabel();
    updateSendBtn();
    const errMsg = payload.error?.message || payload.message?.text || 'An error occurred';
    appendMessage('assistant', errMsg);

  } else if (payload.state === 'start') {
    state.streaming = true;
    setThinkingLabel('thinking');
    updateStreamingMessage();
  }

  // Catch-all: any chat event with text we haven't handled
  if (!['delta','final','error','start'].includes(payload.state) && evtText) {
    clearResponseTimer();
    state.streaming = false;
    if (!state.streamText) state.streamText = evtText;
    finalizeMessage();
    resetThinkingLabel();
  }
});

gw.on('presence', (payload) => {
  if (!payload?.presence) return;
  updatePresenceData(payload.presence);
});

gw.connect();

// ── Color / category system ───────────────────────────────────────────────────
const CAT_META = {
  search:       { label: 'Search & Web',    border: '#3b82f6', bg: '#eff6ff', line: '#60a5fa', icon: 'search' },
  code:         { label: 'Code & Dev',      border: '#6b7280', bg: '#f9fafb', line: '#9ca3af', icon: 'terminal' },
  comms:        { label: 'Communication',   border: '#6366f1', bg: '#eef2ff', line: '#818cf8', icon: 'chat' },
  data:         { label: 'Data & Storage',  border: '#f59e0b', bg: '#fffbeb', line: '#fbbf24', icon: 'storage' },
  ai:           { label: 'AI & Models',     border: '#8b5cf6', bg: '#f5f3ff', line: '#a78bfa', icon: 'smart_toy' },
  productivity: { label: 'Productivity',    border: '#0d9488', bg: '#f0fdfa', line: '#2dd4bf', icon: 'calendar_today' },
  media:        { label: 'Media',           border: '#ec4899', bg: '#fdf2f8', line: '#f472b6', icon: 'image' },
  files:        { label: 'Files & Storage', border: '#d97706', bg: '#fffbeb', line: '#fb923c', icon: 'folder' },
  default:      { label: 'Tools',           border: '#496250', bg: '#f0fdf4', line: '#86efac', icon: 'build' },
  presence:     { label: 'Connected',       border: '#f97316', bg: '#fff7ed', line: '#fb923c', icon: 'computer' },
  sources:      { label: 'Data Sources',    border: '#0ea5e9', bg: '#f0f9ff', line: '#38bdf8', icon: 'link' },
};

function skillCategory(name, description) {
  const t = ((name || '') + ' ' + (description || '')).toLowerCase();
  if (t.match(/search|web|browse|perplexity|brave|exa|tavily|clawhub/)) return 'search';
  if (t.match(/github|git\b|code|terminal|shell|bash|exec|codex|coding/)) return 'code';
  if (t.match(/email|gmail|slack|discord|telegram|sms|imsg|message|notify/)) return 'comms';
  if (t.match(/sql|database|postgres|mysql|sqlite|redis|storage|mongo/)) return 'data';
  if (t.match(/claude|anthropic|gemini|openai|llm|gpt|mistral/)) return 'ai';
  if (t.match(/calendar|notes|remind|todo|task|apple|productivity/)) return 'productivity';
  if (t.match(/image|photo|vision|camera|camsnap|screenshot/)) return 'media';
  if (t.match(/file|folder|fs\b|disk|drive/)) return 'files';
  return 'default';
}

function skillIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.match(/search|perplexity|brave|exa/)) return 'search';
  if (n.match(/github|git\b/)) return 'hub';
  if (n.match(/browser|chrome|puppeteer|playwright/)) return 'public';
  if (n.match(/terminal|shell|bash|exec/)) return 'terminal';
  if (n.match(/sql|database|postgres|mysql|sqlite/)) return 'storage';
  if (n.match(/email|gmail|mail/)) return 'mail';
  if (n.match(/slack|discord/)) return 'chat';
  if (n.match(/calendar/)) return 'calendar_today';
  if (n.match(/image|photo|vision|camsnap/)) return 'image';
  if (n.match(/folder|file/)) return 'folder';
  if (n.match(/claude|anthropic/)) return 'smart_toy';
  return 'build';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractText(value) {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value.filter(b => b.type === 'text' || b.text).map(b => b.text || '').join('\n').trim();
  else if (value?.text) text = String(value.text);
  return text.replace(/<\/?(?:final|thinking|search_quality_reflection|search_quality_score|result)[^>]*>/g, '').trim();
}

function escapeHtml(s) {
  if (typeof s !== 'string') s = String(s || '');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(raw) {
  if (!raw) return '';
  // Escape HTML first on non-code content
  const PLACEHOLDER = '\x02';
  const blocks = [];

  // Pull out fenced code blocks before escaping
  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre class="md-pre"><code class="${lang ? 'lang-'+lang : ''}">${escapeHtml(code.trim())}</code></pre>`);
    return PLACEHOLDER + (blocks.length - 1) + PLACEHOLDER;
  });

  // Escape the rest
  text = escapeHtml(text);

  // Inline code
  text = text.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  // Bold + italic combo ***
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Headers (must come before list rules)
  text = text.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  text = text.replace(/^## (.+)$/gm,  '<h2 class="md-h2">$1</h2>');
  text = text.replace(/^# (.+)$/gm,   '<h1 class="md-h1">$1</h1>');
  // Horizontal rule
  text = text.replace(/^(?:---+|___+|\*\*\*+)$/gm, '<hr class="md-hr">');
  // Unordered list items
  text = text.replace(/^[ \t]*[-*+] (.+)$/gm, '<li class="md-li">$1</li>');
  // Ordered list items
  text = text.replace(/^[ \t]*\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  // Wrap consecutive li runs in ul/ol
  text = text.replace(/(<li class="md-li">[\s\S]*?<\/li>)(\n(?=<li class="md-li">)|$)/g, '$1\n');
  text = text.replace(/((?:<li class="md-li">.*\n?)+)/g, '<ul class="md-ul">$1</ul>');
  text = text.replace(/((?:<li class="md-oli">.*\n?)+)/g, '<ol class="md-ol">$1</ol>');
  // Blockquote
  text = text.replace(/^&gt; (.+)$/gm, '<blockquote class="md-bq">$1</blockquote>');
  // Double newline → paragraph break
  text = text.replace(/\n{2,}/g, '</p><p class="md-p">');
  // Single newline → <br>
  text = text.replace(/\n/g, '<br>');
  text = '<p class="md-p">' + text + '</p>';

  // Restore code blocks
  text = text.replace(new RegExp(PLACEHOLDER + '(\\d+)' + PLACEHOLDER, 'g'), (_, i) => blocks[+i]);
  return text;
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

function showToast(msg, dur = 3000) {
  let t = document.getElementById('ns-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ns-toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;z-index:9999;pointer-events:none;transition:opacity 0.3s';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.opacity = '0'; }, dur);
}

function ensureStyles() {
  if (document.getElementById('ns-styles')) return;
  const s = document.createElement('style');
  s.id = 'ns-styles';
  s.textContent = `
    @keyframes thinkPulse{0%,100%{opacity:.3;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
    .thinking-pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--md-sys-color-primary,#496250);animation:thinkPulse 1.4s ease-in-out infinite;flex-shrink:0}
    @keyframes thinkFade{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:translateY(0)}}
    .thinking-label{animation:thinkFade .35s ease-out}
    .md-p{margin:0 0 .5em;line-height:1.65}
    .md-p:last-child{margin-bottom:0}
    .md-h1{font-size:1.15em;font-weight:700;margin:.9em 0 .3em}
    .md-h2{font-size:1.05em;font-weight:700;margin:.8em 0 .3em}
    .md-h3{font-size:.95em;font-weight:600;margin:.7em 0 .25em}
    .md-hr{border:none;border-top:1px solid #e2e8f0;margin:.75em 0}
    .md-bq{border-left:3px solid #cbd5e1;padding-left:.75em;color:#64748b;margin:.5em 0;font-style:italic}
    .md-ul{list-style:disc;padding-left:1.25em;margin:.35em 0}
    .md-ol{list-style:decimal;padding-left:1.25em;margin:.35em 0}
    .md-li,.md-oli{margin:.15em 0}
    .md-pre{background:#1e293b;color:#e2e8f0;border-radius:8px;padding:.75em 1em;font-size:.78em;overflow-x:auto;margin:.6em 0;font-family:ui-monospace,monospace;line-height:1.55}
    .md-code{background:#f1f5f9;color:#475569;border-radius:4px;padding:.1em .35em;font-size:.82em;font-family:ui-monospace,monospace}
    @keyframes panelIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
    #skill-panel{animation:panelIn .2s ease-out}
    @keyframes subNodeIn{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
    .sub-node{animation:subNodeIn .25s ease-out}
  `;
  document.head.appendChild(s);
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

// ── Skills / categorized mindmap ──────────────────────────────────────────────
// ── Skill catalog (persisted to localStorage so deleted skills are searchable) ──
function saveToCatalog(skills) {
  try {
    const existing = JSON.parse(localStorage.getItem('nordic-skill-catalog') || '{}');
    for (const s of skills) {
      existing[s.skillKey] = {
        skillKey: s.skillKey,
        name: s.name || s.skillKey,
        description: s.description || '',
        emoji: s.emoji || '',
        category: skillCategory(s.name, s.description),
      };
    }
    localStorage.setItem('nordic-skill-catalog', JSON.stringify(existing));
  } catch {}
}

function getCatalog() {
  try { return Object.values(JSON.parse(localStorage.getItem('nordic-skill-catalog') || '{}')); }
  catch { return []; }
}

async function loadSkills() {
  try {
    const res = await gw.skillsStatus();
    const skills = res?.skills || [];
    state.skillsData = {};
    for (const s of skills) state.skillsData[s.skillKey] = s;
    saveToCatalog(skills); // persist all seen skills to catalog

    const center = state.mindmapNodes.find(n => n.id === 'center') || { x: 2500, y: 2500 };
    state.mindmapNodes = state.mindmapNodes.filter(n => n.type === 'center' || n.type === 'presence');

    // Group active skills by category (exclude built-in UI skills)
    const EXCLUDED = ['nordic-studio', 'nordic_studio', 'nordicstudio'];
    const active = skills.filter(s =>
      !s.always && s.eligible && !s.disabled &&
      !EXCLUDED.includes((s.skillKey || '').toLowerCase()) &&
      !EXCLUDED.includes((s.name || '').toLowerCase().replace(/\s+/g, '-'))
    );
    const groups = {};
    for (const skill of active) {
      const cat = skillCategory(skill.name, skill.description);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(skill);
    }

    const catKeys = Object.keys(groups);
    const catAngleStep = (Math.PI * 2) / Math.max(catKeys.length, 1);

    catKeys.forEach((cat, i) => {
      const meta = CAT_META[cat] || CAT_META.default;
      const angle = catAngleStep * i - Math.PI / 2;
      const radius = 300;
      const catId = 'cat-' + cat;
      const expanded = !!state.expandedCategories[catId];
      const cx = center.x + Math.cos(angle) * radius;
      const cy = center.y + Math.sin(angle) * radius;

      state.mindmapNodes.push({
        id: catId,
        type: 'category',
        cat,
        label: meta.label,
        icon: meta.icon,
        skills: groups[cat],
        expanded,
        count: groups[cat].length,
        x: cx,
        y: cy,
      });

      // If expanded, add sub-nodes
      if (expanded) {
        addSubNodes(catId, groups[cat], cx, cy, cat);
      }
    });

    // Custom data sources node
    addCustomSourcesNode(center, catKeys.length);

    // Presence nodes (Claude Code etc)
    addPresenceNodes(center);
    state.skillsLoaded = true;
    refreshMindmapDOM();
  } catch (e) {
    console.error('[Skills]', e);
  }
}

function addSubNodes(catId, skills, cx, cy, cat) {
  const count = skills.length;
  const subRadius = Math.min(160, 80 + count * 15);
  skills.forEach((skill, j) => {
    const angle = (Math.PI * 2 / count) * j - Math.PI / 2;
    state.mindmapNodes.push({
      id: 'skill-' + skill.skillKey,
      type: 'subcategory',
      cat,
      parentId: catId,
      label: skill.name,
      sub: (skill.description || '').slice(0, 32),
      emoji: skill.emoji || '',
      icon: skillIcon(skill.name),
      skillKey: skill.skillKey,
      primaryEnv: skill.primaryEnv,
      homepage: skill.homepage,
      x: cx + Math.cos(angle) * subRadius - 80,
      y: cy + Math.sin(angle) * subRadius - 28,
    });
  });
}

function addCustomSourcesNode(center, catCount) {
  const sources = state.customSources || [];
  const meta = CAT_META.sources;
  // Place the sources node at the bottom-right area of the center
  const angle = Math.PI / 4; // 45° — bottom-right, away from skill categories
  const radius = 300;
  const nodeId = 'cat-sources';
  const expanded = !!state.expandedCategories[nodeId];
  const nx = center.x + Math.cos(angle + (catCount * 0.15)) * radius;
  const ny = center.y + Math.sin(angle + (catCount * 0.15)) * radius;

  state.mindmapNodes.push({
    id: nodeId,
    type: 'category',
    cat: 'sources',
    label: meta.label,
    icon: meta.icon,
    skills: [],         // not skills — custom sources
    sources,
    expanded,
    count: sources.length,
    isSourcesNode: true,
    x: nx,
    y: ny,
  });

  if (expanded && sources.length) {
    const subRadius = Math.min(160, 80 + sources.length * 20);
    sources.forEach((src, j) => {
      const a = (Math.PI * 2 / sources.length) * j - Math.PI / 2;
      state.mindmapNodes.push({
        id: 'src-' + src.id,
        type: 'subcategory',
        cat: 'sources',
        parentId: nodeId,
        label: src.label || new URL(src.url).hostname,
        sub: src.url.slice(0, 36),
        emoji: '🔗',
        icon: 'link',
        sourceId: src.id,
        x: nx + Math.cos(a) * subRadius - 80,
        y: ny + Math.sin(a) * subRadius - 28,
      });
    });
  }
}

function toggleCategoryExpand(catId) {
  const node = state.mindmapNodes.find(n => n.id === catId);
  if (!node) return;
  const newExpanded = !state.expandedCategories[catId];
  state.expandedCategories[catId] = newExpanded;
  node.expanded = newExpanded;

  // Remove existing sub-nodes for this category
  state.mindmapNodes = state.mindmapNodes.filter(n => n.parentId !== catId);

  // Add sub-nodes if expanding
  if (newExpanded) {
    addSubNodes(catId, node.skills, node.x, node.y, node.cat);
  }

  // Re-render nodes layer
  const nodesDiv = document.querySelector('[data-nodes-layer]');
  if (nodesDiv) {
    nodesDiv.innerHTML = mindmapNodesHTML();
    updateMindmapLines();
    const canvas = document.getElementById('mindmap-canvas');
    if (canvas) { canvas._dragInit = false; initMindmap(); }
  }
}

function addPresenceNodes(center) {
  const cx = center?.x || 2500, cy = center?.y || 2500;
  const entries = state.presence.filter(e => (e.text || '').startsWith('Node:') || e.mode === 'node' || e.mode === 'cli');
  entries.slice(0, 4).forEach((e, i) => {
    const id = 'presence-' + (e.host || i);
    if (state.mindmapNodes.find(n => n.id === id)) return;
    const angle = (Math.PI * 2 / Math.max(entries.length, 1)) * i + Math.PI / 4;
    state.mindmapNodes.push({
      id,
      type: 'presence',
      cat: 'presence',
      label: (e.host || 'claude-code').split('.')[0],
      sub: (e.text || '').replace(/^Node:\s*/, '').slice(0, 36) || 'Connected',
      icon: 'computer',
      emoji: '',
      x: cx + Math.cos(angle) * 380,
      y: cy + Math.sin(angle) * 380,
      presenceEntry: e,
    });
  });
}

function refreshMindmapDOM() {
  if (state.view !== 'mindmap') return;
  const nodesDiv = document.querySelector('[data-nodes-layer]');
  if (nodesDiv) {
    nodesDiv.innerHTML = mindmapNodesHTML();
    updateMindmapLines();
    const canvas = document.getElementById('mindmap-canvas');
    if (canvas) { canvas._dragInit = false; initMindmap(); }
  } else render();
}

// ── Presence / Claude Code monitor ────────────────────────────────────────────
async function loadPresence() {
  try {
    const res = await gw.systemPresence();
    const entries = Array.isArray(res) ? res : (res?.presence || Object.values(res || {}));
    updatePresenceData(entries);
  } catch (_) {}
}

function updatePresenceData(entries) {
  if (!Array.isArray(entries)) return;
  state.presence = entries;
  const now = Date.now();
  for (const e of entries) {
    const text = e.text || '';
    if (!text || text === state.presenceLog[0]?.text) continue;
    state.presenceLog.unshift({ text, ts: e.ts || now, mode: e.mode, host: e.host, reason: e.reason });
    if (state.presenceLog.length > 50) state.presenceLog.pop();
  }
  updateMonitorPanel();
}

function updateMonitorPanel() {
  const el = document.getElementById('monitor-panel-body');
  if (!el) return;
  el.innerHTML = renderMonitorContent();
}

function renderMonitorContent() {
  const nodes = state.presence.filter(e => (e.text || '').startsWith('Node:') || e.mode === 'node' || e.mode === 'cli');
  const log = state.presenceLog.slice(0, 20);
  if (!nodes.length && !log.length) return `<div class="text-xs text-slate-400 text-center py-8">No active Claude Code instances</div>`;
  const nodesHtml = nodes.map(e => {
    const text = (e.text || '').replace(/^Node:\s*/, '');
    const active = (Date.now() - (e.ts || 0)) < 30000;
    return `<div class="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
      <div class="mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-orange-400 animate-pulse' : 'bg-slate-300'}"></div>
      <div class="min-w-0 flex-1">
        <div class="text-xs font-semibold text-on-surface">${escapeHtml(e.host || 'claude-code')}</div>
        <div class="text-[10px] text-slate-500 mt-0.5 break-words">${escapeHtml(text)}</div>
        ${e.reason ? `<div class="text-[10px] text-tertiary">${escapeHtml(e.reason)}</div>` : ''}
      </div>
      <div class="text-[10px] text-slate-400 flex-shrink-0">${timeAgo(e.ts)}</div>
    </div>`;
  }).join('');
  const logHtml = log.map(e => {
    const isExec = e.text.includes('Exec');
    return `<div class="flex items-start gap-2 py-1 text-[11px]">
      <span class="material-symbols-outlined text-xs flex-shrink-0 mt-0.5 ${isExec ? 'text-orange-400' : 'text-slate-400'}">${isExec ? 'terminal' : 'circle'}</span>
      <span class="text-slate-600 flex-1 break-words">${escapeHtml(e.text)}</span>
      <span class="text-slate-400 ml-1 flex-shrink-0">${timeAgo(e.ts)}</span>
    </div>`;
  }).join('');
  return `
    ${nodes.length ? `<div class="text-[10px] font-bold uppercase tracking-widest text-secondary mb-2">Active Instances</div><div class="mb-3">${nodesHtml}</div>` : ''}
    ${log.length ? `<div class="text-[10px] font-bold uppercase tracking-widest text-secondary mb-2">Activity Log</div><div>${logHtml}</div>` : ''}
  `;
}

let _presencePollTimer = null;
function startPresencePoll() {
  stopPresencePoll();
  _presencePollTimer = setInterval(() => { if (state.connected) loadPresence(); }, 8000);
}
function stopPresencePoll() {
  if (_presencePollTimer) { clearInterval(_presencePollTimer); _presencePollTimer = null; }
}

// ── Skill management panel ────────────────────────────────────────────────────
function renderSkillPanel() {
  const key = state.selectedSkillKey;
  if (!key) return '';
  const skill = state.skillsData[key];
  if (!skill) return '';
  const cat = skillCategory(skill.name, skill.description);
  const m = CAT_META[cat] || CAT_META.default;
  const isEnabled = !skill.disabled;

  return `
    <div id="skill-panel" style="position:absolute;top:12px;right:12px;width:290px;background:white;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.14);border:1.5px solid ${m.border}33;overflow:hidden;z-index:40;max-height:calc(100% - 80px);display:flex;flex-direction:column">
      <div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;background:${m.bg}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:10px;background:${m.border}18;border:1.5px solid ${m.border}40;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
            ${skill.emoji || `<span class="material-symbols-outlined" style="color:${m.border};font-size:18px">${skillIcon(skill.name)}</span>`}
          </div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:13px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(skill.name)}</div>
            <div style="font-size:10px;color:${m.border};font-weight:600;text-transform:uppercase;letter-spacing:.05em">${m.label}</div>
          </div>
          <button onclick="window._closeSkillPanel()" style="padding:4px;border:none;background:none;cursor:pointer;color:#94a3b8;flex-shrink:0">
            <span class="material-symbols-outlined" style="font-size:16px">close</span>
          </button>
        </div>
        ${skill.description ? `<p style="font-size:11px;color:#64748b;margin:8px 0 0;line-height:1.5">${escapeHtml(skill.description.slice(0, 120))}</p>` : ''}
      </div>

      <div style="overflow-y:auto;flex:1;padding:14px;display:flex;flex-direction:column;gap:12px">
        <!-- Enable / Disable toggle -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
          <div>
            <div style="font-size:12px;font-weight:600;color:#1e293b">${isEnabled ? 'Active' : 'Disabled'}</div>
            <div style="font-size:10px;color:#64748b;margin-top:1px">${isEnabled ? 'Click to disable' : 'Click to enable'}</div>
          </div>
          <button onclick="window._toggleSkill('${escapeHtml(key)}', ${isEnabled})"
            style="width:44px;height:24px;border-radius:12px;border:none;cursor:pointer;transition:background .2s;background:${isEnabled ? m.border : '#cbd5e1'};position:relative;flex-shrink:0">
            <div style="position:absolute;top:2px;${isEnabled ? 'right:2px' : 'left:2px'};width:20px;height:20px;border-radius:10px;background:white;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:all .2s"></div>
          </button>
        </div>

        ${skill.primaryEnv ? `
        <div>
          <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${escapeHtml(skill.primaryEnv)}</div>
          <div style="display:flex;gap:6px">
            <input id="sp-apikey" type="password" placeholder="Paste API key…"
              style="flex:1;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;font-family:monospace;min-width:0;color:#0f172a"
              onfocus="this.style.borderColor='${m.border}'" onblur="this.style.borderColor='#e2e8f0'"/>
            <button onclick="window._saveSkillApiKey('${escapeHtml(key)}')"
              style="padding:8px 10px;background:${m.border};color:white;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">Save</button>
          </div>
        </div>` : ''}

        ${skill.missing?.length ? `
        <div style="padding:10px;background:#fef2f2;border-radius:10px;border:1px solid #fecaca">
          <div style="font-size:10px;font-weight:700;color:#dc2626;margin-bottom:4px">Missing Requirements</div>
          ${skill.missing.map(r => `<div style="font-size:11px;color:#ef4444;display:flex;gap:6px;align-items:center"><span class="material-symbols-outlined" style="font-size:12px">warning</span>${escapeHtml(r)}</div>`).join('')}
        </div>` : ''}

        ${skill.install?.length ? `
        <div>
          <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Install</div>
          ${skill.install.map(opt => `
            <button onclick="window._installSkillDep('${escapeHtml(key)}', '${escapeHtml(opt.id)}')"
              style="width:100%;text-align:left;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;color:#374151;cursor:pointer;margin-bottom:4px">
              ${escapeHtml(opt.label)}
            </button>`).join('')}
        </div>` : ''}

        ${skill.homepage ? `
        <a href="${escapeHtml(skill.homepage)}" target="_blank"
          style="display:flex;align-items:center;gap:6px;font-size:11px;color:${m.border};text-decoration:none;font-weight:600">
          <span class="material-symbols-outlined" style="font-size:14px">open_in_new</span>Docs
        </a>` : ''}
      </div>
    </div>`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res = await gw.chatHistory(state.sessionKey);
    const raw = res?.messages || (Array.isArray(res) ? res : []);
    state.messages = raw.map(m => ({
      role: m.role || (m.from === 'user' ? 'user' : 'assistant'),
      text: extractText(m.text || m.content || m.message || '')
    })).filter(m => m.text);
  } catch (_) {}
  renderMessages();
}

// Appended to EVERY outgoing user message
const RESPONSE_MANDATE =
  '\n\n[Rules: (1) For simple facts, math, translations, or general knowledge — answer DIRECTLY from your knowledge, do NOT use any tools. (2) Only use the browser tool when the question requires live data from a specific URL. (3) NEVER navigate to claude.ai, anthropic.com, or any AI chat service — they are not data sources. (4) After every tool use, ALWAYS write a complete text answer summarising what you found. Never respond with tool calls only.]';

// System primer injected into the FIRST message of every new session
const SESSION_PRIMER =
  '[System: You are a helpful assistant with browser access. For general knowledge, calculations, translations, and common facts, answer directly — do not use tools. Only use the browser tool when the user explicitly asks you to visit a URL or when live web data is required. After using any tool, always write your findings as text. Never navigate to claude.ai or anthropic.com.]\n\n';

function buildMessageWithContext(userText) {
  const sources = state.customSources || [];
  const mandate = RESPONSE_MANDATE;
  // First message in session gets a system primer so Gemini knows the rules
  const primer = state.messages.length === 0 ? SESSION_PRIMER : '';

  if (!sources.length) return primer + userText + mandate;

  const list = sources.map(s => {
    try {
      const host = new URL(s.url).hostname;
      return `  • ${s.label || host}: ${s.url}${s.description ? ' (' + s.description + ')' : ''}`;
    } catch { return null; }
  }).filter(Boolean).join('\n');

  return `${primer}Note: I have set up the following personal data sources. When the question requires live data, use the browser tool to navigate to the most relevant URL below. Do not use claude.ai, anthropic.com, or any AI chat service:

${list}

My question: ${userText}${mandate}`;
}

async function sendMessage(text) {
  if (!text.trim()) return;
  if (state.streaming) { showToast('Still processing…'); return; }  // prevent overlap
  if (!state.connected) { showToast('Not connected — retrying…'); gw.connect(); return; }

  state._nudged = false; // reset nudge guard for each new user message
  const msgToSend = buildMessageWithContext(text);

  appendMessage('user', text);
  state.streamText = ''; state.streaming = true;
  resetThinkingLabel();
  updateSendBtn(); updateStreamingMessage();
  try {
    await gw.chatSend(msgToSend, state.sessionKey);
    armResponseTimer(); // start 75s watchdog from when OpenClaw ACKed the send
  } catch (e) {
    clearResponseTimer();
    resetThinkingLabel();
    state.streaming = false;
    updateSendBtn();
    appendMessage('assistant', 'Error: ' + (e.message || 'Failed to send'));
  }
}

function appendMessage(role, text) { state.messages.push({ role, text }); renderMessages(); }

function updateStreamingMessage() {
  ensureStyles();
  const container = document.getElementById('messages');
  if (!container) return;
  let el = document.getElementById('streaming-msg');
  if (!el) { el = document.createElement('div'); el.id = 'streaming-msg'; el.className = 'flex flex-col gap-4 msg-enter'; container.appendChild(el); }
  el.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Orchestra</span>
      <span class="h-px flex-1 bg-surface-container-high"></span>
    </div>
    <div class="relative pl-6">
      <div class="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-full"></div>
      ${state.streamText
        ? `<div class="text-on-surface text-sm leading-relaxed md-body">${renderMarkdown(state.streamText)}</div>`
        : `<div class="flex items-center gap-2 py-1">
             <span class="thinking-pulse"></span>
             <span class="thinking-label text-xs font-medium text-primary/70 italic">${state.thinkingLabel || 'researching'}…</span>
           </div>`}
    </div>`;
  const scroll = document.getElementById('messages-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function finalizeMessage() {
  document.getElementById('streaming-msg')?.remove();
  if (state.streamText) { appendMessage('assistant', state.streamText); state.streamText = ''; }
  state.streaming = false; updateSendBtn();
}

function updateSendBtn() {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.disabled = state.streaming; btn.style.opacity = state.streaming ? '0.5' : '1';
}

function updateStatusDot() {
  const dot = document.getElementById('status-dot');
  if (dot) dot.className = `w-2 h-2 rounded-full ${state.connected ? 'bg-emerald-500' : 'bg-red-400 animate-pulse'}`;
  const lbl = document.getElementById('status-label');
  if (lbl) lbl.textContent = state.connected ? 'Connected' : 'Disconnected';
}

function renderMessages() {
  const container = document.getElementById('messages');
  if (!container) return;
  const streamEl = document.getElementById('streaming-msg');
  if (state.messages.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-96 gap-4">
        <div class="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center">
          <span class="material-symbols-outlined text-white text-2xl">neurology</span>
        </div>
        <h2 class="text-xl font-semibold tracking-tight text-on-surface">Good ${getGreeting()}</h2>
        <p class="text-sm text-secondary">How can I help you today?</p>
      </div>`;
  } else {
    let html = '';
    for (const msg of state.messages) {
      if (msg.role === 'user') {
        html += `<div class="flex flex-col gap-2 msg-enter">
          <div class="text-[10px] font-bold uppercase tracking-widest text-secondary/60 mb-1">You</div>
          <div class="text-on-surface text-base leading-relaxed max-w-2xl">${escapeHtml(msg.text)}</div>
        </div>`;
      } else {
        html += `<div class="flex flex-col gap-4 msg-enter">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Orchestra</span>
            <span class="h-px flex-1 bg-surface-container-high"></span>
          </div>
          <div class="relative pl-6">
            <div class="absolute left-0 top-0 bottom-0 w-[3px] bg-primary/30 rounded-full"></div>
            <div class="text-on-surface text-sm leading-relaxed md-body">${renderMarkdown(msg.text)}</div>
          </div>
        </div>`;
      }
    }
    container.innerHTML = html;
  }
  if (streamEl) container.appendChild(streamEl);
  const scroll = document.getElementById('messages-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

// ── Sidebar panels ────────────────────────────────────────────────────────────
async function openHistory() {
  state.sidebarPanel = state.sidebarPanel === 'history' ? null : 'history';
  renderSidebarPanel();
  if (state.sidebarPanel === 'history') {
    document.getElementById('sidebar-panel-content').innerHTML =
      `<div class="text-xs text-slate-400 px-3 py-4 text-center flex items-center justify-center gap-2">
        <span class="material-symbols-outlined text-sm" style="animation:spin 1s linear infinite">refresh</span> Loading…
      </div>`;
    try { const res = await gw.sessionsList(50); state.sessions = (res?.sessions || (Array.isArray(res) ? res : [])).filter(s => (s.key || s.sessionKey)); }
    catch (_) { state.sessions = []; }
    renderSidebarPanel();
  }
}

function openHelp() { state.sidebarPanel = state.sidebarPanel === 'help' ? null : 'help'; renderSidebarPanel(); }

function renderSidebarPanel() {
  const el = document.getElementById('sidebar-panel-content');
  if (!el) return;
  document.querySelectorAll('.sidebar-bottom-btn').forEach(b => b.classList.toggle('bg-slate-100', b.dataset.panel === state.sidebarPanel));
  if (state.sidebarPanel === 'history') {
    const items = state.sessions.length
      ? state.sessions.map(s => {
          // Build title — never use the client name, prefer real conversation content
          const CLIENT_NAMES = ['nordic studio', 'orchestra', 'openclaw'];
          const isClientName = t => CLIENT_NAMES.includes((t || '').toLowerCase().trim());
          // First user message is the best title — look in firstMessage/lastMessage
          const firstUserText = extractText(
            s.firstMessage?.role === 'user' ? (s.firstMessage?.content || s.firstMessage?.text) :
            s.lastMessage?.role  === 'user' ? (s.lastMessage?.content  || s.lastMessage?.text)  : ''
          );
          const candidates = [
            !isClientName(s.derivedTitle) ? s.derivedTitle : null,
            !isClientName(s.label)        ? s.label        : null,
            firstUserText,
            extractText(s.lastMessage?.content || s.lastMessage?.text || ''),
          ].filter(Boolean);
          let rawTitle = candidates.find(c => {
            const cl = c.trim();
            return cl.length > 3 && !cl.startsWith('{') && !cl.startsWith('[') && !cl.includes('```') && !cl.startsWith('Sender') && !isClientName(cl);
          }) || s.key || 'Untitled';
          // Strip markdown/JSON/leading punctuation
          rawTitle = rawTitle.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').trim();
          rawTitle = rawTitle.split('\n').map(l => l.trim()).find(l => l.length > 3 && !/^[{[\(]/.test(l) && !l.startsWith('Sender')) || rawTitle;
          rawTitle = rawTitle.replace(/^[^a-zA-Z0-9"'(\u00C0-\u024F]+/, '').replace(/\*\*/g, '').trim();
          const title = rawTitle.slice(0, 60) || 'Untitled';
          const key = s.key || s.sessionKey || s.id || '';
          const active = key === state.sessionKey;
          const ago = s.updatedAt || s.createdAt ? timeAgo(s.updatedAt || s.createdAt) : '';
          return `<button onclick="window._selectSession('${escapeHtml(key)}')"
            class="w-full text-left rounded-lg px-3 py-2 flex items-start gap-3 transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100'}">
            <span class="material-symbols-outlined text-sm mt-0.5 flex-shrink-0">${active ? 'chat_bubble' : 'chat_bubble_outline'}</span>
            <div class="min-w-0 flex-1">
              <div class="text-xs truncate font-medium">${escapeHtml(title)}</div>
              ${ago ? `<div class="text-[10px] text-slate-400 mt-0.5">${ago}</div>` : ''}
            </div>
          </button>`;
        }).join('')
      : '<div class="text-xs text-slate-400 px-3 py-4 text-center">No sessions found</div>';
    el.innerHTML = `
      <div class="px-3 mb-3">
        <button onclick="window._newSession()" class="w-full py-2 px-3 rounded-lg border border-dashed border-primary/30 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-sm">add</span> New Session
        </button>
      </div>
      <div class="text-[10px] font-bold uppercase tracking-widest text-secondary px-3 mb-2">Recent Sessions</div>
      <div class="space-y-0.5">${items}</div>`;
  } else if (state.sidebarPanel === 'help') {
    el.innerHTML = `
      <div class="px-3 space-y-4">
        <div class="text-[10px] font-bold uppercase tracking-widest text-secondary mb-3">Help</div>
        <div class="space-y-3 text-xs text-slate-600">
          <div class="flex gap-3 items-start"><span class="material-symbols-outlined text-sm text-primary mt-0.5">category</span><span><strong>Click category</strong> — expand to see individual skills</span></div>
          <div class="flex gap-3 items-start"><span class="material-symbols-outlined text-sm text-primary mt-0.5">touch_app</span><span><strong>Click skill</strong> — manage, toggle, set API key</span></div>
          <div class="flex gap-3 items-start"><span class="material-symbols-outlined text-sm text-primary mt-0.5">drag_pan</span><span><strong>Pan</strong> — drag background · Scroll to zoom</span></div>
          <div class="flex gap-3 items-start"><span class="material-symbols-outlined text-sm text-primary mt-0.5">extension</span><span><strong>Add Skill</strong> — describe it, Gemini installs it</span></div>
        </div>
        <div class="pt-3 border-t border-slate-100 text-[10px] text-slate-400">Nordic Studio · OpenClaw Gateway v3</div>
      </div>`;
  } else { el.innerHTML = ''; }
}

// ── Mindmap pan/zoom/drag ─────────────────────────────────────────────────────
const drag = { active: false, nodeId: null, sx: 0, sy: 0, nx: 0, ny: 0, moved: false };
const pan  = { active: false, sx: 0, sy: 0, ox: 0, oy: 0 };

function applyWorldTransform() {
  const w = document.getElementById('mindmap-world');
  if (w) w.style.transform = `translate(${state.mapPanX}px,${state.mapPanY}px) scale(${state.mapScale})`;
}

function initMindmap() {
  const canvas = document.getElementById('mindmap-canvas');
  if (!canvas || canvas._dragInit) return;
  canvas._dragInit = true;

  if (!state._mapCentered) {
    const center = state.mindmapNodes.find(n => n.id === 'center') || { x: 2500, y: 2500 };
    state.mapPanX = canvas.clientWidth  / 2 - center.x - 48;
    state.mapPanY = canvas.clientHeight / 2 - center.y - 48;
    state._mapCentered = true;
    applyWorldTransform();
  }

  canvas.addEventListener('mousedown', (e) => {
    const nodeEl = e.target.closest('[data-node-id]');
    if (nodeEl) {
      drag.active = true; drag.nodeId = nodeEl.dataset.nodeId; drag.moved = false;
      drag.sx = e.clientX; drag.sy = e.clientY;
      const node = state.mindmapNodes.find(n => n.id === drag.nodeId);
      if (node) { drag.nx = node.x; drag.ny = node.y; }
      nodeEl.style.cursor = 'grabbing';
    } else {
      pan.active = true;
      pan.sx = e.clientX; pan.sy = e.clientY;
      pan.ox = state.mapPanX; pan.oy = state.mapPanY;
      canvas.style.cursor = 'grabbing';
    }
    e.preventDefault();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const ns = Math.max(0.1, Math.min(4, state.mapScale * factor));
    state.mapPanX = mx - (mx - state.mapPanX) * (ns / state.mapScale);
    state.mapPanY = my - (my - state.mapPanY) * (ns / state.mapScale);
    state.mapScale = ns;
    applyWorldTransform();
  }, { passive: false });

  window.addEventListener('mousemove', onMindmapMouseMove);
  window.addEventListener('mouseup',   onMindmapMouseUp);
  startPresencePoll();
}

function onMindmapMouseMove(e) {
  if (drag.active) {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const node = state.mindmapNodes.find(n => n.id === drag.nodeId);
    if (!node) return;
    node.x = drag.nx + dx / state.mapScale;
    node.y = drag.ny + dy / state.mapScale;
    const el = document.querySelector(`[data-node-id="${drag.nodeId}"]`);
    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
    // Also move sub-nodes relative to parent
    if (node.type === 'category') {
      state.mindmapNodes.filter(n => n.parentId === node.id).forEach(sub => {
        const subEl = document.querySelector(`[data-node-id="${sub.id}"]`);
        if (subEl) { sub.x = sub.x + dx / state.mapScale - (node.x - drag.nx - dx / state.mapScale); sub.y = sub.y + dy / state.mapScale - (node.y - drag.ny - dy / state.mapScale); subEl.style.left = sub.x + 'px'; subEl.style.top = sub.y + 'px'; }
      });
    }
    updateMindmapLines();
  } else if (pan.active) {
    state.mapPanX = pan.ox + (e.clientX - pan.sx);
    state.mapPanY = pan.oy + (e.clientY - pan.sy);
    applyWorldTransform();
  }
}

function onMindmapMouseUp() {
  if (drag.active && !drag.moved) {
    const nodeId = drag.nodeId;
    const node = state.mindmapNodes.find(n => n.id === nodeId);
    if (node?.type === 'category' && node?.isSourcesNode) {
      if (state.customSources.length === 0) {
        window._showAddSourceModal();
      } else {
        toggleCategoryExpand(nodeId);
      }
    } else if (node?.type === 'category') {
      toggleCategoryExpand(nodeId);
    } else if (node?.sourceId) {
      window._showAddSourceModal(node.sourceId);
    } else if (node?.skillKey) {
      state.selectedSkillKey = state.selectedSkillKey === node.skillKey ? null : node.skillKey;
      document.getElementById('skill-panel')?.remove();
      if (state.selectedSkillKey) {
        const canvas = document.getElementById('mindmap-canvas');
        if (canvas) { canvas.insertAdjacentHTML('beforeend', renderSkillPanel()); ensureStyles(); }
      }
    }
  }
  if (drag.active) {
    drag.active = false; drag.nodeId = null;
    document.querySelectorAll('[data-node-id]').forEach(el => el.style.cursor = '');
  }
  if (pan.active) {
    pan.active = false;
    const canvas = document.getElementById('mindmap-canvas');
    if (canvas) canvas.style.cursor = '';
  }
}

function updateMindmapLines() {
  const svg = document.getElementById('mindmap-svg');
  if (!svg) return;
  const center = state.mindmapNodes.find(n => n.id === 'center');
  if (!center) return;
  const cx = center.x + 48, cy = center.y + 48;
  let paths = '';

  for (const node of state.mindmapNodes) {
    if (node.id === 'center') continue;
    const m = CAT_META[node.cat] || CAT_META.default;
    let fx, fy, tx, ty;
    if (node.type === 'subcategory') {
      const parent = state.mindmapNodes.find(n => n.id === node.parentId);
      if (!parent) continue;
      fx = parent.x + 90; fy = parent.y + 32;
      tx = node.x + 80;   ty = node.y + 28;
    } else {
      fx = cx; fy = cy; tx = node.x + 90; ty = node.y + 32;
    }
    const mx = (fx + tx) / 2;
    const solid = node.type === 'presence';
    const w = node.type === 'subcategory' ? '1.5' : '2';
    paths += `<path d="M ${fx} ${fy} C ${mx} ${fy} ${mx} ${ty} ${tx} ${ty}"
      fill="none" stroke="${m.line}" ${solid ? '' : 'stroke-dasharray="5 4"'} stroke-width="${w}" stroke-linecap="round" opacity="${node.type === 'subcategory' ? '0.6' : '0.85'}"/>`;
  }
  svg.innerHTML = paths;
}

function mindmapNodesHTML() {
  ensureStyles();
  return state.mindmapNodes.map(node => {
    if (node.type === 'center') {
      return `<div data-node-id="${node.id}" class="absolute flex flex-col items-center gap-2 cursor-grab"
        style="left:${node.x}px;top:${node.y}px;z-index:20;user-select:none">
        <div class="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-[0_12px_32px_rgba(73,98,80,0.25)] border-4 border-surface-container-lowest">
          <span class="material-symbols-outlined text-white text-4xl" style="font-variation-settings:'FILL' 1">${node.icon}</span>
        </div>
        <div class="text-center pointer-events-none">
          <div class="text-on-surface font-bold text-sm tracking-tight">${escapeHtml(node.label)}</div>
          <div class="text-secondary text-[10px] font-medium uppercase tracking-wider">${escapeHtml(node.sub)}</div>
        </div>
      </div>`;
    }

    const m = CAT_META[node.cat] || CAT_META.default;

    // Category node
    if (node.type === 'category') {
      return `<div data-node-id="${node.id}" class="absolute cursor-pointer"
        style="left:${node.x}px;top:${node.y}px;width:185px;z-index:10;user-select:none">
        <div style="background:${m.bg};border:2.5px solid ${node.expanded ? m.border : m.border + '55'};border-radius:14px;padding:13px;box-shadow:${node.expanded ? `0 0 0 3px ${m.border}20,0 4px 20px rgba(0,0,0,.1)` : '0 2px 8px rgba(0,0,0,.07)'}; transition:all .15s">
          <div class="flex items-center gap-2.5 pointer-events-none">
            <div style="width:38px;height:38px;border-radius:11px;background:${m.border}18;border:1.5px solid ${m.border}50;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span class="material-symbols-outlined" style="color:${m.border};font-size:20px">${m.icon}</span>
            </div>
            <div style="min-width:0;flex:1">
              <div style="font-size:12px;font-weight:700;color:#0f172a">${escapeHtml(node.label)}</div>
              <div style="font-size:10px;color:${m.border};font-weight:600">${node.count} skill${node.count !== 1 ? 's' : ''}</div>
            </div>
            <div style="width:18px;height:18px;border-radius:9px;background:${m.border};display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span class="material-symbols-outlined" style="color:white;font-size:12px">${node.expanded ? 'expand_less' : 'expand_more'}</span>
            </div>
          </div>
        </div>
      </div>`;
    }

    // Sub-skill node (small)
    if (node.type === 'subcategory') {
      const isSelected = state.selectedSkillKey === node.skillKey;
      return `<div data-node-id="${node.id}" class="absolute sub-node cursor-pointer"
        style="left:${node.x}px;top:${node.y}px;width:160px;z-index:15;user-select:none">
        <div style="background:white;border:1.5px solid ${isSelected ? m.border : m.border + '40'};border-radius:10px;padding:9px 11px;box-shadow:${isSelected ? `0 0 0 2px ${m.border}30,0 2px 12px rgba(0,0,0,.08)` : '0 1px 6px rgba(0,0,0,.06)'}; transition:all .15s">
          <div class="flex items-center gap-2 pointer-events-none">
            <div style="width:26px;height:26px;border-radius:7px;background:${m.border}15;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px">
              ${node.emoji || `<span class="material-symbols-outlined" style="color:${m.border};font-size:14px">${node.icon}</span>`}
            </div>
            <div style="min-width:0">
              <div style="font-size:11px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(node.label)}</div>
              ${node.primaryEnv ? `<div style="font-size:9px;color:#f59e0b;font-weight:600">⚠ Key needed</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
    }

    // Presence node
    const presenceActive = node.type === 'presence' && (Date.now() - (node.presenceEntry?.ts || 0)) < 30000;
    return `<div data-node-id="${node.id}" class="absolute cursor-grab"
      style="left:${node.x}px;top:${node.y}px;width:180px;z-index:10;user-select:none">
      <div style="background:${m.bg};border:2px solid ${m.border}55;border-radius:12px;padding:12px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <div class="flex items-center gap-2.5 pointer-events-none">
          <div style="width:34px;height:34px;border-radius:9px;background:${m.border}18;border:1.5px solid ${m.border}50;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative">
            <span class="material-symbols-outlined" style="color:${m.border};font-size:17px">${node.icon}</span>
            <div style="position:absolute;bottom:-2px;right:-2px;width:8px;height:8px;border-radius:4px;background:${presenceActive ? '#22c55e' : '#94a3b8'};border:1.5px solid white${presenceActive ? ';box-shadow:0 0 0 2px rgba(34,197,94,.3)' : ''}"></div>
          </div>
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:700;color:#0f172a">${escapeHtml(node.label)}</div>
            <div style="font-size:10px;color:${m.border};font-weight:600">${presenceActive ? 'Active' : 'Idle'}</div>
          </div>
        </div>
        <div style="margin-top:6px;font-size:10px;color:#64748b;line-height:1.4;pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(node.sub)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── View renderers ────────────────────────────────────────────────────────────
function renderChat() {
  return `
    <section class="flex-1 flex flex-col min-h-0 bg-surface-container-low">
      <div class="flex-1 overflow-y-auto min-h-0" id="messages-scroll">
        <div class="max-w-3xl mx-auto pt-12 pb-8 px-4 md:px-0 space-y-8" id="messages"></div>
      </div>
      <div class="flex-shrink-0 p-4 md:p-6 bg-surface-container-low/80 backdrop-blur-xl border-t border-surface-container-highest/20">
        <div class="max-w-3xl mx-auto">
          <div class="flex items-end gap-3 p-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl focus-within:border-primary/40 transition-all shadow-sm">
            <textarea id="chat-input" rows="1" class="flex-1 py-2 px-2 bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-secondary/40 text-sm resize-none" style="max-height:160px" placeholder="Share your thoughts…"></textarea>
            <button id="send-btn" class="p-2 bg-primary text-on-primary rounded-lg transition-transform active:scale-95 shadow-lg shadow-primary/10 flex-shrink-0">
              <span class="material-symbols-outlined text-sm">send</span>
            </button>
          </div>
          <div class="mt-2 flex items-center justify-center">
            <span class="text-[10px] font-medium text-secondary/40 uppercase tracking-widest flex items-center gap-1">
              <span class="material-symbols-outlined text-xs">model_training</span> gemini-2.5-flash
            </span>
          </div>
        </div>
      </div>
    </section>`;
}

function renderMindmap() {
  const catCount = state.mindmapNodes.filter(n => n.type === 'category').length;
  const presCount = state.mindmapNodes.filter(n => n.type === 'presence').length;
  return `
    <div class="flex-1 relative overflow-hidden bg-surface-container-low mindmap-grid min-h-0" id="mindmap-canvas">
      <div class="absolute top-6 left-6 z-10 pointer-events-none">
        <div class="text-xl font-bold tracking-tight text-on-surface">Skills & Agents</div>
        <div class="flex items-center gap-3 mt-1">
          <span class="w-2 h-2 rounded-full ${state.connected ? 'bg-emerald-500' : 'bg-red-400'}"></span>
          <span class="text-xs font-medium text-secondary">${state.connected ? 'Live' : 'Offline'}</span>
          ${catCount ? `<span class="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">${catCount} categories</span>` : ''}
          ${presCount ? `<span class="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">${presCount} connected</span>` : ''}
        </div>
      </div>

      <!-- World -->
      <div id="mindmap-world" style="position:absolute;left:0;top:0;width:5000px;height:5000px;transform-origin:0 0;transform:translate(${state.mapPanX}px,${state.mapPanY}px) scale(${state.mapScale})">
        <svg id="mindmap-svg" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5"></svg>
        <div data-nodes-layer style="position:absolute;left:0;top:0;right:0;bottom:0;z-index:10">${mindmapNodesHTML()}</div>
      </div>

      <!-- Bottom-left buttons -->
      <div class="absolute bottom-6 left-6 z-20 flex gap-2">
        <button onclick="window._showSkillModal()" class="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-sm hover:border-primary/40 hover:shadow-md transition-all text-sm text-secondary font-medium">
          <span class="material-symbols-outlined text-sm">extension</span> Add Skill
        </button>
        <button onclick="window._showAddSourceModal()" class="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-sm hover:border-sky-400/40 hover:shadow-md transition-all text-sm text-secondary font-medium">
          <span class="material-symbols-outlined text-sm">link</span> Add Source
        </button>
      </div>

      <!-- Monitor -->
      <div class="absolute bottom-6 right-6 z-20">
        <button onclick="window._toggleMonitor()" class="flex items-center gap-2 px-3 py-2 ${state.monitorOpen ? 'bg-orange-500 text-white' : 'bg-surface-container-lowest text-secondary border border-outline-variant/30'} rounded-xl shadow-sm hover:shadow-md transition-all text-xs font-semibold">
          <span class="material-symbols-outlined text-sm">monitor_heart</span> Claude Code
        </button>
      </div>

      ${state.monitorOpen ? `
        <div class="absolute bottom-20 right-6 w-80 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-xl overflow-hidden" style="z-index:35;max-height:400px;display:flex;flex-direction:column">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
              <span class="text-xs font-bold uppercase tracking-widest text-secondary">Claude Code Monitor</span>
            </div>
            <button onclick="window._toggleMonitor()" class="text-slate-400 hover:text-slate-600"><span class="material-symbols-outlined text-sm">close</span></button>
          </div>
          <div id="monitor-panel-body" class="overflow-y-auto p-4" style="max-height:340px">${renderMonitorContent()}</div>
        </div>` : ''}

      <!-- Toolbar -->
      <div class="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 glass-panel rounded-full shadow z-30">
        <button onclick="(() => {const s=Math.min(4,window.__nordicState.mapScale*1.2);const c=document.getElementById('mindmap-canvas').getBoundingClientRect();const mx=c.width/2,my=c.height/2;window.__nordicState.mapPanX=mx-(mx-window.__nordicState.mapPanX)*(s/window.__nordicState.mapScale);window.__nordicState.mapPanY=my-(my-window.__nordicState.mapPanY)*(s/window.__nordicState.mapScale);window.__nordicState.mapScale=s;document.getElementById('mindmap-world').style.transform='translate('+window.__nordicState.mapPanX+'px,'+window.__nordicState.mapPanY+'px) scale('+s+')'})()" class="p-2 hover:bg-surface-container-high rounded-full">
          <span class="material-symbols-outlined text-secondary">zoom_in</span>
        </button>
        <button onclick="(() => {const s=Math.max(0.1,window.__nordicState.mapScale*0.8);const c=document.getElementById('mindmap-canvas').getBoundingClientRect();const mx=c.width/2,my=c.height/2;window.__nordicState.mapPanX=mx-(mx-window.__nordicState.mapPanX)*(s/window.__nordicState.mapScale);window.__nordicState.mapPanY=my-(my-window.__nordicState.mapPanY)*(s/window.__nordicState.mapScale);window.__nordicState.mapScale=s;document.getElementById('mindmap-world').style.transform='translate('+window.__nordicState.mapPanX+'px,'+window.__nordicState.mapPanY+'px) scale('+s+')'})()" class="p-2 hover:bg-surface-container-high rounded-full">
          <span class="material-symbols-outlined text-secondary">zoom_out</span>
        </button>
        <div class="w-px h-6 bg-outline-variant/30 mx-1"></div>
        <button onclick="window._resetMindmap()" class="p-2 hover:bg-surface-container-high rounded-full">
          <span class="material-symbols-outlined text-secondary">center_focus_strong</span>
        </button>
      </div>
    </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  stopPresencePoll();
  const app = document.getElementById('app');
  app.style.cssText = 'display:flex;flex-direction:column;height:100vh;overflow:hidden;';
  app.innerHTML = `
    <header class="flex-shrink-0 z-50 bg-slate-50/80 backdrop-blur-xl border-b border-slate-200/50 shadow-sm flex items-center justify-between px-6 h-14">
      <div class="flex items-center gap-8">
        <span class="text-lg font-semibold tracking-tighter text-slate-900">Orchestra</span>
        <nav class="hidden md:flex items-center gap-6 text-sm font-medium">
          <a href="#chat"    class="${state.view==='chat'    ? 'text-emerald-800 border-b-2 border-emerald-800 pb-1' : 'text-slate-500 hover:text-slate-800 transition-colors'}">Chat</a>
          <a href="#mindmap" class="${state.view==='mindmap' ? 'text-emerald-800 border-b-2 border-emerald-800 pb-1' : 'text-slate-500 hover:text-slate-800 transition-colors'}">Mindmap</a>
        </nav>
      </div>
      <div class="flex items-center gap-3">
        <div onclick="window.__nordicGw.connect()" class="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-low cursor-pointer">
          <div id="status-dot" class="w-2 h-2 rounded-full ${state.connected ? 'bg-emerald-500' : 'bg-red-400 animate-pulse'}"></div>
          <span id="status-label" class="text-[10px] font-bold uppercase tracking-widest text-secondary">${state.connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </header>
    <div class="flex flex-1 min-h-0">
      <aside class="hidden md:flex h-full w-64 flex-shrink-0 border-r border-slate-200/50 bg-slate-50 flex-col py-4 px-3">
        <div class="px-3 mb-4">
          <div class="flex items-center gap-3 mb-5">
            <div class="w-8 h-8 rounded-full bg-primary-fixed-dim flex items-center justify-center">
              <span class="material-symbols-outlined text-primary text-sm">nordic_walking</span>
            </div>
            <div>
              <div class="text-emerald-900 text-xs uppercase tracking-widest font-bold">The Nordic Studio</div>
              <div class="text-[10px] text-slate-500">AI Orchestrator</div>
            </div>
          </div>
          <button onclick="window._newSession()" class="w-full bg-gradient-to-br from-primary to-primary-container text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">New Session</button>
        </div>
        <div class="flex-1 overflow-y-auto min-h-0 px-1" id="sidebar-panel-content"></div>
        <div class="border-t border-slate-200/50 pt-3 space-y-0.5 flex-shrink-0">
          <button data-panel="history" onclick="window._openHistory()" class="sidebar-bottom-btn w-full text-slate-600 hover:bg-slate-100 rounded-lg px-3 py-2 flex items-center gap-3 transition-colors">
            <span class="material-symbols-outlined text-sm">history</span>
            <span class="text-xs uppercase tracking-widest font-bold">History</span>
          </button>
          <button data-panel="help" onclick="window._openHelp()" class="sidebar-bottom-btn w-full text-slate-600 hover:bg-slate-100 rounded-lg px-3 py-2 flex items-center gap-3 transition-colors">
            <span class="material-symbols-outlined text-sm">help_outline</span>
            <span class="text-xs uppercase tracking-widest font-bold">Help</span>
          </button>
        </div>
      </aside>
      <div class="flex-1 flex flex-col min-h-0 min-w-0">
        ${state.view === 'mindmap' ? renderMindmap() : renderChat()}
      </div>
    </div>
    <nav class="md:hidden flex-shrink-0 w-full h-16 bg-white border-t border-slate-100 flex items-center justify-around px-6 z-50">
      <a href="#chat"    class="flex flex-col items-center gap-1 ${state.view==='chat'    ? 'text-emerald-800' : 'text-slate-400'}"><span class="material-symbols-outlined">forum</span><span class="text-[10px] font-bold">Chat</span></a>
      <a href="#mindmap" class="flex flex-col items-center gap-1 ${state.view==='mindmap' ? 'text-emerald-800' : 'text-slate-400'}"><span class="material-symbols-outlined">neurology</span><span class="text-[10px] font-bold">Mind</span></a>
    </nav>`;

  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  if (input && sendBtn) {
    const doSend = () => { const t = input.value.trim(); if (t) { sendMessage(t); input.value = ''; input.style.height = 'auto'; } };
    sendBtn.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
    updateSendBtn();
  }
  renderSidebarPanel(); renderMessages();
  if (state.view === 'mindmap') requestAnimationFrame(() => { initMindmap(); updateMindmapLines(); });
}

// ── Global callbacks ──────────────────────────────────────────────────────────
window.addEventListener('hashchange', () => { state.view = location.hash?.slice(1) || 'chat'; state.selectedSkillKey = null; render(); });
window._newSession = () => {
  clearResponseTimer();
  state.sessionKey = _freshSessionKey();
  state.messages = []; state.streamText = ''; state.streaming = false;
  state.sidebarPanel = null;
  render();
  showToast('New session started');
};
window._openHistory = () => openHistory();
window._openHelp    = () => openHelp();
window._selectSession = (key) => { state.sessionKey = key; state.messages = []; state.sidebarPanel = null; render(); if (state.connected) loadHistory(); };
window._toggleMonitor = () => { state.monitorOpen = !state.monitorOpen; if (state.monitorOpen) loadPresence(); render(); };
window._closeSkillPanel = () => { state.selectedSkillKey = null; document.getElementById('skill-panel')?.remove(); };

window._toggleSkill = async (skillKey, currentlyEnabled) => {
  try {
    await gw.skillsUpdate(skillKey, { enabled: !currentlyEnabled });
    showToast(currentlyEnabled ? 'Skill disabled' : 'Skill enabled');
    await loadSkills();
    document.getElementById('skill-panel')?.remove();
    if (state.selectedSkillKey) {
      document.getElementById('mindmap-canvas')?.insertAdjacentHTML('beforeend', renderSkillPanel());
    }
  } catch (e) { showToast('Error: ' + (e.message || 'Failed to update')); }
};

window._saveSkillApiKey = async (skillKey) => {
  const val = document.getElementById('sp-apikey')?.value?.trim();
  if (!val) { showToast('Enter an API key first'); return; }
  try {
    await gw.skillsUpdate(skillKey, { apiKey: val });
    showToast('API key saved ✓');
    document.getElementById('sp-apikey').value = '';
    await loadSkills();
  } catch (e) { showToast('Error: ' + (e.message || 'Failed')); }
};

window._installSkillDep = async (skillKey, installId) => {
  showToast('Installing…', 8000);
  try {
    const skill = state.skillsData[skillKey];
    await gw.skillsInstall(skill?.name || skillKey, installId);
    showToast('Installed! Refreshing…');
    setTimeout(() => loadSkills(), 2000);
  } catch (e) { showToast('Error: ' + (e.message || 'Failed')); }
};

window._showSkillModal = () => {
  const existing = document.getElementById('skill-modal');
  if (existing) { existing.remove(); return; }

  const CAT_COLORS = {
    search:'#3b82f6', code:'#6b7280', comms:'#6366f1', data:'#f59e0b',
    ai:'#8b5cf6', productivity:'#0d9488', media:'#ec4899', files:'#d97706', default:'#496250'
  };

  const modal = document.createElement('div');
  modal.id = 'skill-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:200;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;padding:24px;width:440px;max-width:92vw;box-shadow:0 24px 64px rgba(0,0,0,.15)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#496250,#617b68);border-radius:10px;display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="color:white;font-size:18px">extension</span>
        </div>
        <div><div style="font-weight:700;font-size:14px;color:#0f172a">Add a Skill</div>
          <div style="font-size:11px;color:#737972">Search your catalog or describe a new skill</div></div>
        <button onclick="document.getElementById('skill-modal').remove()" style="margin-left:auto;padding:4px;border-radius:6px;border:none;background:none;cursor:pointer;color:#94a3b8">
          <span class="material-symbols-outlined" style="font-size:18px">close</span></button>
      </div>
      <div style="position:relative">
        <span class="material-symbols-outlined" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:18px;pointer-events:none">search</span>
        <input id="skill-modal-input" placeholder="e.g. 'perplexity', 'github', 'browse the web'…" autocomplete="off"
          style="width:100%;box-sizing:border-box;padding:10px 12px 10px 36px;border:1.5px solid #e0e3e5;border-radius:10px;font-size:13px;outline:none;font-family:inherit;color:#0f172a" autofocus/>
      </div>
      <div id="skill-search-results" style="margin-top:6px;max-height:240px;overflow-y:auto;border-radius:10px"></div>
      <div id="skill-modal-hint" style="font-size:11px;color:#94a3b8;margin:8px 0 14px">Type to search, or describe a skill for Gemini to install.</div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('skill-modal').remove()" style="flex:1;padding:10px;border:1.5px solid #e0e3e5;border-radius:8px;background:none;cursor:pointer;font-size:13px;font-weight:500;color:#737972">Cancel</button>
        <button id="skill-install-btn" onclick="window._submitSkillInstall()" style="flex:2;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#496250,#617b68);color:white;cursor:pointer;font-size:13px;font-weight:600">Ask Gemini to Install</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const inp = modal.querySelector('#skill-modal-input');
  const resultsEl = modal.querySelector('#skill-search-results');
  const hintEl = modal.querySelector('#skill-modal-hint');
  const btn = modal.querySelector('#skill-install-btn');

  function renderResults(query) {
    const q = query.toLowerCase().trim();
    if (!q) { resultsEl.innerHTML = ''; hintEl.style.display = ''; btn.textContent = 'Ask Gemini to Install'; return; }

    const catalog = getCatalog();
    const installedKeys = new Set(Object.keys(state.skillsData));

    const matches = catalog.filter(s =>
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.skillKey.toLowerCase().includes(q)
    ).sort((a, b) => {
      // Installed first, then alphabetical
      const ai = installedKeys.has(a.skillKey) ? 0 : 1;
      const bi = installedKeys.has(b.skillKey) ? 0 : 1;
      return ai - bi || a.name.localeCompare(b.name);
    }).slice(0, 8);

    if (!matches.length) {
      resultsEl.innerHTML = '';
      hintEl.style.display = '';
      hintEl.textContent = 'No local matches — Gemini will search and install it.';
      btn.textContent = 'Ask Gemini to Install';
      return;
    }

    hintEl.style.display = 'none';
    resultsEl.innerHTML = matches.map(s => {
      const installed = installedKeys.has(s.skillKey);
      const skill = state.skillsData[s.skillKey];
      const disabled = skill?.disabled;
      const catColor = CAT_COLORS[s.category] || CAT_COLORS.default;
      const catLabel = (CAT_META[s.category] || CAT_META.default).label;
      const statusBadge = installed
        ? `<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:${disabled ? '#fee2e2' : '#dcfce7'};color:${disabled ? '#ef4444' : '#16a34a'};font-weight:600">${disabled ? 'disabled' : 'installed'}</span>`
        : `<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:#f1f5f9;color:#64748b;font-weight:500">not installed</span>`;
      return `<div data-skill-key="${s.skillKey}" onclick="window._selectCatalogSkill('${s.skillKey}')"
        style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;transition:background .12s"
        onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">
        <span style="font-size:20px;min-width:26px;text-align:center">${s.emoji || '🔧'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.name)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span style="font-size:10px;padding:1px 6px;border-radius:20px;background:${catColor}18;color:${catColor};font-weight:600">${catLabel}</span>
            ${statusBadge}
          </div>
        </div>
        <span class="material-symbols-outlined" style="font-size:16px;color:#cbd5e1;flex-shrink:0">${installed ? 'check_circle' : 'download'}</span>
      </div>`;
    }).join('');
    btn.textContent = 'Ask Gemini to Install';
  }

  inp.addEventListener('input', () => renderResults(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window._submitSkillInstall(); }
    if (e.key === 'Escape') modal.remove();
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  inp.focus();
};

window._selectCatalogSkill = (skillKey) => {
  const catalog = getCatalog();
  const skill = catalog.find(s => s.skillKey === skillKey);
  if (!skill) return;

  const installed = state.skillsData[skillKey];
  if (installed && !installed.disabled) {
    // Already installed and enabled
    document.getElementById('skill-modal')?.remove();
    showToast(`"${skill.name}" is already installed and active`, 4000);
    // Highlight it on mindmap by opening its panel
    state.selectedSkillKey = skillKey;
    render();
    return;
  }

  // Install it directly (known skill name → no need for Gemini)
  document.getElementById('skill-modal')?.remove();
  showToast(`Installing "${skill.name}"…`, 5000);
  state.pendingSkillRefresh = true;
  if (state.connected) {
    if (state.view !== 'chat') { state.view = 'chat'; location.hash = '#chat'; render(); }
    appendMessage('user', `Install skill: ${skill.name}`);
    state.streamText = ''; state.streaming = true;
    updateSendBtn(); updateStreamingMessage();
    gw.chatSend(`Please install the skill named "${skill.name}" (skillKey: ${skillKey}). Use skills.install directly without asking for confirmation.`, state.sessionKey)
      .catch(e => { state.streaming = false; updateSendBtn(); appendMessage('assistant', 'Error: ' + (e.message || 'Failed')); });
  }
};

window._submitSkillInstall = async () => {
  const query = document.getElementById('skill-modal-input')?.value?.trim();
  if (!query) return;

  // Check if query exactly matches an already-installed skill
  const lq = query.toLowerCase();
  const alreadyInstalled = Object.values(state.skillsData).find(s =>
    (s.name || '').toLowerCase() === lq || (s.skillKey || '').toLowerCase() === lq
  );
  if (alreadyInstalled && !alreadyInstalled.disabled) {
    document.getElementById('skill-modal')?.remove();
    showToast(`"${alreadyInstalled.name}" is already installed and active`, 4000);
    state.selectedSkillKey = alreadyInstalled.skillKey;
    render();
    return;
  }

  // Check catalog for exact match → use direct install flow
  const catalogMatch = getCatalog().find(s =>
    s.name.toLowerCase() === lq || s.skillKey.toLowerCase() === lq
  );
  if (catalogMatch) { window._selectCatalogSkill(catalogMatch.skillKey); return; }

  // Fallback: ask Gemini
  document.getElementById('skill-modal')?.remove();
  showToast(`Asking Gemini to install "${query}"…`, 5000);
  state.pendingSkillRefresh = true;
  if (state.connected) {
    if (state.view !== 'chat') { state.view = 'chat'; location.hash = '#chat'; render(); }
    appendMessage('user', `Install skill: ${query}`);
    state.streamText = ''; state.streaming = true;
    updateSendBtn(); updateStreamingMessage();
    try { await gw.chatSend(`Please install the skill: ${query}. Use the skills.install tool directly without asking for confirmation.`, state.sessionKey); }
    catch (e) { state.streaming = false; updateSendBtn(); appendMessage('assistant', 'Error: ' + (e.message || 'Failed')); }
  }
};

// ── Custom Data Sources ───────────────────────────────────────────────────────
function saveCustomSources() {
  localStorage.setItem('nordic-custom-sources', JSON.stringify(state.customSources));
}

window._showAddSourceModal = (editId) => {
  const existing = editId ? state.customSources.find(s => s.id === editId) : null;
  const modal = document.createElement('div');
  modal.id = 'source-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:200;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;padding:24px;width:440px;max-width:92vw;box-shadow:0 24px 64px rgba(0,0,0,.15)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#0ea5e9,#38bdf8);border-radius:10px;display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="color:white;font-size:18px">link</span>
        </div>
        <div>
          <div style="font-weight:700;font-size:14px;color:#0f172a">${existing ? 'Edit Data Source' : 'Add Data Source'}</div>
          <div style="font-size:11px;color:#737972">OpenClaw will navigate here when you ask about this site</div>
        </div>
        <button onclick="document.getElementById('source-modal').remove()" style="margin-left:auto;padding:4px;border-radius:6px;border:none;background:none;cursor:pointer;color:#94a3b8">
          <span class="material-symbols-outlined" style="font-size:18px">close</span></button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px">URL</label>
          <input id="src-url" type="url" placeholder="https://example.com/data" value="${escapeHtml(existing?.url || '')}"
            style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e0e3e5;border-radius:8px;font-size:13px;outline:none;font-family:inherit;color:#0f172a" autofocus/>
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Label <span style="font-weight:400;color:#94a3b8">(optional)</span></label>
          <input id="src-label" type="text" placeholder="e.g. My Finance Dashboard" value="${escapeHtml(existing?.label || '')}"
            style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e0e3e5;border-radius:8px;font-size:13px;outline:none;font-family:inherit;color:#0f172a"/>
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description <span style="font-weight:400;color:#94a3b8">(helps OpenClaw know when to use it)</span></label>
          <textarea id="src-desc" placeholder="e.g. Company stock prices updated hourly" rows="2"
            style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e0e3e5;border-radius:8px;font-size:13px;outline:none;resize:none;font-family:inherit;color:#0f172a">${escapeHtml(existing?.description || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:18px">
        ${existing ? `<button onclick="window._deleteSource('${existing.id}')" style="padding:10px 14px;border:1.5px solid #fee2e2;border-radius:8px;background:none;cursor:pointer;font-size:13px;font-weight:500;color:#ef4444">Delete</button>` : ''}
        <button onclick="document.getElementById('source-modal').remove()" style="flex:1;padding:10px;border:1.5px solid #e0e3e5;border-radius:8px;background:none;cursor:pointer;font-size:13px;font-weight:500;color:#737972">Cancel</button>
        <button onclick="window._saveSource('${existing?.id || ''}')" style="flex:2;padding:10px;border:none;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:white;cursor:pointer;font-size:13px;font-weight:600">${existing ? 'Save Changes' : 'Add Source'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#src-url').focus();
};

window._saveSource = (editId) => {
  const url = document.getElementById('src-url')?.value?.trim();
  if (!url) { showToast('Please enter a URL'); return; }
  try { new URL(url); } catch { showToast('Invalid URL'); return; }
  const label = document.getElementById('src-label')?.value?.trim();
  const description = document.getElementById('src-desc')?.value?.trim();
  if (editId) {
    const idx = state.customSources.findIndex(s => s.id === editId);
    if (idx !== -1) state.customSources[idx] = { ...state.customSources[idx], url, label, description };
  } else {
    state.customSources.push({ id: crypto.randomUUID(), url, label, description });
  }
  saveCustomSources();
  document.getElementById('source-modal')?.remove();
  showToast(editId ? 'Source updated' : 'Source added');
  loadSkills(); // re-render mindmap
};

window._deleteSource = (id) => {
  state.customSources = state.customSources.filter(s => s.id !== id);
  saveCustomSources();
  document.getElementById('source-modal')?.remove();
  showToast('Source removed');
  loadSkills();
};

window._resetMindmap = () => {
  const cx = 2500, cy = 2500;
  const center = state.mindmapNodes.find(n => n.id === 'center');
  if (center) { center.x = cx; center.y = cy; }
  const cats = state.mindmapNodes.filter(n => n.type === 'category');
  const step = (Math.PI * 2) / Math.max(cats.length, 1);
  cats.forEach((node, i) => {
    const angle = step * i - Math.PI / 2;
    node.x = cx + Math.cos(angle) * 300;
    node.y = cy + Math.sin(angle) * 300;
    // Move sub-nodes too
    if (node.expanded) {
      const subs = state.mindmapNodes.filter(n => n.parentId === node.id);
      const subStep = (Math.PI * 2) / Math.max(subs.length, 1);
      subs.forEach((sub, j) => {
        const sa = subStep * j - Math.PI / 2;
        sub.x = node.x + Math.cos(sa) * 160 - 80;
        sub.y = node.y + Math.sin(sa) * 160 - 28;
      });
    }
  });
  const canvas = document.getElementById('mindmap-canvas');
  if (canvas) { state.mapPanX = canvas.clientWidth / 2 - cx - 48; state.mapPanY = canvas.clientHeight / 2 - cy - 48; state.mapScale = 1.0; }
  const nodesDiv = document.querySelector('[data-nodes-layer]');
  if (nodesDiv) { nodesDiv.innerHTML = mindmapNodesHTML(); updateMindmapLines(); applyWorldTransform(); }
};

render();
