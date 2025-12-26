# Voxe - AI E-book Reader

An AI-powered e-book reader with text-to-speech capabilities. Upload EPUB files and have them read aloud with real-time sentence highlighting.

## Features

- 📚 Upload and parse EPUB files
- 🔊 Text-to-speech with sentence highlighting
- ⏯️ Play, pause, and resume functionality
- 📱 Mobile-friendly responsive design
- 🎯 Click any sentence to start reading from that point
- 🌓 Dark mode support

## Tech Stack

- Next.js 16 (Static Export)
- TypeScript
- Tailwind CSS
- epubjs for EPUB parsing
- Web Speech API for text-to-speech

## Getting Started

### Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Build

```bash
npm run build
```

The static site will be generated in the `out` directory.

## Deployment

This app is configured for GitHub Pages deployment. Push to the `main` branch to trigger automatic deployment via GitHub Actions.

## How to Use

1. Upload an EPUB file using the file input
2. Wait for the book to be parsed (cover pages are automatically skipped)
3. Click the Play button or click any sentence to start reading
4. Click the currently highlighted sentence to pause/resume
5. Click a different sentence to jump to that location

## License

MIT
