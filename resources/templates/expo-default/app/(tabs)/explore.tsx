import { ThemedText } from "@/components/themed-text";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ScrollView, StyleSheet, View } from "react-native";

const SECTIONS = [
  {
    title: "File-Based Routing",
    icon: "folder.fill",
    items: [
      "Screens map to files in the app/ directory",
      "Tab navigation configured in app/(tabs)/_layout.tsx",
      "Add new screens by creating new .tsx files",
    ],
  },
  {
    title: "Cross-Platform",
    icon: "iphone",
    items: [
      "Single codebase for iOS, Android, and web",
      "Platform-specific code via .ios.tsx and .android.tsx",
      "Native look and feel on every platform",
    ],
  },
  {
    title: "NativeWind Styling",
    icon: "paintbrush.fill",
    items: [
      "Tailwind CSS utility classes in React Native",
      "Dark mode support out of the box",
      "Consistent styling across platforms",
    ],
  },
  {
    title: "Backend Ready",
    icon: "externaldrive.fill",
    items: [
      "Ask the AI to add a Convex backend",
      "Real-time database, auth, and file storage",
      "Automatic environment setup",
    ],
  },
  {
    title: "Payments",
    icon: "creditcard.fill",
    items: [
      "Ask the AI to add RevenueCat",
      "In-app purchases and subscriptions",
      "Works with App Store and Google Play",
    ],
  },
  {
    title: "Deploy Anywhere",
    icon: "rocket.fill",
    items: [
      "One-click App Store and Google Play submission",
      "Over-the-air updates without app review",
      "Build tracking and deployment logs",
    ],
  },
];

export default function ExploreScreen() {
  const colorScheme = useColorScheme() ?? "light";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors[colorScheme].background }}
      contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <ThemedText type="title">Explore</ThemedText>
        <ThemedText style={styles.headerSub}>What this template includes and what you can add.</ThemedText>
      </View>

      {SECTIONS.map((section) => (
        <View
          key={section.title}
          style={[
            styles.card,
            {
              backgroundColor: colorScheme === "dark" ? "#1c1c1e" : "#f5f5f7",
              borderColor: colorScheme === "dark" ? "#2c2c2e" : "#e5e5ea",
            },
          ]}>
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.cardIcon,
                {
                  backgroundColor: colorScheme === "dark" ? "#2c2c2e" : "#e5e5ea",
                },
              ]}>
              <IconSymbol name={section.icon as any} size={16} color={Colors[colorScheme].text} />
            </View>
            <ThemedText type="defaultSemiBold">{section.title}</ThemedText>
          </View>
          {section.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={[styles.bullet, { backgroundColor: Colors[colorScheme].icon }]} />
              <ThemedText style={styles.listText}>{item}</ThemedText>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  headerSub: {
    opacity: 0.5,
    marginTop: 4,
    lineHeight: 22,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingLeft: 40,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 8,
    opacity: 0.3,
  },
  listText: {
    flex: 1,
    fontSize: 14,
    opacity: 0.6,
    lineHeight: 20,
  },
});
