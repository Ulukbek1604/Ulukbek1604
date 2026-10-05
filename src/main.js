'use strict';

/**
 * Касса как программа для Windows.
 *
 * Всё локально: ни сервера, ни облака. Данные лежат обычным файлом,
 * который видно в проводнике и можно унести на флешке. Это и главное
 * достоинство такой установки, и её главный риск: копий никто, кроме
 * самой программы, не делает — поэтому она делает их сама.
 */

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fingerprint, keyFor, keyFits } = require('./ключи.js');

/**
 * Поменьше процессов и памяти.
 *
 * Касса стоит на том ноутбуке, который в магазине уже есть, а не на
 * новом. Отдельный процесс для видеокарты ей не нужен: рисовать здесь
 * нечего, кроме списков и кнопок, — и это сразу сотня мегабайт мимо.
 * Второй процесс отрисовки тоже незачем: окно одно.
 */
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('renderer-process-limit', '1');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,MediaRouter');

/**
 * На виду, а не в скрытых папках профиля: продавец должен уметь
 * показать этот файл и скопировать его, не зная слова AppData.
 *
 * Поставленная установщиком программа кладёт данные в «Документы», а не
 * рядом с собой: свою папку установщик при обновлении очищает, и данные
 * ушли бы вместе со старой версией. «Документы» он не трогает — там они
 * переживают и обновление, и удаление программы.
 */
function dataDir() {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable) return path.join(portable, 'Данные кассы');
  if (app.isPackaged) return path.join(app.getPath('documents'), 'Касса');
  return path.join(app.getPath('userData'), 'Данные кассы');
}

const DIR = dataDir();
const FILE = path.join(DIR, 'касса.json');
const BACKUPS = path.join(DIR, 'Копии');

function ensure() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(BACKUPS, { recursive: true });
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    return null;
  }
}

/**
 * Запись через временный файл: если свет погаснет на середине, целым
 * останется прошлый файл, а не половина нового.
 */
function writeData(value) {
  ensure();
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 1), 'utf8');
  fs.renameSync(temp, FILE);
  return true;
}

function backup(reason) {
  ensure();
  if (!fs.existsSync(FILE)) return null;

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `касса-${stamp}${reason ? '-' + reason : ''}.json`;
  fs.copyFileSync(FILE, path.join(BACKUPS, name));

  // Держим последние тридцать: диск не бесконечный, а копия годовой
  // давности в магазине никому не нужна.
  const old = fs
    .readdirSync(BACKUPS)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .slice(0, -30);
  for (const n of old) fs.rmSync(path.join(BACKUPS, n), { force: true });

  return name;
}

/**
 * Запуск вместе с Windows.
 *
 * В магазине кассу открывают один раз утром и не закрывают до вечера.
 * Пусть она будет на экране сразу после включения ноутбука — искать её
 * и вспоминать, как она называется, не придётся.
 *
 * Включается ровно один раз, при первом запуске. Если потом кассу
 * уберут из автозагрузки Windows, навязываться обратно нельзя: это
 * решение хозяина компьютера, а не программы. Отметка о том, что мы
 * уже спрашивали систему, лежит в служебной папке, а не в «Документах»:
 * человеку она ни о чём не говорит и мозолить глаза не должна.
 */
const autostartNote = () => path.join(app.getPath('userData'), 'автозапуск.txt');

function setAutostart(on) {
  // Имя записи задаём своё: без него Windows пишет в автозагрузку
  // «electron.app.Касса», и в списке автозапуска это выглядит как
  // что-то постороннее, что хочется отключить от греха подальше.
  app.setLoginItemSettings({ openAtLogin: on, name: 'Касса' });
  fs.mkdirSync(path.dirname(autostartNote()), { recursive: true });
  fs.writeFileSync(autostartNote(), on ? 'вкл' : 'выкл', 'utf8');
}

/**
 * Спрашиваем и систему, и свою отметку.
 *
 * Системный ответ на Windows бывает ложно отрицательным: запись в реестр
 * кладётся без кавычек вокруг пути, а сверяется с закавыченной. Одна
 * отметка тоже не годится — она не узнает, если автозапуск выключили
 * через «Автозагрузку» в диспетчере задач. Поэтому «включено», если так
 * считает хоть кто-то из двух.
 */
function autostartOn() {
  try {
    if (app.getLoginItemSettings().openAtLogin) return true;
  } catch (error) { /* спросим отметку */ }
  try {
    return fs.readFileSync(autostartNote(), 'utf8').trim() === 'вкл';
  } catch (error) {
    return false;
  }
}

function setupAutostart() {
  if (!app.isPackaged) return;
  // Отметка есть — значит вопрос уже решали, и решение не наше.
  if (fs.existsSync(autostartNote())) return;

  try {
    setAutostart(true);
  } catch (error) {
    // Не повод не запускаться: касса важнее своего места в автозагрузке.
  }
}

/* ------------------------------------------------------- ключ программы */

const keyFile = () => path.join(app.getPath('userData'), 'ключ.txt');

function savedKey() {
  try { return fs.readFileSync(keyFile(), 'utf8'); } catch (error) { return ''; }
}

/**
 * Окно ключа вместо кассы.
 *
 * Пока ключ не введён, магазина не видно. Данные при этом целы: ключ
 * лежит отдельно от них, и переустановка программы их не трогает.
 */
ipcMain.on('key:print', (event) => {
  event.returnValue = fingerprint();
});

ipcMain.on('key:try', (event, key) => {
  if (!keyFits(key)) { event.returnValue = false; return; }

  try {
    fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
    // Записываем ключ этой машины, а не то, что набрали: иначе мой общий
    // код остался бы лежать текстом на чужом компьютере.
    fs.writeFileSync(keyFile(), keyFor(fingerprint()), 'utf8');
  } catch (error) { /* не запишется — спросим ключ ещё раз завтра */ }

  // Страницу кассы открывает сама страница ключа, а не мы отсюда.
  // Переключать её из главного процесса нельзя: окно в этот миг ещё
  // отвечает на синхронный запрос, загрузка срывается на середине —
  // заголовок меняется, а окно остаётся пустым. Проверено дважды.
  event.returnValue = true;
});

/* ------------------------------------------------------------------ окно */

let win = null;

function createWindow(page = 'kassa.html') {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#eef1f4',
    title: 'Касса — телефоны и чехлы',
    icon: path.join(__dirname, 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    win.maximize();
  });

  // Масштаб жил в меню «Вид»; без меню сочетания клавиш надо повесить
  // самим, иначе на маленьком экране текст не увеличить.
  win.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.type !== 'keyDown') return;
    const шаг = { '=': 0.5, '+': 0.5, '-': -0.5, '0': null }[input.key];
    if (шаг === undefined) return;
    const было = win.webContents.getZoomLevel();
    win.webContents.setZoomLevel(шаг === null ? 0 : было + шаг);
    event.preventDefault();
  });

  win.loadFile(path.join(__dirname, page));

  // Ссылки наружу открываются в браузере, а не подменяют окно кассы.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.on('data:load', (event) => {
  event.returnValue = readData();
});

ipcMain.on('data:save', (event, value) => {
  try {
    writeData(value);
    event.returnValue = true;
  } catch (error) {
    event.returnValue = false;
  }
});

ipcMain.on('data:where', (event) => {
  event.returnValue = FILE;
});

ipcMain.on('data:reveal', (event) => {
  shell.openPath(DIR);
  event.returnValue = true;
});

/**
 * Сохранить готовый файл рядом с данными.
 *
 * Книга Excel приходит из окна строкой base64: передавать двоичные данные
 * через мостик дороже и незачем — файл невелик.
 */
ipcMain.on('data:file', (event, name, base64) => {
  try {
    ensure();
    const safe = String(name).replace(/[\/:*?"<>|]/g, '_');
    const full = path.join(DIR, safe);
    fs.writeFileSync(full, Buffer.from(base64, 'base64'));
    // Проводник сам не открываем: программа, которая без спроса кидает
    // поверх работы чужие окна, мешает. Путь показан в кассе, а рядом
    // есть кнопка «Показать папку» — пусть человек решает сам.
    event.returnValue = full;
  } catch (error) {
    event.returnValue = null;
  }
});

ipcMain.on('auto:get', (event) => {
  event.returnValue = autostartOn();
});

ipcMain.on('auto:set', (event, on) => {
  try { setAutostart(!!on); } catch (error) { /* оставим как было */ }
  event.returnValue = autostartOn();
});

ipcMain.on('data:backup', (event) => {
  try {
    event.returnValue = backup('вручную');
  } catch (error) {
    event.returnValue = null;
  }
});

app.whenReady().then(() => {
  ensure();
  // Копия при запуске: если вчерашние данные испортились, вчерашняя
  // копия ещё цела. Делается до того, как программа что-то запишет.
  try { backup('запуск'); } catch (error) { /* не повод не запускаться */ }

  setupAutostart();
  // Полосы меню нет: она занимает место, а всё нужное из неё переехало
  // в раздел «Ещё» самой кассы — туда, где его станут искать.
  Menu.setApplicationMenu(null);

  // Без ключа в том же окне открывается не касса, а страница ключа.
  createWindow(keyFits(savedKey()) ? 'kassa.html' : 'ключ.html');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    createWindow(keyFits(savedKey()) ? 'kassa.html' : 'ключ.html');
  });
});

app.on('window-all-closed', () => app.quit());
