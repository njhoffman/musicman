const _ = require('lodash');

/**
 * A contextOf(track) for nowPlaying: what the Spotify track plays from, as { type, name, uri } (playlist,
 * album, artist, or collection for Liked Songs), from GET /me/player. Resolves to null when Spotify
 * plays a list of tracks without a context (musicman shuffle), plays something else than track (another
 * device), or reports nothing.
 */
const spotifyContextOf = getClient => async track => {
  const client = getClient();
  const playing = await client.get('/me/player');
  const context = playing && playing.context;
  if (!context || !context.uri) {
    return null;
  }
  const playingId = _.get(playing, 'item.id');
  if (track.trackId && playingId && playingId !== track.trackId) {
    return null;
  }
  const id = context.uri.split(':').pop();
  const names = {
    playlist: async () => (await client.get(`/playlists/${id}?fields=name`)).name,
    album: async () => _.get(playing, 'item.album.name') || track.album || null,
    artist: async () => (await client.get(`/artists/${id}`)).name,
    collection: async () => 'Liked Songs'
  };
  const name = names[context.type] ? await names[context.type]() : null;
  return { type: context.type, name: name || null, uri: context.uri };
};

/**
 * A contextOf(track) that names the source of a musicman shuffle: when Spotify plays the shuffle playlist,
 * or plays a list without a context and the track is one of the last shuffle's, the context is
 * { type: 'shuffle', name } with the name of the shuffled source. readShuffle() gives { source, playlistId,
 * order } (the last source, the shuffle playlist id, and the shuffled track ids), each null when unknown.
 * Other contexts, and every context when no shuffle is known, are those of contextOf.
 */
const withShuffleSource = (contextOf, readShuffle) => async track => {
  const context = await contextOf(track).catch(() => null);
  const { source, playlistId, order } = readShuffle() || {};
  if (!source || !source.name) {
    return context;
  }
  const shufflePlaylist = Boolean(
    context && playlistId && context.uri === `spotify:playlist:${playlistId}`
  );
  const shuffledList = !context && Boolean(track.trackId) && _.includes(order || [], track.trackId);
  return shufflePlaylist || shuffledList
    ? { type: 'shuffle', name: source.name, uri: context ? context.uri : null }
    : context;
};

module.exports = { spotifyContextOf, withShuffleSource };
