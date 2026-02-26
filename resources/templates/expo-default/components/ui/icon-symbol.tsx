// Fallback for using MaterialIcons on Android and web.
import { ComponentProps } from "react";

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolViewProps, SymbolWeight } from "expo-symbols";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Partial<
  Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>
>;
type IconSymbolName = SymbolViewProps["name"];

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  checklist: "checklist",
  person: "person",
  envelope: "mail-outline",
  lock: "lock-outline",
  checkmark: "check",
  trash: "delete-outline",
  plus: "add",
  pencil: "edit",
  "rectangle.portrait.and.arrow.right": "logout",
} as IconMapping;

const FALLBACK_ICON: ComponentProps<typeof MaterialIcons>["name"] = "help-outline";
const warnedIcons = new Set<string>();

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  const mappedName = MAPPING[name];
  const iconName = mappedName ?? FALLBACK_ICON;

  if (__DEV__ && !mappedName && !warnedIcons.has(name)) {
    warnedIcons.add(name);
    console.warn(`[IconSymbol] Missing mapping for "${name}", using "${FALLBACK_ICON}".`);
  }

  return <MaterialIcons color={color} size={size} name={iconName} style={style} />;
}
