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
    height: Math.round(height * 0.6),
    transparent: true,           // 窗口透明
    frame: false,                 // 无边框
    resizable: false,             // 固定大小
    alwaysOnTop: true,            // 始终在最前
    skipTaskbar: true,            // 不显示在任务栏
    hasShadow: false,             // 无阴影
    backgroundColor: '#00000000', // 完全透明背景
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
      mainWindow.webContents.send('status', { connected: true, error: null });
    }
  });

  douyinCore.on('disconnected', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: '连接断开' });
    }
  });

  douyinCore.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status', { connected: false, error: err.message });
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

  // 设置窗口透明度 (0.1 ~ 1.0)
  ipcMain.handle('set-opacity', (event, opacity) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(Math.max(0.1, Math.min(1.0, opacity)));
    }
    return { success: true };
  });

  // 获取当前透明度
  ipcMain.handle('get-opacity', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return { opacity: mainWindow.getOpacity() };
    }
    return { opacity: 1.0 };
  });

  // 关闭窗口
  ipcMain.handle('close-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  // 移动窗口（拖拽区域）
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
