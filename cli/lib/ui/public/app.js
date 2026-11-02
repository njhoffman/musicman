// musicman ui: lists from /api, a compare panel with both versions to play, accept and reject, sorting,
// keyboard review, and a poll of /api/status for changed lists and runs going on in a terminal

const pollMs = 15000;

const state = {
  tab: 'review',
  review: null,
  transfers: null,
  loading: { review: false, transfers: false },
  selected: null,
  busy: false,
  // per tab { key, dir } of the sorted column, none for the order the API returns
  sort: {},
  // the last /api/status: { markers: { review, transfers }, running: [{ id, command, args, startedAt }] }
  status: null
};

const tabs = [
  { id: 'review', label: 'Needs review', source: 'review' },
  { id: 'accepted', label: 'Accepted', source: 'review' },
  { id: 'rejected', label: 'Rejected', source: 'review' },
  { id: 'toLocal', label: 'Spotify to local', source: 'transfers' },
  { id: 'toSpotify', label: 'Local to Spotify', source: 'transfers' }
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
  children.flat().forEach(child => {
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
  toLocal: [
    { label: 'Spotify track', key: 'track' },
    { label: 'Album', key: 'album' },
    { label: 'Playlists', key: 'playlists' }
  ],
  toSpotify: [
    { label: 'Local song', key: 'path' },
    { label: 'Belongs in', key: 'playlists' },
    { label: 'Spotify match', key: 'status' }
  ]
};

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
  if (tab === 'toLocal') {
    return state.transfers.toLocal.map(item => ({
      key: item.track.id,
      item,
      text: [trackText(item.track), item.track.album, ...item.playlists],
      sort: {
        track: trackText(item.track),
        album: item.track.album,
        playlists: item.playlists.join(', ')
      },
      cells: [
        h('td', {}, trackText(item.track)),
        h('td', { className: 'dim' }, item.track.album || ''),
        h('td', { className: 'dim' }, item.playlists.join(', '))
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
  toLocal:
    'Tracks in the mapped Spotify playlists that are not in the library (sync --pull downloads them).',
  toSpotify:
    'Songs that belong in a Spotify playlist but have no Spotify id, so only a local file can bring them there.'
};

const keyHints = {
  review:
    'Keys: j/k move, space plays the local file, a accepts, r rejects, / filters, Esc closes.',
  accepted: 'Keys: j/k move, space plays the local file, r rejects, / filters, Esc closes.',
  rejected:
    'Keys: j/k move, space plays the local file, a accepts a song with one rejected track, / filters, Esc closes.',
  toLocal: 'Keys: j/k move, / filters, Esc closes.',
  toSpotify: 'Keys: j/k move, space plays the local file, / filters, Esc closes.'
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
    toLocal: state.transfers && state.transfers.toLocal.length,
    toSpotify: state.transfers && state.transfers.toSpotify.length
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
          onClick: () => load(source)
        },
        state.loading[source] ? 'Reloading...' : 'Reload'
      )
    )
  );
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
          'aria-label': `Local file ${songText(song)}`
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

const selectedRow = () =>
  state.selected && state[sourceOf(state.tab)]
    ? rowsOf(state.tab).find(({ key }) => key === state.selected)
    : null;

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
      )
    ];
  } else if (state.tab === 'accepted') {
    body = [
      similarityLine(item.similarity),
      localVersion(item.song),
      spotifyVersion('Spotify track (accepted)', item.track, item.song, [
        actionButton('Reject', 'reject', item.song.id, item.track.id)
      ])
    ];
  } else if (state.tab === 'rejected') {
    body = [
      localVersion(item.song),
      item.current ? spotifyVersion('Linked now', item.current, item.song) : null,
      ...item.rejected.map(({ track }) =>
        spotifyVersion('Rejected track', track, item.song, [
          actionButton('Accept this one', 'accept', item.song.id, track.id)
        ])
      )
    ];
  } else if (state.tab === 'toLocal') {
    body = [spotifyVersion('Spotify track', item.track, null)];
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

const load = async source => {
  state.loading[source] = true;
  if (sourceOf(state.tab) === source) {
    renderHead();
  }
  try {
    state[source] = await api(source === 'review' ? '/api/review' : '/api/transfers');
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
      kind === 'accept' ? 'Accept' : 'Reject'
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
    await load('review');
    const rows = visibleRows();
    if (position >= 0 && rows.length > 0 && sourceOf(state.tab) === 'review') {
      setSelected(rows[Math.min(position, rows.length - 1)].key, { focus: true });
    }
  } catch (err) {
    showMessage(`${kind} failed: ${err.message}`, true);
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
const toggleLocal = () => {
  const audio = document.querySelector('#compare audio');
  if (!audio) {
    return false;
  }
  if (audio.paused) {
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
    if (event.key === 'Escape' && target.id === 'filter') {
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
      state.status && state.status.running
    ]);
    state.status = status;
    const after = JSON.stringify([isStale('review'), isStale('transfers'), status.running]);
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

export { poll, ready, state, stopPolling };
