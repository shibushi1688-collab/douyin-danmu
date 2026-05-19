'use strict';

let danmuCount = 0;
let currentFontSize = 15;
let currentSpeed = 7; // 3=慢 12=快

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

// 弹幕颜色
const DM_COLORS = {
  chat:   '#ffffff',
  member:  '#7ec8ff',
  gift:   '#ffd700',
  like:   '#ff6b81',
  social: '#7bed9f',
  share:  '#ffa502',
};

function addScrollingDanmu(danmu) {
  const track = document.getElementById('danmuTrack');
  const typeClass = danmu.type || 'chat';
  const icon = { gift:'🎁', social:'✅', like:'❤️', member:'🚪', share:'🔗', chat:'💬' }[typeClass] || '💬';
  const color = DM_COLORS[typeClass] || '#fff';

  const el = document.createElement('div');
  el.className = 'dm-msg ' + typeClass;
  el.style.fontSize = currentFontSize + 'px';
  el.style.color = color;

  // 随机纵向位置（留出底部历史区域）
  const stageHeight = track.offsetHeight || 400;
  const trackHeight = stageHeight - 130; // 底部留130px给历史记录
  const maxTop = Math.max(20, trackHeight - 30);
  const top = Math.random() * maxTop;
  el.style.top = top + 'px';

  el.innerHTML = `<span style="font-weight:700;color:${color}">${escHtml(danmu.user||'')}</span> ${escHtml(danmu.text||'')}`;

  track.appendChild(el);

  // 计算弹幕宽度并设置动画时长
  const textWidth = el.offsetWidth || (danmu.text.length + (danmu.user||'').length) * currentFontSize * 1.2;
  const duration = Math.max(3, Math.min(12, textWidth / (currentSpeed * 15) + 2));
  el.style.animationDuration = duration + 's';

  // 动画结束后删除
  el.addEventListener('animationend', () => el.remove());
  // 超时保护
  setTimeout(() => el.remove(), (duration + 0.5) * 1000);

  // 限制同屏弹幕数量
  while (track.children.length > 30) {
    const oldest = track.children[0];
    if (oldest) oldest.remove();
  }
}

function addHistoryDanmu(danmu) {
  const list = document.getElementById('danmuHistory');
  const empty = list.querySelector('.empty-tip');
  if (empty) empty.remove();

  const typeClass = danmu.type || 'chat';
  const item = document.createElement('div');
  item.className = 'danmu-item ' + typeClass;

  const icons = { gift:'🎁', social:'✅', like:'❤️', member:'🚪', share:'🔗', chat:'💬' };
  const icon = icons[typeClass] || '💬';
  const color = DM_COLORS[typeClass] || '#ff4757';

  item.innerHTML =
    `<span class="danmu-user ${typeClass}">${icon} ${escHtml(danmu.user||'')}</span>` +
    `<span class="danmu-text">${escHtml(danmu.text||'')}</span>` +
    `<span class="danmu-time">${new Date().toLocaleTimeString().slice(0,5)}</span>`;

  list.insertBefore(item, list.firstChild);
  danmuCount++;
  document.title = danmuCount > 0 ? `弹幕 ${danmuCount}` : '抖音弹幕';

  while (list.children.length > 80) {
    list.removeChild(list.lastChild);
  }
}

function addDanmu(danmu) {
  addScrollingDanmu(danmu);
  addHistoryDanmu(danmu);
}

function clearDanmu() {
  document.getElementById('danmuTrack').innerHTML = '';
  const list = document.getElementById('danmuHistory');
  list.innerHTML = '<div class="empty-tip">等待弹幕...</div>';
  danmuCount = 0;
  document.title = '抖音弹幕';
}

function setFontSize(size) {
  currentFontSize = parseInt(size);
  document.getElementById('fontVal').textContent = size;
  document.querySelectorAll('.danmu-item').forEach(el => el.style.fontSize = size + 'px');
}

function setSpeed(val) {
  currentSpeed = parseInt(val);
  document.getElementById('speedVal').textContent = val;
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
setFontSize(15);
