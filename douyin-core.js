'use strict';

const axios = require('axios');
const WebSocket = require('ws');
const { inflateSync } = require('zlib');

// ============================================================
// 签名 API（BarrageGrab 同款）
// ============================================================
const SIGN_API_DOMAIN = 'https://api.aiobs.cn';
const SIGN_API_KEY = 'test-apikey-de9991ea-bf2b-454c-7982-adddfe0581ac-96c0642e-7d1d-87a7-08b2-eff81edae4d3';
const LIVE_URL = 'https://live.douyin.com';

// ============================================================
// 手动 Protobuf 解析
// ============================================================

function decodeVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const b = buffer[offset++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value: result, offset };
}

function decodeKey(buffer, offset) {
  const b = buffer[offset++];
  return { fieldNum: b >> 3, wireType: b & 0x07, offset };
}

function decodeMessage(buffer) {
  const result = {};
  let offset = 0;
  while (offset < buffer.length) {
    const key = decodeKey(buffer, offset);
    offset = key.offset;
    if (key.wireType === 0) {
      const { value, offset: next } = decodeVarint(buffer, offset);
      offset = next;
      result[key.fieldNum] = value;
    } else if (key.wireType === 2) {
      const { value, offset: next } = decodeVarint(buffer, offset);
      offset = next;
      result[key.fieldNum] = buffer.slice(offset, offset + value);
      offset += value;
    }
  }
  return result;
}

function parseUtf8(data) {
  if (!data || data.length === 0) return '';
  try {
    return data.toString('utf8');
  } catch {
    return '';
  }
}

function parseUser(data) {
  if (!data || data.length === 0) return null;
  const obj = decodeMessage(data);
  return {
    id: obj[1] ? obj[1].toString() : '',
    shortId: obj[2] ? obj[2].toString() : '',
    nickname: parseUtf8(obj[3]),
    displayId: obj[4] ? obj[4].toString() : '',
    secUid: parseUtf8(obj[6]),
  };
}

// ============================================================
// 核心类
// ============================================================

class DouyinCore {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.userUniqueId = null;
    this.wssUrl = null;
    this.ttwid = null;
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._listeners = {};
    this._maxReconnects = 3;
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  }

  _generateMsToken(len = 107) {
    const base = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=_';
    let result = '';
    for (let i = 0; i < len; i++) {
      result += base[Math.floor(Math.random() * base.length)];
    }
    return result;
  }

  _generateNonce(len = 21) {
    const base = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
      result += base[Math.floor(Math.random() * base.length)];
    }
    return result;
  }

  // 获取 ttwid
  async _getTtwid() {
    const nonce = this._generateNonce();
    try {
      const resp = await axios.get(`${LIVE_URL}/${this.roomId}`, {
        headers: {
          'User-Agent': this.headers['User-Agent'],
          'Cookie': `__ac_nonce=0${nonce}`,
        },
        timeout: 10000,
      });
      const cookies = resp.headers['set-cookie'] || [];
      for (const c of cookies) {
        const match = c.match(/ttwid=([^;]+)/);
        if (match) return match[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  // 获取 roomId 和 userUniqueId
  async _getRoomInfo() {
    if (!this.ttwid) throw new Error('缺少 ttwid');
    const nonce = this._generateNonce();
    const msToken = this._generateMsToken();
    try {
      const resp = await axios.get(`${LIVE_URL}/${this.roomId}`, {
        headers: {
          'User-Agent': this.headers['User-Agent'],
          'Cookie': `ttwid=${this.ttwid}; msToken=${msToken}; __ac_nonce=0${nonce}`,
        },
        timeout: 10000,
      });

      const html = resp.data;

      // 提取 user_unique_id
      const uidMatch = html.match(/user_unique_id\\?":\\?"(\d+)/);
      const userUniqueId = uidMatch ? uidMatch[1] : null;

      // 提取 roomId（短room id）
      const roomIdMatch = html.match(/roomId\\?":\\?"(\d+)/);
      const roomId = roomIdMatch ? roomIdMatch[1] : null;

      return { userUniqueId, roomId };
    } catch (e) {
      throw new Error('获取房间信息失败: ' + e.message);
    }
  }

  // 调用签名 API
  async _getSignedWss(roomId, userUniqueId) {
    const resp = await axios.post(`${SIGN_API_DOMAIN}/Douyin/Douyin/SignWss`, {
      ApiKey: SIGN_API_KEY,
      BrowserName: 'Mozilla',
      BrowserVersion: this.headers['User-Agent'],
      RoomId: roomId,
      UserUniqueId: userUniqueId || '',
    }, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Connection': 'keep-alive',
      },
      timeout: 15000,
    });
    if (resp.data.Code !== 0) {
      throw new Error(resp.data.Msg || '签名失败');
    }
    return resp.data.Data.WssUrl;
  }

  // 启动
  async start(liveId) {
    try {
      this.roomId = String(liveId).replace(/\/$/, '').split('/').pop();
      console.log(`[DouyinCore] 房间号: ${this.roomId}`);

      // 1. 获取 ttwid
      this._emit('status', { step: '获取ttwid...' });
      this.ttwid = await this._getTtwid();
      if (!this.ttwid) {
        throw new Error('获取 ttwid 失败，请刷新重试');
      }
      console.log(`[DouyinCore] ttwid: ${this.ttwid.substring(0, 8)}...`);

      // 2. 获取 roomId 和 userUniqueId
      this._emit('status', { step: '获取房间信息...' });
      const { userUniqueId, roomId } = await this._getRoomInfo();
      if (!userUniqueId) {
        throw new Error('获取 userUniqueId 失败');
      }
      this.userUniqueId = userUniqueId;
      const actualRoomId = roomId || this.roomId;
      console.log(`[DouyinCore] userUniqueId: ${userUniqueId}, roomId: ${actualRoomId}`);

      // 3. 获取签名 WSS
      this._emit('status', { step: '获取连接...' });
      this.wssUrl = await this._getSignedWss(actualRoomId, userUniqueId);
      console.log(`[DouyinCore] WSS: ${this.wssUrl.substring(0, 80)}...`);

      await this._connect();
      return { success: true };
    } catch (e) {
      console.error('[DouyinCore] 启动失败:', e.message);
      return { success: false, error: e.message };
    }
  }

  async _connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wssUrl, {
        headers: {
          'User-Agent': this.headers['User-Agent'],
          'Cookie': `ttwid=${this.ttwid}`,
        },
      });

      this.ws.on('open', () => {
        console.log('[DouyinCore] WebSocket 已连接');
        this._reconnectAttempts = 0;
        this._emit('connected', {});
        this._startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        this._handleMessage(Buffer.from(data));
      });

      this.ws.on('error', (err) => {
        console.error('[DouyinCore] WS 错误:', err.message);
        this._emit('error', { message: err.message });
        reject(err);
      });

      this.ws.on('close', () => {
        console.log('[DouyinCore] WS 断开');
        this._stopHeartbeat();
        this._emit('disconnected', {});
        this._scheduleReconnect();
      });
    });
  }

  _handleMessage(buffer) {
    try {
      let msgData = buffer;
      try {
        msgData = inflateSync(buffer);
      } catch {}

      const pushFrame = decodeMessage(msgData);
      const payload = pushFrame[3];
      if (!payload || payload.length === 0) return;

      let innerData = payload;
      try {
        innerData = inflateSync(payload);
      } catch {}

      const respFields = {};
      let respOffset = 0;
      while (respOffset < innerData.length) {
        const keyByte = innerData[respOffset++];
        const fieldNum = keyByte >> 3;
        const wireType = keyByte & 0x07;
        if (wireType === 0) {
          const { value, offset: next } = decodeVarint(innerData, respOffset);
          respOffset = next;
          respFields[fieldNum] = value;
        } else if (wireType === 2) {
          const { value, offset: next } = decodeVarint(innerData, respOffset);
          respOffset = next;
          respFields[fieldNum] = innerData.slice(respOffset, respOffset + value);
          respOffset += value;
        }
      }

      const messagesList = respFields[1];
      if (!messagesList) return;

      let listOffset = 0;
      while (listOffset < messagesList.length) {
        const { value, offset: next } = decodeVarint(messagesList, listOffset);
        listOffset = next;
        const msgBytes = messagesList.slice(listOffset, listOffset + value);
        listOffset += value;
        this._parseMessage(msgBytes);
      }
    } catch {}
  }

  _parseMessage(msgBytes) {
    const fields = decodeMessage(msgBytes);
    const method = fields[1] ? parseUtf8(fields[1]) : '';
    const payload = fields[2];
    if (!method || !payload || payload.length === 0) return;

    try {
      switch (method) {
        case 'WebcastChatMessage':    this._parseChatMessage(payload);    break;
        case 'WebcastMemberMessage':  this._parseMemberMessage(payload);  break;
        case 'WebcastGiftMessage':    this._parseGiftMessage(payload);    break;
        case 'WebcastLikeMessage':    this._parseLikeMessage(payload);    break;
        case 'WebcastSocialMessage':  this._parseSocialMessage(payload);   break;
        default: break;
      }
    } catch {}
  }

  _parseChatMessage(payload) {
    const obj = decodeMessage(payload);
    const user = parseUser(obj[2]);
    const content = parseUtf8(obj[3]);
    if (content) {
      this._emit('danmu', {
        type: 'chat',
        text: content,
        user: user?.nickname || user?.displayId || '观众',
        userId: user?.id || '',
      });
    }
  }

  _parseMemberMessage(payload) {
    const obj = decodeMessage(payload);
    const user = parseUser(obj[2]);
    this._emit('danmu', {
      type: 'member',
      text: '进入了直播间',
      user: user?.nickname || user?.displayId || '观众',
      userId: user?.id || '',
    });
  }

  _parseGiftMessage(payload) {
    const obj = decodeMessage(payload);
    const user = parseUser(obj[2]);
    const giftId = obj[3] || 0;
    const giftCount = obj[6] || 1;
    this._emit('danmu', {
      type: 'gift',
      text: `🎁 礼物 #${giftId} x${giftCount}`,
      user: user?.nickname || user?.displayId || '',
      userId: user?.id || '',
    });
  }

  _parseLikeMessage(payload) {
    this._emit('danmu', { type: 'like', text: '❤️ 点赞', user: '', userId: '' });
  }

  _parseSocialMessage(payload) {
    const obj = decodeMessage(payload);
    const user = parseUser(obj[2]);
    const action = obj[3] || 0;
    this._emit('danmu', {
      type: action === 3 ? 'share' : 'social',
      text: action === 3 ? '分享了直播间' : '关注了主播',
      user: user?.nickname || user?.displayId || '',
      userId: user?.id || '',
    });
  }

  _startHeartbeat() {
    const heartbeat = Buffer.from([0x3a, 0x02, 0x68, 0x62]);
    this._heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(heartbeat);
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnects) {
      this._emit('error', { message: '重试次数超限，请重新连接' });
      return;
    }
    if (this._reconnectTimer) return;
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this.roomId && this.wssUrl) {
        try {
          await this._connect();
        } catch (e) {
          this._emit('error', { message: '重连失败: ' + e.message });
        }
      }
    }, 3000);
  }

  stop() {
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.roomId = null;
    this.wssUrl = null;
    this.userUniqueId = null;
  }
}

module.exports = { DouyinCore };
