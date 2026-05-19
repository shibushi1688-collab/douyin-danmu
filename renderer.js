'use strict';

let danmuCount = 0;

function setStatus(connected, error) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (connected) {
    dot.className = 'status-dot active';
    label.textContent = '🟢 已连接';
  } else if (error) {
    dot.className = 'status-dot error';
    label.textContent = '🔴 ' + error;
  } else {
    dot.className = 'status-dot';
    label.textContent = '⚪ 未连接';
  }
}

function addDanmu(danmu) {
  const list = document.getElementById('danmuList');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  const typeClass = danmu.type || 'chat';
  item.className = 'danmu-item ' + typeClass;

  const typeIcons = { gift: '🎁', social: '✅', like: '❤️', member: '🚪', share: '🔗', chat: '💬' };
  const icon = typeIcons[typeClass] || '💬';

  item.innerHTML = `
    <span class="danmu-user">${icon} ${escHtml(danmu.user || '')}</span>
    <span class="danmu-text">${escHtml(danmu.text || '')}</span>
    <span class="danmu-time">${new Date().toLocaleTimeString()}</span>
  `;

  list.insertBefore(item, list.firstChild);
  danmuCount++;
  document.getElementById('danmuCount').textContent = danmuCount;

  while (list.children.length > 200) {
    list.removeChild(list.lastChild);
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clearDanmu() {
  const list = document.getElementById('danmuList');
  list.innerHTML = '<div class="empty">等待弹幕...</div>';
  danmuCount = 0;
  document.getElementById('danmuCount').textContent = '0';
}

function setDanmuFontSize(size) {
  const items = document.querySelectorAll('.danmu-item');
  items.forEach(item => item.style.fontSize = size + 'px');
}

function setDanmuOpacity(val) {
  document.getElementById('danmuList').style.opacity = val / 100;
}

async function connectRoom() {
  const url = document.getElementById('roomUrl').value.trim();
  if (!url) {
    alert('请输入直播间链接或房间号');
    return;
  }
  const btn = document.getElementById('btnConnect');
  btn.disabled = true;
  btn.textContent = '⏳ 连接中...';
  setStatus(false, '连接中...');

  const r = await window.electronAPI.connect(url);
  if (r.success) {
    btn.textContent = '🔌 已连接';
    btn.onclick = disconnectRoom;
    setStatus(true, null);
  } else {
    btn.disabled = false;
    btn.textContent = '❌ 连接失败';
    setStatus(false, r.error || '连接失败');
  }
}

async function disconnectRoom() {
  await window.electronAPI.disconnect();
  const btn = document.getElementById('btnConnect');
  btn.textContent = '📡 连接';
  btn.onclick = connectRoom;
  btn.disabled = false;
  setStatus(false, null);
  clearDanmu();
}

// 监听弹幕
window.electronAPI.onDanmu((danmu) => {
  addDanmu(danmu);
});

// 监听连接状态
window.electronAPI.onStatus((data) => {
  setStatus(data.connected, data.error);
  if (!data.connected && data.error === '已断开') {
    const btn = document.getElementById('btnConnect');
    btn.textContent = '📡 连接';
    btn.onclick = connectRoom;
    btn.disabled = false;
  }
});

// 页面加载完成
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnConnect');
  btn.onclick = connectRoom;
});
