'use strict';

let danmuCount = 0;

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatus(connected, error, step) {
  const dot = document.getElementById('statusDot');
  const stepEl = document.getElementById('connStep');
  if (step) {
    stepEl.textContent = step;
    dot.style.background = '#ffa502';
  } else if (connected) {
    stepEl.textContent = '';
    dot.style.background = '#2ed573';
  } else if (error) {
    stepEl.textContent = error;
    dot.style.background = '#ff4757';
  } else {
    stepEl.textContent = '';
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

async function setZoom(val) {
  document.getElementById('zoomVal').textContent = val + '%';
  await window.electronAPI.setZoom(val / 100);
}

async function connectRoom() {
  const url = document.getElementById('roomUrl').value.trim();
  if (!url) return;
  const btn = document.getElementById('btnConnect');
  btn.disabled = true;
  btn.textContent = '连接中...';
  setStatus(false, null, '准备中...');

  const r = await window.electronAPI.connect(url);
  if (r.success) {
    btn.textContent = '已连接';
    setStatus(true, null);
  } else {
    btn.disabled = false;
    btn.textContent = '失败重试';
    setStatus(false, r.error || '连接失败', null);
  }
}

window.electronAPI.onDanmu(addDanmu);
window.electronAPI.onStatus(data => {
  if (data.step) {
    setStatus(false, null, data.step);
  } else {
    setStatus(data.connected, data.error, null);
  }
});

setOpacity(80);
