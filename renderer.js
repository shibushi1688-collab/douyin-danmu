const { ipcRenderer } = require('electron');

let danmuCount = 0;

function setStatus(type, status, label) {
  const dot = document.getElementById(type + 'Dot');
  const text = document.getElementById(type + 'Label');
  dot.className = 'status-dot ' + (status === 'ready' ? 'ready' : status === 'active' ? 'active' : status === 'error' ? 'error' : '');
  text.textContent = label;
}

function addDanmu(danmu) {
  const list = document.getElementById('danmuList');
  // 移除空状态提示
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  const typeClass = danmu.type || 'chat';
  item.className = 'danmu-item ' + typeClass;

  const typeIcons = { gift: '🎁', social: '✅', like: '❤️', chat: '💬' };
  const icon = typeIcons[typeClass] || '💬';

  const user = danmu.user || '';
  const text = danmu.text || '';

  item.innerHTML = `
    <span class="danmu-user">${icon} ${user}</span>
    <span class="danmu-text">${text}</span>
    <span class="danmu-time">${new Date().toLocaleTimeString()}</span>
  `;

  list.insertBefore(item, list.firstChild);
  danmuCount++;
  document.getElementById('danmuCount').textContent = danmuCount;
  document.getElementById('danmuCount').className = 'badge';

  // 限制200条
  while (list.children.length > 200) {
    list.removeChild(list.lastChild);
  }
}

function clearDanmu() {
  const list = document.getElementById('danmuList');
  list.innerHTML = '<div class="empty">等待弹幕...</div>';
  danmuCount = 0;
  document.getElementById('danmuCount').textContent = '0';
  document.getElementById('danmuCount').className = 'badge';
}

// 监听弹幕
ipcRenderer.on('danmu', (event, danmu) => {
  addDanmu(danmu);
});

async function initBrowser() {
  const btn = document.getElementById('btnInit');
  btn.textContent = '⏳ 启动中...';
  btn.disabled = true;
  const r = await ipcRenderer.invoke('init-browser');
  if (r.success) {
    setStatus('browser', 'ready', '已启动');
    btn.textContent = '✅ 已启动';
    document.getElementById('btnLogin').disabled = false;
    document.getElementById('btnJoin').disabled = false;
    document.getElementById('btnCheck').disabled = false;
    // 自动检查登录状态
    setTimeout(checkLogin, 1000);
  } else {
    setStatus('browser', 'error', '失败');
    btn.textContent = '❌ 重试';
    btn.disabled = false;
    alert('启动浏览器失败：' + r.error);
  }
}

async function openLogin() {
  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  btn.textContent = '⏳ 打开中...';
  const r = await ipcRenderer.invoke('open-login');
  if (r.success) {
    btn.textContent = '✅ 已打开，请扫码';
    btn.disabled = false;
  } else {
    btn.textContent = '❌ 失败';
    btn.disabled = false;
  }
}

async function checkLogin() {
  const r = await ipcRenderer.invoke('check-login');
  if (r.success) {
    if (r.loggedIn) {
      setStatus('login', 'ready', '已登录');
      document.getElementById('btnLogin').textContent = '✅ 已登录';
    } else {
      setStatus('login', 'error', '未登录');
      document.getElementById('btnLogin').textContent = '📱 去扫码';
    }
  }
}

async function joinRoom() {
  const url = document.getElementById('roomUrl').value.trim();
  if (!url) {
    alert('请先输入直播间链接');
    return;
  }
  const btn = document.getElementById('btnJoin');
  btn.disabled = true;
  btn.textContent = '⏳ 进入中...';
  setStatus('room', 'active', '进入中...');

  const r = await ipcRenderer.invoke('join-room', url);
  if (r.success) {
    setStatus('room', 'ready', '已入室');
    btn.textContent = '✅ 已进入';
    btn.disabled = false;

    // 等待页面加载后启动弹幕拦截
    setTimeout(async () => {
      const lr = await ipcRenderer.invoke('start-danmu-listener');
      if (lr.success) {
        setStatus('room', 'active', '监听中');
        document.getElementById('roomLabel').textContent = '🟢 监听中';
      } else {
        setStatus('room', 'error', '监听失败');
        alert('弹幕拦截启动失败：' + lr.error);
      }
    }, 3000);
  } else {
    setStatus('room', 'error', '进入失败');
    btn.textContent = '❌ 重试';
    btn.disabled = false;
    alert('进入直播间失败：' + r.error);
  }
}

async function sendTest() {
  await ipcRenderer.invoke('send-test-danmu');
}
