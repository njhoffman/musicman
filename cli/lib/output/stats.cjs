const _ = require('lodash');
const chalk = require('chalk');

const data = {
  context: {
    Lounge: 1391,
    Study: 3411,
    Pool: 2332,
    Instrumental: 8,
    Relax: 285,
    Heroin: 33,
    Float: 49,
    Sleep: 15,
    Code: 504,
    Lift: 446,
    Run: 616,
    Drive: 2249,
    Smoke: 89,
    Coitus: 91,
    Morning: 5,
    Upbeat: 1,
    Party: 23,
    FixEnding: 6
  },
  mood: {
    Mellow: 939,
    Dreamy: 41,
    'Very Mellow': 122,
    Hardcore: 106,
    Upbeat: 324,
    Intense: 108,
    Chill: 21,
    Ethereal: 10,
    Uplifting: 18,
    Gloomy: 9,
    Groovy: 3,
    Trippy: 6,
    Driving: 4,
    Dark: 3,
    Dirt: 1,
    Ubpeat: 1,
    Energetic: 7,
    Happy: 7,
    Folksy: 3,
    Bluesy: 2
  },
  picks: {
    Nick: 3836,
    Hot: 316,
    Mom: 72,
    Jeremy: 1,
    Guitar: 17
  },
  ratings: {
    '4.0': 1347,
    '3.0': 864,
    '3.5': 745,
    '5.0': 1732,
    '4.5': 866,
    '2.5': 576,
    '1.0': 26,
    '1.5': 11,
    '3.8': 3,
    '3.6': 2,
    '2.0': 88,
    '0.5': 1
  },
  // genres: {},
  overall: {
    unrated: 14,
    rated: 6261,
    // invalid: 0,
    // invalid_tags: [],
    // albums, artists, missing artwork, missing volume
  }
}
const maxLenStatic = 12
const sortAlpha = true

const maxLen = (arr) => {
  return maxLenStatic || arr.reduce(
    (a, b) => a.length > b.length ? a : b
  ).length;
}

const outputStat = (title, stat, chalk) => {
  let output = `\n${chalk.hex('#8888FF')(title)}\n`;
  Object.keys(stat)
    .sort((a, b) => (sortAlpha ? a.charCodeAt(0) - b.charCodeAt(0) : stat[b] - stat[a]))
    .forEach(key => {
      output += `${key.padStart(maxLen(Object.keys(stat)) + 2)} ${stat[key]}\n`
    })
  return output
}

const outputStats = ({ stats, config }) => {
  // multifieldOutput.map(out => logger.info(out));
  // logger.info(ratingsOutput);
  // logger.info(`Total: \t${allFiles.length}`);
};


// const outputStats = (stats, chalk) => {
//   let output = outputStat('Picks', stats.picks, chalk)
//   output += outputStat('Context', stats.context, chalk)
//   output += outputStat('Mood', stats.mood, chalk)
//   output += outputStat('Ratings', stats.ratings, chalk)
//   output += outputStat('Overall', stats.overall, chalk)
//   console.log(output)
// }

module.exports = { outputStats };
