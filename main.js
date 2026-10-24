const { app, BrowserWindow, session } = require('electron');

app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    transparent: true, // Enables the floating widget effect
    frame: false,      // Removes the OS window borders and title bar
    alwaysOnTop: true, // Keeps T.H.U.R.S.D.A.Y. floating above other apps
    webPreferences: {
      nodeIntegration: true,
    },
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});