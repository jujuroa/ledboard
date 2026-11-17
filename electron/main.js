/*
 * Electron 셸: index.html을 독립 창으로 띄운다.
 *
 * 웹 코드는 그대로 쓰고, 브라우저에서 쿼리로 주던 옵션은 명령행 인자로 받는다.
 *   LEDBoard.exe --ws=ws://127.0.0.1:8765/ --panel=0 --cols=96 --rows=48
 *
 * 메뉴 막대
 *   파일  PNG 저장(Ctrl+S), 설정 내보내기(Ctrl+E), 설정 불러오기(Ctrl+O), 설정 초기화, 종료
 *   보기  설정 패널(H), 상태 표시줄(S), 전체 화면(F11), 언어, 새로 고침(Ctrl+R, F5), 개발자 도구(F12)
 * 메뉴 항목은 페이지의 window.ledboardCommand(이름)을 부른다 (js/main.js).
 * 메뉴 문구는 페이지 UI 언어를 따른다. 페이지가 preload의 ledboardShell.setLang으로 알려 준다.
 *   LEDBoard.exe --lang=en   (이번 실행만 영어. 저장하지 않음)
 */
'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');

// 페이지가 읽는 쿼리 키 (README의 쿼리 파라미터 표와 같음)
const QUERY_KEYS = ['ws', 'token', 'cols', 'rows', 'panel', 'stats', 'lang'];

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

// 메뉴 문구. 페이지 UI 언어(js/i18n.js)를 따른다.
const MENU_TEXT = {
  ko: {
    file: '파일(&F)', snap: 'PNG 저장', export: '설정 내보내기…', import: '설정 불러오기…',
    reset: '설정 초기화', quit: '종료',
    view: '보기(&V)', panel: '설정 패널 접기·펴기', stats: '상태 표시줄 표시·숨김',
    fullscreen: '전체 화면', reload: '새로 고침', devtools: '개발자 도구', language: '언어(Language)',
  },
  en: {
    file: '&File', snap: 'Save PNG', export: 'Export Settings…', import: 'Import Settings…',
    reset: 'Reset Settings', quit: 'Exit',
    view: '&View', panel: 'Toggle Settings Panel', stats: 'Toggle Status Bar',
    fullscreen: 'Full Screen', reload: 'Reload', devtools: 'Developer Tools', language: 'Language',
  },
};

function buildMenu(win, lang) {
  const T = MENU_TEXT[lang] || MENU_TEXT.en;
  const cmd = (name) => () => pageCommand(win, name);
  // 페이지가 언어를 바꾼 뒤 ui-lang으로 알려 오면 메뉴가 다시 만들어진다
  const setLang = (l) => () => pageCommand(win, 'lang:' + l);
  return Menu.buildFromTemplate([
    {
      label: T.file,
      submenu: [
        { label: T.snap, accelerator: 'CmdOrCtrl+S', click: cmd('snap') },
        { type: 'separator' },
        { label: T.export, accelerator: 'CmdOrCtrl+E', click: cmd('export') },
        { label: T.import, accelerator: 'CmdOrCtrl+O', click: cmd('import') },
        { label: T.reset, click: cmd('reset') },
        { type: 'separator' },
        { label: T.quit, role: 'quit' },
      ],
    },
    {
      label: T.view,
      submenu: [
        // H·S는 페이지가 직접 처리한다(입력란 포커스 시 무시). 메뉴에는 표시만 한다.
        { label: T.panel, accelerator: 'H', registerAccelerator: false, click: cmd('panel') },
        { label: T.stats, accelerator: 'S', registerAccelerator: false, click: cmd('stats') },
        { type: 'separator' },
        { label: T.fullscreen, role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: T.language,
          submenu: [
            { label: '한국어', type: 'radio', checked: lang === 'ko', click: setLang('ko') },
            { label: 'English', type: 'radio', checked: lang === 'en', click: setLang('en') },
          ],
        },
        { type: 'separator' },
        { label: T.reload, role: 'reload' },
        { label: T.devtools, accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
      ],
    },
  ]);
}

/** 메뉴 언어를 바꾼다. 같은 언어면 다시 만들지 않는다 */
function setMenuLang(win, lang) {
  if (win.isDestroyed() || !MENU_TEXT[lang] || win.menuLang === lang) return;
  win.menuLang = lang;
  win.setMenu(buildMenu(win, lang));
}

// 페이지가 UI 언어를 정하거나 바꾸면 알려 온다 (electron/preload.js)
ipcMain.on('ui-lang', (event, lang) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) setMenuLang(win, lang);
});

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
      preload: path.join(__dirname, 'preload.js'),
      // 창이 가려지거나 최소화돼도 렌더 루프·WebSocket 수신이 느려지지 않게 한다.
      backgroundThrottling: false,
    },
  });
  // 페이지가 언어를 알려 오기 전까지는 OS 언어로 메뉴를 만든다
  setMenuLang(win, /^ko/i.test(app.getLocale()) ? 'ko' : 'en');
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
