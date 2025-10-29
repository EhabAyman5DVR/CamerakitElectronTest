const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const https = require('https');
const selfsigned = require('selfsigned');

let staticServer; // https.Server
let staticServerPort; // number

let mainWindow;

function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			// Keep web security enabled; we proxy where needed
			webSecurity: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
		show: false,
	});

	const devServerUrl = process.env.VITE_DEV_SERVER_URL;
	if (devServerUrl) {
		mainWindow.loadURL(devServerUrl);
		mainWindow.webContents.openDevTools({ mode: 'detach' });
	} else {
		// In production, serve dist/ over HTTP to avoid file:// origin issues with external APIs/CORS
		startStaticServer().then((port) => {
			const url = `https://127.0.0.1:${port}/index.html`;
			mainWindow.loadURL(url);
			mainWindow.webContents.openDevTools({ mode: 'detach' });
		});
	}

	mainWindow.once('ready-to-show', () => {
		mainWindow.show();
	});

	mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
		console.error('did-fail-load', { errorCode, errorDescription, validatedURL });
	});

	mainWindow.webContents.on('render-process-gone', (event, details) => {
		console.error('render-process-gone', details);
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

app.on('ready', createMainWindow);

// Auto-allow camera/microphone permission requests
app.whenReady().then(() => {
	session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
		if (permission === 'media') {
			return callback(true);
		}
		return callback(true);
	});

	// Optional: reduce blocked autoplay for camera previews
	app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
	// Allow self-signed certificate for local https server
	app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
	app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
	session.defaultSession.setCertificateVerifyProc((request, callback) => {
		// Trust our local self-signed cert
		if (request.hostname === '127.0.0.1' || request.hostname === 'localhost') {
			return callback(0);
		}
		return callback(-3); // use default verification for others
	});

	// Ensure CORS succeeds by setting a single valid ACAO value on Snap endpoints
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		try {
			const url = details.url || '';
			const isSnapApi = /(snapar|snapchat|snapkit|sc-cdn|sc-prod)\.(com|net)/i.test(url);
			if (isSnapApi) {
				const headers = details.responseHeaders || {};
				// Normalize header keys (Electron uses case-insensitive keys stored as arrays)
				const normalized = {};
				for (const key in headers) {
					normalized[key.toLowerCase()] = headers[key];
				}
				// Remove any existing ACAO to avoid duplicates, then set to our app origin
				delete normalized['access-control-allow-origin'];
				const origin = staticServerPort ? `https://127.0.0.1:${staticServerPort}` : 'https://127.0.0.1';
				normalized['access-control-allow-origin'] = [origin];
				// Keep permissive headers for preflight completeness
				normalized['access-control-allow-headers'] = normalized['access-control-allow-headers'] || ['*'];
				normalized['access-control-allow-methods'] = normalized['access-control-allow-methods'] || ['GET,POST,OPTIONS'];
				return callback({ responseHeaders: normalized });
			}
		} catch {}
		return callback({ responseHeaders: details.responseHeaders });
	});

// Rewrite request headers for Snap endpoints to a known allowed origin (configure if needed)
const filter = { urls: ['https://*/*'] };
const ALLOWED_ORIGIN = process.env.SNAP_ALLOWED_ORIGIN || 'https://127.0.0.1';
session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    try {
        const reqUrl = details.url || '';
        const isSnapApi = /(snapar|snapchat|snapkit|sc-cdn|sc-prod)\.(com|net)/i.test(reqUrl);
        if (isSnapApi) {
            details.requestHeaders['Origin'] = ALLOWED_ORIGIN;
            details.requestHeaders['Referer'] = ALLOWED_ORIGIN + '/';
        }
    } catch {}
    callback({ requestHeaders: details.requestHeaders });
});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
	if (mainWindow === null) createMainWindow();
});

app.on('will-quit', () => {
	if (staticServer) {
		try { staticServer.close(); } catch {}
	}
});

function startStaticServer() {
	if (staticServer && staticServerPort) return Promise.resolve(staticServerPort);
	const distDir = path.join(__dirname, '..', 'dist');
	const serveHandler = require('serve-handler');
return new Promise((resolve, reject) => {
    const pems = selfsigned.generate(null, { days: 365, keySize: 2048 });
    const server = https.createServer({ key: pems.private, cert: pems.cert }, (request, response) => {
        return serveHandler(request, response, {
            public: distDir,
            directoryListing: false,
            cleanUrls: true,
        });
    });
		server.listen(0, '127.0.0.1', () => {
			staticServer = server;
			staticServerPort = server.address().port;
			resolve(staticServerPort);
		});
		server.on('error', reject);
	});
}


