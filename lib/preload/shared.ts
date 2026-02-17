import type { ElectronAPI, IpcRenderer } from '@electron-toolkit/preload'
import type { ChannelName, ChannelArgs, ChannelReturn } from '@/lib/conveyor/schemas'

export abstract class ConveyorApi {
  protected renderer: IpcRenderer

  constructor(electronApi: ElectronAPI) {
    this.renderer = electronApi.ipcRenderer
  }

  invoke = async <T extends ChannelName>(channel: T, ...args: ChannelArgs<T>): Promise<ChannelReturn<T>> => {
    // Call the IPC method without runtime validation in preload
    // Validation happens on the main process side
    return this.renderer.invoke(channel, ...args) as Promise<ChannelReturn<T>>
  }

  /**
   * Subscribe to an IPC event channel
   * @param channel - The event channel name
   * @param callback - The callback function to handle the event
   * @returns A function to unsubscribe from the event
   */
  on = <T>(channel: string, callback: (data: T) => void): (() => void) => {
    const handler = (_event: unknown, data: T) => callback(data)
    this.renderer.on(channel, handler)
    return () => {
      this.renderer.removeListener(channel, handler)
    }
  }
}
