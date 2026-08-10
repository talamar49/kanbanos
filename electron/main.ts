import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { GitWorkspaceService } from './git-service';

if (process.platform === 'linux') {
  // Some Linux installations disable IPv6 at kernel level. Keep Chromium's
  // development network service on IPv4 to avoid repeated AF_INET6 errors.
  app.commandLine.appendSwitch('disable-ipv6');
  app.commandLine.appendSwitch('disable-features', 'AsyncDns,UseDnsHttpsSvcbAlpn');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1');
}

const gitWorkspace = new GitWorkspaceService();

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../build/icon.png'),
    show: false,
    title: 'Kanbanos',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f5f6f8',
      symbolColor: '#5d6472',
      height: 42,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      const allowed = developmentUrl ? target.origin === new URL(developmentUrl).origin : target.protocol === 'file:';
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('repository:status', () => gitWorkspace.restoreConnection());
  ipcMain.handle('repository:list-recent', () => gitWorkspace.listRecentConnections());
  ipcMain.handle('repository:open-recent', (_event, repositoryPath: string) =>
    gitWorkspace.openRecentConnection(repositoryPath),
  );
  ipcMain.handle('repository:remove-recent', (_event, repositoryPath: string) =>
    gitWorkspace.removeRecentConnection(repositoryPath),
  );
  ipcMain.handle('repository:create-local', async (_event, displayName: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Location',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return gitWorkspace.createLocal(displayName, result.filePaths[0]);
  });
  ipcMain.handle('repository:connect-remote', (_event, remoteUrl: string) =>
    gitWorkspace.connectRemote(remoteUrl),
  );
  ipcMain.handle('repository:choose-local', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Workspace Folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return gitWorkspace.connectLocal(result.filePaths[0]);
  });
  ipcMain.handle('repository:add-remote', (_event, remoteUrl: string) =>
    gitWorkspace.addRemote(remoteUrl),
  );
  ipcMain.handle('repository:disconnect', () => gitWorkspace.disconnect());
  ipcMain.handle('repository:reveal', async () => {
    const connection = await gitWorkspace.restoreConnection();
    if (connection) shell.showItemInFolder(connection.repositoryPath);
  });

  ipcMain.handle('workspace:load', () => gitWorkspace.loadWorkspace());
  ipcMain.handle('workspace:save', (_event, document: unknown) =>
    gitWorkspace.saveWorkspace(document),
  );
  ipcMain.handle('workspace:resolve-conflicts', (_event, strategy: 'local' | 'remote') =>
    gitWorkspace.resolveConflicts(strategy),
  );
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.kanbanos.desktop');
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
