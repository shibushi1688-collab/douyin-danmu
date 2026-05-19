'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let douyinCore = null;

const LOG_FILE = path.join(app.getPath('userData'), 'app.log');

function log(...args) {
  const msg = '[' + new Date().toISOString() + '] ' + args.join(' ');
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n');
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.round(width * 0.4),
    height: Math.round(height * 0.65),
    minWidth: 300,
    minHeight: 200,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log('窗口已创建');
}

async function connectDanmu(liveId) {
  log('connectDanmu 开始, liveId:', liveId);

  if (douyinCore) {
    douyinCore.stop();
    douyinCore = null;
  }

  const { DouyinCore } = require('./douyin-core');
  douyinCore = new DouyinCore();

  douyinCore.on('danmu', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('danmu', msg);
    }
  });

  douyinCore.on('connected', () => {
    log('connected 事件触发');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: true, error: null, step: null });
    }
  });

  douyinCore.on('disconnected', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: '连接断开', step: null });
    }
  });

  douyinCore.on('error', (err) => {
    log('douyinCore error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: err.message, step: null });
    }
  });

  douyinCore.on('status', (data) => {
    log('douyinCore status:', data.step);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: null, step: data.step });
    }
  });

  log('调用 douyinCore.start()');
  const result = await Promise.race([
    douyinCore.start(liveId),
    new Promise(resolve => setTimeout(() => resolve({ success: false, error: '连接超时（20秒）' }), 20000)),
  ]);
  log('douyinCore.start() 返回:', JSON.stringify(result));
  return result;
}

function disconnectDanmu() {
  if (douyinCore) {
    douyinCore.stop();
    douyinCore = null;
  }
}

function setupIpc() {
  ipcMain.handle('connect', async (event, liveId) => {
    log('IPC connect 请求:', liveId);
    try {
      const r = await connectDanmu(liveId);
      log('IPC connect 返回:', JSON.stringify(r));
      return r;
    } catch(e) {
      log('IPC connect 异常:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('disconnect', () => {
    disconnectDanmu();
    return { success: true };
  });

  ipcMain.handle('set-opacity', (event, opacity) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(Math.max(0.1, Math.min(1.0, opacity)));
    }
    return { success: true };
  });

  ipcMain.handle('get-opacity', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return { opacity: mainWindow.getOpacity() };
    }
    return { opacity: 1.0 };
  });

  ipcMain.handle('set-zoom', (event, factor) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(Math.max(0.5, Math.min(1.0, factor)));
    }
    return { success: true };
  });

  ipcMain.handle('close-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.handle('move-window', (event, deltaX, deltaY) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const pos = mainWindow.getPosition();
      mainWindow.setPosition(pos[0] + deltaX, pos[1] + deltaY);
    }
  });
}

app.whenReady().then(() => {
  log('App ready');
  createWindow();
  setupIpc();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (douyinCore) douyinCore.stop();
});
