// musicman ui: lists from /api, a compare panel with both versions to play, accept and reject, sorting,
// keyboard review, and a poll of /api/status for changed lists and runs going on in a terminal

const pollMs = 15000;

const state = {
  tab: 'review',
  review: null,
  transfers: null,
  history: null,
  loading: { review: false, transfers: false, history: false },
  selected: null,
  busy: false,
  // per tab { key, dir } of the sorted column, none for the order the API returns
  sort: {},
  // the last /api/status: { markers: { review, transfers }, running: [{ id, command, args, startedAt }] }
  status: null,
  // the Spotify search of the selected song: { songId, query, results, loading, error, preview, token }
  search: null
};

const tabs = [
  { id: 'review', label: 'Needs review', source: 'review' },
  { id: 'accepted', label: 'Accepted', source: 'review' },
  { id: 'rejected', label: 'Rejected', source: 'review' },
  { id: 'missing', label: 'Not found', source: 'review' },
  { id: 'toLocal', label: 'Spotify to local', source: 'transfers' },
  { id: 'toSpotify', label: 'Local to Spotify', source: 'transfers' },
  { id: 'history', label: 'History', source: 'history' }
];

const sourceOf = tabId => tabs.find(({ id }) => id === tabId).source;

// an element with attributes (on* are listeners) and children (strings become text, never markup)
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) {
      return;
    }
    if (key.startsWith('on')) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'className') {
      el.className = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  });
  children.flat(Infinity).forEach(child => {
    if (child !== null && child !== undefined && child !== false) {
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  });
  return el;
};

const $ = id => document.getElementById(id);

const api = async (url, body) => {
  const response = await fetch(
    url,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : {}
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return data;
};

const showMessage = (text, error = false) => {
  const message = $('message');
  message.hidden = !text;
  message.textContent = text || '';
  message.className = error ? 'error' : '';
};

const announce = text => {
  $('announce').textContent = text;
};

const clock = seconds => {
  if (!seconds && seconds !== 0) {
    return '';
  }
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const songDuration = song => song && song.duration;
const trackDuration = track => track && track.durationMs && track.durationMs / 1000;

// seconds between the two versions, null when either length is unknown
const lengthDifference = (song, track) => {
  const a = songDuration(song);
  const b = trackDuration(track);
  return a && b ? Math.abs(a - b) : null;
};

const percentCell = similarity => {
  if (!similarity) {
    return h('td', { className: 'num dim' }, '');
  }
  const { percent } = similarity;
  const level = percent >= 95 ? 'high' : percent >= 80 ? 'mid' : 'low';
  return h('td', { className: `num percent ${level}` }, `${percent}%`);
};

const songText = song => `${song.artist || '?'} - ${song.title || '?'}`;
const trackText = track =>
  track && track.name ? `${track.artists || '?'} - ${track.name}` : track ? track.id : '';

/**
 * Columns of each tab: the header, and the row value it sorts by. Length sorts by the difference of
 * the two lengths, Similar least similar first, so audits start with the doubtful matches.
 */
const columns = {
  review: [
    { label: 'Local song', key: 'path' },
    { label: 'Spotify candidate', key: 'track' },
    { label: 'Length', key: 'lengthDiff', title: 'Sorts by the difference of the two lengths' },
    { label: 'Similar', key: 'similarity' }
  ],
  accepted: [
    { label: 'Local song', key: 'path' },
    { label: 'Spotify track', key: 'track' },
    { label: 'Length', key: 'lengthDiff', title: 'Sorts by the difference of the two lengths' },
    { label: 'Similar', key: 'similarity' }
  ],
  rejected: [
    { label: 'Local song', key: 'path' },
    { label: 'Rejected tracks', key: 'rejected' },
    { label: 'Linked now', key: 'linked' }
  ],
  missing: [
    { label: 'Local song', key: 'path' },
    { label: 'Length', key: 'length' },
    { label: 'Looked up', key: 'checked' }
  ],
  toLocal: [
    { label: 'Spotify track', key: 'track' },
    { label: 'Album', key: 'album' },
    { label: 'Playlists', key: 'playlists' },
    { label: 'Download', key: 'download' }
  ],
  toSpotify: [
    { label: 'Local song', key: 'path' },
    { label: 'Belongs in', key: 'playlists' },
    { label: 'Spotify match', key: 'status' }
  ],
  history: [
    { label: 'When', key: 'started' },
    { label: 'Action', key: 'action' },
    { label: 'Song', key: 'path' },
    { label: 'Undo', key: 'state' }
  ]
};

const actionNames = {
  accept: 'Accept',
  reject: 'Reject',
  undo: 'Undo',
  download: 'Add to downloads'
};

// the song a run of the page changed, from its files and Spotify matches
const runPath = run => (run.files[0] || run.matches[0] || {}).path || '';

// whether undoing a run can go ahead: undone, held back by changes since, or ready
const runState = run => {
  if (run.undoneBy) {
    return 'undone';
  }
  const statuses = [...run.files, ...run.matches].map(({ status }) => status);
  if (statuses.includes('changed')) {
    return 'changed since';
  }
  if (!statuses.includes('restore')) {
    return 'nothing to undo';
  }
  return 'can undo';
};

const when = iso => (iso ? new Date(iso).toLocaleString() : '');

// rows of a tab in the order the API returns, each { key, item, text, sort, cells }
const rowsOf = tab => {
  if (tab === 'review' || tab === 'accepted') {
    return state.review[tab].map(item => ({
      key: `${item.song.id}`,
      item,
      text: [
        songText(item.song),
        item.song.album,
        trackText(item.track),
        item.track && item.track.album,
        item.song.path
      ],
      sort: {
        path: item.song.path,
        track: trackText(item.track),
        lengthDiff: lengthDifference(item.song, item.track),
        similarity: item.similarity ? item.similarity.percent : null
      },
      cells: [
        h('td', {}, songText(item.song), h('div', { className: 'dim' }, item.song.album || '')),
        h(
          'td',
          {},
          trackText(item.track),
          h('div', { className: 'dim' }, (item.track && item.track.album) || '')
        ),
        h(
          'td',
          { className: 'num' },
          clock(songDuration(item.song)),
          h('div', { className: 'dim' }, clock(trackDuration(item.track)))
        ),
        percentCell(item.similarity)
      ]
    }));
  }
  if (tab === 'rejected') {
    return state.review.rejected.map(item => ({
      key: `${item.song.id}`,
      item,
      text: [
        songText(item.song),
        item.song.album,
        item.song.path,
        ...item.rejected.map(({ track }) => trackText(track))
      ],
      sort: {
        path: item.song.path,
        rejected: item.rejected.map(({ track }) => trackText(track)).join(' '),
        linked: item.current ? trackText(item.current) : null
      },
      cells: [
        h('td', {}, songText(item.song), h('div', { className: 'dim' }, item.song.album || '')),
        h(
          'td',
          {},
          item.rejected.map(({ track }) => h('div', {}, trackText(track)))
        ),
        h(
          'td',
          {},
          item.current ? trackText(item.current) : h('span', { className: 'dim' }, item.status)
        )
      ]
    }));
  }
  if (tab === 'missing') {
    return state.review.missing.map(item => ({
      key: `${item.song.id}`,
      item,
      text: [songText(item.song), item.song.album, item.song.path],
      sort: { path: item.song.path, length: item.song.duration, checked: item.checkedAt },
      cells: [
        h(
          'td',
          {},
          item.song.artist || item.song.title ? songText(item.song) : item.song.path,
          h('div', { className: 'dim' }, item.song.album || '')
        ),
        h('td', { className: 'num' }, clock(item.song.duration)),
        h('td', { className: 'dim' }, item.checkedAt || '')
      ]
    }));
  }
  if (tab === 'toLocal') {
    return state.transfers.toLocal.map(item => ({
      key: item.track.id,
      item,
      text: [
        trackText(item.track),
        item.track.album,
        ...item.playlists,
        item.download || 'not queued'
      ],
      sort: {
        track: trackText(item.track),
        album: item.track.album,
        playlists: item.playlists.join(', '),
        download: item.download || 'not queued'
      },
      cells: [
        h('td', {}, trackText(item.track)),
        h('td', { className: 'dim' }, item.track.album || ''),
        h('td', { className: 'dim' }, item.playlists.join(', ')),
        h('td', { className: item.download ? 'dim' : null }, item.download || 'not queued')
      ]
    }));
  }
  if (tab === 'history') {
    return state.history.runs.map(run => ({
      key: run.id,
      item: run,
      text: [`${actionNames[run.args[0]] || run.args[0]} ${runPath(run)}`, run.id, runState(run)],
      sort: {
        started: run.startedAt,
        action: run.args[0],
        path: runPath(run),
        state: runState(run)
      },
      cells: [
        h('td', { className: 'dim' }, when(run.startedAt)),
        h('td', {}, actionNames[run.args[0]] || run.args[0]),
        h('td', {}, runPath(run)),
        h('td', { className: runState(run) === 'can undo' ? null : 'dim' }, runState(run))
      ]
    }));
  }
  return state.transfers.toSpotify.map(item => ({
    key: item.song.path,
    item,
    text: [
      item.song.artist && songText(item.song),
      item.song.album,
      item.song.path,
      ...item.playlists
    ],
    sort: {
      path: item.song.path,
      playlists: item.playlists.join(', '),
      status: item.status
    },
    cells: [
      h(
        'td',
        {},
        item.song.artist ? songText(item.song) : item.song.path,
        h('div', { className: 'dim' }, item.song.path)
      ),
      h('td', { className: 'dim' }, item.playlists.join(', ')),
      h('td', { className: 'dim' }, item.status || 'never looked up')
    ]
  }));
};

// unknown values (null, undefined, '') sort last in either direction
const compareValues = (a, b) => {
  const missingA = a === null || a === undefined || a === '';
  const missingB = b === null || b === undefined || b === '';
  if (missingA || missingB) {
    return missingA === missingB ? 0 : missingA ? 1 : -1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
};

const sortRows = (rows, sort) => {
  if (!sort) {
    return rows;
  }
  const sign = sort.dir === 'desc' ? -1 : 1;
  // the API order breaks ties, so equal rows keep a stable order
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = a.row.sort[sort.key];
      const vb = b.row.sort[sort.key];
      const missing =
        va === null ||
        va === undefined ||
        va === '' ||
        vb === null ||
        vb === undefined ||
        vb === '';
      const order = missing ? compareValues(va, vb) : sign * compareValues(va, vb);
      return order || a.index - b.index;
    })
    .map(({ row }) => row);
};

// the rows the list shows: the current tab's, filtered and sorted
const visibleRows = () => {
  if (!state[sourceOf(state.tab)]) {
    return [];
  }
  const filter = $('filter').value.trim().toLowerCase();
  return sortRows(
    rowsOf(state.tab).filter(
      row => !filter || row.text.filter(Boolean).join(' ').toLowerCase().includes(filter)
    ),
    state.sort[state.tab]
  );
};

const notes = {
  review:
    'Matches sync --match was not sure of. Pick a row to play both versions, then accept or reject.',
  accepted:
    'Matches accepted in review, newest first. Rejecting removes the Spotify id and fields from the file.',
  rejected: 'Tracks rejected for a song. Accepting one links the song to it after all.',
  missing:
    'Songs sync --match found no Spotify candidate for. Pick one to search Spotify, play the results, and accept one.',
  toLocal:
    'Tracks in the mapped Spotify playlists that are not in the library. Add them to the download manifest here (or with sync --pull); pnpm download fetches them and sync --import brings them in.',
  toSpotify:
    'Songs that belong in a Spotify playlist but have no Spotify id, so only a local file can bring them there.',
  history:
    'Accepts, rejects, and undos of this page, newest first. Undoing one puts back the tags and the Spotify match, as musicman undo does.'
};

const keyHints = {
  review:
    'Keys: j/k move, space plays the local file, s the Spotify track, a accepts, r rejects, / filters, Esc closes.',
  accepted:
    'Keys: j/k move, space plays the local file, s the Spotify track, r rejects, / filters, Esc closes.',
  rejected:
    'Keys: j/k move, space plays the local file, s the linked or only rejected track, a accepts a song with one rejected track, / filters, Esc closes.',
  missing:
    'Keys: j/k move, space plays the local file, s the previewed or first result, / filters, Esc closes. The search runs when you stop on a song.',
  toLocal: 'Keys: j/k move, s plays the Spotify track, / filters, Esc closes.',
  toSpotify: 'Keys: j/k move, space plays the local file, / filters, Esc closes.',
  history: 'Keys: j/k move, / filters, Esc closes.'
};

// whether the database changed since the source's lists were loaded
const isStale = source =>
  Boolean(
    state[source] &&
    state.status &&
    state[source].marker &&
    state.status.markers[source] !== state[source].marker
  );

const focusTab = id => {
  const button = $(`tab-${id}`);
  if (button) {
    button.focus();
  }
};

// arrow keys, Home, and End move between the tabs, as in a tablist
const onTabKey = event => {
  const index = tabs.findIndex(({ id }) => id === state.tab);
  const next = {
    ArrowRight: (index + 1) % tabs.length,
    ArrowLeft: (index - 1 + tabs.length) % tabs.length,
    Home: 0,
    End: tabs.length - 1
  }[event.key];
  if (next === undefined) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  selectTab(tabs[next].id);
  focusTab(tabs[next].id);
};

const renderTabs = () => {
  const counts = {
    review: state.review && state.review.review.length,
    accepted: state.review && state.review.accepted.length,
    rejected: state.review && state.review.rejected.length,
    missing: state.review && state.review.missing.length,
    toLocal: state.transfers && state.transfers.toLocal.length,
    toSpotify: state.transfers && state.transfers.toSpotify.length,
    history: null
  };
  // drawing the tabs again keeps the focus on the tab that had it
  const focused = document.activeElement && document.activeElement.getAttribute('role') === 'tab';
  $('tabs').replaceChildren(
    ...tabs.map(({ id, label, source }) =>
      h(
        'button',
        {
          id: `tab-${id}`,
          role: 'tab',
          'aria-selected': String(state.tab === id),
          'aria-controls': 'list',
          tabindex: state.tab === id ? '0' : '-1',
          className: isStale(source) ? 'stale' : null,
          title: isStale(source) ? 'Changed since loaded' : null,
          onClick: () => selectTab(id),
          onKeydown: onTabKey
        },
        label,
        counts[id] === undefined || counts[id] === null
          ? null
          : h('span', { className: 'count' }, counts[id])
      )
    )
  );
  $('list').setAttribute('aria-labelledby', `tab-${state.tab}`);
  if (focused) {
    focusTab(state.tab);
  }
};

// the note above the list, with the reload button and whether the list changed since it was loaded
const renderHead = () => {
  const source = sourceOf(state.tab);
  const head = $('list-head');
  if (!state[source]) {
    head.replaceChildren();
    return;
  }
  const syncedNote =
    source === 'transfers'
      ? ` As of the last sync${state.transfers.syncedAt ? ` (${state.transfers.syncedAt} UTC)` : ''}.`
      : '';
  head.replaceChildren(
    h(
      'p',
      { className: 'note' },
      notes[state.tab] + syncedNote,
      ' ',
      isStale(source)
        ? h('span', { className: 'stale-note' }, 'Changed since loaded (a run in a terminal?). ')
        : null,
      h(
        'button',
        {
          className: 'reload',
          disabled: state.loading[source],
          // the server keeps the transfer lists; the button asks for them computed again
          onClick: () => load(source, { fresh: true })
        },
        state.loading[source] ? 'Reloading...' : 'Reload'
      ),
      source === 'transfers' ? transferButtons() : null
    )
  );
};

// tracks of the Spotify to local list shown now (the filter applies) not in the download manifest
const notQueued = () =>
  state.tab === 'toLocal'
    ? visibleRows()
        .map(({ item }) => item)
        .filter(item => !item.download)
    : [];

const transferButtons = () => {
  const waiting = notQueued();
  return [
    ' ',
    h(
      'button',
      {
        className: 'reload',
        disabled: state.refreshing || state.loading.transfers,
        title: 'Fetch the Spotify playlists again, as sync does first',
        onClick: () => refreshPlaylists()
      },
      state.refreshing ? 'Refreshing...' : 'Refresh playlists'
    ),
    state.tab === 'toLocal' && waiting.length > 0
      ? [
          ' ',
          h(
            'button',
            {
              className: 'reload',
              disabled: state.busy,
              onClick: () => queueDownloads(waiting.map(({ track }) => track.id))
            },
            `Add ${waiting.length} to downloads`
          )
        ]
      : null
  ];
};

// fetches the Spotify playlists again, then the transfer lists computed from them
const refreshPlaylists = async () => {
  state.refreshing = true;
  renderHead();
  try {
    const result = await api('/api/spotify/refresh', {});
    showMessage(
      `Refreshed ${result.refreshed} Spotify playlists (${result.unchanged} unchanged since the last sync)`
    );
    state.refreshing = false;
    await load('transfers');
  } catch (err) {
    state.refreshing = false;
    showMessage(`Refreshing the playlists failed: ${err.message}`, true);
    renderHead();
  }
};

// adds tracks to the download manifest for pnpm download
const queueDownloads = async trackIds => {
  if (state.busy || !confirmWhileRunning('download')) {
    return;
  }
  setBusy(true);
  try {
    const result = await api('/api/downloads', { trackIds });
    showMessage(
      `Added ${result.added.length} tracks to the download manifest; pnpm download fetches them` +
        (result.unknown.length > 0
          ? ` (${result.unknown.length} are no longer in the list, reload it)`
          : '')
    );
    setBusy(false);
    await load('transfers');
  } catch (err) {
    showMessage(`Adding to downloads failed: ${err.message}`, true);
    setBusy(false);
  }
};

const onSortClick = key => {
  const current = state.sort[state.tab];
  // ascending, descending, then the order the API returns
  state.sort[state.tab] =
    !current || current.key !== key
      ? { key, dir: 'asc' }
      : current.dir === 'asc'
        ? { key, dir: 'desc' }
        : undefined;
  renderList();
};

const headerCell = column => {
  const sort = state.sort[state.tab];
  const dir = sort && sort.key === column.key ? sort.dir : null;
  return h(
    'th',
    { 'aria-sort': dir ? (dir === 'asc' ? 'ascending' : 'descending') : null },
    h(
      'button',
      { className: 'sort', title: column.title || null, onClick: () => onSortClick(column.key) },
      column.label,
      h(
        'span',
        { className: 'arrow', 'aria-hidden': 'true' },
        dir ? (dir === 'asc' ? ' ▲' : ' ▼') : ''
      )
    )
  );
};

const renderList = () => {
  renderHead();
  const body = $('list-body');
  const source = sourceOf(state.tab);
  if (!state[source]) {
    body.replaceChildren(
      h(
        'p',
        { className: 'note' },
        source === 'transfers'
          ? 'Comparing the library with the cached Spotify playlists, this takes a few seconds...'
          : 'Loading...'
      )
    );
    return;
  }
  const filter = $('filter').value.trim();
  const rows = visibleRows();
  body.replaceChildren(
    rows.length === 0
      ? h('p', { className: 'note' }, filter ? 'Nothing matches the filter.' : 'Nothing here.')
      : h(
          'table',
          {},
          h('thead', {}, h('tr', {}, columns[state.tab].map(headerCell))),
          h(
            'tbody',
            {},
            rows.map(row =>
              h(
                'tr',
                {
                  'data-key': row.key,
                  className: state.selected === row.key ? 'selected' : null,
                  'aria-current': state.selected === row.key ? 'true' : null,
                  tabindex: '0',
                  onClick: () => select(row.key),
                  onKeydown: event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      select(row.key);
                    }
                  }
                },
                row.cells
              )
            )
          )
        ),
    h('p', { className: 'note keys' }, keyHints[state.tab])
  );
};

const runText = run => {
  const started = run.startedAt ? new Date(run.startedAt) : null;
  const args = Array.isArray(run.args) && run.args.length > 0 ? run.args.join(' ') : run.command;
  return `musicman ${args}${started ? ` (since ${started.toLocaleTimeString()})` : ''}`;
};

// the banner while runs of other commands change the library
const renderRuns = () => {
  const banner = $('runs');
  const running = (state.status && state.status.running) || [];
  banner.hidden = running.length === 0;
  banner.textContent =
    running.length === 0
      ? ''
      : `Running: ${running.map(runText).join(', ')}. It can write the same files and rows as accepting and rejecting here, so the page asks before each.`;
};

const field = (label, value, other) => [
  h('dt', {}, label),
  h(
    'dd',
    {
      className:
        other !== undefined &&
        value &&
        other &&
        String(value).toLowerCase() !== String(other).toLowerCase()
          ? 'differs'
          : null
    },
    value || h('span', { className: 'dim' }, 'none')
  )
];

const localVersion = song =>
  h(
    'div',
    { className: 'version' },
    h('h3', {}, 'Local file'),
    h(
      'dl',
      {},
      field('Artist', song.artist),
      field('Title', song.title),
      field('Album', song.album),
      field('Length', clock(song.duration)),
      field('Path', song.path)
    ),
    song.id
      ? h('audio', {
          controls: true,
          preload: 'none',
          src: `/api/songs/${song.id}/audio`,
          'aria-label': `Local file ${songText(song)}`,
          // one player at a time: the file pauses Spotify in the page
          onPlay: () => pauseWebPlayer()
        })
      : null
  );

const spotifyVersion = (title, track, song, actions = []) =>
  h(
    'div',
    { className: 'version' },
    h('h3', {}, title),
    h(
      'dl',
      {},
      field('Artist', track.artists, song && song.artist),
      field('Title', track.name, song && song.title),
      field('Album', track.album, song && song.album),
      field('Length', clock(trackDuration(track)), song && clock(song.duration)),
      field('Track id', track.id)
    ),
    h('iframe', {
      src: `https://open.spotify.com/embed/track/${encodeURIComponent(track.id)}`,
      height: '80',
      loading: 'lazy',
      allow: 'autoplay; clipboard-write; encrypted-media',
      title: `Spotify player for ${trackText(track)}`
    }),
    h(
      'div',
      { className: 'actions' },
      playHereButton(track.id),
      h('button', { onClick: () => openInApp(track.id) }, 'Play in Spotify app'),
      actions
    )
  );

const actionButton = (label, kind, songId, trackId) =>
  h(
    'button',
    { className: kind, disabled: state.busy, onClick: () => act(kind, songId, trackId) },
    label
  );

const similarityLine = similarity =>
  similarity
    ? h(
        'p',
        { className: 'similarity' },
        `${similarity.percent}% similar`,
        h('span', { className: 'dim' }, ` - ${similarity.details}`)
      )
    : null;

// waits this long after a song is selected on the Not found tab before searching, so moving through
// the list with j and k does not search for every song on the way
const searchDelayMs = 400;
let searchTimer = null;
let searchCount = 0;

const searchOf = song =>
  state.search && song && state.search.songId === song.id ? state.search : null;

const searchResult = (song, search, { track, similarity, rejected }) =>
  h(
    'li',
    {},
    h(
      'div',
      {},
      trackText(track),
      h(
        'div',
        { className: 'dim' },
        [
          track.album,
          clock(trackDuration(track)),
          similarity ? `${similarity.percent}% similar` : null,
          rejected ? 'rejected before' : null
        ]
          .filter(Boolean)
          .join(' - ')
      )
    ),
    h(
      'div',
      { className: 'actions' },
      h(
        'button',
        {
          'aria-pressed': String(search.preview === track.id),
          onClick: () => {
            search.preview = search.preview === track.id ? null : track.id;
            renderSearch();
          }
        },
        'Preview'
      ),
      playHereButton(track.id),
      actionButton('Accept', 'accept', song.id, track.id)
    )
  );

// the contents of the search section: the query form, and the results with a preview player
const searchContent = song => {
  const search = searchOf(song);
  const input = h('input', {
    type: 'search',
    name: 'q',
    value: search ? search.query : null,
    placeholder: 'Empty for the query of sync --match',
    'aria-label': 'Spotify search'
  });
  const form = h(
    'form',
    {
      onSubmit: event => {
        event.preventDefault();
        runSearch(song, input.value.trim());
      }
    },
    input,
    h(
      'button',
      { type: 'submit', disabled: Boolean(search && search.loading) },
      search && search.loading ? 'Searching...' : 'Search'
    )
  );
  let results = null;
  if (search && search.error) {
    results = h('p', { className: 'error' }, `Search failed: ${search.error}`);
  } else if (search && search.results && search.results.length === 0) {
    results = h('p', { className: 'dim' }, 'Nothing found; try other words.');
  } else if (search && search.results) {
    const previewed = search.results.find(({ track }) => track.id === search.preview);
    results = [
      h(
        'ul',
        { className: 'results' },
        search.results.map(result => searchResult(song, search, result))
      ),
      previewed
        ? h('iframe', {
            src: `https://open.spotify.com/embed/track/${encodeURIComponent(previewed.track.id)}`,
            height: '80',
            allow: 'autoplay; clipboard-write; encrypted-media',
            title: `Spotify player for ${trackText(previewed.track)}`
          })
        : null
    ];
  }
  return [h('h3', {}, 'Find on Spotify'), form, results];
};

const searchSection = song =>
  h(
    'section',
    { id: 'search', className: 'version', 'aria-label': 'Find on Spotify' },
    searchContent(song)
  );

// draws the search section again, without the rest of the panel and its players
const renderSearch = () => {
  const section = $('search');
  const row = selectedRow();
  if (!section || !row) {
    return;
  }
  const typing =
    document.activeElement &&
    section.contains(document.activeElement) &&
    document.activeElement.tagName === 'INPUT';
  section.replaceChildren(...searchContent(row.item.song).flat().filter(Boolean));
  if (typing) {
    section.querySelector('input').focus();
  }
};

// searches Spotify for a song, with the query, or the queries of sync --match when it is empty; a
// result that arrives after another search started, or after the song changed, is dropped
const runSearch = async (song, query = '') => {
  searchCount += 1;
  const token = searchCount;
  state.search = {
    songId: song.id,
    query,
    results: null,
    loading: true,
    error: null,
    preview: null,
    token
  };
  renderSearch();
  const params = new URLSearchParams({ song: String(song.id) });
  if (query) {
    params.set('q', query);
  }
  let update;
  try {
    const data = await api(`/api/spotify/search?${params}`);
    update = { query: data.query, results: data.tracks };
  } catch (err) {
    update = { error: err.message };
  }
  if (!state.search || state.search.token !== token) {
    return;
  }
  Object.assign(state.search, update, { loading: false });
  renderSearch();
};

// on the Not found tab, searches for the selected song once the selection stays on it
const scheduleSearch = () => {
  clearTimeout(searchTimer);
  const row = selectedRow();
  if (state.tab !== 'missing' || !row || searchOf(row.item.song)) {
    return;
  }
  const { song } = row.item;
  searchTimer = setTimeout(() => {
    const current = selectedRow();
    if (current && current.item.song.id === song.id && !searchOf(song)) {
      runSearch(song);
    }
  }, searchDelayMs);
};

const selectedRow = () =>
  state.selected && state[sourceOf(state.tab)]
    ? rowsOf(state.tab).find(({ key }) => key === state.selected)
    : null;

// what undoing a run of the page does, with Undo, and Undo anyway when something changed since
const historyDetails = run => {
  const lines = [
    ...run.files.map(({ path: file, frames, status, changed }) =>
      h(
        'li',
        { className: status === 'restore' ? null : 'differs' },
        {
          restore: `Tags of ${file} back: ${frames.join(', ')}`,
          changed: `Tags of ${file} changed since: ${changed.join(', ')} (Undo anyway puts them back)`,
          missing: `${file} is gone (moved or deleted)`
        }[status]
      )
    ),
    ...run.matches.map(({ path: file, before, status }) =>
      h(
        'li',
        { className: status === 'restore' ? null : 'differs' },
        {
          restore: before
            ? `Spotify match of ${file} back to ${before}`
            : `Spotify match of ${file} removed`,
          changed: `Spotify match of ${file} changed since, e.g. by sync --match (Undo anyway puts it back)`,
          missing: `${file} is no longer in the library`
        }[status]
      )
    )
  ];
  const undoState = runState(run);
  return [
    h(
      'p',
      { className: 'dim' },
      `${run.id}, ${when(run.startedAt)}`,
      run.args[2] ? ` - track ${run.args[2]}` : '',
      run.undoes ? ` - undoes ${run.undoes}` : '',
      run.undoneBy ? ` - undone by ${run.undoneBy}` : ''
    ),
    h(
      'div',
      { className: 'version' },
      h('h3', {}, 'Undoing it'),
      h('ul', { className: 'plan' }, lines)
    ),
    h(
      'div',
      { className: 'actions' },
      h(
        'button',
        {
          className: 'undo',
          disabled: state.busy || undoState !== 'can undo',
          onClick: () => undoRun(run.id, false)
        },
        'Undo'
      ),
      undoState === 'changed since'
        ? h(
            'button',
            { className: 'undo', disabled: state.busy, onClick: () => undoRun(run.id, true) },
            'Undo anyway'
          )
        : null
    )
  ];
};

const renderCompare = () => {
  const compare = $('compare');
  const row = selectedRow();
  if (!row) {
    compare.hidden = true;
    compare.replaceChildren();
    return;
  }
  const { item } = row;
  compare.hidden = false;
  let body;
  if (state.tab === 'review') {
    body = [
      similarityLine(item.similarity),
      localVersion(item.song),
      spotifyVersion(
        item.linked ? 'Spotify candidate (already linked)' : 'Spotify candidate',
        item.track,
        item.song,
        [
          actionButton('Accept', 'accept', item.song.id, item.track.id),
          actionButton('Reject', 'reject', item.song.id, item.track.id)
        ]
      ),
      searchSection(item.song)
    ];
  } else if (state.tab === 'accepted') {
    body = [
      similarityLine(item.similarity),
      localVersion(item.song),
      spotifyVersion('Spotify track (accepted)', item.track, item.song, [
        actionButton('Reject', 'reject', item.song.id, item.track.id)
      ]),
      searchSection(item.song)
    ];
  } else if (state.tab === 'rejected') {
    body = [
      localVersion(item.song),
      item.current ? spotifyVersion('Linked now', item.current, item.song) : null,
      ...item.rejected.map(({ track }) =>
        spotifyVersion('Rejected track', track, item.song, [
          actionButton('Accept this one', 'accept', item.song.id, track.id)
        ])
      ),
      searchSection(item.song)
    ];
  } else if (state.tab === 'missing') {
    body = [localVersion(item.song), searchSection(item.song)];
  } else if (state.tab === 'history') {
    body = historyDetails(item);
  } else if (state.tab === 'toLocal') {
    body = [
      spotifyVersion('Spotify track', item.track, null, [
        h(
          'button',
          {
            className: 'accept',
            disabled: state.busy || Boolean(item.download),
            onClick: () => queueDownloads([item.track.id])
          },
          item.download ? `In downloads (${item.download})` : 'Add to downloads'
        )
      ])
    ];
  } else {
    body = [localVersion(item.song)];
  }
  compare.replaceChildren(h('h2', {}, row.text[0] || ''), ...body);
};

const render = () => {
  renderTabs();
  renderList();
  renderCompare();
  renderRuns();
};

// focuses the selected row and scrolls it into view, after the list was drawn again
const focusSelected = () => {
  const row = state.selected
    ? [...document.querySelectorAll('#list-body tbody tr')].find(
        tr => tr.dataset.key === state.selected
      )
    : null;
  if (row) {
    row.focus();
    if (row.scrollIntoView) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }
};

const announceSelected = () => {
  const rows = visibleRows();
  const index = rows.findIndex(({ key }) => key === state.selected);
  announce(index < 0 ? '' : `${index + 1} of ${rows.length}: ${rows[index].text[0] || ''}`);
};

const setSelected = (key, { focus = false } = {}) => {
  state.selected = key;
  renderList();
  renderCompare();
  announceSelected();
  if (focus) {
    focusSelected();
  }
  scheduleSearch();
};

// a click selects a row, or closes the panel of the selected one
const select = key => setSelected(state.selected === key ? null : key, { focus: true });

// j/k: the next or previous visible row, the first or last when none is selected
const move = delta => {
  const rows = visibleRows();
  if (rows.length === 0) {
    return;
  }
  const index = rows.findIndex(({ key }) => key === state.selected);
  const next =
    index < 0
      ? delta > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, index + delta));
  setSelected(rows[next].key, { focus: true });
};

const load = async (source, { fresh = false } = {}) => {
  state.loading[source] = true;
  if (sourceOf(state.tab) === source) {
    renderHead();
  }
  try {
    state[source] = await api(
      {
        review: '/api/review',
        transfers: `/api/transfers${fresh ? '?fresh' : ''}`,
        history: '/api/history'
      }[source]
    );
    if (source === 'review' && state.review.warning) {
      showMessage(state.review.warning, true);
    }
  } catch (err) {
    showMessage(`Could not load ${source}: ${err.message}`, true);
  }
  state.loading[source] = false;
  // a reload keeps the selection when the row is still there
  if (state.selected && sourceOf(state.tab) === source && !selectedRow()) {
    state.selected = null;
  }
  render();
};

const selectTab = id => {
  if (state.tab === id) {
    return;
  }
  state.tab = id;
  state.selected = null;
  const source = sourceOf(id);
  render();
  announce('');
  if (!state[source] && !state.loading[source]) {
    load(source);
  }
};

/**
 * Full tracks in the page through the Spotify Web Playback SDK, which makes the page a Spotify
 * Connect device (Premium, and the streaming permission of musicman sync --login). The SDK loads on
 * first use, so opening the page adds no device; status is off, loading, ready, or failed (with the
 * reason, kept until the page reloads); trackId and paused follow the player.
 */
const web = {
  status: 'off',
  reason: null,
  starting: null,
  player: null,
  deviceId: null,
  trackId: null,
  paused: true
};

const sdkUrl = 'https://sdk.scdn.co/spotify-player.js';
const playerName = 'musicman ui';

const fetchToken = async () => (await api('/api/spotify/token')).accessToken;

const loadSdk = () =>
  new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify);
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    const script = h('script', { src: sdkUrl, async: true });
    script.addEventListener('error', () =>
      reject(new Error('the Spotify player script did not load'))
    );
    document.head.append(script);
  });

const sdkErrors = {
  initialization_error: message => `this browser cannot play Spotify (${message})`,
  authentication_error: message =>
    `Spotify refused the login (${message}); run musicman sync --login`,
  account_error: message => `Spotify Premium is needed (${message})`
};

// shows on each Play here button whether its track plays in the page
const renderPlayback = () => {
  document.querySelectorAll('button.play-here').forEach(button => {
    const playing = web.trackId === button.dataset.track && !web.paused;
    button.textContent = playing ? 'Pause' : 'Play here';
    button.setAttribute('aria-pressed', String(playing));
    button.disabled = web.status === 'loading';
    button.title = web.status === 'failed' ? `Not available: ${web.reason}` : '';
  });
};

// connects the page's player once; resolves when it is a Connect device
const startWebPlayer = () => {
  if (web.status === 'failed') {
    return Promise.reject(new Error(web.reason));
  }
  if (web.starting) {
    return web.starting;
  }
  web.status = 'loading';
  renderPlayback();
  web.starting = (async () => {
    // asked first, so a missing permission is told before the SDK loads
    await fetchToken();
    const Spotify = await loadSdk();
    const player = new Spotify.Player({
      name: playerName,
      getOAuthToken: callback =>
        fetchToken().then(callback, err => showMessage(`Spotify: ${err.message}`, true)),
      volume: 0.8
    });
    const deviceId = await new Promise((resolve, reject) => {
      player.addListener('ready', ({ device_id: id }) => resolve(id));
      Object.entries(sdkErrors).forEach(([name, reason]) =>
        player.addListener(name, ({ message }) => reject(new Error(reason(message))))
      );
      player.connect().then(connected => {
        if (!connected) {
          reject(new Error('the Spotify player could not connect'));
        }
      });
    });
    player.addListener('player_state_changed', playerState => {
      web.trackId = playerState ? (playerState.track_window.current_track || {}).id || null : null;
      web.paused = playerState ? playerState.paused : true;
      renderPlayback();
    });
    player.addListener('playback_error', ({ message }) =>
      showMessage(`Spotify playback: ${message}`, true)
    );
    // leaves Spotify Connect when the page closes
    window.addEventListener('pagehide', () => player.disconnect());
    Object.assign(web, { status: 'ready', player, deviceId });
    renderPlayback();
    return web;
  })();
  web.starting.catch(err => {
    Object.assign(web, { status: 'failed', reason: err.message, starting: null });
    renderPlayback();
  });
  return web.starting;
};

const pauseWebPlayer = () => {
  if (web.player && !web.paused) {
    web.player.pause();
  }
};

const pauseLocal = () => document.querySelectorAll('audio').forEach(audio => audio.pause());

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// starts a track on the page's device; a device that just connected can be unknown for a moment
const startTrack = async (deviceId, trackId) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${await fetchToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
      }
    );
    if (response.ok) {
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (response.status !== 404 || attempt > 0) {
      throw new Error((body.error && body.error.message) || `Spotify answered ${response.status}`);
    }
    await wait(1000);
  }
};

// plays a track in the page, or pauses and resumes it when it is the one playing there
const playHere = async trackId => {
  if (web.player) {
    // lets the browser start audio from this click or key press
    web.player.activateElement();
  }
  const ready = await startWebPlayer();
  pauseLocal();
  if (ready.trackId === trackId) {
    await ready.player.togglePlay();
    return;
  }
  await startTrack(ready.deviceId, trackId);
};

const playHereButton = trackId =>
  h(
    'button',
    {
      className: 'play-here',
      'data-track': trackId,
      'aria-pressed': String(web.trackId === trackId && !web.paused),
      title: web.status === 'failed' ? `Not available: ${web.reason}` : null,
      onClick: () =>
        playHere(trackId).catch(err => showMessage(`Playing in the page: ${err.message}`, true))
    },
    web.trackId === trackId && !web.paused ? 'Pause' : 'Play here'
  );

const openInApp = async trackId => {
  try {
    await api('/api/spotify/open', { trackId });
    showMessage('Playing in the Spotify app');
  } catch (err) {
    showMessage(`Spotify app: ${err.message}`, true);
  }
};

// greys out the accept and reject buttons without drawing the panel again, which would restart the
// players
const setBusy = busy => {
  state.busy = busy;
  document.querySelectorAll('#compare button.accept, #compare button.reject').forEach(button => {
    button.disabled = busy;
  });
};

// while another run changes the library, asks before acting; true to go ahead
const confirmWhileRunning = kind => {
  const running = (state.status && state.status.running) || [];
  if (running.length === 0) {
    return true;
  }
  return window.confirm(
    `${running.map(runText).join(', ')} is running and can write the same files. ${
      actionNames[kind]
    } anyway?`
  );
};

const act = async (kind, songId, trackId) => {
  if (state.busy || !confirmWhileRunning(kind)) {
    return;
  }
  // after the lists reload, the row at the same place is selected: the next one when this one left
  const position = visibleRows().findIndex(({ key }) => key === state.selected);
  setBusy(true);
  try {
    const result = await api(`/api/songs/${songId}/${kind}`, { trackId });
    showMessage(
      `${kind === 'accept' ? 'Accepted' : 'Rejected'} ${trackId}` +
        (result.detailsError ? ` (fields not fetched: ${result.detailsError})` : '') +
        '; musicman undo restores the tags'
    );
    state.selected = null;
    setBusy(false);
    await Promise.all([load('review'), state.history ? load('history') : null]);
    const rows = visibleRows();
    if (position >= 0 && rows.length > 0 && sourceOf(state.tab) === 'review') {
      setSelected(rows[Math.min(position, rows.length - 1)].key, { focus: true });
    }
  } catch (err) {
    showMessage(`${kind} failed: ${err.message}`, true);
    setBusy(false);
  }
};

// undoes a run of the page; force also puts back what changed since
const undoRun = async (runId, force) => {
  if (state.busy || !confirmWhileRunning('undo')) {
    return;
  }
  setBusy(true);
  try {
    const result = await api(`/api/history/${encodeURIComponent(runId)}/undo`, { force });
    showMessage(
      `Undid ${runId}: ${result.files} files and ${result.matches} Spotify matches put back`
    );
    setBusy(false);
    await Promise.all([load('history'), load('review')]);
  } catch (err) {
    showMessage(`Undo failed: ${err.message}`, true);
    setBusy(false);
  }
};

// a and r: accept or reject the selected song's track, where there is one track to act on
const keyAction = kind => {
  const row = selectedRow();
  if (!row) {
    return;
  }
  const { item } = row;
  if (state.tab === 'review') {
    act(kind, item.song.id, item.track.id);
  } else if (state.tab === 'accepted' && kind === 'reject') {
    act(kind, item.song.id, item.track.id);
  } else if (state.tab === 'rejected' && kind === 'accept') {
    if (item.rejected.length === 1) {
      act(kind, item.song.id, item.rejected[0].track.id);
    } else {
      showMessage('This song has several rejected tracks: accept one with its button');
    }
  }
};

// space: play or pause the local file of the selected song
// the Spotify track s plays for the selected song: the candidate or linked track, on Not found the
// previewed or first search result
const spotifyTrackOf = row => {
  if (!row) {
    return null;
  }
  const { item } = row;
  if (state.tab === 'rejected') {
    return item.current || (item.rejected.length === 1 ? item.rejected[0].track : null);
  }
  if (state.tab === 'missing') {
    const search = searchOf(item.song);
    const results = (search && search.results) || [];
    const previewed = results.find(({ track }) => track.id === search.preview);
    return (previewed || results[0] || {}).track || null;
  }
  return item.track || null;
};

// s: the Spotify track in the page, or in the desktop app when the page cannot play it
const playSpotify = () => {
  const row = selectedRow();
  if (!row) {
    return false;
  }
  const track = spotifyTrackOf(row);
  if (!track) {
    showMessage(
      state.tab === 'missing'
        ? 'No search result to play yet'
        : 'No single Spotify track to play for this song'
    );
    return true;
  }
  playHere(track.id).catch(err => {
    showMessage(`Playing in the Spotify app; in the page: ${err.message}`);
    pauseLocal();
    api('/api/spotify/open', { trackId: track.id }).catch(appErr =>
      showMessage(`Spotify app: ${appErr.message}`, true)
    );
  });
  return true;
};

const toggleLocal = () => {
  const audio = document.querySelector('#compare audio');
  if (!audio) {
    return false;
  }
  if (audio.paused) {
    pauseWebPlayer();
    const playing = audio.play();
    if (playing && playing.catch) {
      playing.catch(err => showMessage(`Could not play the file: ${err.message}`, true));
    }
  } else {
    audio.pause();
  }
  return true;
};

const onKey = event => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target && target.closest('input, textarea, select, [contenteditable]')) {
    if (event.key === 'Escape') {
      target.blur();
    }
    return;
  }
  // space and Enter keep pressing a focused button, link, or audio control
  if (
    target &&
    target.closest('button, a, audio') &&
    (event.key === ' ' || event.key === 'Enter')
  ) {
    return;
  }
  const handlers = {
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    ' ': () => {
      // on a row that is not selected yet, space selects it
      const row = target && target.closest('tr[data-key]');
      if (row && row.dataset.key !== state.selected) {
        select(row.dataset.key);
        return true;
      }
      return toggleLocal();
    },
    s: () => playSpotify(),
    a: () => keyAction('accept'),
    r: () => keyAction('reject'),
    '/': () => $('filter').focus(),
    Escape: () => (state.selected ? setSelected(null) : false)
  };
  const handler = handlers[event.key];
  if (handler && handler() !== false) {
    event.preventDefault();
  }
};

// asks the server what changed: the lists drawn again only when one is stale, so a poll never takes
// the focus or restarts a player
const poll = async () => {
  try {
    const status = await api('/api/status');
    const before = JSON.stringify([
      isStale('review'),
      isStale('transfers'),
      isStale('history'),
      state.status && state.status.running
    ]);
    state.status = status;
    const after = JSON.stringify([
      isStale('review'),
      isStale('transfers'),
      isStale('history'),
      status.running
    ]);
    if (before !== after) {
      renderTabs();
      renderHead();
      renderRuns();
    }
  } catch {
    // the server stopped (ctrl-c); the next poll tries again
  }
};

let pollTimer = null;

const startPolling = () => {
  pollTimer = setInterval(() => {
    if (!document.hidden) {
      poll();
    }
  }, pollMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      poll();
    }
  });
};

const stopPolling = () => {
  clearInterval(pollTimer);
  pollTimer = null;
};

// resolves when the first list and status are loaded
const ready = (() => {
  $('filter').addEventListener('input', () => {
    renderList();
    announceSelected();
  });
  document.addEventListener('keydown', onKey);
  render();
  startPolling();
  return Promise.all([load('review'), poll()]);
})();

export { poll, ready, state, stopPolling, web };
