interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppName: () => Promise<string>;
  getMachineId: () => Promise<string>;
  trialRead: () => Promise<string | null>;
  trialWrite: (data: string) => Promise<boolean>;
  trialReadRegistry: () => Promise<string | null>;
  trialWriteRegistry: (data: string) => Promise<boolean>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
