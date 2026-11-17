/*
 * preload: 페이지 → 메인 프로세스 알림 통로. 페이지에는 window.ledboardShell만 노출한다.
 *   ledboardShell.setLang(lang)  UI 언어가 정해지거나 바뀌었을 때. 메인이 메뉴 문구를 맞춘다.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ledboardShell', {
  setLang: (lang) => ipcRenderer.send('ui-lang', String(lang)),
});
