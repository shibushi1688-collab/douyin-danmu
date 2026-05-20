'use strict';

let danmuCount = 0;
let currentFontSize = 13;
let isConnected = false;

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
  const empty = list.querySelector('.empty-tip');
  if (empty) empty.remove();

  const typeClass = danmu.type || 'chat';

  const item = document.createElement('div');
  item.className = 'danmu-item ' + typeClass;
  item.style.fontSize = currentFontSize + 'px';

  const icons = { gift:'🎁', social:'✅', like:'❤️', member:'🚪', share:'🔗', chat:'' };
  const icon = icons[typeClass] || '';

  item.innerHTML =
    '<span class="danmu-user ' + typeClass + '">' + escHtml(danmu.user || '') + '</span>' +
    '<span class="danmu-text">' + (icon ? icon + ' ' : '') + escHtml(danmu.text || '') + '</span>';

  list.appendChild(item);
  list.scrollTop = list.scrollHeight;

  danmuCount++;
  document.title = danmuCount > 0 ? '弹幕 ' + danmuCount : '抖音弹幕';

  while (list.children.length > 500) {
    list.removeChild(list.firstChild);
  }
}

function clearDanmu() {
  const list = document.getElementById('danmuList');
  list.innerHTML = '<div class="empty-tip">等待弹幕...</div>';
  danmuCount = 0;
  document.title = '抖音弹幕';
}

function setBgAlpha(val) {
  document.getElementById('bgVal').textContent = val + '%';
  document.body.style.setProperty('--bg-alpha', val / 100);
}

function setFontSize(size) {
  currentFontSize = parseInt(size);
  document.getElementById('fontVal').textContent = size;
  document.querySelectorAll('.danmu-item').forEach(el => el.style.fontSize = size + 'px');
}

async function toggleConnect() {
  const btn = document.getElementById('btnConnect');

  if (isConnected) {
    // 断开
    await window.electronAPI.disconnect();
    clearDanmu();
    isConnected = false;
    btn.textContent = '连接';
    btn.className = 'btn';
    setStatus(false, null, null);
  } else {
    // 连接
    const url = document.getElementById('roomUrl').value.trim();
    if (!url) return;
    btn.disabled = true;
    btn.textContent = '连接中...';
    setStatus(false, null, '连接中...');

    const r = await window.electronAPI.connect(url);
    if (r.success) {
      btn.disabled = false;
      btn.textContent = '断开';
      btn.className = 'btn disconnect';
      isConnected = true;
      setStatus(true, null);
    } else {
      btn.disabled = false;
      btn.textContent = '失败重试';
      setStatus(false, r.error || '连接失败', null);
    }
  }
}

window.electronAPI.onDanmu((data) => {
  addDanmu(data);
});
window.electronAPI.onStatus(data => {
  if (data.step) {
    setStatus(false, null, data.step);
  } else {
    // 如果是断开事件，重置状态
    if (!data.connected && !data.step) {
      isConnected = false;
      const btn = document.getElementById('btnConnect');
      btn.textContent = '连接';
      btn.className = 'btn';
    }
    setStatus(data.connected, data.error, null);
  }
});

setBgAlpha(50);
setFontSize(13);
