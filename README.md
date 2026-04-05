# stillRating for flathub
show stillRating score in flathub app pages

## Build

- Firefox: `node scripts/build-firefox.mjs`
- Chrome: `node scripts/build-chrome.mjs`

The Chrome build writes an unpacked extension to `dist/chrome` and an uploadable archive to `dist/stillrating-for-flathub-chrome-v<version>.zip`.
