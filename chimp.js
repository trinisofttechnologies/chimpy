module.exports = {
  // - - - - CHIMP - - - -
  watch: false,
  watchTags: '@watch',
  offline: false,

  webdriverio: {
    desiredCapabilities: {},
    logLevel: 'silent',
    // logOutput: null,
    host: '127.0.0.1',
    port: 4444,
    path: '/wd/hub',
    baseUrl: null,
    coloredLogs: true,
    screenshotPath: null,
    waitforTimeout: 5000,
    waitforInterval: 5000,
  },

  // - - - - CUCUMBER - - - -
  path: './features',

  jsonOutput: 'output.json',

  // '- - - - DEBUGGING  - - - -
  log: 'info',
  debug: false,
  seleniumDebug: false,
  webdriverLogLevel: false,
  // debugBrkCucumber: 5858,
};
