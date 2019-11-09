// ran once before all tests
const sinon = require('sinon');
const chai = require('chai');
const sinonChai = require('sinon-chai');

chai.config.includeStack = true;
chai.use(sinonChai);

global.sinon = sinon;
global.expect = chai.expect;
global.assert = chai.assert;
global.should = chai.should();

console.clear();
