'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 连接直播间
  connect: (liveId) => ipcRenderer.invoke('connect', liveId),

  // 断开连接
  disconnect: () => ipcRenderer.invoke('disconnect'),

  // 监听弹幕
  onDanmu: (callback) => {
    ipcRenderer.on('danmu', (event, data) => callback(data));
  },

  // 监听连接状态
  onStatus: (callback) => {
    ipcRenderer.on('status', (event, data) => callback(data));
  },

  // 移除监听
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
