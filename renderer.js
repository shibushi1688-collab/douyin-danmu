'use strict';

let danmuCount = 0;

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatus(connected, error) {
  const dot = document.getElementById('statusDot');
  if (connected) {
    dot.style.background = '#2ed573';
  } else if (error) {
    dot.style.background = '#ff4757';
  } else {
    dot.style.background = 'rgba(255,255,255,0.3)';
  }
}

function addDanmu(danmu) {
  const list = document.getElementById('danmuList');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  const typeClass = danmu.type || 'chat';
  item.className = 'danmu-item ' + typeClass;

  const icons = { gift:'🎁', social:'✅', like:'❤️', member:'🚪', share:'🔗', chat:'💬' };
  const icon = icons[typeClass] || '💬';

  item.innerHTML =
    `<span class="danmu-user">${icon} ${escHtml(danmu.user||'')}</span>` +
    `<span class="danmu-text">${escHtml(danmu.text||'')}</span>` +
    `<span class="danmu-time">${new Date().toLocaleTimeString().slice(0,5)}</span>`;

  list.insertBefore(item, list.firstChild);
  danmuCount++;
  document.title = danmuCount > 0 ? `弹幕 ${danmuCount}` : '抖音弹幕';

  while (list.children.length > 150) {
    list.removeChild(list.lastChild);
  }
}

function clearDanmu() {
  const list = document.getElementById('danmuList');
  list.innerHTML = '<div class="empty">等待弹幕...</div>';
  danmuCount = 0;
  document.title = '抖音弹幕';
}

function setFontSize(size) {
  document.getElementById('fontVal').textContent = size;
  document.querySelectorAll('.danmu-item').forEach(el => el.style.fontSize = size + 'px');
}

async function setOpacity(val) {
  document.getElementById('opacityVal').textContent = val + '%';
  await window.electronAPI.setOpacity(val / 100);
}

async function connectRoom() {
  const url = document.getElementById('roomUrl').value.trim();
  if (!url) return;
  const btn = document.getElementById('btnConnect');
  btn.disabled = true;
  btn.textContent = '...';
  setStatus(false, null);

  const r = await window.electronAPI.connect(url);
  if (r.success) {
    btn.textContent = '已连接';
    setStatus(true, null);
  } else {
    btn.disabled = false;
    btn.textContent = '失败重试';
    setStatus(false, r.error || '连接失败');
  }
}

// IPC 监听
window.electronAPI.onDanmu(addDanmu);
window.electronAPI.onStatus(data => setStatus(data.connected, data.error));

// 初始化透明度
setOpacity(80);
