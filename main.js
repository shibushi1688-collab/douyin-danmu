'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { BarrageClient } = require('./barrage-client');

let mainWindow = null;
let barrageClient = null;

const LOG_FILE = path.join(app.getPath('userData'), 'app.log');

function log(...args) {
  const msg = '[' + new Date().toISOString() + '] ' + args.join(' ');
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, msg + '\n'); } catch (e) { /* ignore */ }
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

function connectDanmu() {
  log('connectDanmu 开始');

  if (barrageClient) {
    barrageClient.disconnect();
    barrageClient = null;
  }

  barrageClient = new BarrageClient();

  barrageClient.on('danmu', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('danmu', msg);
    }
  });

  barrageClient.on('connected', () => {
    log('已连接到 BarrageGrab');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: true, error: null, step: null });
    }
  });

  barrageClient.on('disconnected', () => {
    log('与 BarrageGrab 断开');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: '连接断开，3秒后自动重连...', step: null });
    }
  });

  barrageClient.on('error', (err) => {
    log('BarrageClient error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: '无法连接 BarrageGrab（127.0.0.1:8888），请确认 BarrageGrab.exe 已启动', step: null });
    }
  });

  barrageClient.connect();
  return { success: true };
}

function disconnectDanmu() {
  if (barrageClient) {
    barrageClient.disconnect();
    barrageClient = null;
  }
}

function setupIpc() {
  ipcMain.handle('connect', async () => {
    log('IPC connect 请求');
    try {
      return connectDanmu();
    } catch (e) {
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
  if (barrageClient) barrageClient.disconnect();
});
