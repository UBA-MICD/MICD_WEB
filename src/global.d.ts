declare global {
  interface Window {
    api?: {
      on: (channel: string, callback: () => void) => void;
      dicom: {
        openFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
        openFolder: () => Promise<{ canceled: boolean; filePaths: string[] }>;
        readFile: (filePath: string) => Promise<ArrayBuffer>;
      };
    };
  }
}

export {};
