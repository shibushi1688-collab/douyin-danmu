// 抖音弹幕核心：手写 WebSocket（原生 tls）+ protobufjs 正确解析
'use strict';

const axios = require('axios');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');
const { RawWebSocket } = require('./raw-websocket');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SIGN_API = 'https://api.aiobs.cn/Douyin/Douyin/SignWss';
const SIGN_API_KEY = 'test-apikey-de9991ea-bf2b-454c-7982-adddfe0581ac-96c0642e-7d1d-87a7-08b2-eff81edae4d3';

let _logFn = () => {};
let _protoRoot = null; // 缓存的 proto root

function dlog(...args) {
  const msg = '[DouyinCore] ' + args.join(' ');
  console.log(msg);
  _logFn(msg);
}

function randomStr(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=_';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function extractLiveId(input) {
  const match = input.match(/live\.douyin\.com\/(\d+)/);
  return match ? match[1] : input.replace(/\D/g, '');
}

async function loadProto() {
  if (_protoRoot) return _protoRoot;
  const protoPath = path.join(__dirname, 'douyin.proto');
  _protoRoot = await protobuf.load(protoPath);
  dlog('Proto 文件加载完成');
  return _protoRoot;
}

class DouyinCore {
  constructor() {
    this._handlers = {};
    this._ws = null;
    this._heartbeatTimer = null;
    this._liveId = '';
  }

  setLog(fn) { _logFn = fn; }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  }

  _emit(event, data) {
    (this._handlers[event] || []).forEach(fn => { try { fn(data); } catch (e) {} });
  }

  async start(liveUrl) {
    this._liveId = extractLiveId(liveUrl);
    if (!this._liveId) throw new Error('无法识别直播间ID');

    await loadProto();

    this._emit('status', '获取ttwid...');
    const ttwid = await this._getTtwid();

    this._emit('status', '获取房间信息...');
    const { roomId, userUniqueId } = await this._getRoomInfo(ttwid);

    this._emit('status', '获取连接...');
    const wssUrl = await this._getWssUrl(roomId, userUniqueId);

    this._emit('status', '连接中...');
    await this._connectWss(wssUrl, ttwid);

    this._emit('status', '已连接');
  }

  async _getTtwid() {
    let retries = 0;
    while (retries < 6) {
      try {
        const resp = await axios.get(`https://live.douyin.com/${this._liveId}`, {
          headers: {
            'User-Agent': USER_AGENT,
            'Cookie': `__ac_nonce=0${randomStr(20)}`,
          },
          maxRedirects: 0,
          timeout: 10000,
          validateStatus: s => s < 400,
        });
        const cookies = resp.headers['set-cookie'] || [];
        for (const c of cookies) {
          const m = c.match(/ttwid=([^;]+)/);
          if (m) return m[1];
        }
        throw new Error('no ttwid');
      } catch (e) {
        retries++;
        if (retries >= 6) throw new Error('获取ttwid失败');
      }
    }
  }

  async _getRoomInfo(ttwid) {
    const resp = await axios.get(`https://live.douyin.com/${this._liveId}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': `ttwid=${ttwid}; msToken=${randomStr(107)}; __ac_nonce=0${randomStr(20)}`,
      },
      timeout: 10000,
    });
    const html = resp.data;
    let roomId = '', userUniqueId = '';
    const roomMatch = html.match(/roomId\\?":\\?"(\d+)/);
    if (roomMatch) roomId = roomMatch[1];
    const uidMatch = html.match(/user_unique_id\\?":\\?"(\d+)/);
    if (uidMatch) userUniqueId = uidMatch[1];
    if (!roomId) throw new Error('未找到roomId');
    return { roomId, userUniqueId: userUniqueId || '' };
  }

  async _getWssUrl(roomId, userUniqueId) {
    const resp = await axios.post(SIGN_API, {
      ApiKey: SIGN_API_KEY,
      BrowserName: 'Mozilla',
      BrowserVersion: USER_AGENT,
      RoomId: roomId,
      UserUniqueId: userUniqueId,
    }, {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      timeout: 15000,
    });
    if (resp.data.Code !== 0) {
      throw new Error(resp.data.Msg || '签名失败');
    }
    return resp.data.Data.WssUrl;
  }

  async _connectWss(wssUrl, ttwid) {
    this._ws = new RawWebSocket(wssUrl, {
      headers: {
        'cookie': `ttwid=${ttwid}`,
        'user-agent': USER_AGENT,
      }
    });

    this._ws.onOpen = () => {
      this._ws.send(Buffer.from([0x3a, 0x02, 0x68, 0x62]));
      this._heartbeatTimer = setInterval(() => {
        try { this._ws.send(Buffer.from([0x3a, 0x02, 0x68, 0x62])); } catch (e) {}
      }, 10000);
      this._emit('connected');
    };

    this._ws.onMessage = (data) => {
      this._handleMessage(data);
    };

    this._ws.onClose = () => {
      clearInterval(this._heartbeatTimer);
      this._emit('disconnected');
    };

    this._ws.onError = (err) => {
      this._emit('error', err);
    };

    await this._ws.connect();
  }

  _handleMessage(data) {
    try {
      const root = _protoRoot;
      if (!root) return;

      const PushFrame = root.lookupType('PushFrame');
      const Response = root.lookupType('Response');

      const frame = PushFrame.decode(Buffer.from(data));
      const response = Response.decode(zlib.gunzipSync(frame.payload));

      if (response.messagesList) {
        for (const msg of response.messagesList) {
          this._dispatch(msg.method, msg.payload);
        }
      }
    } catch (e) {
      // 解析失败，可能是心跳或其他非标准消息
    }
  }

  _dispatch(method, payload) {
    try {
      const root = _protoRoot;
      if (!root) return;

      let nickName = '';
      let content = '';
      let type = 'chat';

      switch (method) {
        case 'WebcastChatMessage': {
          const ChatMessage = root.lookupType('ChatMessage');
          const msg = ChatMessage.decode(payload);
          nickName = (msg.user && msg.user.nickName) || '';
          dlog('ChatMessage user:', JSON.stringify({ nickName, displayId: msg.user && msg.user.displayId }));
          content = msg.content || '';
          type = 'chat';
          break;
        }
        case 'WebcastMemberMessage': {
          const MemberMessage = root.lookupType('MemberMessage');
          const msg = MemberMessage.decode(payload);
          nickName = (msg.user && msg.user.nickName) || '';
          content = nickName ? nickName + ' 来了' : '有人来了';
          type = 'member';
          break;
        }
        case 'WebcastGiftMessage': {
          const GiftMessage = root.lookupType('GiftMessage');
          const msg = GiftMessage.decode(payload);
          nickName = (msg.user && msg.user.nickName) || '';
          const giftName = (msg.gift && msg.gift.name) || '礼物';
          content = nickName + ' 送出 ' + giftName + ' x' + (msg.repeatCount || 1);
          type = 'gift';
          break;
        }
        case 'WebcastLikeMessage': {
          const LikeMessage = root.lookupType('LikeMessage');
          const msg = LikeMessage.decode(payload);
          nickName = (msg.user && msg.user.nickName) || '';
          content = nickName + ' 点赞';
          type = 'like';
          break;
        }
        case 'WebcastSocialMessage': {
          const SocialMessage = root.lookupType('SocialMessage');
          const msg = SocialMessage.decode(payload);
          nickName = (msg.user && msg.user.nickName) || '';
          content = nickName + ' 关注了主播';
          type = 'social';
          break;
        }
        default:
          return;
      }

      if (content || nickName) {
        this._emit('danmu', { type, user: nickName, text: content });
      }
    } catch (e) {
      // 单个消息解析失败，忽略
    }
  }

  disconnect() {
    clearInterval(this._heartbeatTimer);
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }
}

module.exports = { DouyinCore };
