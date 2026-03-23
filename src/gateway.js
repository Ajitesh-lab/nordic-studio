// OpenClaw Gateway WebSocket Client
export class Gateway {
  constructor({ url = 'ws://127.0.0.1:18789', token }) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.state = 'disconnected';
    this._reqId = 0;
    this._pending = new Map();
    this._listeners = new Map();
    this._reconnectDelay = 1000;
    this._nonce = null;
    this._connected = false;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    this.state = 'connecting';
    this._emit('state', this.state);

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this._reconnectDelay = 1000;
    };

    this.ws.onmessage = (e) => {
      const frame = JSON.parse(e.data);

      if (frame.type === 'event') {
        if (frame.event === 'connect.challenge') {
          this._nonce = frame.payload.nonce;
          this._sendConnect();
        } else {
          this._emit(frame.event, frame.payload, frame);
        }
      } else if (frame.type === 'res') {
        if (frame.ok && !this._connected) {
          this._connected = true;
          this.state = 'connected';
          console.log('[GW] Connected!');
          this._emit('state', this.state);
          this._emit('hello', frame.payload);
        }
        if (!frame.ok) {
          console.error('[GW] Error:', JSON.stringify(frame.error));
        }
        const pending = this._pending.get(frame.id);
        if (pending) {
          this._pending.delete(frame.id);
          if (frame.ok) pending.resolve(frame.payload);
          else pending.reject(frame.error || { message: 'Unknown error' });
        }
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.state = 'disconnected';
      this._emit('state', this.state);
      setTimeout(() => this.connect(), this._reconnectDelay);
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 10000);
    };

    this.ws.onerror = () => this.ws.close();
  }

  _sendConnect() {
    this._sendRaw({
      type: 'req',
      id: this._nextId(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-control-ui',
          version: '1.0.0',
          platform: 'web',
          mode: 'ui',
          displayName: 'Nordic Studio'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
        auth: this.token ? { token: this.token } : undefined
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this._nextId();
      this._pending.set(id, { resolve, reject });
      this._sendRaw({ type: 'req', id, method, params });
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject({ message: 'Request timeout' });
        }
      }, 60000);
    });
  }

  _sendRaw(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _nextId() {
    return `ns-${++this._reqId}-${Date.now()}`;
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  _emit(event, ...args) {
    this._listeners.get(event)?.forEach(fn => fn(...args));
  }

  // High-level methods
  async chatHistory(sessionKey = 'main', limit = 50) {
    return this.send('chat.history', { sessionKey, limit });
  }

  async chatSend(text, sessionKey = 'main') {
    return this.send('chat.send', {
      sessionKey,
      message: text,
      idempotencyKey: crypto.randomUUID()
    });
  }

  async chatAbort(sessionKey = 'main') {
    return this.send('chat.abort', { sessionKey });
  }

  async sessionsList(limit = 50) {
    return this.send('sessions.list', {
      limit,
      includeDerivedTitles: true,
      includeLastMessage: true,
      includeFirstMessage: true,
    });
  }

  async skillsStatus(agentId) {
    return this.send('skills.status', agentId ? { agentId } : {});
  }

  async skillsInstall(name, installId) {
    return this.send('skills.install', { name, installId });
  }

  async skillsUpdate(skillKey, updates) {
    return this.send('skills.update', { skillKey, ...updates });
  }

  async systemPresence() {
    return this.send('system-presence', {});
  }

  disconnect() {
    this._reconnectDelay = Infinity;
    this.ws?.close();
  }
}
