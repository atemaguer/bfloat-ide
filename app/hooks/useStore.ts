import { useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand/vanilla'

/**
 * React hook to subscribe to a zustand vanilla store.
 * Drop-in replacement for `useStore` from `@nanostores/react`.
 */
export function useStore<T>(store: StoreApi<T>): T {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  )
}
