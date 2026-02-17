/**
 * Template API
 *
 * Renderer-side API for project template operations.
 */

import { ConveyorApi } from '@/lib/preload/shared'

export class TemplateApi extends ConveyorApi {
  /**
   * Initialize a project directory from a template
   * Note: Using renderer.invoke directly because these channels aren't in the typed schema
   */
  initialize = (projectPath: string, appType: string): Promise<{ success: boolean; error?: string }> =>
    this.renderer.invoke('template:initialize', { projectPath, appType }) as Promise<{ success: boolean; error?: string }>

  /**
   * List available templates
   */
  list = (): Promise<{ id: string; name: string; type: string }[]> =>
    this.renderer.invoke('template:list') as Promise<{ id: string; name: string; type: string }[]>

  /**
   * Get template path for app type
   */
  getPath = (appType: string): Promise<string> =>
    this.renderer.invoke('template:get-path', appType) as Promise<string>
}
