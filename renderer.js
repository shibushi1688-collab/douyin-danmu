'use strict';

let danmuCount = 0;
let currentFontSize = 13;
let isConnected = false;

// 抖音表情文字 → emoji 映射
const EMOJI_MAP = {
  '[爱心]': '❤️', '[大笑]': '😄', '[赞]': '👍', '[玫瑰]': '🌹',
  '[鼓掌]': '👏', '[流泪]': '😭', '[害羞]': '😊', '[飞吻]': '😘',
  '[惊喜]': '🤩', '[哈哈]': '😂', '[调皮]': '😜', '[抠鼻]': '🤪',
  '[可爱]': '🥰', '[尬笑]': '😅', '[比心]': '🫶', '[吐血]': '🤮',
  '[what]': '🤔', '[wow]': '😲', '[捂脸]': '🤦', '[抓狂]': '😫',
  '[狗头]': '🐶', '[微笑]': '🙂', '[撇嘴]': '😕', '[晕]': '😵',
  '[发怒]': '😡', '[得意]': '😎', '[亲亲]': '😚', '[睡着]': '😴',
  '[色]': '😍', '[闭嘴]': '🤐', '[难过]': '😞', '[奋斗]': '💪',
  '[太阳]': '☀️', '[月亮]': '🌙', '[下雨]': '🌧️', '[蛋糕]': '🎂',
  '[蜡烛]': '🕯️', '[咖啡]': '☕', '[啤酒]': '🍺', '[红包]': '🧧',
  '[烟花]': '🎆', '[鞭炮]': '🧨', '[福]': '🧧', '[发]': '💰',
  '[V5]': '✋', '[ok]': '👌', '[胜利]': '✌️', '[拳头]': '👊',
  '[抱抱]': '🫂', '[握手]': '🤝', '[祈祷]': '🙏', '[合十]': '🙏',
  '[告辞]': '👋', '[吃瓜]': '🍉', '[叹气]': '😮‍💨', '[翻白眼]': '🙄',
  '[酸了]': '🍋', '[惊呆]': '😳', '[恐惧]': '😨', '[坏笑]': '😏',
  '[呲牙]': '😁', '[嘘]': '🤫', '[委屈]': '🥺', '[疑问]': '❓',
};

// 给用户分配固定颜色（基于昵称 hash 到色相）
function getUserColor(name) {
  if (!name) return '#ff4757';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function replaceEmojis(text) {
  return text.replace(/\[[^\]]+\]/g, (match) => EMOJI_MAP[match] || match);
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

function showEvent(danmu) {
  const bar = document.getElementById('eventBar');
  const html = '<span class="event-item ' + danmu.type + '">' + replaceEmojis(escHtml(danmu.text)) + '</span>';
  bar.innerHTML = html;
}

function addDanmu(danmu) {
  const list = document.getElementById('danmuList');
  const empty = list.querySelector('.empty-tip');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'danmu-item';
  item.style.fontSize = currentFontSize + 'px';

  item.innerHTML =
    '<span class="danmu-user" style="color:' + getUserColor(danmu.user) + '">' + escHtml(danmu.user || '') + '</span>' +
    '<span class="danmu-text">' + replaceEmojis(escHtml(danmu.text || '')) + '</span>';

  list.appendChild(item);
  list.scrollTop = list.scrollHeight;

  danmuCount++;
  document.title = danmuCount > 0 ? '弹幕 ' + danmuCount : '纤型公屏';

  while (list.children.length > 500) {
    list.removeChild(list.firstChild);
  }
}

function clearDanmu() {
  document.getElementById('danmuList').innerHTML = '<div class="empty-tip">等待弹幕...</div>';
  document.getElementById('eventBar').innerHTML = '';
  danmuCount = 0;
  document.title = '纤型公屏';
}

function setBgAlpha(val) {
  document.getElementById('bgVal').textContent = val + '%';
  document.body.style.setProperty('--bg-alpha', val / 100);
}

function setFontSize(size) {
  currentFontSize = parseInt(size);
  document.getElementById('fontVal').textContent = size;
  document.querySelectorAll('.danmu-item').forEach(el => el.style.fontSize = size + 'px');
  document.getElementById('eventBar').style.fontSize = size + 'px';
}

async function toggleConnect() {
  const btn = document.getElementById('btnConnect');
  if (isConnected) {
    await window.electronAPI.disconnect();
    clearDanmu();
    isConnected = false;
    btn.textContent = '连接';
    btn.className = 'btn';
    setStatus(false, null, null);
  } else {
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
  if (data.type === 'chat') {
    addDanmu(data);
  } else {
    showEvent(data);
  }
});

window.electronAPI.onStatus(data => {
  if (data.step) {
    setStatus(false, null, data.step);
  } else {
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
document.getElementById('eventBar').style.fontSize = '13px';
