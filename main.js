// main.js

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fixPath = require('fix-path');

// Fix the PATH for GUI apps (this ensures 'node' is found)
fixPath();

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    icon: path.join(__dirname, 'assets', 'icon.png'), // optional: set an app icon
    webPreferences: {
      // For security, disable Node integration in the renderer process
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the URL served by our Express server
  mainWindow.loadURL('http://localhost:8888');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  let nodePath;
  try {
    // Get the absolute path to node (trim any newline characters)
    nodePath = execSync('which node').toString().trim();
    console.log(`Using Node at: ${nodePath}`);
  } catch (err) {
    console.error('Error finding Node path:', err);
    nodePath = 'node'; // fallback; may still cause issues
  }

  // Spawn the server process using the absolute Node path and shell: true
  serverProcess = spawn(nodePath, [path.join(__dirname, 'server.js')], {
    env: process.env,
    shell: true
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });
  serverProcess.stderr.on('data', (data) => {
    console.error(`Server error: ${data}`);
  });
}

app.on('ready', () => {
  startServer();
  createWindow();
});

// Quit the app when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Re-create a window if the dock icon is clicked (macOS behavior)
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// When the Electron app quits, kill the server process if it’s running.
app.on('quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});