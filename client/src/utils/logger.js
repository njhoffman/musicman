import { noop } from 'lodash';
import { defaultConfig } from './contexts/Config';

/* eslint-disable no-console */

const levelMap = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

const bindToConsole = (consoleMethod, polyfill) => {
  return consoleMethod ? consoleMethod.bind(console) : polyfill;
};

export const createLogger = subsystem => {
  const { logLevel = 'debug' } = defaultConfig;
  const currLevel = levelMap[logLevel] || 1;
  let prefix = subsystem ? `[${subsystem}]` : '';

  const consoleLog = (...args) => {
    console.log(...args);
  };

  const consoleFormatLog = (...args) => {
    console.log(`%c ${prefix}`, 'color: gray; font-weight: lighter;', ...args);
  };

  const consoleFormatInfo = (...args) => {
    console.log(`%c ${prefix}`, 'color: white; font-weight: lighter;', ...args);
  };

  const consoleFormatWarn = (...args) => {
    console.log(`%c ${prefix}`, 'color: orange; font-weight: lighter;', ...args);
  };

  const consoleError = (...args) => {
    console.log(`%c ${prefix}`, 'color: red; font-weight: lighter;', ...args);
    // console.error(...args);
  };

  const consoleGroup = (...args) => {
    consoleLog(...args);
    prefix += '> ';
  };

  const consoleGroupEnd = () => {
    prefix = prefix.slice(0, -2);
  };

  return {
    trace: currLevel === 0 ? consoleFormatLog : noop,
    debug: currLevel <= 1 ? consoleFormatLog : noop,
    info: currLevel <= 2 ? consoleFormatInfo : noop,
    warn: currLevel <= 3 ? consoleFormatWarn : noop,
    log: consoleLog,
    error: consoleError,
    group: bindToConsole(console.group, consoleGroup),
    groupCollapsed: bindToConsole(console.groupCollapsed, consoleGroup),
    groupEnd: bindToConsole(console.groupEnd, consoleGroupEnd),
  };
};

export const prettyJson = json => {
  let jsonString = json;
  if (typeof json !== 'string') {
    jsonString = JSON.stringify(json, undefined, '\t');
  }

  jsonString = jsonString
    .split('\n')
    .filter((line, i, arr) => i !== 0 && i !== arr.length - 1)
    .join('\n');

  const arr = [];
  const _string = 'color:#00aa44';
  const _number = 'color:darkorange';
  const _boolean = 'color:blue';
  const _null = 'color:magenta';
  const _key = 'color:#2299cc';

  jsonString = jsonString.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    match => {
      let style = _number;
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          style = _key;
        } else {
          style = _string;
        }
      } else if (/true|false/.test(match)) {
        style = _boolean;
      } else if (/null/.test(match)) {
        style = _null;
      }
      arr.push(style);
      arr.push('');
      return `%c${match}%c`;
    },
  );

  arr.unshift(jsonString);

  console.log.apply(console, arr);
  return '';
};

export const formatGraphQLRequest = (operationType, operation, ellapsed) => {
  const headerCss = [
    'color: gray; font-weight: lighter;', // title
    `color: ${operationType === 'query' ? '#03A9F4' : 'red'};`, // operationType
    'color: inherit;', // operationName
  ];

  const parts = ['%c [GraphQL]', `%c${operationType}`, `%c${operation.operationName}`];

  if (operationType !== 'subscription') {
    parts.push(`%c(in ${ellapsed} ms)`);
    headerCss.push('color: gray; font-weight: lighter;');
  }

  return [parts.join(' '), ...headerCss];
};

export const formatGraphQLError = (message, line, path) => {
  const headerCss = [
    'color: gray; font-weight: lighter;', // title
    `color: red; font-weight: bold;`, // operationType
    'color: inherit; font-weight: bold;', // message
    'color: gray;', // line
  ];

  const operationType = 'error';

  const parts = ['%c [GraphQL]', `%c${operationType}`, `%c${message}`, `%c${line} ${path !== undefined ? path : ''}`];
  return [parts.join(' '), ...headerCss];
};

export const formatNetworkError = message => {
  const headerCss = [
    'color: gray; font-weight: lighter;', // title
    `color: red; font-weight: bold;`, // operationType
    'color: inherit; font-weight: bold;', // message
  ];

  const operationType = 'error';

  const parts = ['%c [Network]', `%c${operationType}`, `%c${message}`];
  return [parts.join(' '), ...headerCss];
};

export default createLogger('app');
