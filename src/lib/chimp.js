/**
 * Externals
 */
let async = require('async'),
  path = require('path'),
  chokidar = require('chokidar'),
  _ = require('underscore'),
  log = require('./log'),
  freeport = require('freeport'),
  DDPClient = require('xolvio-ddp'),
  fs = require('fs'),
  Hapi = require('hapi'),
  AutoupdateWatcher = require('./ddp-watcher'),
  colors = require('colors'),
  booleanHelper = require('./boolean-helper'),
  Versions = require('../lib/versions');

colors.enabled = true;
const DEFAULT_COLOR = 'yellow';

/**
 * Internals
 */
const Mocha = require('./mocha/mocha.js');
const Jasmine = require('./jasmine/jasmine.js');
const Cucumber = require('./cucumberjs/cucumber.js');
const Phantom = require('./phantom.js');
const Chromedriver = require('./chromedriver.js');
const Consoler = require('./consoler.js');
const Selenium = require('./selenium.js');
const SimianReporter = require('./simian-reporter.js');

/**
 * Exposes the binary path
 *
 * @api public
 */
Chimp.bin = path.resolve(__dirname, path.join('..', 'bin', 'chimp'));

Chimp.install = function (callback) {
  log.debug('[chimp]', 'Installing dependencies');
  new Selenium({port: '1'}).install(callback);
};

/**
 * Chimp Constructor
 *
 * Options:
 *    - `browser` browser to run tests in
 *
 * @param {Object} options
 * @api public
 */
function Chimp(options) {
  this.chokidar = chokidar;
  this.options = options || {};
  this.processes = [];
  this.isInterrupting = false;
  this.exec = require('child_process').exec;
  this.fs = fs;
  this.testRunnerRunOrder = [];
  this.watcher = undefined;

  // store all cli parameters in env hash
  // Note: Environment variables are always strings.
  for (const option in options) {
    if (option === 'ddp') {
      handleDdpOption(options);
    } else {
      process.env[`chimp.${option}`] = _.isObject(options[option]) ?
       JSON.stringify(options[option]) :
       String(options[option]);
    }
  }

  this._handleChimpInterrupt();
}

function handleDdpOption(options) {
  if (typeof options.ddp === 'string') {
    process.env['chimp.ddp0'] = String(options.ddp);
    return;
  }
  if (Array.isArray(options.ddp)) {
    options.ddp.forEach((val, index) => {
      process.env[`chimp.ddp${index}`] = String(val);
    });
  }
}

/**
 * Runs an npm install then calls selectMode
 *
 * @param {Function} callback
 * @api public
 */
Chimp.prototype.init = function (callback) {
  const self = this;

  this.informUser();

  try {
    this._initSimianResultBranch();
    this._initSimianBuildNumber();
  } catch (error) {
    callback(error);
    return;
  }

  if (this.options.versions || this.options.debug) {
    const versions = new Versions(this.options);
    if (this.options.debug) {
      versions.show(() => {
        self.selectMode(callback);
      });
    } else {
      versions.show();
    }
  } else {
    self.selectMode(callback);
  }
};

Chimp.prototype.informUser = function () {
  if (this.options.showXolvioMessages) {
    log.info('\nMaster Chimp and become a testing Ninja! Check out our course: '.green + 'http://bit.ly/2btQaFu\n'.blue.underline);
  }

  if (booleanHelper.isTruthy(this.options.criticalSteps)) {
    this.options.e2eSteps = this.options.criticalSteps;
    log.warn('[chimp] Please use e2eSteps instead of criticalSteps. criticalSteps is now deprecated.'.red);
  }

  if (booleanHelper.isTruthy(this.options.criticalTag)) {
    this.options.e2eTags = this.options.criticalTag;
    log.warn('[chimp] Please use e2eTags instead of criticalTag. criticalTag is now deprecated.'.red);
  }

  if (booleanHelper.isTruthy(this.options.mochaTags)
    || booleanHelper.isTruthy(this.options.mochaGrep)
    || booleanHelper.isTruthy(this.options.mochaTimeout)
    || booleanHelper.isTruthy(this.options.mochaReporter)
    || booleanHelper.isTruthy(this.options.mochaSlow)) {
    log.warn('[chimp] mochaXYZ style configs are now deprecated. Please use a mochaConfig object.'.red);
  }
};


Chimp.prototype._initSimianResultBranch = function () {
  // Automatically set the result branch for the common CI tools
  if (this.options.simianAccessToken &&
    this.options.simianResultBranch === null
  ) {
    if (booleanHelper.isTruthy(process.env.CI_BRANCH)) {
      // Codeship or custom
      this.options.simianResultBranch = process.env.CI_BRANCH;
    } else if (booleanHelper.isTruthy(process.env.CIRCLE_BRANCH)) {
      // CircleCI
      this.options.simianResultBranch = process.env.CIRCLE_BRANCH;
    } else if (booleanHelper.isTruthy(process.env.TRAVIS_BRANCH)) {
      // TravisCI
      if (booleanHelper.isFalsey(process.env.TRAVIS_PULL_REQUEST)) {
        this.options.simianResultBranch = process.env.TRAVIS_BRANCH;
      } else {
        // Ignore the builds that simulate the pull request merge,
        // because the branch will be the target branch.
        this.options.simianResultBranch = false;
      }
    } else {
      throw new Error(
        'You have not specified the branch that should be reported to Simian!' +
        ' Do this with the --simianResultBranch argument' +
        ' or the CI_BRANCH environment variable.',
      );
    }
  }
};

Chimp.prototype._initSimianBuildNumber = function _initSimianBuildNumber() {
  // Automatically set the result branch for the common CI tools
  if (this.options.simianAccessToken) {
    if (process.env.CI_BUILD_NUMBER) {
      // Codeship or custom
      this.options.simianBuildNumber = process.env.CI_BUILD_NUMBER;
    } else if (process.env.CIRCLE_BUILD_NUM) {
      // CircleCI
      this.options.simianBuildNumber = process.env.CIRCLE_BUILD_NUM;
    } else if (process.env.TRAVIS_BUILD_NUMBER) {
      // TravisCI
      this.options.simianBuildNumber = process.env.TRAVIS_BUILD_NUMBER;
    }
  }
};

/**
 * Decides which mode to run and kicks it off
 *
 * @param {Function} callback
 * @api public
 */
Chimp.prototype.selectMode = function (callback) {
  if (booleanHelper.isTruthy(this.options.watch)) {
    this.watch();
  } else if (booleanHelper.isTruthy(this.options.server)) {
    this.server();
  } else {
    this.run(callback);
  }
};

/**
 * Watches the file system for changes and reruns when it detects them
 *
 * @api public
 */
Chimp.prototype.watch = function () {
  const self = this;

  let watchDirectories = [];
  if (self.options.watchSource) {
    watchDirectories = (self.options.watchSource.split(','));
  }

  if (self.options.e2eSteps) {
    watchDirectories.push(self.options.e2eSteps);
  }

  if (self.options.domainSteps) {
    watchDirectories.push(self.options.domainSteps);
  }

  watchDirectories.push(self.options.path);

  this.watcher = chokidar.watch(watchDirectories, {
    ignored: /[\/\\](\.|node_modules)/,
    ignoreInitial: true,
    persistent: true,
    usePolling: this.options.watchWithPolling,
  });

  // set cucumber tags to be watch based
  if (booleanHelper.isTruthy(self.options.watchTags)) {
    self.options.tags = self.options.watchTags;
  }

  if (booleanHelper.isTruthy(self.options.ddp)) {
    const autoUpdateWatcher = new AutoupdateWatcher(self.options);
    autoUpdateWatcher.watch(() => {
      log.debug('[chimp] Meteor autoupdate detected');
      self.rerun();
    });
  }

  // wait for initial file scan to complete
  this.watcher.once('ready', () => {
    const watched = [];
    if (_.isArray(self.options.watchTags)) {
      _.each(self.options.watchTags, (watchTag) => {
        watched.push(watchTag.split(','));
      });
    } else if (_.isString(self.options.watchTags)) {
      watched.push(self.options.watchTags.split(','));
    }
    log.info(`[chimp] Watching features with tagged with ${watched.join()}`.white);

    // start watching
    self.watcher.on('all', self._getDebouncedFunction((event, path) => {
      // removing feature files should not rerun
      if (event === 'unlink' && path.match(/\.feature$/)) {
        return;
      }

      log.debug('[chimp] file changed');
      self.rerun();
    }, 500));

    log.debug('[chimp] watcher ready, running for the first time');
    self.rerun();
  });
};

Chimp.prototype._getDebouncedFunction = function (func, timeout) {
  return _.debounce(func, timeout);
};


/**
 * Starts a chimp server on a freeport or on options.serverPort if provided
 *
 * @api public
 */
Chimp.prototype.server = function () {
  const self = this;
  if (!this.options.serverPort) {
    freeport((error, port) => {
      if (error) {
        throw error;
      }
      self._startServer(port);
    });
  } else {
    self._startServer(this.options.serverPort);
  }
};

Chimp.prototype._startServer = function (port) {
  const server = new Hapi.Server();

  server.connection({
    host: this.options.serverHost,
    port,
    routes: {timeout: {server: false, socket: false}},
  });

  this._setupRoutes(server);

  server.start();

  log.info('[chimp] Chimp server is running on port', port, process.env['chimp.ddp']);

  if (booleanHelper.isTruthy(this.options.ddp)) {
    this._handshakeOverDDP();
  }
};

Chimp.prototype._handshakeOverDDP = function () {
  const ddp = new DDPClient({
    host: process.env['chimp.ddp'].match(/http:\/\/(.*):/)[1],
    port: process.env['chimp.ddp'].match(/:([0-9]+)/)[1],
    ssl: false,
    autoReconnect: true,
    autoReconnectTimer: 500,
    maintainCollections: true,
    ddpVersion: '1',
    useSockJs: true,
  });
  ddp.connect((error) => {
    if (error) {
      log.error('[chimp] Error handshaking via DDP');
      throw (error);
    }
  }).then(() => {
    log.debug('[chimp] Handshaking with DDP server');
    ddp.call('handshake').then(() => {
      log.debug('[chimp] Handshake complete, closing DDP connection');
      ddp.close();
    });
  });
};

Chimp.prototype._parseResult = function (res) {
  // FIXME this is shitty, there's got to be a nicer way to deal with variable async chains
  const cucumberResults = res[1][1] ? res[1][1] : res[1][0];
  if (!cucumberResults) {
    log.error('[chimp] Could not get Cucumber Results from run result:');
    log.error(res);
  }
  log.debug('[chimp] Responding to /run request with:');
  log.debug(cucumberResults);
  return cucumberResults;
};

Chimp.prototype._setupRoutes = function (server) {
  const self = this;
  server.route({
    method: 'GET',
    path: '/run',
    handler(request, reply) {
      self.rerun((err, res) => {
        const cucumberResults = self._parseResult(res);
        reply(cucumberResults).header('Content-Type', 'application/json');
      });
    },
  });
  server.route({
    method: 'GET',
    path: '/run/{absolutePath*}',
    handler(request, reply) {
      // / XXX is there a more elegant way we can do this?
      self.options._[2] = request.params.absolutePath;
      self.rerun((err, res) => {
        const cucumberResults = self._parseResult(res);
        reply(cucumberResults).header('Content-Type', 'application/json');
      });
    },
  });
  server.route({
    method: 'GET',
    path: '/interrupt',
    handler(request, reply) {
      self.interrupt((err, res) => {
        reply('done').header('Content-Type', 'application/json');
      });
    },
  });
  server.route({
    method: 'GET',
    path: '/runAll',
    handler(request, reply) {
      self.options._tags = self.options.tags;
      self.options.tags = '~@ignore';
      self.rerun((err, res) => {
        self.options.tags = self.options._tags;
        const cucumberResults = self._parseResult(res);
        reply(cucumberResults).header('Content-Type', 'application/json');
      });
    },
  });
};


/**
 * Starts servers and runs specs
 *
 * @api public
 */
Chimp.prototype.run = function (callback) {
  log.info('\n[chimp] Running...'[DEFAULT_COLOR]);

  const self = this;

  function getJsonCucumberResults(result) {
    const startProcessesIndex = 1;
    if (!result || !result[startProcessesIndex]) {
      return [];
    }

    let jsonResult = '[]';
    _.any(['domain', 'e2e', 'generic'], (type) => {
      const _testRunner = _.findWhere(self.testRunnerRunOrder, {name: 'cucumber', type});
      if (_testRunner) {
        jsonResult = result[startProcessesIndex][_testRunner.index];
        return true;
      }
    });
    return JSON.parse(jsonResult);
  }

  async.series(
    [
      self.interrupt.bind(self),
      self._startProcesses.bind(self),
      self.interrupt.bind(self),
    ],
    (error, result) => {
      if (error) {
        log.debug('[chimp] run complete with errors', error);
        if (booleanHelper.isFalsey(self.options.watch)) {
          self.interrupt(() => {});
        }
      } else {
        log.debug('[chimp] run complete');
      }

      if (self.options.simianAccessToken &&
        self.options.simianResultBranch !== false
      ) {
        const jsonCucumberResult = getJsonCucumberResults(result);
        const simianReporter = new SimianReporter(self.options);
        simianReporter.report(jsonCucumberResult, () => {
          callback(error, result);
        });
      } else {
        callback(error, result);
      }
    },
  );
};

/**
 * Interrupts any running specs in the reverse order. This allows cucumber to shut down first
 * before webdriver servers, otherwise we can get test errors in the console
 *
 * @api public
 */
Chimp.prototype.interrupt = function (callback) {
  log.debug('[chimp] interrupting');

  const self = this;


  self.isInterrupting = true;

  if (!self.processes || self.processes.length === 0) {
    self.isInterrupting = false;
    log.debug('[chimp] no processes to interrupt');
    if (callback) {
      callback();
    }
    return;
  }

  log.debug('[chimp]', self.processes.length, 'processes to interrupt');

  const reverseProcesses = [];
  while (self.processes.length !== 0) {
    reverseProcesses.push(self.processes.pop());
  }

  const processes = _.collect(reverseProcesses, process => process.interrupt.bind(process));

  async.series(processes, function (error, r) {
    self.isInterrupting = false;
    log.debug('[chimp] Finished interrupting processes');
    if (error) {
      log.error('[chimp] with errors', error);
    }
    if (callback) {
      callback.apply(this, arguments);
    }
  });
};

/**
 * Combines the interrupt and run methods and latches calls
 *
 * @api public
 */
Chimp.prototype.rerun = function (callback) {
  log.debug('[chimp] rerunning');

  const self = this;

  if (self.isInterrupting) {
    log.debug('[chimp] interrupt in progress, ignoring rerun');
    return;
  }

  self.run((err, res) => {
    if (callback) {
      callback(err, res);
    }
    log.debug('[chimp] finished rerun');
  });
};

/**
 * Starts processes in series
 *
 * @api private
 */
Chimp.prototype._startProcesses = function (callback) {
  const self = this;

  self.processes = self._createProcesses();


  const processes = self.processes.map(process => process.start.bind(process));

  // pushing at least one processes guarantees the series below runs
  processes.push((callback) => {
    log.debug('[chimp] Finished running async processes');
    callback();
  });

  async.series(processes, (err, res) => {
    if (err) {
      self.isInterrupting = false;
      log.debug('[chimp] Finished running async processes with errors');
    }
    callback(err, res);
  });
};

/**
 * Creates the correct sequence of servers needed prior to running cucumber
 *
 * @api private
 */
Chimp.prototype._createProcesses = function () {
  const processes = [];
  const self = this;

  const addTestRunnerToRunOrder = function (name, type) {
    self.testRunnerRunOrder.push({name, type, index: processes.length - 1});
  };

  const userHasNotProvidedSeleniumHost = function () {
    return booleanHelper.isFalsey(self.options.host);
  };

  const userHasProvidedBrowser = function () {
    return booleanHelper.isTruthy(self.options.browser);
  };

  if (!this.options.domainOnly) {
    if (this.options.browser === 'phantomjs') {
      process.env['chimp.host'] = this.options.host = 'localhost';
      const phantom = new Phantom(this.options);
      processes.push(phantom);
    } else if (userHasProvidedBrowser() && userHasNotProvidedSeleniumHost()) {
      process.env['chimp.host'] = this.options.host = 'localhost';
      const selenium = new Selenium(this.options);
      processes.push(selenium);
    } else if (userHasNotProvidedSeleniumHost()) {
      // rewrite the browser to be chrome since "chromedriver" is not a valid browser
      process.env['chimp.browser'] = this.options.browser = 'chrome';
      process.env['chimp.host'] = this.options.host = 'localhost';
      const chromedriver = new Chromedriver(this.options);
      processes.push(chromedriver);
    }
  }

  if (booleanHelper.isTruthy(this.options.mocha)) {
    const mocha = new Mocha(this.options);
    processes.push(mocha);
  } else if (booleanHelper.isTruthy(this.options.jasmine)) {
    const jasmine = new Jasmine(this.options);
    processes.push(jasmine);
  } else if (booleanHelper.isTruthy(this.options.e2eSteps) || booleanHelper.isTruthy(this.options.domainSteps)) {
      // domain scenarios
    if (booleanHelper.isTruthy(this.options.domainSteps)) {
      const options = JSON.parse(JSON.stringify(this.options));
      if (options.r) {
        options.r = _.isArray(options.r) ? options.r : [options.r];
      } else {
        options.r = [];
      }
      const message = '\n[chimp] domain scenarios...';
      options.r.push(options.domainSteps);

      if (booleanHelper.isTruthy(options.fullDomain)) {
        delete options.tags;
      }

      if (!this.options.domainOnly) {
        processes.push(new Consoler(message[DEFAULT_COLOR]));
      }
      processes.push(new Cucumber(options));
      addTestRunnerToRunOrder('cucumber', 'domain');
      processes.push(new Consoler(''));
    }
    if (booleanHelper.isTruthy(this.options.e2eSteps)) {
        // e2e scenarios
      const options = JSON.parse(JSON.stringify(this.options));
      if (options.r) {
        options.r = _.isArray(options.r) ? options.r : [options.r];
      } else {
        options.r = [];
      }

      options.tags = options.tags.split(',');
      options.tags.push(options.e2eTags);
      options.tags = options.tags.join();

      const message = `\n[chimp] ${options.e2eTags} scenarios ...`;
      options.r.push(options.e2eSteps);
      processes.push(new Consoler(message[DEFAULT_COLOR]));
      processes.push(new Cucumber(options));
      addTestRunnerToRunOrder('cucumber', 'e2e');
      processes.push(new Consoler(''));
    }
  } else {
    const cucumber = new Cucumber(this.options);
    processes.push(cucumber);
    addTestRunnerToRunOrder('cucumber', 'generic');
  }

  return processes;
};

/**
 * Uses process.kill wen interrupted by Meteor so that Selenium shuts down correctly for node 0.10.x
 *
 * @api private
 */
Chimp.prototype._handleChimpInterrupt = function () {
  const self = this;
  process.on('SIGINT', () => {
    log.debug('[chimp] SIGINT detected, killing process');
    process.stdin.end();
    self.interrupt();
    if (booleanHelper.isTruthy(self.options.watch)) {
      self.watcher.close();
    }
  });
};

module.exports = Chimp;
