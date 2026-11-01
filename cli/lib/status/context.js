const _ = require('lodash');

/**
 * A contextOf(track) for nowPlaying: what the Spotify track plays from, as { type, name } (playlist,
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
  return { type: context.type, name: name || null };
};

module.exports = { spotifyContextOf };
