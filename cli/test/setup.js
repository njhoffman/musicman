// ran once before all tests
const sinon = require('sinon');
const chai = require('chai');
// chai 5+ and sinon-chai 4 are ES modules, loaded through require(esm); the plugin is the default export
const sinonChai = require('sinon-chai').default;

chai.config.includeStack = true;
chai.use(sinonChai);

global.sinon = sinon;
global.expect = chai.expect;
global.assert = chai.assert;
global.should = chai.should();

console.clear();
console.log(new Date().toLocaleTimeString());
