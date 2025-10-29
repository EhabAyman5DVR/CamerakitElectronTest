import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
	const isElectron = mode === 'electron' || process.env.BUILD_TARGET === 'electron';
	return {
		base: isElectron ? './' : '/CameraKitElectronTest/',
	};
});