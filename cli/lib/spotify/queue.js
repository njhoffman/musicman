const _ = require('lodash');

// What `musicman spotify queue --format json` prints, kept stable for other programs (docs/09-contract.md)
const queueVersion = 1;
const queueLimit = 5;

/** A Web API track as the queue lists it; null for what is not a track (an episode, a local file without an id) */
const queueTrack = item => {
  if (!item || item.type !== 'track' || !item.id) {
    return null;
  }
  return {
    id: item.id,
    title: item.name,
    artists: _.map(item.artists, 'name'),
    album: _.get(item, 'album.name') || null,
    durationMs: item.duration_ms || null,
    isrc: _.get(item, 'external_ids.isrc') || null
  };
};

/**
 * The track Spotify plays and the next few after it (GET /me/player/queue, the user's playback scope), on
 * whichever device plays. playing is null when nothing does; queue holds tracks only, at most limit.
 */
const spotifyQueue = async (client, { limit = queueLimit } = {}) => {
  const answer = (await client().get('/me/player/queue')) || {};
  return {
    version: queueVersion,
    playing: queueTrack(answer.currently_playing),
    queue: _.take(_.compact(_.map(answer.queue, queueTrack)), limit)
  };
};

/** One line per track for the default view */
const describeQueue = ({ playing, queue }) => {
  const line = track => `${track.artists.join(', ')} - ${track.title}`;
  if (!playing && queue.length === 0) {
    return ['Nothing queued'];
  }
  return [
    ...(playing ? [`Playing: ${line(playing)}`] : []),
    ...queue.map((track, index) => `${index + 1}. ${line(track)}`)
  ];
};

module.exports = { describeQueue, queueLimit, queueTrack, queueVersion, spotifyQueue };
