// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// CRITICAL: Add 'cjs' extension for Firebase SDK compatibility
// Without this, Firebase modules fail to resolve in React Native
config.resolver.sourceExts.push("cjs");

module.exports = config;
