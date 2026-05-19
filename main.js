'use strict';

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let douyinCore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 320,
    minHeight: 400,
    title: '抖音弹幕',
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { connected: false, error: '已断开' });
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
