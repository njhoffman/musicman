const _ = require('lodash');

// single quoted zsh word
const quote = text => `'${String(text).replace(/'/g, `'\\''`)}'`;

// text inside the [description] of an _arguments or _values spec
const bracketed = text => String(text).replace(/[\\[\]]/g, '\\$&');

// the _arguments action that completes a switch value
const valueAction = ({ name, words, separator }) => {
  if (words.length === 0) {
    return ' ';
  }
  const escaped = _.map(words, word => String(word).replace(/[\\:[\],]/g, '\\$&'));
  return separator
    ? `_values -s ${separator} ${name} ${escaped.join(' ')}`
    : `(${escaped.join(' ')})`;
};

// _arguments specs of a switch, long form and alias; a value can follow = or come as the next word
const switchSpecs = ({ name, alias, description, value }) => {
  const exclusive = `(--${name} ${alias})`;
  const desc = `[${bracketed(description)}]`;
  if (!value) {
    return [`${exclusive}--${name}${desc}`, `${exclusive}${alias}${desc}`];
  }
  const arg = `:${value.name}:${valueAction(value)}`;
  return [`${exclusive}--${name}=${desc}${arg}`, `${exclusive}${alias}${desc}${arg}`];
};

// the _musicman_terms arguments for completes, words, and pairs
const termArgs = ({ name, completes, words, pairs }) => [
  ...completes,
  ..._.map(words, word => `word:${word}`),
  ...(pairs ? [`pairs:${name}`] : [])
];

// text inside a single quoted SQL string
const sqlText = text => String(text).replace(/'/g, "''");

// the function completing a command's setting words, then the modes of the setting before; line
// (from _arguments) has the arguments up to the current one
const pairsFunction = ({ name, pairs }) => [
  `_musicman_pairs_${name}() {`,
  '  case ${line[-2]} in',
  ..._.map(
    pairs,
    (modes, setting) => `    ${quote(setting)}) compadd "$@" -- ${_.map(modes, quote).join(' ')} ;;`
  ),
  `    *) compadd "$@" -- ${_.map(_.keys(pairs), quote).join(' ')} ;;`,
  '  esac',
  '}'
];

// functions completing values from the library database (through the sqlite3 command), the rating
// steps, run ids, and playlist names
const valueFunctions = ({ db, frames, ratings, runsDirectory }) => [
  '# a query of the library database, nothing without the database or the sqlite3 command',
  '_musicman_sql() {',
  `  local db=${quote(db || '')}`,
  '  [[ -r $db ]] && (( $+commands[sqlite3] )) || return 1',
  '  sqlite3 -readonly -batch -noheader -list "$db" "$1" 2>/dev/null',
  '}',
  '',
  '# values of a field, called with compadd options and the field: rating steps, others from the',
  '# library database',
  '_musicman_values() {',
  '  local field=${@[-1]}',
  '  local -a values',
  `  local -A frames=(${_.map(frames, (id, name) => `${quote(name)} ${quote(sqlText(id))}`).join(' ')})`,
  '  if [[ $field == rating ]]; then',
  `    values=(${ratings.join(' ')})`,
  '  elif (( $+frames[$field] )); then',
  "    local sql=\"SELECT DISTINCT value FROM song_tags WHERE frame_id = '${frames[$field]}' AND value <> '' ORDER BY value COLLATE NOCASE\"",
  '    values=(${(f)"$(_musicman_sql $sql)"})',
  '  fi',
  '  (( $#values )) || return 1',
  '  compadd "${@[1,-2]}" -a values',
  '}',
  '',
  '# ids of archived runs (undo, logs), oldest first like their names',
  '_musicman_runs() {',
  `  local dir=${quote(runsDirectory || '')}`,
  '  local -a runs=($dir/*.json(N:t:r))',
  '  (( $#runs )) || return 1',
  '  compadd "$@" -a runs',
  '}',
  '',
  '# names of the Spotify playlists cached by sync (shuffle)',
  '_musicman_playlists() {',
  "  local sql='SELECT name FROM spotify_playlists WHERE name IS NOT NULL ORDER BY name'",
  '  local -a names=(${(f)"$(_musicman_sql $sql)"})',
  '  (( $#names )) || return 1',
  '  compadd "$@" -a names',
  '}'
];

const argumentsCall = (switchNames, model, rest) => {
  const specs = _.flatMap(switchNames, name => switchSpecs(model.switches[name]));
  return [
    '  _arguments \\',
    ..._.map([...specs.map(quote), ...(rest ? [rest] : [])], (spec, i, all) =>
      i < all.length - 1 ? `    ${spec} \\` : `    ${spec}`
    )
  ].join('\n');
};

const commandFunction = (command, model) => {
  const args = termArgs(command);
  const rest = args.length > 0 ? quote(`*: :_musicman_terms ${args.join(' ')}`) : null;
  return [
    `_musicman_cmd_${command.name}() {`,
    argumentsCall(command.switches, model, rest),
    '}'
  ].join('\n');
};

/**
 * The zsh completion script for the model. It works from $fpath as _musicman (#compdef) and when
 * sourced (compdef). Field names are fixed when the script is generated.
 */
const renderZsh = (model, { version }) => {
  const { program } = model;
  const commandEntries = _.map(
    model.commands,
    ({ name, description }) => `    ${quote(`${name.replace(/:/g, '\\:')}:${description}`)}`
  );
  const fieldWords = _.map(model.fields, quote).join(' ');
  const defaultArgs = model.default.completes.join(' ');
  const firstArgs = model.default.first.join(' ');

  return `${[
    `#compdef ${program} -tilde-`,
    `# zsh completion for ${program} ${version}, generated by ${program} completion zsh. Field names, the`,
    '# library database, and the runs directory are those of the config when it was generated, generate',
    '# it again after changing them. Tag values and playlist names are read from the library database',
    '# with the sqlite3 command at Tab time. It also completes the -tilde- context, so ~field: works',
    '# without quoting; other commands get the standard _tilde completion there.',
    '',
    '# commands with their descriptions',
    '_musicman_commands() {',
    '  local -a commands=(',
    ...commandEntries,
    '  )',
    '  _describe -t commands command commands',
    '}',
    '',
    ...valueFunctions(model.values),
    '',
    '# field names, called with compadd options and filter (field:, also ~field: that excludes) or',
    '# assign (field=); after the : or = the values of the field, one more after each comma, and after',
    '# + or - for an assignment',
    '_musicman_fields() {',
    '  local kind=${@[-1]} sep=: other==',
    `  local -a fields=(${fieldWords})`,
    '  if [[ $kind == filter ]]; then',
    "    compset -P '\\\\~' || compset -P '\\~'",
    '  else',
    '    sep== other=:',
    '  fi',
    '  local name=${PREFIX%%[:=]*}',
    '  if [[ $PREFIX == $name$sep* ]]; then',
    '    compset -P "[^:=]##$sep"',
    "    compset -P '*,'",
    "    [[ $kind == assign ]] && compset -P '[+-]'",
    '    _musicman_values "${@[1,-2]}" $name',
    '    return',
    '  fi',
    '  [[ $PREFIX == *$other* ]] && return 1',
    '  compadd "${@[1,-2]}" -S $sep -a fields',
    '}',
    '',
    '# arguments that are not switches, by kind: commands, paths, assignments, filters, word:<word>;',
    '# filters come last since ~ is taken off the prefix for them',
    '_musicman_terms() {',
    '  local -a alts words filters',
    '  local kind',
    '  for kind in "$@"; do',
    '    case $kind in',
    "      commands) alts+=('commands:command:_musicman_commands') ;;",
    "      paths) alts+=('files:file:_files') ;;",
    "      assignments) alts+=('assignments:assignment:_musicman_fields assign') ;;",
    "      filters) filters=('filters:filter:_musicman_fields filter') ;;",
    "      runs) alts+=('runs:run id:_musicman_runs') ;;",
    "      playlists) alts+=('playlists:playlist:_musicman_playlists') ;;",
    '      pairs:*) alts+=("settings:setting:_musicman_pairs_${kind#pairs:}") ;;',
    '      word:*) words+=(${kind#word:}) ;;',
    '    esac',
    '  done',
    '  (( $#words )) && alts=("words:word:($words)" $alts)',
    '  _alternative $alts $filters',
    '}',
    '',
    ..._.flatMap(_.filter(model.commands, 'pairs'), command => [...pairsFunction(command), '']),
    ..._.flatMap(model.commands, command => [commandFunction(command, model), '']),
    '# no command word: view, or edit when an argument assigns',
    '_musicman_default() {',
    `  local -a kinds=(${defaultArgs})`,
    `  (( CURRENT == 2 )) && kinds=(${firstArgs} $kinds)`,
    argumentsCall(model.default.switches, model, '"*: :_musicman_terms $kinds"'),
    '}',
    '',
    '_musicman() {',
    '  # ~ starting an unquoted word: fields that exclude for musicman, home directories for the rest',
    '  if [[ $service == -tilde- ]]; then',
    `    if [[ \${words[1]:t} == ${program} ]]; then`,
    '      _musicman_fields filter',
    '    else',
    '      _tilde "$@"',
    '    fi',
    '    return',
    '  fi',
    '  if (( CURRENT > 2 )); then',
    '    case $words[2] in',
    `      ${_.map(model.commands, 'name').join('|')})`,
    '        local cmd=$words[2]',
    '        curcontext="${curcontext%:*:*}:musicman-$cmd:"',
    '        shift words',
    '        (( CURRENT-- ))',
    '        _musicman_cmd_$cmd',
    '        return',
    '        ;;',
    '    esac',
    '  fi',
    '  _musicman_default',
    '}',
    '',
    '# autoloaded from $fpath the first call defines the functions above, sourced it registers them',
    'if [[ $funcstack[1] == _musicman ]]; then',
    '  _musicman "$@"',
    'else',
    `  compdef _musicman ${program} -tilde-`,
    'fi'
  ].join('\n')}\n`;
};

module.exports = { renderZsh };
