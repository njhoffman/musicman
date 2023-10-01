const _ = require('lodash');
const chalk = require('chalk');

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
  output += outputStat('Genres', stats[3].genre, 30);
  output += outputStat('Groupings', stats[4].grouping, 30);
  output += outputStat('Picks', stats[2].picks);
  output += outputStat('Context', stats[0].context);
  output += outputStat('Mood', stats[1].mood);
  output += outputStat('Ratings', stats.ratings);
  output += outputStat('Overall', {
    tracks_rated: stats.rated,
    tracks_unrated: stats.unrated,
    total_duration: `${Math.round(stats.duration / 60)} min`,
    total_size: `${Math.round(stats.size / 1024)} MB`
  });
  console.log(output);
};

module.exports = { outputStats };
