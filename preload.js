'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (liveId) => ipcRenderer.invoke('connect', liveId),
  disconnect: () => ipcRenderer.invoke('disconnect'),

  onDanmu: (callback) => {
    ipcRenderer.on('danmu', (event, data) => callback(data));
  },
  onStatus: (callback) => {
    ipcRenderer.on('status', (event, data) => callback(data));
  },

  // 窗口透明度
  setOpacity: (val) => ipcRenderer.invoke('set-opacity', val),
  getOpacity: () => ipcRenderer.invoke('get-opacity'),

  // 关闭窗口
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // 拖拽移动窗口
  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
});
