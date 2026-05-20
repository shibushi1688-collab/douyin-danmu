'use strict';

const WebSocket = require('ws');

const TYPE_MAP = {
  1: 'member',  // 进入
  2: 'social',  // 关注
  3: 'chat',    // 弹幕
  4: 'like',    // 点赞
  5: 'gift',    // 礼物
  6: 'share',   // 分享
};

class BarrageClient {
  constructor() {
    this.ws = null;
    this._handlers = {};
    this._reconnectTimer = null;
    this._intentionalClose = false;
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return this;
  }

  _emit(event, data) {
    (this._handlers[event] || []).forEach(fn => {
      try { fn(data); } catch (e) { /* ignore */ }
    });
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
    }
    this._intentionalClose = false;

    this.ws = new WebSocket('ws://127.0.0.1:8888');

    this.ws.on('open', () => {
      this._emit('connected');
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const typeStr = TYPE_MAP[msg.Type] || 'chat';
        const danmu = {
          type: typeStr,
          user: (msg.Data && msg.Data.User && msg.Data.User.NickName) || '',
          text: (msg.Data && msg.Data.Content) || '',
        };
        this._emit('danmu', danmu);
      } catch (e) {
        // 解析失败，忽略
      }
    });

    this.ws.on('close', () => {
      this._emit('disconnected');
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this._emit('error', err);
    });
  }

  disconnect() {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}

module.exports = { BarrageClient };
