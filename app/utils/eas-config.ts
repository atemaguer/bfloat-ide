/**
 * Default EAS configuration for new projects.
 * Matches the production-ready template in templates/expo-default/eas.json.
 */
export function getDefaultEasConfig() {
  return {
    cli: {
      version: '>= 14.0.0',
      appVersionSource: 'remote',
    },
    build: {
      development: {
        developmentClient: true,
        distribution: 'internal',
        ios: {
          simulator: true,
        },
      },
      preview: {
        distribution: 'internal',
        android: {
          buildType: 'apk',
        },
      },
      production: {
        autoIncrement: true,
        ios: {
          credentialsSource: 'remote',
        },
        android: {
          buildType: 'app-bundle',
        },
      },
    },
  }
}
