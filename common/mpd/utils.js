const parseKeyValueMessage = msg => {
  const result = {};

  msg.split('\n').forEach(p => {
    if (p.length === 0) {
      return;
    }
    const keyMatch = p.match(/([^ ]+): (.*)/);
    if (keyMatch === null) {
      throw new Error(`Could not parse entry "${p}"`);
    }
    const [key, value] = keyMatch;
    result[key] = value;
  });
  return result;
};

const parseArrayMessage = msg => {
  const results = [];
  let obj = {};

  msg.split('\n').forEach(p => {
    if (p.length === 0) {
      return;
    }
    const keyMatch = p.match(/([^ ]+): (.*)/);
    if (keyMatch === null) {
      throw new Error(`Could not parse entry "${p}"`);
    }
    const [key, value] = keyMatch;

    if (obj[key] !== undefined) {
      results.push(obj);
      obj = {};
      obj[key] = value;
    } else {
      obj[key] = value;
    }
  });
  results.push(obj);
  return results;
};

const argEscape = arg =>
  // MPD arguments are double quoted with backslashes and double quotes escaped
  `"${arg.toString().replace(/[\\"]/g, '\\$&')}"`;
module.exports = { parseKeyValueMessage, parseArrayMessage, argEscape };
