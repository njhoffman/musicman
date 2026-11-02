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
  toLocal: [{ track: track(trackC, 'Wanted', 1000), playlists: ['Liked Songs'] }],
  toSpotify: [],
  marker: 'transfers-1'
});

describe('musicman ui page', () => {
  let dom;
  let app;
  let requests;
  let routes;
  let loaded = 0;
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
    requests.push({ method, url, body });
    const route = routes[`${method} ${url}`];
    if (route === undefined) {
      return respond(404, { error: `No route ${method} ${url}` });
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
    routes = {
      'GET /api/review': reviewFixture(),
      'GET /api/transfers': transfersFixture(),
      'GET /api/status': { markers: { review: 'review-1', transfers: 'transfers-1' }, running: [] }
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
      expect(buttons.map(b => b.getAttribute('role'))).to.deep.equal(Array(6).fill('tab'));
      expect(tab('review').getAttribute('aria-selected')).to.equal('true');
      expect(tab('review').getAttribute('tabindex')).to.equal('0');
      expect(tab('accepted').getAttribute('tabindex')).to.equal('-1');
      expect(tab('review').textContent).to.equal('Needs review3');
      expect($('list').getAttribute('aria-labelledby')).to.equal('tab-review');
    });

    it('should move between tabs with the arrow keys and load the transfers once', async () => {
      press('ArrowLeft', tab('review'));
      await settle();
      expect(app.state.tab).to.equal('toSpotify');
      expect(dom.window.document.activeElement.id).to.equal('tab-toSpotify');
      press('ArrowLeft', tab('toSpotify'));
      await settle();
      expect(app.state.tab).to.equal('toLocal');
      expect(rowTexts()).to.deep.equal(['Spotify Artist - Wanted']);
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
        'Spotify Artist - SixSpotify Album - 3:20 - 95% similarPreviewAccept',
        'Spotify Artist - Six (Live)Spotify Album - 4:20 - 70% similar - rejected beforePreviewAccept'
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
});
