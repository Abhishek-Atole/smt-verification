export async function getMachineId(): Promise<string> {
  if (window.electronAPI?.getMachineId) {
    return window.electronAPI.getMachineId();
  }
  console.warn('[License] Not running in Electron — machine binding unavailable');
  return 'dev-mode-no-machine-binding';
}
