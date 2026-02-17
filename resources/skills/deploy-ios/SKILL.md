---
name: deploy-ios
description: Deploy iOS apps to the App Store via EAS Build and TestFlight
version: 1.0.1
license: MIT
allowed-tools: Read, Grep, Bash
---

# iOS Deployment

Autonomous iOS deployment to the App Store via EAS Build and TestFlight.

## Input

This skill expects to be invoked with:

```
/deploy-ios
```

The Apple session is handled automatically via the cached Fastlane cookie at `~/.app-store/auth/<email>/cookie`.

## When to Use

Use this when the user wants to deploy an iOS app to the App Store.

**First-time setup required:** For first-time iOS deployment, you must use the Deploy Modal ("Publish to iOS App Store" button) at least once. The modal will:
- Link your app to App Store Connect
- Save the association on EAS servers
- Display the ASC App ID in the logs

After the modal completes, extract the ASC App ID from the logs (shown as `ASC App ID: XXXXXXXXXX`) and add it to `eas.json`:

```bash
jq '.submit.production.ios.ascAppId = "YOUR_ASC_APP_ID"' eas.json > eas.json.tmp && mv eas.json.tmp eas.json
```

Once `ascAppId` is saved, this skill can handle fully automatic deployments.

## Prerequisites

- User is logged in to Expo (`eas whoami` works)
- Project has an `app.json` or `app.config.js`
- Apple session is cached at `~/.app-store/auth/<email>/cookie`
- App has been linked to App Store Connect via the modal at least once
- `ascAppId` is saved in `eas.json` under `submit.production.ios.ascAppId`

## Deployment Process

### 1. Verify Project Setup

First, ensure the project is properly configured and check for ASC App ID:

```bash
# Check app.json exists
cat app.json | jq '.expo.ios.bundleIdentifier'

# Check if ascAppId is configured
cat eas.json | jq '.submit.production.ios.ascAppId'
```

If `ascAppId` is `null` or missing, the user needs to run the Deploy Modal first to link the app.

### 2. Configure EAS

Initialize EAS if not already done:

```bash
npx -y eas-cli init --non-interactive
```

### 3. Commit Changes

Ensure all changes are committed:

```bash
git add -A
git commit -m "Configure for deployment" --allow-empty || true
```

### 4. Install Dependencies

EAS needs to resolve plugins, so install dependencies first:

```bash
npm install --legacy-peer-deps
```

### 5. Run EAS Build with Auto-Submit

```bash
npx -y eas-cli build --platform ios --profile production --non-interactive --auto-submit
```

**Flags explained:**

- `--platform ios`: Build for iOS
- `--profile production`: Use production build profile
- `--non-interactive`: Don't prompt for input (uses cached session)
- `--auto-submit`: Automatically submit to TestFlight after build (requires `ascAppId`)

### 6. Monitor Build Progress

The build process will output progress. Monitor for:

- Build queue status
- Build URL (for EAS dashboard)
- Submission status to TestFlight

### 7. Report Results

After deployment completes:

- **Success**: Report the build URL and TestFlight submission status
- **Failure**: Report the error message and suggest next steps

## Common Issues

### "No app associated with this project"

This means the project hasn't been linked to an EAS project yet. Run:

```bash
npx -y eas-cli init --non-interactive
```

### "Set ascAppId in the submit profile"

The app hasn't been linked to App Store Connect yet. Run the Deploy Modal ("Publish to iOS App Store" button) to complete the first-time setup. After the modal completes:

1. Find the `ASC App ID` in the build logs (format: `ASC App ID: XXXXXXXXXX`)
2. Save it to `eas.json`:
```bash
jq '.submit.production.ios.ascAppId = "XXXXXXXXXX"' eas.json > eas.json.tmp && mv eas.json.tmp eas.json
```

### "Session expired" or "Not logged in"

The cached Apple session may have expired. Ask the user to sign in again through the deployment modal.

### Build fails with "Signing Capabilities"

This means the provisioning profiles or certificates are missing. EAS should handle this automatically with remote credentials, but if it fails:

1. Check that the project owner has an Apple Developer account
2. Verify the bundle identifier is unique
3. Try `eas credentials:reset` if needed

## Example Full Deployment

```bash
# Navigate to project (use current project path)
cd .

# Ensure git is initialized
git init && git add -A && git commit -m "Configure for deployment" --allow-empty || true

# Install dependencies (EAS needs to resolve plugins)
npm install --legacy-peer-deps

# Initialize EAS if needed
npx -y eas-cli init --non-interactive

# Build and submit (requires ascAppId to be configured)
npx -y eas-cli build --platform ios --profile production --non-interactive --auto-submit
```

## Output to User

Always inform the user about:

1. What step you're on (e.g., "Initializing EAS project...", "Building iOS app...")
2. Any URLs they can visit to monitor progress (EAS dashboard)
3. Final success/failure status
4. Next steps (e.g., "Test the app in TestFlight", "Check for build errors in EAS dashboard")
