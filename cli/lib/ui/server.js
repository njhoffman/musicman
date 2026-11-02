const _ = require('lodash');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { candidateOf, looseQuery, matchSimilarity, searchQuery } = require('../spotify/match.js');
const { searchTracks, songFields } = require('../sync/match.js');
const { runningRuns, runsDirectory } = require('../utils/runs.js');
const {
  acceptedList,
  changeMarkers,
  fetchRejected,
  missingList,
  rejectedList,
  reviewList,
  transferLists,
  unknownRejected
} = require('./data.js');

const publicDirectory = path.join(__dirname, 'public');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav'
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// API answers are never cached: they change with the library, and one carries an access token
const sendJson = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
};

const readBody = req =>
  new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
      if (text.length > 64 * 1024) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, 'Request body is not JSON'));
      }
    });
    req.on('error', reject);
  });

// a file of the page, never outside the public directory
const sendStatic = (res, urlPath) => {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(publicDirectory, relative);
  if (!file.startsWith(`${publicDirectory}${path.sep}`) || !fs.existsSync(file)) {
    throw new HttpError(404, `Not found: ${urlPath}`);
  }
  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
};

/**
 * Streams a library file, the whole of it or the byte range the browser asks for (seeking in an audio
 * element). The file must resolve inside the library directory.
 */
const sendAudio = (req, res, baseDirectory, songPath) => {
  const file = path.resolve(baseDirectory, songPath);
  if (!file.startsWith(`${baseDirectory}${path.sep}`)) {
    throw new HttpError(403, 'Outside the library');
  }
  if (!fs.existsSync(file)) {
    throw new HttpError(404, `No file ${songPath}`);
  }
  const { size } = fs.statSync(file);
  const type = contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  // bytes=-500 is the last 500 bytes
  const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes'
  });
  fs.createReadStream(file, { start, end }).pipe(res);
};

// the names the page is reached by; any other Host is a DNS rebinding site that resolves to 127.0.0.1
const allowedHosts = port => [`127.0.0.1:${port}`, `localhost:${port}`];

/**
 * Refuses requests that do not come from the page itself: a Host other than 127.0.0.1 or localhost at
 * the server's port (DNS rebinding), and POSTs that are not JSON or come from another origin. A web
 * page elsewhere can send a text/plain POST without asking first, but not a JSON one: that needs a CORS
 * preflight, which this server never answers.
 */
const checkOrigin = req => {
  const hosts = allowedHosts(req.socket.localPort);
  if (!hosts.includes(req.headers.host)) {
    throw new HttpError(403, `Host ${req.headers.host || '(none)'} is not this server`);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return;
  }
  const type = `${req.headers['content-type'] || ''}`.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new HttpError(415, 'Requests that change something must be application/json');
  }
  const { origin } = req.headers;
  if (origin !== undefined && !hosts.map(host => `http://${host}`).includes(origin)) {
    throw new HttpError(403, `Origin ${origin} is not this page`);
  }
};

const songId = value => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `Not a song id: ${value}`);
  }
  return id;
};

// Spotify refuses longer queries
const maxQueryLength = 250;
const searchLimit = 10;

const trackIdOf = body => {
  if (!_.isString(body.trackId) || !/^[A-Za-z0-9]{22}$/.test(body.trackId)) {
    throw new HttpError(400, 'trackId must be a Spotify track id');
  }
  return body.trackId;
};

/**
 * The request handler of musicman ui: the page from lib/ui/public, and a JSON API:
 *   GET  /api/review                     review, accepted, and rejected lists, with their marker
 *   GET  /api/transfers                  tracks to bring from Spotify, songs missing on Spotify, marker
 *   GET  /api/status                     change markers of the lists and the runs going on now
 *   GET  /api/spotify/search?song=<id>&q= Spotify tracks for a song: q, or the queries sync --match uses
 *   GET  /api/songs/<id>/audio           the song's file, with byte ranges
 *   POST /api/songs/<id>/accept          { trackId } accept the track for the song
 *   POST /api/songs/<id>/reject          { trackId } reject the track for the song
 *   POST /api/spotify/open               { trackId } play the track in the Spotify desktop app
 *   GET  /api/spotify/token              the user's access token for the Web Playback SDK in the page
 * Only requests from the page itself are answered (checkOrigin), so another site can neither read
 * the access token nor act. getUserToken() resolves to { accessToken, scope } of the logged in user.
 * Dependencies: db, config, actions (reviewActions), getClient() a Spotify app client or null without
 * credentials, librarySongs() the songs with their targets (songTargets), plan(songs) syncPlan, and
 * player (spotifyPlayer).
 */
const createHandler = ({
  db,
  config,
  actions,
  getClient,
  librarySongs,
  plan,
  player,
  getUserToken = async () => {
    throw new Error('Not logged in to Spotify, run: musicman sync --login');
  },
  running = () => runningRuns(runsDirectory(config))
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);

  // runs of other commands going on now; the page's own accept and reject are ui runs
  const otherRuns = () =>
    _.map(_.reject(running(), { command: 'ui' }), run =>
      _.pick(run, ['id', 'command', 'args', 'startedAt'])
    );

  const reviewLists = async () => {
    // taken before the lists, so a change while they are read shows as a change afterwards
    const marker = changeMarkers(db).review;
    let rejected = rejectedList(db);
    const unknown = unknownRejected(rejected);
    const client = unknown.length > 0 ? getClient() : null;
    let fetchError = null;
    if (client) {
      try {
        await fetchRejected(db, client, unknown);
        rejected = rejectedList(db);
      } catch (err) {
        fetchError = err.message;
      }
    }
    return {
      review: reviewList(db, config),
      accepted: acceptedList(db),
      rejected,
      missing: missingList(db),
      marker,
      ...(fetchError ? { warning: `Rejected tracks could not be looked up: ${fetchError}` } : {})
    };
  };

  const routes = [
    ['GET', /^\/api\/review$/, async () => reviewLists()],
    [
      'GET',
      /^\/api\/transfers$/,
      async () => {
        const marker = changeMarkers(db).transfers;
        return { ...transferLists(db, config, plan(await librarySongs())), marker };
      }
    ],
    [
      'GET',
      /^\/api\/spotify\/search$/,
      async req => {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const row = db
          .prepare('SELECT id, path, duration FROM songs WHERE id = ?')
          .get(songId(params.get('song')));
        if (!row) {
          throw new HttpError(404, `No song ${params.get('song')}`);
        }
        const query = (params.get('q') || '').trim();
        if (query.length > maxQueryLength) {
          throw new HttpError(400, `The query is longer than ${maxQueryLength} characters`);
        }
        const client = getClient();
        if (!client) {
          throw new HttpError(503, 'Spotify credentials are missing, so the page cannot search');
        }
        const song = songFields(db, row);
        // without a query, the strict query of sync --match, then its loose one when that finds nothing
        // a song without a title tag is searched for by its file name
        const fileName = path.basename(row.path, path.extname(row.path)).replace(/[_.]+/g, ' ');
        const queries = query
          ? [query]
          : song.title
            ? _.uniq(_.compact([searchQuery(song), looseQuery(song)]))
            : [fileName.slice(0, maxQueryLength)];
        let used = queries[0];
        let found = [];
        for (const candidateQuery of queries) {
          used = candidateQuery;
          found = await searchTracks(client, candidateQuery, searchLimit);
          if (found.length > 0) {
            break;
          }
        }
        const candidates = _.map(_.compact(found), candidateOf);
        if (actions.remember) {
          actions.remember(candidates);
        }
        const match = db
          .prepare('SELECT rejected FROM spotify_matches WHERE song_id = ?')
          .get(row.id);
        const rejected = new Set(match && match.rejected ? JSON.parse(match.rejected) : []);
        return {
          query: used,
          tracks: _.map(candidates, candidate => ({
            track: {
              id: candidate.id,
              name: candidate.name || null,
              artists: candidate.artists || null,
              album: candidate.album || null,
              durationMs: candidate.durationMs || null
            },
            similarity: candidate.name ? matchSimilarity(song, candidate) : null,
            rejected: rejected.has(candidate.id)
          }))
        };
      }
    ],
    [
      'GET',
      /^\/api\/spotify\/token$/,
      async () => {
        let token;
        try {
          token = await getUserToken();
        } catch (err) {
          throw new HttpError(503, err.message);
        }
        if (!`${token.scope || ''}`.split(' ').includes('streaming')) {
          throw new HttpError(
            409,
            'Playing in the page needs the streaming permission: run musicman sync --login again'
          );
        }
        return { accessToken: token.accessToken };
      }
    ],
    ['GET', /^\/api\/status$/, async () => ({ markers: changeMarkers(db), running: otherRuns() })],
    [
      'GET',
      /^\/api\/songs\/(\d+)\/audio$/,
      async (req, res, [id]) => {
        const row = db.prepare('SELECT path FROM songs WHERE id = ?').get(songId(id));
        if (!row) {
          throw new HttpError(404, `No song ${id}`);
        }
        sendAudio(req, res, baseDirectory, row.path);
        return undefined;
      }
    ],
    [
      'POST',
      /^\/api\/songs\/(\d+)\/(accept|reject)$/,
      async (req, res, [id, action]) => {
        const trackId = trackIdOf(await readBody(req));
        const result = await actions[action](songId(id), trackId);
        const failed = _.get(result, 'failed', []);
        if (failed.length > 0) {
          throw new HttpError(500, failed[0].error);
        }
        return { ok: true, action, trackId, detailsError: _.get(result, 'detailsError') || null };
      }
    ],
    [
      'POST',
      /^\/api\/spotify\/open$/,
      async req => {
        const trackId = trackIdOf(await readBody(req));
        await player.open(`spotify:track:${trackId}`);
        return { ok: true };
      }
    ]
  ];

  return async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      checkOrigin(req);
      const route = _.find(
        routes,
        ([method, pattern]) => method === req.method && pattern.test(pathname)
      );
      if (route) {
        const params = route[1].exec(pathname).slice(1);
        const body = await route[2](req, res, params);
        if (body !== undefined) {
          sendJson(res, 200, body);
        }
        return;
      }
      if (req.method !== 'GET' || pathname.startsWith('/api/')) {
        throw new HttpError(404, `No route ${req.method} ${pathname}`);
      }
      sendStatic(res, pathname);
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      sendJson(res, err.status || 500, { error: err.message });
    }
  };
};

// an HTTP server for the handler, listening on 127.0.0.1 only; resolves when it listens
const startServer = (handler, { port, host = '127.0.0.1' }) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });

module.exports = { createHandler, startServer };
