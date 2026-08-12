import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppName: () => ipcRenderer.invoke('get-app-name'),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  trialRead: () => ipcRenderer.invoke('trial:read'),
  trialWrite: (data: string) => ipcRenderer.invoke('trial:write', data),
  trialReadRegistry: () => ipcRenderer.invoke('trial:read-registry'),
  trialWriteRegistry: (data: string) => ipcRenderer.invoke('trial:write-registry', data),
});

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      getAppName: () => Promise<string>;
      getMachineId: () => Promise<string>;
      trialRead: () => Promise<string | null>;
      trialWrite: (data: string) => Promise<boolean>;
      trialReadRegistry: () => Promise<string | null>;
      trialWriteRegistry: (data: string) => Promise<boolean>;
    };
  }
}