# Release Process

This document explains how to build and publish Bfloat IDE releases.

## ⚠️ Critical: Notarization Requirement

**All apps uploaded to S3 MUST be notarized.** Un-notarized apps will show "damaged and can't be opened" errors to users on macOS.

## Prerequisites

### One-Time Setup

1. **Sign Apple Developer Agreement**:
   - Visit: https://developer.apple.com/account/
   - Sign in with your Apple ID
   - Accept any pending agreements
   - This is required for notarization

2. **Configure Environment Variables** (`.env` file):
   ```bash
   # Code Signing
   CSC_NAME="Developer ID Application: Your Name (TEAMID)"

   # Notarization (Apple ID method)
   APPLE_ID=your@email.com
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   APPLE_TEAM_ID=XXXXXXXXXX

   # AWS S3 for Updates
   AWS_ACCESS_KEY_ID=your_key
   AWS_SECRET_ACCESS_KEY=your_secret
   AWS_REGION=us-west-2
   UPDATES_BUCKET=bfloat-ide-updates
   UPDATE_CHANNEL=stable
   ```

3. **Verify S3 Bucket Exists**:
   ```bash
   aws s3 ls s3://bfloat-ide-updates
   ```

## Release Workflows

### Production Release (Recommended)

**Single command for complete release**:
```bash
npm run build:mac:publish
```

This will:
1. ✅ Build the app with production settings
2. ✅ Code sign with Developer ID certificate
3. ✅ Submit to Apple for notarization (~5-10 minutes)
4. ✅ Staple notarization ticket
5. ✅ Upload to S3 for distribution

### Step-by-Step Release

If you prefer to run each step individually:

```bash
# 1. Build with code signing
npm run build:mac:prod

# 2. Notarize (required for distribution)
npm run notarize

# 3. Upload to S3
npm run upload:updates
```

### Development Build (No Distribution)

For local testing only (not for distribution):

```bash
# Build without code signing
npm run build:mac:dev

# Remove quarantine to test locally
xattr -cr dist/mac-arm64/Bfloat.app
```

## Build Scripts Reference

| Script | Purpose | Use Case |
|--------|---------|----------|
| `build:mac:dev` | Build without code signing | Local testing only |
| `build:mac:prod` | Build with code signing | Testing signed builds |
| `build:mac:notarize` | Build + Notarize | Testing notarization |
| `build:mac:publish` | **Complete release** | **Production releases** |
| `notarize` | Notarize existing build | Standalone notarization |
| `upload:updates` | Upload to S3 | Standalone upload |

## Notarization Verification

The upload script **automatically verifies** that macOS apps are notarized before uploading.

**If notarization fails**, you'll see:
```
❌ ERROR: macOS app is NOT notarized!
⚠️  Uploading un-notarized apps will cause "damaged and can't be opened" errors for users.
```

**To fix**:
1. Ensure Apple Developer Agreement is signed
2. Run `npm run build:mac:publish` (includes notarization)

**To bypass** (NOT recommended for production):
```bash
SKIP_NOTARIZATION_CHECK=1 npm run upload:updates
```

## Version Management

1. **Update version** in `package.json`:
   ```json
   {
     "version": "0.2.0"
   }
   ```

2. **Build and publish**:
   ```bash
   npm run build:mac:publish
   ```

3. **Users automatically receive updates**:
   - Apps check for updates on startup
   - Download in background
   - Prompt user to restart
   - Seamless update experience

## Update Channels

Configure different release channels using `UPDATE_CHANNEL` environment variable:

```bash
# Stable (default)
UPDATE_CHANNEL=stable npm run build:mac:publish

# Beta testing
UPDATE_CHANNEL=beta npm run build:mac:publish

# Canary (bleeding edge)
UPDATE_CHANNEL=canary npm run build:mac:publish
```

Users on different channels receive updates from their respective S3 paths:
- `stable/darwin/arm64/latest-mac.yml`
- `beta/darwin/arm64/latest-mac.yml`
- `canary/darwin/arm64/latest-mac.yml`

## Troubleshooting

### "App is damaged and can't be opened"

**Cause**: App is not notarized

**Fix**:
1. For local testing: `xattr -cr dist/mac-arm64/Bfloat.app`
2. For distribution: Run `npm run build:mac:publish`

### Notarization Fails with 403 Error

**Cause**: Apple Developer Agreement not signed or expired

**Fix**:
1. Visit https://developer.apple.com/account/
2. Sign in and accept pending agreements

### Upload Fails - "App not notarized"

**Cause**: Protection against distributing broken apps

**Fix**: Use `npm run build:mac:publish` instead of separate commands

### Build is Slow

**Optimization**:
- Electron download (~110 MB) is cached after first build
- Notarization typically takes 5-10 minutes
- Use `build:mac:dev` for rapid iteration (no signing/notarization)

## Security Notes

- **Never commit `.env` file** - Contains signing credentials
- **Code signing certificate** is stored in macOS Keychain
- **App-specific password** is required (not your Apple ID password)
- **S3 uploads** use secure AWS credentials
- **Notarized apps** provide users with verified, safe updates

## Verification

After uploading, verify the release:

1. **Check S3 bucket**:
   ```bash
   aws s3 ls s3://bfloat-ide-updates/
   ```

2. **Test update manifest**:
   ```bash
   curl https://bfloat-ide-updates.s3.us-west-2.amazonaws.com/latest-mac.yml
   ```

3. **Verify notarization**:
   ```bash
   spctl -a -vv dist/mac-arm64/Bfloat.app
   # Should show: "accepted" and "Notarized Developer ID"
   ```

## Auto-Update Flow

1. **User launches app** → Checks S3 for `latest-mac.yml`
2. **New version found** → Downloads ZIP in background
3. **Download complete** → Shows dialog: "Restart to update"
4. **User clicks Restart** → App updates and relaunches
5. **Success** → User running new version

## Cost Estimates

**S3 Storage**: ~$0.006/GB/month (~$1.44/year for 20 releases)
**S3 Transfer**: First 100 GB/month free (~400 user updates)
**Apple Developer**: $99/year (required for code signing and notarization)

## Support

For issues with:
- **Building**: Check electron-builder logs in terminal
- **Code signing**: Verify certificate in Keychain Access
- **Notarization**: Check Apple Developer account status
- **S3 uploads**: Verify AWS credentials and bucket permissions
