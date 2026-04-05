# stillRating for flathub
show stillRating score in flathub app pages

## Build

- Firefox: `node scripts/build-firefox.mjs`
- Chrome: `node scripts/build-chrome.mjs`

The Firefox build writes an `.xpi` to `.build/xpi/stillrating-for-flathub-firefox.xpi`.
The Chrome build writes an unpacked extension to `.build/chrome` and an uploadable archive to `.build/chrome/stillrating-for-flathub-chrome-v<version>.zip`.
