/**
 * Shared IPC result envelope for Electron main ↔ renderer contracts.
 * Use discriminated union so clients can narrow on `success`.
 */

export type IpcSuccess<T> = { success: true; data: T };

export type IpcFailure = {
  success: false;
  code: string;
  message: string;
  details?: unknown;
};

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

export function ipcOk<T>(data: T): IpcSuccess<T> {
  return { success: true, data };
}

export function ipcErr(code: string, message: string, details?: unknown): IpcFailure {
  return { success: false, code, message, ...(details !== undefined ? { details } : {}) };
}

export function isIpcSuccess<T>(r: IpcResult<T>): r is IpcSuccess<T> {
  return r.success === true;
}
