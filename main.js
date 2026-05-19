const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { chromium } = require('playwright');

let mainWindow;
let browser;
let page;
let roomJoined = false;
let danmuCount = 0;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    x: width - 500,
    y: 50,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    resizable: true,
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 初始化浏览器
ipcMain.handle('init-browser', async () => {
  try {
    if (browser) await browser.close();
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
      viewport: { width: 400, height: 700 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page = await context.newPage();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 获取登录状态
ipcMain.handle('check-login', async () => {
  try {
    if (!page) return { success: false, error: 'no page' };
    const cookies = await page.context().cookies();
    const session = cookies.find(c => c.name === 'sessionid' || c.name === 'sid_guard');
    return { success: true, loggedIn: !!session };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 打开登录页
ipcMain.handle('open-login', async () => {
  try {
    if (!page) return { success: false, error: 'no page' };
    await page.goto('https://www.douyin.com/login/', { waitUntil: 'networkidle', timeout: 30000 });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 等待登录成功
ipcMain.handle('wait-login', async () => {
  try {
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const cookies = await page.context().cookies();
      const session = cookies.find(c => c.name === 'sessionid');
      if (session && session.value) {
        return { success: true, loggedIn: true };
      }
    }
    return { success: true, loggedIn: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 进入直播间
ipcMain.handle('join-room', async (event, roomUrl) => {
  try {
    if (!page) return { success: false, error: 'no page' };
    await page.goto(roomUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    roomJoined = true;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 注入弹幕拦截脚本
async function injectDanmuHook() {
  await page.evaluate(() => {
    // 防止重复注入
    if (window.__danmuHookInjected) return;
    window.__danmuHookInjected = true;
    window.__danmuCallbacks = [];

    // 保存原始 WebSocket
    const OrigWebSocket = window.WebSocket;

    // 替换 WebSocket 构造函数
    window.WebSocket = function(url, protocols) {
      // 只拦截抖音直播弹幕 WebSocket
      if (url.includes('webcast/im') || url.includes('wss://webcast3')) {
        console.log('[弹幕助手] 拦截到弹幕 WebSocket:', url.substring(0, 80));
        const ws = new OrigWebSocket(url, protocols);

        // 劫持 send 方法（用于发送心跳）
        const origSend = ws.send.bind(ws);
        ws.send = function(data) {
          // 如果是 ping 字符串，保持心跳
          if (data === 'ping' || data === 'PING') {
            // 抖音用的是字符串 "ping"
            origSend(data);
          } else {
            origSend(data);
          }
          return origSend(data);
        };

        // 劫持 message 事件
        ws.addEventListener('message', (event) => {
          try {
            const text = typeof event.data === 'string' 
              ? event.data 
              : new TextDecoder().decode(event.data);
            
            // 尝试解析 JSON
            let msgObj;
            try {
              msgObj = JSON.parse(text);
            } catch {
              // 二进制或其他格式，尝试 Protobuf 解析或跳过
              // console.log('[弹幕助手] 非JSON消息:', text.substring(0, 50));
              return;
            }

            // msgObj 结构: { type: number, method: number, data: Uint8Array }
            // method 2 = 弹幕, method 4 = 礼物, method 7 = 关注, method 5 = 点赞
            const method = msgObj.method || msgObj.type;
            
            if (method === 2 || method === 'chat') {
              // 解码 Protobuf 数据
              const chatData = decodeChatMsg(msgObj.data || msgObj.payload);
              if (chatData) {
                window.__danmuCallbacks.forEach(cb => cb({
                  type: 'chat',
                  text: chatData.content || chatData.text || JSON.stringify(chatData),
                  user: chatData.user?.nickname || chatData.user?.short_id || '观众',
                  userId: chatData.user?.unique_id || ''
                }));
              }
            } else if (method === 4 || method === 'gift') {
              const giftData = decodeChatMsg(msgObj.data || msgObj.payload);
              if (giftData) {
                window.__danmuCallbacks.forEach(cb => cb({
                  type: 'gift',
                  text: `🎁 ${giftData.gift?.name || '礼物'} x${giftData.gift?.count || 1}`,
                  user: giftData.user?.nickname || ''
                }));
              }
            } else if (method === 7 || method === 'social') {
              window.__danmuCallbacks.forEach(cb => cb({
                type: 'social',
                text: '✅ 关注',
                user: msgObj.msg?.user?.nickname || ''
              }));
            } else if (method === 5 || method === 'like') {
              window.__danmuCallbacks.forEach(cb => cb({
                type: 'like',
                text: '❤️ 点赞',
                user: ''
              }));
            }
          } catch (e) {
            // 忽略解析错误
          }
        });

        ws.addEventListener('open', () => {
          console.log('[弹幕助手] WebSocket 连接成功');
          // 立即发送一次心跳
          setTimeout(() => origSend('ping'), 1000);
          // 定期心跳
          window.__wsHeartbeat = setInterval(() => origSend('ping'), 25000);
        });

        ws.addEventListener('close', () => {
          console.log('[弹幕助手] WebSocket 断开');
          if (window.__wsHeartbeat) clearInterval(window.__wsHeartbeat);
        });

        return ws;
      }

      // 非弹幕 WebSocket，走原逻辑
      return new OrigWebSocket(url, protocols);
    };

    window.WebSocket.prototype = OrigWebSocket.prototype;

    // 解码抖音聊天消息（简化版 protobuf decode）
    function decodeChatMsg(data) {
      if (!data) return null;
      try {
        // 如果是 ArrayBuffer，转成字节数组
        let bytes = data;
        if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data);
        } else if (typeof data === 'string') {
          // 可能是 base64
          const binary = atob(data);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
        }

        // 简单 tag-length 解码（抖音使用修改过的 protobuf）
        // method=2, field 1=user, field 2=content
        const result = {};
        let i = 0;
        while (i < bytes.length) {
          const tag = bytes[i++] & 0xff;
          const wireType = tag & 0x07;
          const fieldNum = tag >> 3;
          
          if (i >= bytes.length) break;
          
          let len = 0;
          let shift = 0;
          do {
            len |= (bytes[i] & 0x7f) << shift;
            shift += 7;
            i++;
          } while (i < bytes.length && (bytes[i-1] & 0x80));
          
          if (i + len > bytes.length) break;
          
          const fieldData = bytes.slice(i, i + len);
          i += len;
          
          if (fieldNum === 1 && fieldData.length > 0) {
            // user 字段，解码用户信息
            result.user = decodeUser(fieldData);
          } else if (fieldNum === 2 && fieldData.length > 0) {
            // content 字段
            result.content = decodeString(fieldData);
          }
        }
        
        // 如果普通解码失败，尝试直接返回原始数据的文本描述
        if (!result.content && data && bytes.length > 0) {
          try {
            const str = new TextDecoder().decode(bytes);
            if (str) result.content = str.substring(0, 100);
          } catch(e) {}
        }
        
        return result;
      } catch (e) {
        return null;
      }
    }

    function decodeUser(bytes) {
      const user = {};
      let i = 0;
      while (i < bytes.length) {
        const tag = bytes[i++] & 0xff;
        const wireType = tag & 0x07;
        const fieldNum = tag >> 3;
        
        if (i >= bytes.length) break;
        let len = 0, shift = 0;
        do {
          len |= (bytes[i] & 0x7f) << shift;
          shift += 7;
          i++;
        } while (i < bytes.length && (bytes[i-1] & 0x80));
        if (i + len > bytes.length) break;
        
        const fieldData = bytes.slice(i, i + len);
        i += len;
        
        if (fieldNum === 1) user.id = decodeString(fieldData);
        else if (fieldNum === 2) user.short_id = decodeString(fieldData);
        else if (fieldNum === 3) user.nickname = decodeString(fieldData);
        else if (fieldNum === 4) user.unique_id = decodeString(fieldData);
      }
      return user;
    }

    function decodeString(bytes) {
      try {
        // tag-length 格式，先读长度
        if (bytes.length === 0) return '';
        let i = 0;
        let len = bytes[i++] & 0xff;
        if (i + len > bytes.length) return new TextDecoder().decode(bytes);
        return new TextDecoder().decode(bytes.slice(i, i + len));
      } catch(e) {
        try { return new TextDecoder().decode(bytes); } catch(e2) { return ''; }
      }
    }

    console.log('[弹幕助手] WebSocket 劫持脚本已注入');
  });
}

// 启动弹幕监听
ipcMain.handle('start-danmu-listener', async () => {
  try {
    if (!page || !roomJoined) return { success: false, error: 'not in room' };

    // 注入 WebSocket 劫持脚本
    await injectDanmuHook();

    // 注册回调，把弹幕发到渲染进程
    await page.exposeFunction('__danmuCallback', (danmu) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        danmu.count = ++danmuCount;
        mainWindow.webContents.send('danmu', danmu);
      }
    });

    // 通知注入的脚本注册回调
    await page.evaluate(() => {
      window.__danmuCallbacks.push((danmu) => {
        // 调用 Electron 暴露的函数
        window.__danmuCallback(danmu);
      });
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 停止弹幕监听
ipcMain.handle('stop-danmu-listener', async () => {
  try {
    roomJoined = false;
    await page.evaluate(() => {
      if (window.__wsHeartbeat) clearInterval(window.__wsHeartbeat);
      window.__danmuHookInjected = false;
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 关闭浏览器
ipcMain.handle('close-browser', async () => {
  try {
    if (browser) { await browser.close(); browser = null; }
    roomJoined = false;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 发送弹幕（测试用）
ipcMain.handle('send-test-danmu', async () => {
  try {
    const testDanmu = {
      type: 'chat',
      text: '这是一条测试弹幕 ' + new Date().toLocaleTimeString(),
      user: '测试用户',
      count: ++danmuCount
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('danmu', testDanmu);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
