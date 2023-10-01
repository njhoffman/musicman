const _ = require('lodash');
const chalk = require('chalk');

const maxLenStatic = 12;
const sortAlpha = true;

const maxLen = arr => {
  return maxLenStatic || arr.reduce((a, b) => (a.length > b.length ? a : b)).length;
};

const outputStat = (title, stat) => {
  let output = `\n${chalk.hex('#8888FF')(title)}\n`;
  Object.keys(stat)
    .sort((a, b) => (sortAlpha ? a.charCodeAt(0) - b.charCodeAt(0) : stat[b] - stat[a]))
    .forEach(key => {
      output += `${key.padStart(maxLen(Object.keys(stat)) + 2)} ${stat[key]}\n`;
    });
  return output;
};

const outputStats = ({ stats, config }) => {
  let output = outputStat('Picks', stats[2].picks);
  output += outputStat('Context', stats[0].context);
  output += outputStat('Mood', stats[1].mood);
  output += outputStat('Ratings', stats.ratings);
  output += outputStat('Overall', { rated: stats.rated, unrated: stats.unrated });
  console.log(output);
};

module.exports = { outputStats };
