const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');
const { expect } = require('chai');

const publicDirectory = path.join(__dirname, 'public');
const appUrl = pathToFileURL(path.join(publicDirectory, 'app.js')).href;

const trackA = '0Q7a3AbWpEr162RRDyz5u6';
const trackB = '77exqyiyvw4D2BBmFNMUur';
const trackC = '4uLU6hMCjMI75M1A2tKUQC';

const song = (id, artist, title, duration) => ({
  id,
  path: `${artist}/${title}.mp3`,
  artist,
  title,
  album: `${artist} Album`,
  duration
});
const track = (id, name, durationMs) => ({
  id,
  name,
  artists: 'Spotify Artist',
  album: 'Spotify Album',
  durationMs
});
const similarity = percent => ({ percent, details: `${percent} details` });

// three songs to review: Beta (60% similar, 50 s longer on Spotify), Alpha (90%, same length), and
// Gamma (no similarity, unknown Spotify length); the API order is Beta, Alpha, Gamma
const reviewFixture = () => ({
  review: [
    {
      song: song(2, 'Beta', 'Two', 200),
      track: track(trackA, 'Two', 250000),
      similarity: similarity(60)
    },
    {
      song: song(1, 'Alpha', 'One', 180),
      track: track(trackB, 'One', 180000),
      similarity: similarity(90)
    },
    { song: song(3, 'Gamma', 'Three', 100), track: track(trackC, 'Three', null), similarity: null }
  ],
  accepted: [
    { song: song(4, 'Delta', 'Four', 120), track: track(trackA, 'Four', 120000), similarity: null }
  ],
  rejected: [
    {
      song: song(5, 'Echo', 'Five', 90),
      status: 'missing',
      current: null,
      rejected: [{ track: track(trackA, 'Five A', 90000) }, { track: track(trackB, 'Five B', 1) }]
    }
  ],
  missing: [
    { song: song(6, 'Foxtrot', 'Six', 200), checkedAt: '2026-11-01 09:00:00' },
    { song: song(7, 'Golf', 'Seven', 210), checkedAt: '2026-10-01 09:00:00' }
  ],
  marker: 'review-1'
});

// an accept that can be undone, and a reject whose song changed since
const historyFixture = () => ({
  runs: [
    {
      id: '20261101-110000-ui',
      args: ['accept', 'Beta/Two.mp3', trackA],
      startedAt: '2026-11-01T11:00:00.000Z',
      undoes: null,
      undoneBy: null,
      spotify: 0,
      files: [
        { path: 'Beta/Two.mp3', frames: ['TXXX.sp_track_id'], status: 'restore', changed: [] }
      ],
      matches: [{ path: 'Beta/Two.mp3', before: 'review', status: 'restore' }]
    },
    {
      id: '20261101-100000-ui',
      args: ['reject', 'Alpha/One.mp3', trackB],
      startedAt: '2026-11-01T10:00:00.000Z',
      undoes: null,
      undoneBy: null,
      spotify: 0,
      files: [],
      matches: [{ path: 'Alpha/One.mp3', before: 'review', status: 'changed' }]
    }
  ],
  marker: 'history-1'
});

// an album copy that keeps over a single, and one single in two grouping folders to pick from
const copyOf = (id, songPath, action, reason = null, audio = null) => ({
  song: { id, path: songPath, artist: 'Hotel', title: 'Song', album: null, duration: 100 },
  action,
  reason,
  size: 4194304,
  rating: 4.5,
  audio
});
const duplicatesFixture = () => ({
  groups: [
    {
      key: 'album|single',
      keep: 'Hotel/album/01 - Song.mp3',
      candidates: [],
      sameAudio: null,
      copies: [
        copyOf(8, 'Hotel/album/01 - Song.mp3', 'keep'),
        copyOf(9, 'Singles/Hotel - Song.mp3', 'trash', 'single copy, the album copy is kept')
      ]
    },
    {
      key: 'x|y',
      keep: null,
      candidates: ['X/Singles/Hotel - Tune.mp3', 'Y/Singles/Hotel - Tune.mp3'],
      sameAudio: false,
      copies: [
        copyOf(10, 'X/Singles/Hotel - Tune.mp3', 'pick', null, 'aaaa1111'),
        copyOf(11, 'Y/Singles/Hotel - Tune.mp3', 'pick', null, 'bbbb2222')
      ]
    }
  ],
  marker: 'duplicates-1'
});

const searchFixture = (query, ...tracks) => ({
  query,
  tracks: tracks.map(([t, percent, rejected = false]) => ({
    track: t,
    similarity: percent ? similarity(percent) : null,
    rejected
  }))
});

const transfersFixture = () => ({
  syncedAt: '2026-11-01 10:00:00',
  toLocal: [
    { track: track(trackC, 'Wanted', 1000), playlists: ['Liked Songs'], download: null },
    { track: track(trackB, 'Queued', 1000), playlists: ['Liked Songs'], download: 'queued' }
  ],
  toSpotify: [],
  marker: 'transfers-1'
});

describe('musicman ui page', () => {
  let dom;
  let app;
  let requests;
  let routes;
  let loaded = 0;
  // a function of the url answering before routes, or nothing
  let fetchOverride = null;
  // the headers of each request, kept out of the requests the tests compare
  const requestHeaders = new WeakMap();
  const globalNames = ['window', 'document', 'Node', 'Element', 'fetch'];
  // Node has fetch (and may have others) of its own, which the specs after this one use
  let savedGlobals;

  const respond = (status, body) => ({
    ok: status < 400,
    status,
    statusText: String(status),
    json: async () => body
  });

  // the page's fetch: routes maps 'GET /api/review' to a body, or to a function of the request body
  const fakeFetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    const request = { method, url, body };
    requests.push(request);
    requestHeaders.set(request, options.headers || {});
    const route = (fetchOverride && fetchOverride(url)) || routes[`${method} ${url}`];
    if (route === undefined) {
      return respond(404, { error: `No route ${method} ${url}` });
    }
    if (route && route.$status) {
      return respond(route.$status, route.body);
    }
    return respond(200, typeof route === 'function' ? route(body) : route);
  };

  // lets the page's promises (fetch, json, renders) settle
  const settle = async () => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
  };

  const $ = id => dom.window.document.getElementById(id);
  const all = selector => [...dom.window.document.querySelectorAll(selector)];
  const rowTexts = () => all('#list-body tbody tr').map(tr => tr.cells[0].textContent);
  const press = (key, target = dom.window.document.body) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const click = element =>
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const tab = id => $(`tab-${id}`);
  const header = label => all('th').find(th => th.textContent.startsWith(label));

  beforeEach(async () => {
    requests = [];
    fetchOverride = null;
    routes = {
      'GET /api/review': reviewFixture(),
      'GET /api/transfers': transfersFixture(),
      'GET /api/history': historyFixture(),
      'GET /api/duplicates': duplicatesFixture(),
      'GET /api/status': {
        markers: { review: 'review-1', transfers: 'transfers-1', history: 'history-1' },
        running: []
      }
    };
    dom = new JSDOM(fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8'), {
      url: 'http://127.0.0.1:6660/',
      pretendToBeVisual: true
    });
    // jsdom has no media playback: a paused flag that play and pause flip
    const media = dom.window.HTMLMediaElement.prototype;
    Object.defineProperty(media, 'paused', {
      configurable: true,
      get() {
        return this.playing !== true;
      }
    });
    media.play = function play() {
      this.playing = true;
      return Promise.resolve();
    };
    media.pause = function pause() {
      this.playing = false;
    };
    savedGlobals = globalNames.map(name => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name)
    ]);
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Node: dom.window.Node,
      Element: dom.window.Element,
      fetch: fakeFetch
    });
    // a new instance of the module for each test
    loaded += 1;
    app = await import(`${appUrl}?test=${loaded}`);
    await app.ready;
    await settle();
  });

  afterEach(() => {
    app.stopPolling();
    dom.window.close();
    savedGlobals.forEach(([name, descriptor]) => {
      delete globalThis[name];
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      }
    });
  });

  describe('tabs', () => {
    it('should be a tablist with the selected tab and the list counts', () => {
      expect($('tabs').getAttribute('role')).to.equal('tablist');
      const buttons = all('#tabs button');
      expect(buttons.map(b => b.getAttribute('role'))).to.deep.equal(Array(8).fill('tab'));
      expect(tab('review').getAttribute('aria-selected')).to.equal('true');
      expect(tab('review').getAttribute('tabindex')).to.equal('0');
      expect(tab('accepted').getAttribute('tabindex')).to.equal('-1');
      expect(tab('review').textContent).to.equal('Needs review3');
      expect($('list').getAttribute('aria-labelledby')).to.equal('tab-review');
    });

    it('should move between tabs with the arrow keys and load the transfers once', async () => {
      press('ArrowLeft', tab('review'));
      await settle();
      expect(app.state.tab).to.equal('history');
      press('ArrowLeft', tab('history'));
      await settle();
      expect(app.state.tab).to.equal('duplicates');
      press('ArrowLeft', tab('duplicates'));
      await settle();
      expect(app.state.tab).to.equal('toSpotify');
      expect(dom.window.document.activeElement.id).to.equal('tab-toSpotify');
      press('ArrowLeft', tab('toSpotify'));
      await settle();
      expect(app.state.tab).to.equal('toLocal');
      expect(rowTexts()).to.deep.equal(['Spotify Artist - Wanted', 'Spotify Artist - Queued']);
      expect(requests.filter(r => r.url === '/api/transfers')).to.have.length(1);
      press('Home', tab('toLocal'));
      expect(app.state.tab).to.equal('review');
    });
  });

  describe('keyboard review', () => {
    it('should move through the rows with j and k, open the compare panel, and announce the song', () => {
      press('j');
      expect(app.state.selected).to.equal('2');
      expect($('compare').hidden).to.equal(false);
      expect($('announce').textContent).to.equal('1 of 3: Beta - Two');
      const selected = all('#list-body tr.selected');
      expect(selected).to.have.length(1);
      expect(selected[0].getAttribute('aria-current')).to.equal('true');
      expect(dom.window.document.activeElement).to.equal(selected[0]);
      press('j');
      press('ArrowDown');
      press('j');
      expect(app.state.selected).to.equal('3');
      press('k');
      expect(app.state.selected).to.equal('1');
      press('Escape');
      expect(app.state.selected).to.equal(null);
      expect($('compare').hidden).to.equal(true);
    });

    it('should accept with a, then select the row that took its place', async () => {
      routes['POST /api/songs/2/accept'] = body => ({ ok: true, action: 'accept', ...body });
      press('j');
      const next = reviewFixture();
      next.review.shift();
      routes['GET /api/review'] = next;
      press('a');
      await settle();
      expect(requests.find(r => r.method === 'POST')).to.deep.equal({
        method: 'POST',
        url: '/api/songs/2/accept',
        body: { trackId: trackA }
      });
      expect(app.state.selected).to.equal('1');
      expect($('message').textContent).to.include(`Accepted ${trackA}`);
    });

    it('should reject with r on the accepted tab, and not accept there', async () => {
      routes['POST /api/songs/4/reject'] = { ok: true };
      click(tab('accepted'));
      press('j');
      press('a');
      await settle();
      expect(requests.filter(r => r.method === 'POST')).to.be.empty;
      press('r');
      await settle();
      expect(requests.filter(r => r.method === 'POST').map(r => r.url)).to.deep.equal([
        '/api/songs/4/reject'
      ]);
    });

    it('should not accept with a when a song has several rejected tracks', async () => {
      click(tab('rejected'));
      press('j');
      press('a');
      await settle();
      expect(requests.filter(r => r.method === 'POST')).to.be.empty;
      expect($('message').textContent).to.include('several rejected tracks');
    });

    it('should play and pause the local file with space', () => {
      press('j');
      const audio = dom.window.document.querySelector('#compare audio');
      expect(press(' ').defaultPrevented).to.equal(true);
      expect(audio.paused).to.equal(false);
      press(' ');
      expect(audio.paused).to.equal(true);
    });

    it('should leave keys typed in the filter alone, and focus the filter with /', () => {
      const filter = $('filter');
      press('/');
      expect(dom.window.document.activeElement).to.equal(filter);
      expect(press('j', filter).defaultPrevented).to.equal(false);
      expect(app.state.selected).to.equal(null);
      filter.value = 'alpha';
      filter.dispatchEvent(new dom.window.Event('input'));
      expect(rowTexts()).to.deep.equal(['Alpha - OneAlpha Album']);
    });

    it('should leave space and Enter to a focused button', () => {
      press('j');
      const button = dom.window.document.querySelector('#compare button.accept');
      expect(press(' ', button).defaultPrevented).to.equal(false);
    });
  });

  describe('sorting', () => {
    it('should sort by a column ascending, then descending, then in the order of the API', () => {
      expect(rowTexts().map(t => t.split(' - ')[0])).to.deep.equal(['Beta', 'Alpha', 'Gamma']);
      click(header('Similar').querySelector('button'));
      // least similar first, unknown similarity last
      expect(rowTexts().map(t => t.split(' - ')[0])).to.deep.equal(['Beta', 'Alpha', 'Gamma']);
      expect(header('Similar').getAttribute('aria-sort')).to.equal('ascending');
      click(header('Similar').querySelector('button'));
      expect(rowTexts().map(t => t.split(' - ')[0])).to.deep.equal(['Alpha', 'Beta', 'Gamma']);
      expect(header('Similar').getAttribute('aria-sort')).to.equal('descending');
      click(header('Similar').querySelector('button'));
      expect(header('Similar').hasAttribute('aria-sort')).to.equal(false);
      click(header('Local song').querySelector('button'));
      expect(rowTexts().map(t => t.split(' - ')[0])).to.deep.equal(['Alpha', 'Beta', 'Gamma']);
    });

    it('should sort Length by the difference of the two lengths and keep the sort per tab', () => {
      click(header('Length').querySelector('button'));
      click(header('Length').querySelector('button'));
      expect(rowTexts().map(t => t.split(' - ')[0])).to.deep.equal(['Beta', 'Alpha', 'Gamma']);
      click(tab('accepted'));
      expect(all('th[aria-sort]')).to.be.empty;
      click(tab('review'));
      expect(header('Length').getAttribute('aria-sort')).to.equal('descending');
    });

    it('should move with j through the rows in the sorted order', () => {
      click(header('Local song').querySelector('button'));
      press('j');
      expect(app.state.selected).to.equal('1');
    });
  });

  describe('changes and runs', () => {
    it('should mark a list changed since loaded, and reload it with its button', async () => {
      routes['GET /api/status'] = {
        markers: { review: 'review-2', transfers: 'transfers-1' },
        running: []
      };
      press('j');
      await app.poll();
      expect(tab('review').classList.contains('stale')).to.equal(true);
      expect($('list-head').textContent).to.include('Changed since loaded');
      // the poll leaves the list and the selected row alone
      expect(app.state.selected).to.equal('2');
      routes['GET /api/review'] = { ...reviewFixture(), marker: 'review-2' };
      click($('list-head').querySelector('button.reload'));
      await settle();
      expect(tab('review').classList.contains('stale')).to.equal(false);
      expect($('list-head').textContent).to.not.include('Changed since loaded');
      expect(app.state.selected).to.equal('2');
    });

    it('should ask for the transfer lists computed again when they are reloaded', async () => {
      routes['GET /api/transfers?fresh'] = { ...transfersFixture(), marker: 'transfers-2' };
      click(tab('toLocal'));
      await settle();
      click($('list-head').querySelector('button.reload'));
      await settle();
      expect(
        requests.map(r => r.url).filter(url => url.startsWith('/api/transfers'))
      ).to.deep.equal(['/api/transfers', '/api/transfers?fresh']);
      expect(app.state.transfers.marker).to.equal('transfers-2');
    });

    it('should show the runs going on, and ask before accepting while one runs', async () => {
      routes['GET /api/status'] = {
        markers: { review: 'review-1', transfers: 'transfers-1' },
        running: [
          { id: 'r', command: 'sync', args: ['sync', '--match'], startedAt: '2026-11-01T10:00:00Z' }
        ]
      };
      routes['POST /api/songs/2/accept'] = { ok: true };
      await app.poll();
      expect($('runs').hidden).to.equal(false);
      expect($('runs').textContent).to.include('musicman sync --match');
      const questions = [];
      let answer = false;
      dom.window.confirm = question => {
        questions.push(question);
        return answer;
      };
      press('j');
      press('a');
      await settle();
      expect(questions).to.have.length(1);
      expect(questions[0]).to.include('Accept anyway?');
      expect(requests.filter(r => r.method === 'POST')).to.be.empty;
      answer = true;
      press('a');
      await settle();
      expect(requests.filter(r => r.method === 'POST')).to.have.length(1);
      routes['GET /api/status'] = {
        markers: { review: 'review-1', transfers: 'transfers-1' },
        running: []
      };
      await app.poll();
      expect($('runs').hidden).to.equal(true);
    });
  });

  describe('Spotify search', () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const searches = () => requests.filter(r => r.url.startsWith('/api/spotify/search'));

    beforeEach(() => {
      routes['GET /api/spotify/search?song=6'] = searchFixture(
        'track:"Six" artist:"Foxtrot"',
        [track(trackA, 'Six', 200000), 95],
        [track(trackB, 'Six (Live)', 260000), 70, true]
      );
      routes['GET /api/spotify/search?song=7'] = searchFixture('track:"Seven" artist:"Golf"');
      routes['GET /api/spotify/search?song=6&q=foxtrot+six+remix'] = searchFixture(
        'foxtrot six remix',
        [track(trackC, 'Six Remix', 1000), 50]
      );
    });

    it('should list the songs without a candidate in the Not found tab', () => {
      expect(tab('missing').textContent).to.equal('Not found2');
      click(tab('missing'));
      expect(rowTexts()).to.deep.equal(['Foxtrot - SixFoxtrot Album', 'Golf - SevenGolf Album']);
    });

    it('should search for the song the selection stops on, not every song on the way', async () => {
      click(tab('missing'));
      press('j');
      press('j');
      await wait(500);
      await settle();
      expect(searches().map(r => r.url)).to.deep.equal(['/api/spotify/search?song=7']);
      expect($('search').textContent).to.include('Nothing found');
      expect($('search').querySelector('input').value).to.equal('track:"Seven" artist:"Golf"');
    });

    it('should show the results with their similarity, preview one, and accept one', async () => {
      click(tab('missing'));
      press('j');
      await wait(500);
      await settle();
      const items = all('#search .results li');
      expect(items.map(li => li.textContent)).to.deep.equal([
        'Spotify Artist - SixSpotify Album - 3:20 - 95% similarPreviewPlay hereAccept',
        'Spotify Artist - Six (Live)Spotify Album - 4:20 - 70% similar - rejected beforePreviewPlay hereAccept'
      ]);
      const audio = dom.window.document.querySelector('#compare audio');
      click(items[1].querySelector('button[aria-pressed]'));
      expect(dom.window.document.querySelector('#search iframe').getAttribute('src')).to.include(
        trackB
      );
      // the preview draws only the search section, so the local player keeps playing
      expect(dom.window.document.querySelector('#compare audio')).to.equal(audio);
      routes['POST /api/songs/6/accept'] = { ok: true };
      const next = reviewFixture();
      next.missing.shift();
      routes['GET /api/review'] = next;
      click(all('#search .results li')[0].querySelector('button.accept'));
      await settle();
      expect(requests.find(r => r.method === 'POST')).to.deep.equal({
        method: 'POST',
        url: '/api/songs/6/accept',
        body: { trackId: trackA }
      });
      // the next song is selected and searched for in turn
      expect(app.state.selected).to.equal('7');
      await wait(500);
      await settle();
      expect(searches().map(r => r.url)).to.include('/api/spotify/search?song=7');
    });

    it('should search with the words typed, and offer the search for a review song too', async () => {
      press('j');
      expect($('search')).to.not.equal(null);
      await wait(500);
      expect(searches()).to.be.empty;
      routes['GET /api/spotify/search?song=2&q=beta+two'] = searchFixture('beta two');
      const input = $('search').querySelector('input');
      input.value = 'beta two';
      $('search')
        .querySelector('form')
        .dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      await settle();
      expect(searches().map(r => r.url)).to.deep.equal(['/api/spotify/search?song=2&q=beta+two']);
      expect($('search').querySelector('input').value).to.equal('beta two');
    });

    it('should show why a search failed', async () => {
      routes['GET /api/spotify/search?song=6'] = undefined;
      click(tab('missing'));
      press('j');
      await wait(500);
      await settle();
      expect($('search').textContent).to.include('Search failed: No route');
    });
  });

  describe('Spotify playback', () => {
    const playUrl = 'https://api.spotify.com/v1/me/player/play?device_id=device-1';
    let players;

    // a stand-in for the Web Playback SDK: a player that connects and reports error, or ready
    const fakeSdk = ({ error } = {}) => {
      players = [];
      dom.window.Spotify = {
        Player: class {
          constructor(options) {
            this.options = options;
            this.listeners = {};
            this.calls = [];
            players.push(this);
          }

          addListener(name, listener) {
            this.listeners[name] = listener;
          }

          emit(name, value) {
            this.listeners[name](value);
          }

          async connect() {
            setImmediate(() =>
              error
                ? this.emit(error, { message: 'nope' })
                : this.emit('ready', { device_id: 'device-1' })
            );
            return true;
          }

          activateElement() {
            this.calls.push('activateElement');
          }

          pause() {
            this.calls.push('pause');
          }

          togglePlay() {
            this.calls.push('togglePlay');
          }

          disconnect() {
            this.calls.push('disconnect');
          }
        }
      };
    };
    const posts = () => requests.filter(r => r.method === 'POST');
    const plays = () => requests.filter(r => r.method === 'PUT');
    const playing = trackId =>
      players[0].emit('player_state_changed', {
        paused: false,
        track_window: { current_track: { id: trackId } }
      });

    beforeEach(() => {
      routes['GET /api/spotify/token'] = { accessToken: 'user-token' };
      routes[`PUT ${playUrl}`] = {};
      routes['POST /api/spotify/open'] = { ok: true };
    });

    it('should play the candidate in the page with s, and pause it with s again', async () => {
      fakeSdk();
      press('j');
      press('s');
      await settle();
      expect(players).to.have.length(1);
      expect(players[0].options.name).to.equal('musicman ui');
      expect(plays()).to.have.length(1);
      expect(plays()[0].body).to.deep.equal({ uris: [`spotify:track:${trackA}`] });
      expect(requestHeaders.get(plays()[0]).Authorization).to.equal('Bearer user-token');
      playing(trackA);
      const button = dom.window.document.querySelector('#compare button.play-here');
      expect(button.textContent).to.equal('Pause');
      expect(button.getAttribute('aria-pressed')).to.equal('true');
      press('s');
      await settle();
      expect(players[0].calls).to.include('togglePlay');
      expect(plays()).to.have.length(1);
      expect(posts()).to.be.empty;
    });

    it('should pause Spotify in the page when the local file plays, and the file when Spotify plays', async () => {
      fakeSdk();
      press('j');
      press('s');
      await settle();
      playing(trackA);
      const audio = dom.window.document.querySelector('#compare audio');
      press(' ');
      expect(players[0].calls).to.include('pause');
      expect(audio.paused).to.equal(false);
      players[0].emit('player_state_changed', null);
      dom.window.document.querySelector('#compare button.play-here').click();
      await settle();
      expect(audio.paused).to.equal(true);
    });

    it('should try a device Spotify does not know yet once more', async () => {
      fakeSdk();
      let answers = 0;
      fetchOverride = url => {
        if (url === playUrl) {
          answers += 1;
          return answers === 1
            ? { $status: 404, body: { error: { message: 'Device not found' } } }
            : {};
        }
        return undefined;
      };
      press('j');
      press('s');
      await settle();
      await new Promise(resolve => setTimeout(resolve, 1100));
      await settle();
      expect(plays()).to.have.length(2);
      expect($('message').hidden).to.equal(true);
    });

    it('should play in the Spotify app without the streaming permission, without loading the SDK', async () => {
      fakeSdk();
      routes['GET /api/spotify/token'] = {
        $status: 409,
        body: { error: 'Playing in the page needs the streaming permission' }
      };
      press('j');
      press('s');
      await settle();
      expect(players).to.be.empty;
      expect(dom.window.document.querySelector(`script[src*="sdk.scdn.co"]`)).to.equal(null);
      expect(posts()).to.deep.equal([
        { method: 'POST', url: '/api/spotify/open', body: { trackId: trackA } }
      ]);
      expect($('message').textContent).to.include('streaming permission');
      // the reason stays: s goes straight to the app, the button says why
      press('s');
      await settle();
      expect(requests.filter(r => r.url === '/api/spotify/token')).to.have.length(1);
      expect(posts()).to.have.length(2);
      expect(dom.window.document.querySelector('#compare button.play-here').title).to.include(
        'streaming permission'
      );
    });

    it('should tell a Spotify account without Premium', async () => {
      fakeSdk({ error: 'account_error' });
      press('j');
      dom.window.document.querySelector('#compare button.play-here').click();
      await settle();
      expect($('message').textContent).to.include('Spotify Premium is needed');
      expect(posts()).to.be.empty;
    });

    it('should play the first search result on Not found, and ask for a search before one', async () => {
      fakeSdk();
      routes['GET /api/spotify/search?song=6'] = searchFixture('six', [
        track(trackC, 'Six', 1000),
        90
      ]);
      click(tab('missing'));
      press('j');
      press('s');
      expect($('message').textContent).to.equal('No search result to play yet');
      await new Promise(resolve => setTimeout(resolve, 500));
      await settle();
      press('s');
      await settle();
      expect(plays()[0].body).to.deep.equal({ uris: [`spotify:track:${trackC}`] });
    });
  });

  describe('history', () => {
    const undoButtons = () => all('#compare button.undo');

    it('should list the runs of the page with what undoing them does', async () => {
      click(tab('history'));
      await settle();
      expect(
        all('#list-body tbody tr').map(tr => [...tr.cells].slice(1).map(td => td.textContent))
      ).to.deep.equal([
        ['Accept', 'Beta/Two.mp3', 'can undo'],
        ['Reject', 'Alpha/One.mp3', 'changed since']
      ]);
      press('j');
      expect(all('#compare .plan li').map(li => li.textContent)).to.deep.equal([
        'Tags of Beta/Two.mp3 back: TXXX.sp_track_id',
        'Spotify match of Beta/Two.mp3 back to review'
      ]);
      expect(undoButtons().map(b => [b.textContent, b.disabled])).to.deep.equal([['Undo', false]]);
      press('j');
      expect(undoButtons().map(b => [b.textContent, b.disabled])).to.deep.equal([
        ['Undo', true],
        ['Undo anyway', false]
      ]);
    });

    it('should undo a run and load the history and the review lists again', async () => {
      routes['POST /api/history/20261101-100000-ui/undo'] = { ok: true, files: 0, matches: 1 };
      click(tab('history'));
      await settle();
      press('j');
      press('j');
      const loads = requests.length;
      click(undoButtons()[1]);
      await settle();
      expect(requests.find(r => r.method === 'POST')).to.deep.equal({
        method: 'POST',
        url: '/api/history/20261101-100000-ui/undo',
        body: { force: true }
      });
      expect(
        requests
          .slice(loads)
          .map(r => r.url)
          .filter(url => url !== '/api/history/20261101-100000-ui/undo')
          .sort()
      ).to.deep.equal(['/api/history', '/api/review']);
      expect($('message').textContent).to.include('0 files and 1 Spotify matches put back');
    });

    it('should load the history again after an accept once it was shown', async () => {
      routes['POST /api/songs/2/accept'] = { ok: true };
      click(tab('history'));
      await settle();
      click(tab('review'));
      press('j');
      press('a');
      await settle();
      expect(requests.filter(r => r.url === '/api/history')).to.have.length(2);
    });
  });

  describe('duplicates', () => {
    const plans = () => all('#list-body tbody tr').map(tr => tr.cells[2].textContent);
    const button = (selector, text) =>
      all(selector).find(element => element.textContent.startsWith(text));

    beforeEach(async () => {
      dom.window.confirm = () => true;
      click(tab('duplicates'));
      await settle();
    });

    it('should list each group with its plan, and repair only the decided ones from the head', async () => {
      expect(tab('duplicates').textContent).to.equal('Duplicates2');
      expect(plans()).to.deep.equal(['trash 1', 'pick the copy to keep']);
      routes['POST /api/duplicates'] = {
        ok: true,
        removed: 1,
        excluded: 0,
        cleared: 0,
        merged: 1,
        failed: []
      };
      click(button('#list-head button', 'Repair 1 group'));
      await settle();
      expect(requests.find(r => r.method === 'POST')).to.deep.equal({
        method: 'POST',
        url: '/api/duplicates',
        body: {
          groups: [
            {
              files: ['Hotel/album/01 - Song.mp3', 'Singles/Hotel - Song.mp3'],
              keep: 'Hotel/album/01 - Song.mp3'
            }
          ]
        }
      });
      expect($('message').textContent).to.include(
        'Moved 1 files to the trash, dropped 0 copies from the library, merged tags into 1'
      );
    });

    it('should list only the groups to pick, and tell their copies apart', () => {
      click(button('#list-head button', 'Only groups to pick (1)'));
      expect(plans()).to.deep.equal(['pick the copy to keep']);
      expect(button('#list-head button', 'Show every group')).to.exist;
      press('j');
      expect($('compare').querySelector('.similarity').textContent).to.equal(
        'Different audio, same length 1:40'
      );
      const details = all('#compare .duplicate dl')
        .filter(dl => dl.textContent.includes('Audio CRC'))
        .map(dl => dl.textContent);
      expect(details[0])
        .to.include('Size4.0 MB')
        .and.include('Audio CRCaaaa1111')
        .and.include('Rating4.5');
      expect(all('#compare dd.differs').map(dd => dd.textContent)).to.include('aaaa1111');
    });

    it('should pick the copy to keep in the panel, then repair that group', async () => {
      press('j');
      press('j');
      expect(all('#compare .duplicate p').map(p => p.textContent)).to.deep.equal([
        'Pick to keep',
        'Pick to keep'
      ]);
      expect(button('#compare button', 'Repair this group').disabled).to.be.true;
      click(all('#compare button.accept')[1]);
      expect(all('#compare .duplicate p').map(p => p.textContent)).to.deep.equal([
        'Out of the library, file kept',
        'Kept (picked)'
      ]);
      expect(plans()).to.deep.equal(['trash 1', 'drop 1 (file kept)']);
      routes['POST /api/duplicates'] = {
        ok: true,
        removed: 0,
        excluded: 1,
        cleared: 0,
        merged: 0,
        failed: []
      };
      click(button('#compare button', 'Repair this group'));
      await settle();
      expect(requests.find(r => r.method === 'POST').body).to.deep.equal({
        groups: [
          {
            files: ['X/Singles/Hotel - Tune.mp3', 'Y/Singles/Hotel - Tune.mp3'],
            keep: 'Y/Singles/Hotel - Tune.mp3'
          }
        ]
      });
      expect(requests.filter(r => r.url === '/api/duplicates')).to.have.length(3);
      // the group at its place is selected next, to go on picking
      expect(app.state.selected).to.equal('x|y');
    });
  });

  describe('transfer actions', () => {
    const headButton = text =>
      all('#list-head button').find(button => button.textContent.startsWith(text));

    beforeEach(async () => {
      click(tab('toLocal'));
      await settle();
    });

    it('should show where each track is, and add the ones not queued to the downloads', async () => {
      expect(all('#list-body tbody tr').map(tr => tr.cells[3].textContent)).to.deep.equal([
        'not queued',
        'queued'
      ]);
      routes['POST /api/downloads'] = body => ({ ok: true, added: body.trackIds, unknown: [] });
      const queued = transfersFixture();
      queued.toLocal[0].download = 'queued';
      routes['GET /api/transfers'] = queued;
      click(headButton('Add 1 to downloads'));
      await settle();
      expect(requests.find(r => r.method === 'POST')).to.deep.equal({
        method: 'POST',
        url: '/api/downloads',
        body: { trackIds: [trackC] }
      });
      expect($('message').textContent).to.include('Added 1 tracks to the download manifest');
      expect(headButton('Add ')).to.equal(undefined);
    });

    it('should add one track from its panel, and not one already in the downloads', async () => {
      routes['POST /api/downloads'] = body => ({ ok: true, added: body.trackIds, unknown: [] });
      press('j');
      const add = () =>
        all('#compare button').find(button => /downloads/i.test(button.textContent));
      expect(add().textContent).to.equal('Add to downloads');
      click(add());
      await settle();
      expect(requests.filter(r => r.method === 'POST').map(r => r.body)).to.deep.equal([
        { trackIds: [trackC] }
      ]);
      press('j');
      expect(add().textContent).to.equal('In downloads (queued)');
      expect(add().disabled).to.equal(true);
    });

    const downloadStatus = download => ({
      markers: { review: 'review-1', transfers: 'transfers-1', history: 'history-1' },
      running: download.running ? [{ id: 'd', command: 'download', args: [] }] : [],
      download: { queued: 2, downloaded: 1, imported: 0, log: [], ...download }
    });

    it('should start a download of the queued tracks and show its progress and output', async () => {
      routes['GET /api/status'] = downloadStatus({ running: null });
      await app.poll();
      routes['POST /api/downloads/run'] = { started: true, pid: 7 };
      routes['GET /api/status'] = downloadStatus({
        running: { pid: 7, startedAt: '2026-11-03T00:00:00Z', fromPage: true },
        log: ['Batch 1/1', 'Downloaded "A - One"']
      });
      click(headButton('Download 2 queued'));
      await settle();
      expect(requests.filter(r => r.method === 'POST').map(r => r.url)).to.deep.equal([
        '/api/downloads/run'
      ]);
      expect(all('#list-head progress')[0].value).to.equal(1);
      expect($('list-head').textContent).to.include('1 of 3 downloaded');
      expect(all('#list-head pre')[0].textContent).to.equal('Batch 1/1\nDownloaded "A - One"');
      expect(headButton('Download ')).to.equal(undefined);
      // a download writes no library files, so the page does not ask before accepting
      expect($('runs').textContent).to.not.include('asks before');
    });

    it('should cancel a download the page started after asking, and reload the lists when it ends', async () => {
      routes['GET /api/status'] = downloadStatus({
        running: { pid: 7, startedAt: '2026-11-03T00:00:00Z', fromPage: true }
      });
      await app.poll();
      routes['POST /api/downloads/cancel'] = { cancelled: true, pid: 7 };
      let answer = false;
      dom.window.confirm = () => answer;
      click(headButton('Cancel download'));
      await settle();
      expect(requests.filter(r => r.method === 'POST')).to.be.empty;
      answer = true;
      routes['GET /api/status'] = downloadStatus({ running: null });
      const loads = requests.filter(r => r.url.startsWith('/api/transfers')).length;
      click(headButton('Cancel download'));
      await settle();
      expect(requests.filter(r => r.method === 'POST').map(r => r.url)).to.deep.equal([
        '/api/downloads/cancel'
      ]);
      expect(requests.filter(r => r.url.startsWith('/api/transfers'))).to.have.length(loads + 1);
      expect(headButton('Download 2 queued')).to.not.equal(undefined);
    });

    it('should show a download in a terminal without Cancel, and not start a second one', async () => {
      routes['GET /api/status'] = downloadStatus({
        running: { pid: 9, startedAt: '2026-11-03T00:00:00Z', fromPage: false }
      });
      await app.poll();
      expect($('list-head').textContent).to.include('(running in a terminal)');
      expect(headButton('Cancel download')).to.equal(undefined);
      expect(headButton('Download ')).to.equal(undefined);
    });

    it('should refresh the playlists and then load the transfer lists again', async () => {
      routes['POST /api/spotify/refresh'] = { ok: true, refreshed: 3, unchanged: 2 };
      click(headButton('Refresh playlists'));
      await settle();
      expect(requests.filter(r => r.url.startsWith('/api/transfers'))).to.have.length(2);
      expect($('message').textContent).to.equal(
        'Refreshed 3 Spotify playlists (2 unchanged since the last sync)'
      );
    });

    it('should say why a refresh failed', async () => {
      routes['POST /api/spotify/refresh'] = { $status: 503, body: { error: 'Not logged in' } };
      click(headButton('Refresh playlists'));
      await settle();
      expect($('message').textContent).to.include('Refreshing the playlists failed: Not logged in');
      expect(headButton('Refresh playlists').disabled).to.equal(false);
    });
  });
});
