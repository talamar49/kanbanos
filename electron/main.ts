import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAttachmentPreview } from './attachment-preview';
import { GitWorkspaceService, type GitCredentials } from './git-service';

if (process.platform === 'linux') {
  // Some Linux installations disable IPv6 at kernel level. Keep Chromium's
  // development network service on IPv4 to avoid repeated AF_INET6 errors.
  app.commandLine.appendSwitch('disable-ipv6');
  app.commandLine.appendSwitch('disable-features', 'AsyncDns,UseDnsHttpsSvcbAlpn');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1');
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'kanbanos-attachment',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const gitWorkspace = new GitWorkspaceService();

function attachmentPreviewUrl(relativePath: string): string {
  return `kanbanos-attachment://preview/${Buffer.from(relativePath).toString('base64url')}`;
}

function registerAttachmentProtocol(): void {
  protocol.handle('kanbanos-attachment', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'preview') return new Response('Not found', { status: 404 });
      const relativePath = Buffer.from(url.pathname.slice(1), 'base64url').toString('utf8');
      const absolutePath = await gitWorkspace.resolveAttachmentPath(relativePath);
      return net.fetch(pathToFileURL(absolutePath).toString());
    } catch {
      return new Response('Attachment not found', { status: 404 });
    }
  });
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: dark ? '#343943' : '#f5f6f8',
    icon: path.join(__dirname, '../build/icon.png'),
    show: false,
    title: 'Kanbanos',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#343943' : '#f5f6f8',
      symbolColor: dark ? '#d8dbe5' : '#5d6472',
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
  ipcMain.on('appearance:set-theme', (_event, theme: 'light' | 'dark') => {
    const dark = theme === 'dark';
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(dark ? '#343943' : '#f5f6f8');
      window.setTitleBarOverlay({
        color: dark ? '#343943' : '#f5f6f8',
        symbolColor: dark ? '#d8dbe5' : '#5d6472',
        height: 42,
      });
    }
  });
  ipcMain.handle('repository:status', () => gitWorkspace.restoreConnection());
  ipcMain.handle('repository:list-recent', () => gitWorkspace.listRecentConnections());
  ipcMain.handle('repository:open-recent', (_event, repositoryPath: string) =>
    gitWorkspace.openRecentConnection(repositoryPath),
  );
  ipcMain.handle('repository:remove-recent', (_event, repositoryPath: string) =>
    gitWorkspace.removeRecentConnection(repositoryPath),
  );
  ipcMain.handle('repository:create-local', async (_event, displayName: string, language: 'en' | 'he' = 'en') => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: language === 'he' ? 'בחירת מיקום לסביבת העבודה' : 'Select Workspace Location',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return gitWorkspace.createLocal(displayName, result.filePaths[0]);
  });
  ipcMain.handle('repository:connect-remote', (_event, remoteUrl: string, credentials?: GitCredentials | null) =>
    gitWorkspace.connectRemote(remoteUrl, credentials),
  );
  ipcMain.handle('repository:choose-local', async (_event, language: 'en' | 'he' = 'en') => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: language === 'he' ? 'פתיחת תיקיית סביבת עבודה' : 'Open Workspace Folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return gitWorkspace.connectLocal(result.filePaths[0]);
  });
  ipcMain.handle('repository:add-remote', (_event, remoteUrl: string, credentials?: GitCredentials | null) =>
    gitWorkspace.addRemote(remoteUrl, credentials),
  );
  ipcMain.handle('repository:disconnect', () => gitWorkspace.disconnect());
  ipcMain.handle('repository:reveal', async () => {
    const connection = await gitWorkspace.restoreConnection();
    if (connection) shell.showItemInFolder(connection.repositoryPath);
  });

  ipcMain.handle('attachments:pick-files', async (_event, language: 'en' | 'he' = 'en') => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: language === 'he' ? 'בחירת קבצים לצירוף' : 'Choose files to attach',
    });
    return result.canceled ? [] : gitWorkspace.importAttachments(result.filePaths);
  });
  ipcMain.handle('attachments:pick-folders', async (_event, language: 'en' | 'he' = 'en') => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      title: language === 'he' ? 'בחירת תיקיות לצירוף' : 'Choose folders to attach',
    });
    return result.canceled ? [] : gitWorkspace.importAttachments(result.filePaths);
  });
  ipcMain.handle('attachments:pick-references', async (_event, language: 'en' | 'he' = 'en') => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: language === 'he' ? 'בחירת קבצים כהפניה מקומית' : 'Choose files to keep as local references',
    });
    return result.canceled ? [] : gitWorkspace.createLocalFileReferences(result.filePaths);
  });
  ipcMain.handle('attachments:open', async (_event, relativePath: string) => {
    const error = await shell.openPath(await gitWorkspace.resolveAttachmentPath(relativePath));
    if (error) throw new Error(error);
  });
  ipcMain.handle('attachments:reveal', async (_event, relativePath: string) => {
    shell.showItemInFolder(await gitWorkspace.resolveAttachmentPath(relativePath));
  });
  ipcMain.handle('attachments:open-reference', async (_event, localPath: string) => {
    const error = await shell.openPath(await gitWorkspace.resolveLocalReferencePath(localPath));
    if (error) throw new Error(error);
  });
  ipcMain.handle('attachments:reveal-reference', async (_event, localPath: string) => {
    shell.showItemInFolder(await gitWorkspace.resolveLocalReferencePath(localPath));
  });
  ipcMain.handle('attachments:preview', async (_event, relativePath: string) => {
    const absolutePath = await gitWorkspace.resolveAttachmentPath(relativePath);
    return createAttachmentPreview(absolutePath, relativePath, attachmentPreviewUrl(relativePath));
  });
  ipcMain.handle('attachments:remove', (_event, attachmentId: string) =>
    gitWorkspace.removeAttachment(attachmentId),
  );

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
  registerAttachmentProtocol();
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
