import { createContext, useContext, useEffect, useState } from 'react'
import { Titlebar, TitlebarProps } from './Titlebar'
import { TitlebarContextProvider } from './TitlebarContext'
import type { ChannelReturn } from '@/lib/conveyor/schemas'
import { useConveyor } from '@/app/hooks/use-conveyor'

type WindowInitProps = ChannelReturn<'window-init'>

interface WindowContextProps {
  titlebar: TitlebarProps
  readonly window: WindowInitProps | undefined
}

const WindowContext = createContext<WindowContextProps | undefined>(undefined)

export const WindowContextProvider = ({
  children,
  titlebar = {
    title: 'Bfloat',
    icon: 'appIcon.png',
    titleCentered: false,
    menuItems: [],
  },
}: {
  children: React.ReactNode
  titlebar?: TitlebarProps
}) => {
  const [initProps, setInitProps] = useState<WindowInitProps>()
  const windowApi = useConveyor('window')

  useEffect(() => {
    if (windowApi?.windowInit) {
      windowApi.windowInit().then(setInitProps)
    }

    // Add class to parent element
    const parent = document.querySelector('.window-content')?.parentElement
    parent?.classList.add('window-frame')

    // Track fullscreen state via CSS class on document element
    if (windowApi?.windowIsFullscreen) {
      windowApi.windowIsFullscreen().then((isFs) => {
        document.documentElement.classList.toggle('is-fullscreen', isFs)
      })
    }
    if (windowApi?.onFullscreenChange) {
      return windowApi.onFullscreenChange((isFs) => {
        document.documentElement.classList.toggle('is-fullscreen', isFs)
      })
    }
  }, [windowApi])

  return (
    <WindowContext.Provider value={{ titlebar, window: initProps }}>
      <TitlebarContextProvider>
        <Titlebar />
      </TitlebarContextProvider>
      <div className="window-content">{children}</div>
    </WindowContext.Provider>
  )
}

export const useWindowContext = () => {
  const context = useContext(WindowContext)
  if (!context) {
    throw new Error('useWindowContext must be used within a WindowContextProvider')
  }
  return context
}
