const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Smart playlists: named sets of search terms (filters and free text, as musicman search and player play
 * take them) that make a playlist from the library as it is now. Kept in $XDG_CONFIG_HOME/musicman/
 * smart.yml (~/.config without XDG_CONFIG_HOME), one name per key, in the order they are listed:
 *
 *   study: context:Study mood:Upbeat rating:4.5
 *   mazzy: artist:"Mazzy Star" ~mood:Sad
 *
 * A value is a string of terms (quote a value with spaces, field:"some value") or a list of terms.
 * musicman smart save and rm rewrite the file, so comments in it are not kept.
 */

const smartFile = (env = process.env) =>
  path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'musicman', 'smart.yml');

// words that are smart's own actions, so no playlist can take them as a name
const reservedNames = ['list', 'show', 'save', 'rm'];

/**
 * Splits a string of terms on whitespace, keeping quoted parts ("..." or '...') together and dropping
 * the quotes, as a shell would: artist:"Mazzy Star" mood:Sad gives ['artist:Mazzy Star', 'mood:Sad'].
 * Throws for an unclosed quote.
 */
const splitTerms = text => {
  const terms = [];
  let current = '';
  let started = false;
  let quote = null;
  for (const char of `${text || ''}`) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        terms.push(current);
      }
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) {
    throw new Error(`Unclosed ${quote} in '${text}'`);
  }
  if (started) {
    terms.push(current);
  }
  return terms;
};

// terms as one string splitTerms reads back: a term with whitespace or quotes gets its value quoted
const joinTerms = terms =>
  _.map(terms, term => {
    if (!/[\s"']/.test(term)) {
      return term;
    }
    const quote = term.includes('"') ? "'" : '"';
    const match = /^(~?[\w-]+:)(.*)$/.exec(term);
    return match ? `${match[1]}${quote}${match[2]}${quote}` : `${quote}${term}${quote}`;
  }).join(' ');

// a name smart save takes: letters, digits, and _ . - (no spaces, so it needs no quoting anywhere)
const checkName = name => {
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name || '')) {
    throw new Error(
      `A smart playlist name is letters, digits, _ . and -, starting with a letter or digit, not '${name || ''}'`
    );
  }
  if (reservedNames.includes(name)) {
    throw new Error(`'${name}' is a smart action (${reservedNames.join(', ')}), pick another name`);
  }
};

/**
 * The smart playlists in file, in its order, as [{ name, terms }]; [] when the file does not exist.
 * Throws for a file that is not a map of names to terms.
 */
const readPresets = file => {
  if (!fs.existsSync(file)) {
    return [];
  }
  const text = fs.readFileSync(file, 'utf8');
  // js-yaml refuses an empty document
  const data = text.trim() ? yaml.load(text) : null;
  if (_.isNil(data)) {
    return [];
  }
  if (!_.isPlainObject(data)) {
    throw new Error(`${file} should map smart playlist names to search terms`);
  }
  return _.map(_.toPairs(data), ([name, value]) => {
    const terms = _.isArray(value) ? _.map(value, String) : splitTerms(_.isNil(value) ? '' : value);
    if (terms.length === 0) {
      throw new Error(`Smart playlist '${name}' in ${file} has no terms`);
    }
    return { name: String(name), terms };
  });
};

// writes presets back (replaced atomically), each one's terms as a string
const writePresets = (file, presets) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = _.fromPairs(_.map(presets, ({ name, terms }) => [name, joinTerms(terms)]));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, presets.length ? yaml.dump(data, { lineWidth: -1 }) : '');
  fs.renameSync(temporary, file);
};

// the preset named name, or an error listing the names there are
const findPreset = (presets, name) => {
  const preset = _.find(presets, { name });
  if (!preset) {
    const names = _.map(presets, 'name');
    throw new Error(
      `No smart playlist '${name}'${names.length ? `, there are: ${names.join(', ')}` : ', save one with musicman smart save NAME TERMS'}`
    );
  }
  return preset;
};

module.exports = {
  checkName,
  findPreset,
  joinTerms,
  readPresets,
  reservedNames,
  smartFile,
  splitTerms,
  writePresets
};
