import { ConveyorApi } from '@/lib/preload/shared'

export class ScreenshotApi extends ConveyorApi {
  capture = (url: string, webContentsId?: number) => this.invoke('screenshot:capture', url, webContentsId)
}
