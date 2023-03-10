import {defineConfig} from 'cypress';

export default defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/*.cy.ts',
    chromeWebSecurity: false,
    video: false,
    setupNodeEvents(on) {
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.family === 'chromium') {
          launchOptions.args.push(
              `--unsafely-treat-insecure-origin-as-secure=http://armada.local`);
          launchOptions.args.push('--disable-site-isolation-trials');
        }

        return launchOptions;
      })
    },
  },
});
