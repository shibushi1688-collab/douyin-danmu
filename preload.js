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

  setOpacity: (val) => ipcRenderer.invoke('set-opacity', val),
  getOpacity: () => ipcRenderer.invoke('get-opacity'),

  setZoom: (factor) => ipcRenderer.invoke('set-zoom', factor),

  closeWindow: () => ipcRenderer.invoke('close-window'),

  moveWindow: (deltaX, deltaY) => ipcRenderer.invoke('move-window', deltaX, deltaY),
});
