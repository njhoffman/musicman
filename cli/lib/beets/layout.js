const _ = require('lodash');

// $album or ${album} as a template variable, not $albumartist or $albumtype
const albumVariable = /\$(?:\{album\}|album(?![A-Za-z0-9_]))/;

// beets template variables ($title, ${title}) and functions (%aunique{}, %if{$a,b}) inside one segment
const templateToken = /\$\{[A-Za-z0-9_]+\}|\$[A-Za-z0-9_]+|%[A-Za-z0-9_]+\{[^{}]*\}/g;

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A regex for the paths a beets path template produces, relative to the beets directory: literal text
 * as it is, every variable or function as any text within its path segment, and the file extension
 * beets appends to the last segment.
 */
const templatePattern = template => {
  const segments = _.map(`${template}`.split('/'), segment => {
    const literals = segment.split(templateToken);
    const tokens = segment.match(templateToken) || [];
    return _.map(
      literals,
      (literal, i) => escapeRegExp(literal) + (i < tokens.length ? '[^/]*' : '')
    ).join('');
  });
  return new RegExp(`^${segments.join('/')}\\.[^/.]+$`, 'u');
};

// characters of a template outside its variables and functions, how specific a matching template is
const literalLength = template => `${template}`.replace(templateToken, '').length;

/**
 * Layouts of the beets path rules (paths in the beets config): each template with its pattern and
 * whether it puts songs in album folders (it has $album).
 */
const pathLayouts = paths =>
  _.map(_.toPairs(paths || {}), ([query, template]) => ({
    query,
    template: `${template}`,
    pattern: templatePattern(template),
    album: albumVariable.test(`${template}`),
    specificity: literalLength(template)
  }));

/**
 * How a song is organized from its path relative to the beets directory: 'album' when the beets path
 * rule its path matches puts songs in album folders, 'single' when it does not, null when no rule
 * matches. When several rules match, the one with the most literal text wins, then the first in the
 * config.
 */
const songLayout = (layouts, songPath) => {
  const normalized = `${songPath}`.split('\\').join('/');
  const matching = _.filter(layouts, ({ pattern }) => pattern.test(normalized));
  if (matching.length === 0) {
    return null;
  }
  const best = _.reduce(matching, (found, layout) =>
    layout.specificity > found.specificity ? layout : found
  );
  return best.album ? 'album' : 'single';
};

module.exports = { pathLayouts, songLayout, templatePattern };
