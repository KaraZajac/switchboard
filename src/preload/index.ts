import { contextBridge, ipcRenderer } from 'electron'
import type { MainToRendererEvents, RendererToMainInvocations } from '@shared/types/ipc'

/** Typed API exposed to the renderer via contextBridge */
const api = {
  /** Invoke a main process handler and await result */
  invoke<K extends keyof RendererToMainInvocations>(
    channel: K,
    ...args: Parameters<RendererToMainInvocations[K]>
  ): ReturnType<RendererToMainInvocations[K]> {
    return ipcRenderer.invoke(channel, ...args) as ReturnType<RendererToMainInvocations[K]>
  },

  /** Listen for events from main process */
  on<K extends keyof MainToRendererEvents>(
    channel: K,
    callback: (data: MainToRendererEvents[K]) => void
  ): () => void {
    const handler = (_event: Electron.IpcRendererEvent, data: MainToRendererEvents[K]) => {
      callback(data)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /** Listen for a single event from main process */
  once<K extends keyof MainToRendererEvents>(
    channel: K,
    callback: (data: MainToRendererEvents[K]) => void
  ): void {
    ipcRenderer.once(channel, (_event, data) => callback(data))
  }
}

export type SwitchboardAPI = typeof api

contextBridge.exposeInMainWorld('switchboard', api)
