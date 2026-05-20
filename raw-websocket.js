// 手写 WebSocket 客户端（原生 tls），替代 ws 库
// 解决 ws 库连接抖音 WSS 秒断的问题

const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');
const zlib = require('zlib');

class RawWebSocket {
  constructor(wssUrl, options = {}) {
    this.url = new URL(wssUrl);
    this.headers = options.headers || {};
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.onError = null;
    this._socket = null;
    this._buffer = Buffer.alloc(0);
    this._closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const host = this.url.hostname;
      const port = parseInt(this.url.port) || 443;
      const path = this.url.pathname + this.url.search;

      // 生成 WebSocket key
      const key = crypto.randomBytes(16).toString('base64');

      const socket = tls.connect({
        host,
        port,
        servername: host, // SNI
        rejectUnauthorized: false,
      }, () => {
        // 发送 HTTP Upgrade 请求
        const headers = [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          `Upgrade: websocket`,
          `Connection: Upgrade`,
          `Sec-WebSocket-Key: ${key}`,
          `Sec-WebSocket-Version: 13`,
        ];

        // 添加用户自定义头（cookie, user-agent 等）
        if (this.headers['cookie']) {
          headers.push(`Cookie: ${this.headers['cookie']}`);
        }
        if (this.headers['user-agent']) {
          headers.push(`User-Agent: ${this.headers['user-agent']}`);
        }
        if (this.headers['origin']) {
          headers.push(`Origin: ${this.headers['origin']}`);
        }

        headers.push('', ''); // 结束空行
        socket.write(headers.join('\r\n'));
      });

      let handshakeDone = false;

      socket.on('data', (data) => {
        if (!handshakeDone) {
          // 解析 HTTP 响应
          const response = data.toString();
          const statusMatch = response.match(/HTTP\/\d\.\d (\d+)/);
          const status = statusMatch ? parseInt(statusMatch[1]) : 0;

          if (status === 101) {
            // 检查 Sec-WebSocket-Accept
            const acceptMatch = response.match(/Sec-WebSocket-Accept: (.+)/i);
            if (!acceptMatch) {
              reject(new Error('No Sec-WebSocket-Accept header'));
              return;
            }

            const expectedAccept = crypto
              .createHash('sha1')
              .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
              .digest('base64');

            if (acceptMatch[1].trim() !== expectedAccept) {
              reject(new Error('Sec-WebSocket-Accept mismatch'));
              return;
            }

            handshakeDone = true;
            this._socket = socket;

            if (this.onOpen) this.onOpen();
            resolve();

            // 处理握手响应后可能跟着的 WebSocket 帧
            const headerEnd = response.indexOf('\r\n\r\n');
            if (headerEnd !== -1 && data.length > headerEnd + 4) {
              const remaining = data.slice(headerEnd + 4);
              if (remaining.length > 0) {
                this._processData(remaining);
              }
            }
          } else if (status >= 300 || status === 0) {
            reject(new Error(`WebSocket upgrade failed: HTTP ${status}, response: ${response.substring(0, 200)}`));
          }
          // 如果是 1xx 但不是 101，继续等待
        } else {
          this._processData(data);
        }
      });

      socket.on('error', (err) => {
        if (!handshakeDone) {
          reject(err);
        } else {
          if (this.onError) this.onError(err);
        }
      });

      socket.on('close', () => {
        this._closed = true;
        if (this.onClose) this.onClose();
      });
    });
  }

  // 发送二进制数据（自动打包为 WebSocket 帧）
  send(data) {
    if (!this._socket || this._closed) return;

    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // 打包 WebSocket 帧
    let frame;
    const maskKey = crypto.randomBytes(4); // 客户端必须 mask

    if (payload.length < 126) {
      frame = Buffer.alloc(2 + 4 + payload.length);
      frame[0] = 0x82; // FIN + Binary
      frame[1] = 0x80 | payload.length; // MASK + length
      maskKey.copy(frame, 2);
      for (let i = 0; i < payload.length; i++) {
        frame[6 + i] = payload[i] ^ maskKey[i % 4];
      }
    } else if (payload.length < 65536) {
      frame = Buffer.alloc(4 + 4 + payload.length);
      frame[0] = 0x82;
      frame[1] = 0x80 | 126; // MASK + 126 (extended)
      frame.writeUInt16BE(payload.length, 2);
      maskKey.copy(frame, 4);
      for (let i = 0; i < payload.length; i++) {
        frame[8 + i] = payload[i] ^ maskKey[i % 4];
      }
    } else {
      frame = Buffer.alloc(10 + 4 + payload.length);
      frame[0] = 0x82;
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(payload.length), 2);
      maskKey.copy(frame, 10);
      for (let i = 0; i < payload.length; i++) {
        frame[14 + i] = payload[i] ^ maskKey[i % 4];
      }
    }

    this._socket.write(frame);
  }

  _processData(data) {
    this._buffer = Buffer.concat([this._buffer, data]);
    this._tryParseFrame();
  }

  _tryParseFrame() {
    while (this._buffer.length >= 2) {
      const opcode = this._buffer[0] & 0x0f;
      const masked = (this._buffer[1] & 0x80) !== 0;
      let payloadLen = this._buffer[1] & 0x7f;
      let headerLen = 2;

      if (payloadLen === 126) {
        if (this._buffer.length < 4) return;
        payloadLen = this._buffer.readUInt16BE(2);
        headerLen = 4;
      } else if (payloadLen === 127) {
        if (this._buffer.length < 10) return;
        payloadLen = Number(this._buffer.readBigUInt64BE(2));
        headerLen = 10;
      }

      // 服务端不 mask（但检查一下）
      if (masked) headerLen += 4;

      const totalLen = headerLen + payloadLen;
      if (this._buffer.length < totalLen) return;

      const payload = this._buffer.slice(headerLen, totalLen);

      // 处理不同类型的帧
      if (opcode === 0x02) {
        // 二进制帧
        if (this.onMessage) this.onMessage(payload);
      } else if (opcode === 0x08) {
        // Close 帧
        this._closed = true;
        if (this.onClose) this.onClose();
        return;
      } else if (opcode === 0x09) {
        // Ping → Pong
        const pongFrame = Buffer.alloc(2 + payload.length);
        pongFrame[0] = 0x8a; // FIN + Pong
        pongFrame[1] = payload.length;
        payload.copy(pongFrame, 2);
        if (this._socket) this._socket.write(pongFrame);
      }
      // Pong (0x0a) 忽略

      this._buffer = this._buffer.slice(totalLen);
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;

    // 发送 Close 帧
    if (this._socket) {
      try {
        const closeFrame = Buffer.from([0x88, 0x00]); // FIN + Close
        this._socket.write(closeFrame);
        this._socket.end();
      } catch (e) {}
    }
  }
}

module.exports = { RawWebSocket };
