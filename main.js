'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let douyinCore = null;

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
}

async function connectDanmu(liveId) {
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: err.message, step: null });
    }
  });

  douyinCore.on('status', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: null, step: data.step });
    }
  });

  return await douyinCore.start(liveId);
}

function disconnectDanmu() {
  if (douyinCore) {
    douyinCore.stop();
    douyinCore = null;
  }
}

function setupIpc() {
  ipcMain.handle('connect', async (event, liveId) => {
    return await connectDanmu(liveId);
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

  // 窗口缩放（页面内容缩放比例 0.5 ~ 1.0）
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
  createWindow();
  setupIpc();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (douyinCore) douyinCore.stop();
});
