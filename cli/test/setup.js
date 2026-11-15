// ran once before all tests
const fs = require('fs');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const chai = require('chai');
// chai 5+ and sinon-chai 4 are ES modules, loaded through require(esm); the plugin is the default export
const sinonChai = require('sinon-chai').default;

chai.config.includeStack = true;
chai.use(sinonChai);

// files published for other programs (now-playing, the player back point) go to a directory of the run,
// never the session's $XDG_RUNTIME_DIR/musicman
process.env.XDG_RUNTIME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-test-runtime-'));

global.sinon = sinon;
global.expect = chai.expect;
global.assert = chai.assert;
global.should = chai.should();

console.clear();
console.log(new Date().toLocaleTimeString());
