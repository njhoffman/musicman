const wcwidth = require('./width');

/**
 * repeat string `str` up to total length of `len`
 *
 * @param String str string to repeat
 * @param Number len total length of output string
 */

function repeatString(str, len) {
  return Array.apply(null, { length: len + 1 })
    .join(str)
    .slice(0, len);
}

/**
 * Pad `str` up to total length `max` with `chr`.
 * If `str` is longer than `max`, padRight will return `str` unaltered.
 *
 * @param String str string to pad
 * @param Number max total length of output string
 * @param String chr optional. Character to pad with. default: ' '
 * @return String padded str
 */

function padRight(str, max, chr) {
  str = str != null ? str : '';
  str = String(str);
  const length = max - wcwidth(str);
  if (length <= 0) return str;
  return str + repeatString(chr || ' ', length);
}

/**
 * Pad `str` up to total length `max` with `chr`.
 * If `str` is longer than `max`, padCenter will return `str` unaltered.
 *
 * @param String str string to pad
 * @param Number max total length of output string
 * @param String chr optional. Character to pad with. default: ' '
 * @return String padded str
 */

function padCenter(str, max, chr) {
  str = str != null ? str : '';
  str = String(str);
  const length = max - wcwidth(str);
  if (length <= 0) return str;
  const lengthLeft = Math.floor(length / 2);
  const lengthRight = length - lengthLeft;
  return repeatString(chr || ' ', lengthLeft) + str + repeatString(chr || ' ', lengthRight);
}

/**
 * Pad `str` up to total length `max` with `chr`, on the left.
 * If `str` is longer than `max`, padRight will return `str` unaltered.
 *
 * @param String str string to pad
 * @param Number max total length of output string
 * @param String chr optional. Character to pad with. default: ' '
 * @return String padded str
 */

function padLeft(str, max, chr) {
  str = str != null ? str : '';
  str = String(str);
  const length = max - wcwidth(str);
  if (length <= 0) return str;
  return repeatString(chr || ' ', length) + str;
}

/**
 * Split a String `str` into lines of maxiumum length `max`.
 * Splits on word boundaries. Preserves existing new lines.
 *
 * @param String str string to split
 * @param Number max length of each line
 * @return Array Array containing lines.
 */

function splitIntoLines(str, max) {
  function _splitIntoLines(str, max) {
    return str
      .trim()
      .split(' ')
      .reduce(function(lines, word) {
        const line = lines[lines.length - 1];
        if (line && wcwidth(line.join(' ')) + wcwidth(word) < max) {
          lines[lines.length - 1].push(word); // add to line
        } else lines.push([word]); // new line
        return lines;
      }, [])
      .map(function(l) {
        return l.join(' ');
      });
  }
  return str
    .split('\n')
    .map(function(str) {
      return _splitIntoLines(str, max);
    })
    .reduce(function(lines, line) {
      return lines.concat(line);
    }, []);
}

/**
 * Add spaces and `truncationChar` between words of
 * `str` which are longer than `max`.
 *
 * @param String str string to split
 * @param Number max length of each line
 * @param Number truncationChar character to append to split words
 * @return String
 */

function splitLongWords(str, max, truncationChar) {
  str = str.trim();
  const result = [];
  const words = str.split(' ');
  let remainder = '';

  const truncationWidth = wcwidth(truncationChar);

  while (remainder || words.length) {
    if (remainder) {
      var word = remainder;
      remainder = '';
    } else {
      var word = words.shift();
    }

    if (wcwidth(word) > max) {
      // slice is based on length no wcwidth
      let i = 0;
      let wwidth = 0;
      const limit = max - truncationWidth;
      while (i < word.length) {
        const w = wcwidth(word.charAt(i));
        if (w + wwidth > limit) {
          break;
        }
        wwidth += w;
        ++i;
      }

      remainder = word.slice(i); // get remainder
      // save remainder for next loop

      word = word.slice(0, i); // grab truncated word
      word += truncationChar; // add trailing … or whatever
    }
    result.push(word);
  }

  return result.join(' ');
}

/**
 * Truncate `str` into total width `max`
 * If `str` is shorter than `max`,  will return `str` unaltered.
 *
 * @param String str string to truncated
 * @param Number max total wcwidth of output string
 * @return String truncated str
 */

function truncateString(str, max) {
  str = str != null ? str : '';
  str = String(str);

  if (max == Infinity) return str;

  let i = 0;
  let wwidth = 0;
  while (i < str.length) {
    const w = wcwidth(str.charAt(i));
    if (w + wwidth > max) break;
    wwidth += w;
    ++i;
  }
  return str.slice(0, i);
}

/**
 * Exports
 */

module.exports.padRight = padRight;
module.exports.padCenter = padCenter;
module.exports.padLeft = padLeft;
module.exports.splitIntoLines = splitIntoLines;
module.exports.splitLongWords = splitLongWords;
module.exports.truncateString = truncateString;
