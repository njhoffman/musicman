const _ = require('lodash');

const { itemFields, toRow } = require('../sync/cache.js');

// tracks per request when writing a playlist, the API's limit
const writeBatch = 100;

/**
 * A copy of items in uniformly random order (Fisher-Yates): every order is equally likely, so songs
 * by one artist are not spread apart the way Spotify's own shuffle does.
 */
const shuffleOrder = (items, random = Math.random) => {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

// track ids of cached rows, and how many were left out: local files and unavailable tracks have no id
const rowTracks = rows => {
  const playable = _.filter(rows, row => row.track_id && !row.is_local);
  return {
    trackIds: _.uniq(_.map(playable, 'track_id')),
    skipped: rows.length - playable.length,
    total: rows.length
  };
};

const likedTracks = async client => ({
  name: 'Liked Songs',
  ...rowTracks(_.map(await client.paginate('/me/tracks?limit=50'), toRow))
});

const playlistTracks = async (client, id) => {
  const { name } = await client.get(`/playlists/${id}?fields=name`);
  const items = await client.paginate(
    `/playlists/${id}/items?limit=100&fields=${encodeURIComponent(itemFields)}`
  );
  return { name, playlistId: id, ...rowTracks(_.map(items, toRow)) };
};

// the user's own playlists and the ones they follow, as { id, name, owner }
const userPlaylists = async client =>
  _.map(await client.paginate('/me/playlists?limit=50'), ({ id, name, owner }) => ({
    id,
    name,
    owner: _.get(owner, 'id') || null
  }));

/**
 * The playlist a name refers to among the user's playlists, compared without case. Throws when none
 * or several have the name.
 */
const findPlaylist = (playlists, name) => {
  const found = _.filter(playlists, playlist => _.toLower(playlist.name) === _.toLower(name));
  if (found.length === 0) {
    throw new Error(`No playlist named '${name}' in your Spotify library`);
  }
  if (found.length > 1) {
    throw new Error(`${found.length} playlists are named '${name}', give its URL instead`);
  }
  return found[0];
};

// a Spotify playlist URL, URI, or bare id; anything else is a name
const playlistIdOf = text => {
  const match = /(?:playlist[/:])([A-Za-z0-9]{22})/.exec(text) || /^([A-Za-z0-9]{22})$/.exec(text);
  return match ? match[1] : null;
};

/**
 * The tracks of a Spotify source: liked (Liked Songs), a playlist URL, URI or id, or the name of one of
 * the user's playlists. Resolves to { name, trackIds, skipped, playlistId }.
 */
const spotifySourceTracks = async (client, source) => {
  if (['liked', 'liked songs'].includes(_.toLower(source))) {
    return likedTracks(client);
  }
  const id = playlistIdOf(source) || findPlaylist(await userPlaylists(client), source).id;
  return playlistTracks(client, id);
};

/**
 * The id of the user's own playlist with this name, created (private) when there is none. With several
 * of the same name the one used last (knownId) is kept.
 */
const ensurePlaylist = async (client, { name, knownId = null, description = '' }) => {
  const me = await client.get('/me');
  const own = _.filter(
    await userPlaylists(client),
    playlist => playlist.owner === me.id && _.toLower(playlist.name) === _.toLower(name)
  );
  const existing = _.find(own, { id: knownId }) || own[0];
  if (existing) {
    return { id: existing.id, created: false };
  }
  const body = { name, public: false, description };
  let created;
  try {
    created = await client.request('POST', '/me/playlists', body);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
    created = await client.request('POST', `/users/${encodeURIComponent(me.id)}/playlists`, body);
  }
  return { id: created.id, created: true };
};

// one playlist request, on /items with the older /tracks endpoint as a fallback
const itemsRequest = async (client, method, id, body) => {
  try {
    return await client.request(method, `/playlists/${id}/items`, body);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
    return client.request(method, `/playlists/${id}/tracks`, body);
  }
};

/**
 * Replaces a playlist's tracks with trackIds in this order: the first batch replaces everything, the
 * rest are appended in order. An empty list empties the playlist.
 */
const replaceTracks = async (client, id, trackIds, { onProgress = _.noop } = {}) => {
  const uris = _.map(trackIds, trackId => `spotify:track:${trackId}`);
  const [first = [], ...rest] = _.chunk(uris, writeBatch);
  await itemsRequest(client, 'PUT', id, { uris: first });
  let done = first.length;
  onProgress({ done, total: uris.length });
  for (const batch of rest) {
    await itemsRequest(client, 'POST', id, { uris: batch });
    done += batch.length;
    onProgress({ done, total: uris.length });
  }
};

module.exports = {
  ensurePlaylist,
  findPlaylist,
  playlistIdOf,
  replaceTracks,
  rowTracks,
  shuffleOrder,
  spotifySourceTracks
};
