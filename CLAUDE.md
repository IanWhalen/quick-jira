# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Raycast extension called "Quick Jira" that provides a quick form interface for creating Jira issues. The extension collects issue details (summary, description, type, priority) and then opens the main Jira extension with the summary copied to clipboard.

## Architecture

- **Single component architecture**: The entire functionality is contained in `src/quick-jira.tsx`
- **Raycast extension**: Built using `@raycast/api` framework with Form components
- **No-view mode**: Extension runs in "no-view" mode as defined in package.json
- **Integration pattern**: Copies data to clipboard and opens the main Jira extension via deep link

## Development Commands

```bash
# Development server
npm run dev

# Build the extension
npm run build

# Linting
npm run lint
npm run fix-lint

# Publish to Raycast Store
npm run publish
```

## Key Files

- `src/quick-jira.tsx` - Main and only component containing the form interface
- `package.json` - Extension configuration and dependencies
- `tsconfig.json` - TypeScript configuration with ES2023 target
- `eslint.config.js` - ESLint configuration using @raycast/eslint-config

## Technical Details

- Uses React hooks (useState) from @raycast/api
- Form submission copies summary to clipboard and opens `raycast://extensions/raycast/jira/create-issue`
- TypeScript with strict mode enabled
- ESLint configured with Raycast's standard config