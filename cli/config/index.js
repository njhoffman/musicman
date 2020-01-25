// TODO: validate configuration, prevent reserved tag names
const rcConf = require('rc');
const appName = require('../package.json').name;

const defaultConfig = require('./defaultConfig');

const conf = rcConf(appName, defaultConfig);
module.exports = conf;
