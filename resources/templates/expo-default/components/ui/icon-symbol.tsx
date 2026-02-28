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
  // Navigation
  "house.fill": "home",
  "house": "home",
  "arrow.left": "arrow-back",
  "arrow.right": "arrow-forward",
  "arrow.up": "arrow-upward",
  "arrow.down": "arrow-downward",
  "arrow.uturn.left": "undo",
  "arrow.uturn.right": "redo",
  "chevron.left": "chevron-left",
  "chevron.right": "chevron-right",
  "chevron.up": "expand-less",
  "chevron.down": "expand-more",
  "chevron.left.forwardslash.chevron.right": "code",
  "xmark": "close",
  "xmark.circle": "cancel",
  "xmark.circle.fill": "cancel",
  "line.3.horizontal": "menu",
  "line.3.horizontal.decrease": "filter-list",
  "ellipsis": "more-horiz",
  "ellipsis.circle": "more-horiz",
  "magnifyingglass": "search",
  "arrow.clockwise": "refresh",
  "arrow.counterclockwise": "replay",
  "sidebar.left": "menu-open",

  // Content & Actions
  "square.and.arrow.up": "share",
  "square.and.arrow.down": "download",
  "doc.on.doc": "content-copy",
  "doc": "description",
  "doc.text": "article",
  "doc.fill": "description",
  "photo": "image",
  "photo.fill": "image",
  "camera": "photo-camera",
  "camera.fill": "photo-camera",
  "video": "videocam",
  "video.fill": "videocam",
  "mic": "mic",
  "mic.fill": "mic",
  "mic.slash": "mic-off",
  "speaker.wave.2": "volume-up",
  "speaker.slash": "volume-off",
  "folder": "folder",
  "folder.fill": "folder",
  "link": "link",
  "paperclip": "attach-file",
  "paperplane.fill": "send",
  "paperplane": "send",
  "scissors": "content-cut",
  "doc.on.clipboard": "content-paste",
  "play": "play-arrow",
  "play.fill": "play-arrow",
  "play.circle": "play-circle-outline",
  "pause": "pause",
  "pause.fill": "pause",
  "stop": "stop",
  "stop.fill": "stop",
  "forward": "fast-forward",
  "backward": "fast-rewind",
  "goforward": "forward-10",
  "gobackward": "replay-10",

  // Status & Feedback
  "checkmark": "check",
  "checkmark.circle": "check-circle",
  "checkmark.circle.fill": "check-circle",
  "checkmark.square": "check-box",
  "square": "check-box-outline-blank",
  "exclamationmark.triangle": "warning",
  "exclamationmark.triangle.fill": "warning",
  "exclamationmark.circle": "error",
  "info.circle": "info",
  "info.circle.fill": "info",
  "questionmark.circle": "help-outline",
  "bell": "notifications",
  "bell.fill": "notifications",
  "bell.slash": "notifications-off",
  "bolt": "flash-on",
  "bolt.fill": "flash-on",
  "bolt.slash": "flash-off",

  // User & Social
  "person": "person",
  "person.fill": "person",
  "person.circle": "account-circle",
  "person.circle.fill": "account-circle",
  "person.2": "people",
  "person.2.fill": "people",
  "person.crop.circle.badge.plus": "person-add",
  "person.badge.plus": "person-add",
  "heart": "favorite-border",
  "heart.fill": "favorite",
  "hand.thumbsup": "thumb-up",
  "hand.thumbsup.fill": "thumb-up",
  "hand.thumbsdown": "thumb-down",
  "hand.thumbsdown.fill": "thumb-down",
  "message": "chat-bubble-outline",
  "message.fill": "chat-bubble",
  "bubble.left": "chat-bubble-outline",
  "bubble.left.fill": "chat-bubble",
  "envelope": "mail-outline",
  "envelope.fill": "mail",
  "phone": "phone",
  "phone.fill": "phone",

  // Settings & System
  "gear": "settings",
  "gearshape": "settings",
  "gearshape.fill": "settings",
  "lock": "lock-outline",
  "lock.fill": "lock",
  "lock.open": "lock-open",
  "key": "vpn-key",
  "key.fill": "vpn-key",
  "shield": "shield",
  "shield.fill": "shield",
  "creditcard": "credit-card",
  "creditcard.fill": "credit-card",
  "cart": "shopping-cart",
  "cart.fill": "shopping-cart",
  "bag": "shopping-bag",
  "bag.fill": "shopping-bag",
  "slider.horizontal.3": "tune",
  "switch.2": "toggle-on",
  "power": "power-settings-new",
  "rectangle.portrait.and.arrow.right": "logout",
  "arrow.right.square": "login",

  // Data & Time
  "calendar": "calendar-today",
  "calendar.badge.plus": "event",
  "clock": "schedule",
  "clock.fill": "schedule",
  "timer": "timer",
  "alarm": "alarm",
  "alarm.fill": "alarm",
  "chart.bar": "bar-chart",
  "chart.bar.fill": "bar-chart",
  "chart.pie": "pie-chart",
  "chart.pie.fill": "pie-chart",
  "chart.line.uptrend.xyaxis": "show-chart",
  "number": "tag",

  // Editing & Text
  "plus": "add",
  "plus.circle": "add-circle-outline",
  "plus.circle.fill": "add-circle",
  "minus": "remove",
  "minus.circle": "remove-circle-outline",
  "pencil": "edit",
  "pencil.circle": "edit",
  "trash": "delete-outline",
  "trash.fill": "delete",
  "checklist": "checklist",
  "list.bullet": "format-list-bulleted",
  "list.number": "format-list-numbered",
  "text.alignleft": "format-align-left",
  "text.aligncenter": "format-align-center",
  "text.alignright": "format-align-right",
  "textformat": "text-format",
  "bold": "format-bold",
  "italic": "format-italic",

  // Misc
  "star": "star-border",
  "star.fill": "star",
  "bookmark": "bookmark-border",
  "bookmark.fill": "bookmark",
  "flag": "flag",
  "flag.fill": "flag",
  "pin": "push-pin",
  "pin.fill": "push-pin",
  "location": "place",
  "location.fill": "place",
  "map": "map",
  "map.fill": "map",
  "globe": "language",
  "eye": "visibility",
  "eye.fill": "visibility",
  "eye.slash": "visibility-off",
  "moon": "dark-mode",
  "moon.fill": "dark-mode",
  "sun.max": "light-mode",
  "sun.max.fill": "light-mode",
  "cloud": "cloud",
  "cloud.fill": "cloud",
  "cloud.arrow.up": "cloud-upload",
  "cloud.arrow.down": "cloud-download",
  "wifi": "wifi",
  "wifi.slash": "wifi-off",
  "qrcode": "qr-code",
  "barcode": "qr-code-scanner",
  "tag": "label",
  "tag.fill": "label",
  "gift": "card-giftcard",
  "gift.fill": "card-giftcard",
  "paintbrush": "brush",
  "paintbrush.fill": "brush",
  "wand.and.stars": "auto-fix-high",
  "sparkles": "auto-awesome",
  "atom": "science",
  "lightbulb": "lightbulb",
  "lightbulb.fill": "lightbulb",
  "battery.100": "battery-full",
  "battery.25": "battery-alert",
  "airplane": "flight",
  "car": "directions-car",
  "car.fill": "directions-car",
  "figure.walk": "directions-walk",
  "tray": "inbox",
  "tray.fill": "inbox",
  "archivebox": "archive",
  "archivebox.fill": "archive",
  "scope": "my-location",
  "hand.raised": "pan-tool",
  "hand.raised.fill": "pan-tool",
  "rectangle.stack": "layers",
  "rectangle.stack.fill": "layers",
  "square.grid.2x2": "grid-view",
  "square.grid.2x2.fill": "grid-view",
  "circle": "radio-button-unchecked",
  "circle.fill": "circle",
  "drop": "water-drop",
  "drop.fill": "water-drop",
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
