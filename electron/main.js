/*
 * Electron 셸: index.html을 독립 창으로 띄운다.
 *
 * 웹 코드는 그대로 쓰고, 브라우저에서 쿼리로 주던 옵션은 명령행 인자로 받는다.
 *   LEDBoard.exe --ws=ws://127.0.0.1:8765/ --panel=0 --cols=96 --rows=48
 *
 * 단축키(메뉴 막대가 없으므로 여기서 처리)
 *   F11            창 전체 화면 (페이지의 F 키는 HTML 전체 화면)
 *   F12            개발자 도구
 *   Ctrl+R / F5    새로 고침
 */
'use strict';

const path = require('path');
const { app, BrowserWindow, session, shell } = require('electron');

// 페이지가 읽는 쿼리 키 (README의 쿼리 파라미터 표와 같음)
const QUERY_KEYS = ['ws', 'token', 'cols', 'rows', 'panel', 'stats'];

/** 명령행의 --key=value 중 QUERY_KEYS에 해당하는 것만 쿼리로 옮긴다. */
function queryFromArgv(argv) {
  const query = {};
  for (const arg of argv) {
    const m = /^--([a-z]+)=(.*)$/i.exec(arg);
    if (m && QUERY_KEYS.includes(m[1].toLowerCase())) query[m[1].toLowerCase()] = m[2];
  }
  return query;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#000000',
    title: 'LED Board Simulator',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 창이 가려지거나 최소화돼도 렌더 루프·WebSocket 수신이 느려지지 않게 한다.
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win.show());

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  // 페이지 안의 외부 링크는 기본 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'), { query: queryFromArgv(process.argv) });
}

app.whenReady().then(() => {
  // 카메라 소스와 HTML 전체 화면만 허용한다.
  const allowed = new Set(['media', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  createWindow();
});

app.on('window-all-closed', () => app.quit());
