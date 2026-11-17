/*
 * Electron 셸: index.html을 독립 창으로 띄운다.
 *
 * 웹 코드는 그대로 쓰고, 브라우저에서 쿼리로 주던 옵션은 명령행 인자로 받는다.
 *   LEDBoard.exe --ws=ws://127.0.0.1:8765/ --panel=0 --cols=96 --rows=48
 *
 * 메뉴 막대
 *   파일  PNG 저장(Ctrl+S), 설정 내보내기(Ctrl+E), 설정 불러오기(Ctrl+O), 설정 초기화, 종료
 *   보기  설정 패널(H), 상태 표시줄(S), 전체 화면(F11), 새로 고침(Ctrl+R, F5), 개발자 도구(F12)
 * 메뉴 항목은 페이지의 window.ledboardCommand(이름)을 부른다 (js/main.js).
 */
'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, session, shell } = require('electron');

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

/**
 * 페이지 명령 실행. userGesture=true로 실행해야 파일 선택 창(설정 불러오기)이 열린다.
 */
function pageCommand(win, name) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`window.ledboardCommand && window.ledboardCommand(${JSON.stringify(name)})`, true)
    .catch(() => {});
}

function buildMenu(win) {
  const cmd = (name) => () => pageCommand(win, name);
  return Menu.buildFromTemplate([
    {
      label: '파일(&F)',
      submenu: [
        { label: 'PNG 저장', accelerator: 'CmdOrCtrl+S', click: cmd('snap') },
        { type: 'separator' },
        { label: '설정 내보내기…', accelerator: 'CmdOrCtrl+E', click: cmd('export') },
        { label: '설정 불러오기…', accelerator: 'CmdOrCtrl+O', click: cmd('import') },
        { label: '설정 초기화', click: cmd('reset') },
        { type: 'separator' },
        { label: '종료', role: 'quit' },
      ],
    },
    {
      label: '보기(&V)',
      submenu: [
        // H·S는 페이지가 직접 처리한다(입력란 포커스 시 무시). 메뉴에는 표시만 한다.
        { label: '설정 패널 접기·펴기', accelerator: 'H', registerAccelerator: false, click: cmd('panel') },
        { label: '상태 표시줄 표시·숨김', accelerator: 'S', registerAccelerator: false, click: cmd('stats') },
        { type: 'separator' },
        { label: '전체 화면', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: '새로 고침', role: 'reload' },
        { label: '개발자 도구', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
      ],
    },
  ]);
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
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 창이 가려지거나 최소화돼도 렌더 루프·WebSocket 수신이 느려지지 않게 한다.
      backgroundThrottling: false,
    },
  });
  win.setMenu(buildMenu(win));
  win.once('ready-to-show', () => win.show());

  // F5 새로 고침 (메뉴의 Ctrl+R과 같음)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F5') {
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
