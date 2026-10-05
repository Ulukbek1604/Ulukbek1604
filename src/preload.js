'use strict';

/**
 * Мостик между окном и программой.
 *
 * Наружу отдаётся ровно девять действий и ничего больше: страница не должна
 * уметь читать произвольные файлы на машине, даже своя собственная.
 *
 * Окно одно на обе страницы — ключа и кассы, — поэтому и мостик один.
 * Двумя окнами это уже пробовалось: переключать их из ответа на
 * синхронный запрос нельзя, программа закрывалась.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kassa', {
  load:   () => ipcRenderer.sendSync('data:load'),
  save:   (value) => ipcRenderer.sendSync('data:save', value),
  where:  () => ipcRenderer.sendSync('data:where'),
  reveal: () => ipcRenderer.sendSync('data:reveal'),
  backup: () => ipcRenderer.sendSync('data:backup'),
  saveFile: (name, base64) => ipcRenderer.sendSync('data:file', name, base64),
  autoGet: () => ipcRenderer.sendSync('auto:get'),
  autoSet: (on) => ipcRenderer.sendSync('auto:set', on),
  recover: (code) => ipcRenderer.sendSync('pin:recover', code),
});

contextBridge.exposeInMainWorld('ключ', {
  отпечаток: () => ipcRenderer.sendSync('key:print'),
  проверить: (key) => ipcRenderer.sendSync('key:try', key),
});
