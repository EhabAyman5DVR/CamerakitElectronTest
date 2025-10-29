const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
	// reserved for future use
});


