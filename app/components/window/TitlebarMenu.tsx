import { useEffect, useRef } from 'react'
import { useWindowContext } from '@/app/components/window'
import { useTitlebarContext } from './TitlebarContext'
import { window as windowApi } from '@/app/api/sidecar'

const TitlebarMenu = () => {
  const { menuItems } = useWindowContext().titlebar
  if (!menuItems) return null

  return (
    <div className="window-titlebar-menu">
      {menuItems.map((menu, index) => (
        <TitlebarMenuItem key={index} menu={menu} index={index} />
      ))}
    </div>
  )
}

const TitlebarMenuItem = ({ menu, index }: { menu: TitlebarMenu; index: number }) => {
  const { activeMenuIndex, setActiveMenuIndex } = useTitlebarContext()
  const menuItemRef = useRef<HTMLDivElement>(null)

  const togglePopup = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (activeMenuIndex === index) {
      menuItemRef.current?.classList.remove('active')
      setActiveMenuIndex(null)
    } else if (!menuItemRef.current?.classList.contains('active')) {
      setActiveMenuIndex(index)
      menuItemRef.current?.classList.add('active')
    }
  }

  const handleMouseOver = () => {
    if (activeMenuIndex != null) setActiveMenuIndex(index)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        menuItemRef.current &&
        !menuItemRef.current.contains(target) &&
        menuItemRef.current.classList.contains('active')
      ) {
        setActiveMenuIndex(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [setActiveMenuIndex])

  useEffect(() => {
    menuItemRef.current?.classList.toggle('active', activeMenuIndex === index)
  }, [activeMenuIndex, index])

  return (
    <div className="titlebar-menuItem" ref={menuItemRef}>
      <div
        className="menuItem-label"
        role="button"
        tabIndex={0}
        onClick={togglePopup}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            togglePopup(e as any)
          }
        }}
        onMouseOver={handleMouseOver}
        onFocus={handleMouseOver}
        onMouseDown={(e) => e.preventDefault()}
      >
        {menu.name}
      </div>
      {activeMenuIndex === index && <TitlebarMenuPopup menu={menu} />}
    </div>
  )
}

const TitlebarMenuPopup = ({ menu }: { menu: TitlebarMenu }) => (
  <div className="menuItem-popup">
    {menu.items.map((item, index) => (
      <TitlebarMenuPopupItem key={index} item={item} />
    ))}
  </div>
)

const TitlebarMenuPopupItem = ({ item }: { item: TitlebarMenuItem }) => {
  const { setActiveMenuIndex } = useTitlebarContext()

  const handleAction = () => {
    if (typeof item.actionCallback === 'function') {
      item.actionCallback()
    } else if (item.action && (windowApi as any)[item.action]) {
      (windowApi as any)[item.action](...(item.actionParams || []))
    }
    setActiveMenuIndex(null)
  }

  if (item.name === '---') {
    return <div className="menuItem-popupItem menuItem-separator" />
  }

  return (
<div
        role="button"
        tabIndex={0}
        className="titlebar-menu-item"
        onClick={() => setActiveMenuIndex(index)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setActiveMenuIndex(index)
          }
        }}
        onMouseOver={() => setActiveMenuIndex(index)}
        onFocus={() => setActiveMenuIndex(index)}
      >
      <div>{item.name}</div>
      {item.shortcut && <div className="menuItem-shortcut">{item.shortcut}</div>}
    </div>
  )
}

interface TitlebarMenuItem {
  name: string
  action?: string
  actionParams?: (string | number | object)[]
  shortcut?: string
  items?: TitlebarMenuItem[]
  actionCallback?: () => void
}

interface TitlebarMenu {
  name: string
  items: TitlebarMenuItem[]
}

export { TitlebarMenu, TitlebarMenuItem, TitlebarMenuPopup, TitlebarMenuPopupItem }
