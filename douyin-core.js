'use strict';

const axios = require('axios');
const WebSocket = require('ws');
const zlib = require('zlib');
const protobuf = require('protobufjs');

// ============================================================
// 签名 API
// ============================================================
const SIGN_API_DOMAIN = 'https://api.aiobs.cn';
const SIGN_API_KEY = 'test-apikey-de9991ea-bf2b-454c-7982-adddfe0581ac-96c0642e-7d1d-87a7-08b2-eff81edae4d3';
const SIGN_API_URL = '/Douyin/Douyin/SignWss';

// ============================================================
// Protobuf 初始化（弹幕消息解析）
// ============================================================
let protoRoot = null;
let ChatMessageProto = null;
let MemberMessageProto = null;
let GiftMessageProto = null;
let LikeMessageProto = null;
let SocialMessageProto = null;
let RoomProxyMessageProto = null;

async function initProtobuf() {
  if (protoRoot) return;

  const schema = `
syntax = "proto3";
message User {
  int64 id = 1;
  int64 short_id = 2;
  string nickname = 3;
  string display_id = 4;
  string avatar_url = 5;
  string sec_uid = 6;
}
message ChatMessage {
  int64 room_id = 1;
  User user = 2;
  string content = 3;
  int64 like_count = 4;
  int32 member_type = 5;
  string ip = 6;
  int64 timestamp = 7;
  int32 display_type = 8;
  string content_source = 9;
  int32 vision = 10;
}
message MemberMessage {
  int64 room_id = 1;
  User user = 2;
  int32 member_type = 3;
  int64 timestamp = 4;
  int64 enter_count = 5;
}
message GiftMessage {
  int64 room_id = 1;
  User user = 2;
  int32 gift_id = 3;
  int32 gift_count = 4;
  int64 timestamp = 5;
  string gift_name = 6;
}
message LikeMessage {
  int64 room_id = 1;
  User user = 2;
  int32 like_count = 3;
  int64 timestamp = 4;
}
message SocialMessage {
  int64 room_id = 1;
  User user = 2;
  int32 action = 3;
  int64 timestamp = 4;
}
message WebcastRoomProxyMessage {
  int64 room_id = 1;
  bytes messages_list = 3;
  int64 cursor = 4;
  string internal_ext = 6;
  string error_reason = 8;
}
`;

  protoRoot = protobuf.parse(schema).root;
  ChatMessageProto = protoRoot.lookupType('ChatMessage');
  MemberMessageProto = protoRoot.lookupType('MemberMessage');
  GiftMessageProto = protoRoot.lookupType('GiftMessage');
  RoomProxyMessageProto = protoRoot.lookupType('WebcastRoomProxyMessage');
}

// ============================================================
// 工具函数
// ============================================================

function decodeVarint(buffer, offset) {
  let result = 0, shift = 0;
  let pos = offset;
  while (pos < buffer.length) {
    const b = buffer[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value: result, offset: pos };
}

function decodeMessageRaw(buffer) {
  const result = {};
  let pos = 0;
  while (pos < buffer.length) {
    const b = buffer[pos++];
    const fieldNum = b >> 3, wireType = b & 0x07;
    if (wireType === 0) {
      const { value, offset: next } = decodeVarint(buffer, pos);
      pos = next; result[fieldNum] = value;
    } else if (wireType === 2) {
      const { value, offset: next } = decodeVarint(buffer, pos);
      pos = next; result[fieldNum] = buffer.slice(pos, pos + value); pos += value;
    } else if (wireType === 1) {
      result[fieldNum] = buffer.slice(pos, pos + 8); pos += 8;
    } else if (wireType === 5) {
      result[fieldNum] = buffer.slice(pos, pos + 4); pos += 4;
    } else break;
  }
  return result;
}

// 解压 PushFrame field 8 (gzip)
function decompressPushFrame(buffer) {
  const fields = decodeMessageRaw(buffer);
  if (!fields[8] || !Buffer.isBuffer(fields[8])) return null;
  try { return zlib.gunzipSync(fields[8]); } catch { return null; }
}

// 构造 ack PushFrame（Protobuf binary）
function buildAckPushFrame(logId, internalExt) {
  const parts = [];
  // field 1: logId (varint)
  let v = Number(logId);
  const logIdBytes = [];
  while (v > 0x7f) { logIdBytes.push((v & 0xff) | 0x80); v >>>= 7; }
  logIdBytes.push(v);
  parts.push(Buffer.from([(1 << 3) | 0, ...logIdBytes]));
  // field 2: "ack" (length-delimited string)
  const ackStr = Buffer.from('ack', 'utf8');
  parts.push(Buffer.from([(2 << 3) | 2, ackStr.length, ...ackStr]));
  // field 4: internalExt (length-delimited bytes)
  const extBytes = Buffer.from(String(internalExt || ''), 'utf8');
  const extLenBytes = [];
  let lv = extBytes.length;
  while (lv > 0x7f) { extLenBytes.push((lv & 0xff) | 0x80); lv >>>= 7; }
  extLenBytes.push(lv);
  parts.push(Buffer.from([(4 << 3) | 2, ...extLenBytes, ...extBytes]));
  return Buffer.concat(parts);
}

// 解析 messagesList：交替的 (methodName, messageBytes) 对
function parseMessagesList(msgsBuf) {
  const results = [];
  let pos = 0;
  let pendingMethod = '';
  while (pos < msgsBuf.length) {
    const keyByte = msgsBuf[pos++];
    const fieldNum = keyByte >> 3;
    const wireType = keyByte & 0x07;
    if (wireType === 2) {
      const { value, offset: next } = decodeVarint(msgsBuf, pos);
      pos = next;
      if (value <= 0 || pos + value > msgsBuf.length) break;
      const bytes = msgsBuf.slice(pos, pos + value);
      pos += value;
      if (fieldNum === 1) {
        pendingMethod = bytes.toString('utf8');
      } else if (fieldNum === 2 && pendingMethod) {
        results.push({ method: pendingMethod, payload: bytes });
        pendingMethod = '';
      }
    } else {
      if (wireType === 0) { const { offset: next } = decodeVarint(msgsBuf, pos); pos = next; }
      else if (wireType === 2) { const { value, offset: next } = decodeVarint(msgsBuf, pos); pos = next + value; }
      else if (wireType === 1) pos += 8;
      else if (wireType === 5) pos += 4;
      else break;
    }
  }
  return results;
}

// 解析弹幕消息 payload
function decodePayload(method, payloadBytes) {
  if (!payloadBytes || !Buffer.isBuffer(payloadBytes) || payloadBytes.length === 0) return null;

  try {
    if (method === 'WebcastChatMessage') {
      const decoded = ChatMessageProto.decode(payloadBytes);
      const user = decoded.user || {};
      return {
        type: 'chat',
        text: decoded.content || '',
        user: user.nickname || '观众',
        userId: user.id ? user.id.toString() : '',
      };
    } else if (method === 'WebcastMemberMessage') {
      const decoded = MemberMessageProto.decode(payloadBytes);
      const user = decoded.user || {};
      return {
        type: 'member',
        text: '进入了直播间',
        user: user.nickname || '观众',
        userId: user.id ? user.id.toString() : '',
      };
    } else if (method === 'WebcastGiftMessage') {
      const decoded = GiftMessageProto.decode(payloadBytes);
      const user = decoded.user || {};
      return {
        type: 'gift',
        text: `🎁 礼物 #${decoded.giftId || 0} x${decoded.giftCount || 1}`,
        user: user.nickname || '',
        userId: user.id ? user.id.toString() : '',
      };
    } else if (method === 'WebcastLikeMessage') {
      return { type: 'like', text: '❤️ 点赞', user: '', userId: '' };
    }
  } catch (e) {
    // 解析失败，忽略
  }
  return null;
}

// ============================================================
// DouyinCore 主类
// ============================================================

class DouyinCore extends require('events').EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.roomId = null;
    this.connected = false;
    this.ttwid = '';
    this.wssUrl = '';
    this.pingInterval = null;
  }

  // 从链接或纯ID中提取房间号
  _parseRoomId(input) {
    input = input.trim();
    // 纯数字直接返回
    if (/^\d+$/.test(input)) return input;
    // 从 URL 中提取 roomId
    const m = input.match(/live\.douyin\.com\/(\d+)/);
    if (m) return m[1];
    return null;
  }

  async start(roomId) {
    try {
      const parsed = this._parseRoomId(roomId);
      if (!parsed) throw new Error('无效的房间号或链接');
      this.roomId = parsed;
      await this._getTtwid();
      await this._getSign();
      await this._connect();
      return { success: true };
    } catch (e) {
      this.stop();
      return { success: false, error: e.message };
    }
  }

  stop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.emit('stopped');
  }

  // 从抖音直播间页面获取 ttwid cookie
  async _getTtwid() {
    this.emit('status', { step: '获取ttwid' });
    try {
      const resp = await axios.get(`https://live.douyin.com/${this.roomId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': 'https://www.douyin.com/',
        },
        timeout: 10000,
      });
      const cookies = resp.headers['set-cookie'] || [];
      for (const c of cookies) {
        if (c.startsWith('ttwid=')) {
          this.ttwid = c.split(';')[0]; // e.g. "ttwid=1%7C..."
          return;
        }
      }
      this.ttwid = '';
    } catch (e) {
      this.ttwid = '';
    }
  }

  // 从签名 API 获取 WSS 地址
  async _getSign() {
    this.emit('status', { step: '获取连接' });
    try {
      const resp = await axios.post(`${SIGN_API_DOMAIN}${SIGN_API_URL}`, {
        ApiKey: SIGN_API_KEY,
        BrowserName: 'Mozilla',
        BrowserVersion: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        RoomId: this.roomId,
        UserUniqueId: this.roomId,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      const data = resp.data;
      if (data.Code !== 0 || !data.Data?.WssUrl) {
        throw new Error(data.Msg || '签名失败');
      }
      this.wssUrl = data.Data.WssUrl;
    } catch (e) {
      throw new Error('获取连接失败: ' + e.message);
    }
  }

  // 建立 WebSocket 连接
  async _connect() {
    if (!this.wssUrl) throw new Error('无 WSS 地址');

    await initProtobuf();

    // 注意：this.ttwid 已经是完整的 "ttwid=..." 字符串
    this.ws = new WebSocket(this.wssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://live.douyin.com',
        'Cookie': this.ttwid,
      },
    });

    this.ws.on('open', () => {
      this.connected = true;
      this.emit('connected');
      // 发送初始 ping（4字节）
      this._sendPing();
      // 定期 ping（30秒）
      this.pingInterval = setInterval(() => this._sendPing(), 30000);
    });

    this.ws.on('message', (data) => this._handleMessage(data));

    this.ws.on('close', () => {
      this.connected = false;
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.emit('disconnected');
    });

    this.ws.on('error', (e) => {
      this.emit('error', e);
    });
  }

  _sendPing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // 抖音 WebSocket ping 格式: 3a 02 68 62
    this.ws.send(Buffer.from([0x3a, 0x02, 0x68, 0x62]));
  }

  _handleMessage(buffer) {
    try {
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const decompressed = decompressPushFrame(buf);
      if (!decompressed) return;

      // 确保 protobuf 已初始化
      if (!RoomProxyMessageProto) return;

      // decompressed = WebcastRoomProxyMessage (protobuf binary)
      let roomProxyMsg;
      try {
        roomProxyMsg = RoomProxyMessageProto.decode(decompressed);
      } catch(e) {
        return; // 不是有效的 RoomProxyMessage，忽略
      }

      const msgsBuf = roomProxyMsg.messagesList;
      const internalExt = roomProxyMsg.internalExt || '';
      const cursor = roomProxyMsg.cursor;

      // 回复 ack
      if (cursor) {
        const ack = buildAckPushFrame(cursor, internalExt);
        this.ws.send(ack);
      }

      if (!msgsBuf || !Buffer.isBuffer(msgsBuf)) return;

      // 解析消息列表
      const messages = parseMessagesList(msgsBuf);
      for (const { method, payload } of messages) {
        const danmu = decodePayload(method, payload);
        if (danmu) {
          this.emit('danmu', danmu);
        }
      }
    } catch (e) {
      // 忽略解析错误，避免中断连接
    }
  }
}

module.exports = { DouyinCore };

// ============================================================
// 独立测试
// ============================================================
async function testDanmu() {
  const { DouyinCore } = require('./douyin-core');
  const core = new DouyinCore();
  core.on('danmu', msg => console.log('★', JSON.stringify(msg)));
  core.on('connected', () => console.log('--- CONNECTED ---'));
  core.on('status', s => console.log('STATUS:', s.step));
  core.on('error', e => console.log('ERROR:', e.message));
  core.on('disconnected', () => console.log('DISCONNECTED'));
  const r = await core.start('74234820926');
  console.log('Start:', JSON.stringify(r));
  setTimeout(() => core.stop(), 60000);
}

testDanmu();
