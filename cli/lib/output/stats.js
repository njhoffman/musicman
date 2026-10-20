const _ = require('lodash');
const chalk = require('chalk').default;

const { consoleLog } = require('../utils/logger.js');

const maxLen = (arr, maxLenStatic) => {
  return maxLenStatic || arr.reduce((a, b) => (a.length > b.length ? a : b)).length;
};

const outputStat = (title, stat, maxLenStatic = 12) => {
  let output = `\n${chalk.hex('#8888FF')(title)}\n`;
  Object.keys(stat)
    // .sort((a, b) =>
    //   sortAlpha ? a.trim().charCodeAt(0) - b.trim().charCodeAt(0) : stat[b] - stat[a]
    // )
    .sort()
    .forEach(key => {
      output += `${key.padStart(maxLen(Object.keys(stat), maxLenStatic) + 2)} ${stat[key]}\n`;
    });
  return output;
};

const outputStats = ({ stats, config }) => {
  let output = '';
  const { genre, grouping, ...multiFields } = stats.fields;
  output += outputStat('Genres', genre, 30);
  output += outputStat('Groupings', grouping, 30);
  _.each(multiFields, (values, field) => {
    output += outputStat(_.upperFirst(field), values);
  });
  output += outputStat('Ratings', stats.ratings);
  output += outputStat('Overall', {
    tracks_rated: stats.rated,
    tracks_unrated: stats.unrated,
    total_duration: `${Math.round(stats.duration / 60)} min`,
    total_size: `${Math.round(stats.size / 1024)} MB`
  });
  return consoleLog(output);
};

module.exports = { outputStats };
