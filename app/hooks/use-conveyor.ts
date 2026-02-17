type ConveyorKey = keyof Window['conveyor']

/**
 * Use the conveyor for inter-process communication
 *
 * @param key - The key of the conveyor object to use
 * @returns The conveyor object or the keyed object
 */
export const useConveyor = <T extends ConveyorKey | undefined = undefined>(
  key?: T
): T extends ConveyorKey ? Window['conveyor'][T] | undefined : Window['conveyor'] | undefined => {
  const conveyor = window.conveyor

  if (!conveyor) {
    return undefined
  }

  if (key) {
    return conveyor[key] as any
  }

  return conveyor as any
}
