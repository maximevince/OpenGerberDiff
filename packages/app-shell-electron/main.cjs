// Minimal Electron main process. It serves the UNMODIFIED app-web static build
// over a loopback HTTP server and loads it in one BrowserWindow. A loopback
// server (rather than file://) keeps SvelteKit's absolute asset URLs working and
// gives us a real origin. Native open/save/menu are exposed to the renderer via
// preload's `window.nativeAPI`; the web app feature-detects that and otherwise
// behaves exactly as in a browser.
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function webRoot() {
  // Packaged: copied into resources/web by electron-builder (extraResources).
  // Dev: the sibling app-web static build.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', 'app-web', 'build');
}

function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let filePath = path.normalize(path.join(root, urlPath));
        if (!filePath.startsWith(root)) {
          res.statusCode = 403;
          return res.end('Forbidden');
        }
        if (urlPath === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(root, 'index.html'); // SPA fallback
        }
        res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let win = null;

function send(action) {
  win?.webContents.send('menu', action);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  // Accelerators that the renderer already handles via keydown (undo/redo/save)
  // are intentionally omitted here to avoid firing the action twice.
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Save Review…', click: () => send('save-session') },
        { type: 'separator' },
        { label: 'Reset', click: () => send('reset') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', click: () => send('undo') },
        { label: 'Redo', click: () => send('redo') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => send('help') },
        { label: 'About OpenGerberDiff', click: () => send('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('open-files', async (_e, opts) => {
  const res = await dialog.showOpenDialog(win, {
    properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [
      {
        name: 'Gerber / Excellon / sessions',
        extensions: ['gbr', 'ger', 'drl', 'xln', 'zip', 'pcbdiff'],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled) return null;
  return res.filePaths.map((p) => ({
    name: path.basename(p),
    bytes: new Uint8Array(fs.readFileSync(p)),
  }));
});

ipcMain.handle('save-file', async (_e, suggestedName, bytes) => {
  const res = await dialog.showSaveDialog(win, { defaultPath: suggestedName });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  return true;
});

async function createWindow() {
  const server = await startServer(webRoot());
  const { port } = server.address();
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  buildMenu();
  win.on('closed', () => {
    win = null;
    server.close();
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`did-fail-load ${code} ${desc} ${url}`);
    if (process.env.OGD_SMOKE) app.exit(1);
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);

  // Headless self-check (CI): wait for the SPA to mount, then exit.
  if (process.env.OGD_SMOKE) {
    try {
      const ok = await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const hit = () => {
            const el = document.querySelector('h1.brand');
            return !!el && el.textContent.includes('OpenGerberDiff');
          };
          if (hit()) return resolve(true);
          let n = 0;
          const id = setInterval(() => {
            if (hit() || ++n > 100) { clearInterval(id); resolve(hit()); }
          }, 100);
        })
      `);
      console.log(ok ? 'OGD_SMOKE_OK' : 'OGD_SMOKE_FAIL');
      app.exit(ok ? 0 : 1);
    } catch (err) {
      console.error('OGD_SMOKE_ERROR', err);
      app.exit(1);
    }
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Best-effort auto-update against GitHub Releases when packaged.
  if (app.isPackaged) {
    try {
      require('electron-updater').autoUpdater.checkForUpdatesAndNotify();
    } catch {
      /* updater unavailable — ignore */
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
