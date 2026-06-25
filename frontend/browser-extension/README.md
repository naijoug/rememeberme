# Remember Me Frontend
> "Words remember you, too."

The browser extension frontend for Remember Me. It helps you track and manage unfamiliar English words to improve your language learning efficiency.

## Features

- 📝 **Smart Word Selection** - Select any English word on any webpage to automatically display its definition
- 📚 **Vocabulary Management** - Record unfamiliar words with complete context and source information
- 🔄 **Repetition Tracking** - Automatically count how many times you've forgotten each word
- 💾 **Local Storage** - All data is stored locally to protect your privacy
- 🎯 **Quick Access** - View your saved vocabulary list through a convenient popup interface

## Local Development

Run browser-extension commands from this directory:

```bash
cd frontend/browser-extension
npm test
npm run compile
npm run build
npm run dev
```

### Requirements

- Node.js 16+
- npm or yarn

### Install Dependencies

```bash
cd frontend/browser-extension
npm install
```

### Start Development Server

```bash
# Chrome/Edge development mode
npm run dev

# Firefox development mode
npm run dev:firefox
```

### Load Extension in Browser

#### Chrome/Edge

1. Open your browser and navigate to `chrome://extensions/` (Chrome) or `edge://extensions/` (Edge)
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Select the `frontend/browser-extension/.output/chrome-mv3` directory from the project root, or `.output/chrome-mv3` from this directory

#### Firefox

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` file from the `frontend/browser-extension/.output/firefox-mv2` directory from the project root, or `.output/firefox-mv2` from this directory

### Development Features

- 🔥 **Hot Reload** - Automatic rebuild and reload on code changes
- 🐛 **Debug Support** - Full Source Maps support
- ⚡ **Fast Build** - Lightning-fast development experience powered by Vite

### Testing the Extension

Test the extension on any webpage:

1. Visit any webpage with English content
2. Select an English word
3. View the popup definition card
4. Click the "Forget" button to save the word
5. Click the extension icon in the browser toolbar to view your saved vocabulary list

### Run Tests

```bash
# Run all tests
npm test

# Watch mode (for development)
npm run test:watch
```

### Type Checking

```bash
npm run compile
```

## Build and Release

### Build for Production

```bash
# Build Chrome/Edge version
npm run build

# Build Firefox version
npm run build:firefox

# Package as zip files (for uploading to extension stores)
npm run zip
npm run zip:firefox
```

Build output locations:
- Chrome/Edge: `frontend/browser-extension/.output/chrome-mv3.zip`
- Firefox: `frontend/browser-extension/.output/firefox-mv2.zip`

## Tech Stack

- **Framework**: [WXT](https://wxt.dev/) - Modern browser extension development framework
- **UI**: Vue 3 - Reactive user interface
- **Language**: TypeScript - Type safety
- **Build Tool**: Vite - Fast development and build experience
- **Testing**: Vitest - Unit and integration testing

## Project Structure

```
frontend/browser-extension/
├── entrypoints/          # Extension entry points
│   ├── background.ts     # Background script
│   ├── content.ts        # Content script
│   └── popup/            # Popup interface
├── components/           # Vue components
│   ├── SelectionPopup.vue    # Word selection popup
│   ├── WordList.vue          # Vocabulary list
│   └── WordDetail.vue        # Word details
├── services/             # Business logic
│   ├── storage.ts        # Storage service
│   ├── dictionary.ts     # Dictionary API
│   └── context-extractor.ts  # Context extraction
├── types/                # TypeScript type definitions
├── assets/               # Static assets
└── public/               # Public resources (icons, etc.)
```

## Troubleshooting

### Development Server Fails to Start

Make sure no other process is using port 3000, or modify the port configuration in `wxt.config.ts`.

### Extension Won't Load

1. Confirm that "Developer mode" is enabled in your browser
2. Check if build output exists in the `.output` directory
3. Try running `npm run dev` again

### Hot Reload Not Working

1. Click the "Reload" button on the browser's extension management page
2. Or restart the development server

## License

MIT

## Contributing

Issues and Pull Requests are welcome!
