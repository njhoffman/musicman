const mpdConnect = require('./clients/mpd');
const config = require('../config');

const run = async args => {
  const currentSong = await mpdConnect(config.mpd);
  console.log('CURRENT SONG', currentSong);
};

run(process.argv.slice(2));

//   const { broadcast, mpdClient } = modules;
//
//   const getStatus = async () => {
//     const parsed = await mpdClient.sendCommandAsync('status');
//     const ignored = ['elapsed'];
//
//     const differences = getDifferences(parsed, status, ignored);
//     status = parsed;
//
//     if (_.keys(differences).length > 0) {
//       broadcast(MPD_STATUS, differences);
//     }
//   };
//
//   const getStats = async () => {
//     const parsed = await mpdClient.sendCommandAsync('stats');
//     const differences = getDifferences(parsed, stats);
//     stats = parsed;
//     if (_.keys(differences).length > 0) {
//       broadcast(MPD_STATS, differences);
//     }
//   };
//
//   const getCurrentSong = async () => {
//     const parsed = await mpdClient.sendCommandAsync('currentsong');
//     const differences = getDifferences(parsed, song);
//     song = parsed;
//     if (_.keys(differences).length > 0) {
//       broadcast(MPD_CURRENT_SONG, differences);
//     }
//   };
//
//   mpdClient.on('error', err => {
//     logger.info('MPD ERROR', err);
//     throw new Error(err);
//   });
//
//   mpdClient.on('ready', () => {
//     logger.info(`MPD connected at ${config.mpd.host}:${config.mpd.port}`);
//     getStatus();
//     getStats();
//   });
//
//   mpdClient.on('system', (name, ...args) => {
//     const systemMap = {
//       database: () => {},
//       update: () => {},
//       stored_playlist: () => {},
//       playlist: () => {},
//       player: getStatus,
//       mixer: () => {},
//       output: () => {},
//       options: () => {},
//       sticker: () => {},
//       subscription: () => {},
//       message: () => {}
//     };
//     logger.info(`update: ${name}`);
//     if (args.length > 0) {
//       logger.info(args);
//     }
//
//     systemMap[name](args);
//   });
//
//   setInterval(() => {
//     getStatus();
//     getStats();
//     getCurrentSong();
//   }, 3000);
//
//   const router = new Router();
//
//   router.get('/mpd', (req, res) => {
//     res.send({ version: config.version });
//   });
//   return router;
// };
//
