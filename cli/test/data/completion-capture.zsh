# Prints what zsh completes for command lines, using the completion functions in a directory:
#   zsh -f completion-capture.zsh <fpath dir> <line>...
# Each line is typed into an interactive zsh followed by Tab; compadd is wrapped to print the candidates
# it is given. Output per line: "== <line>", then "HIT <candidate|candidate...>" for each group.
zmodload zsh/zpty
zpty z zsh -f -i
zpty -w z "PS1='' PROMPT_EOL_MARK=''; fpath=(${(q)1} \$fpath); autoload -U compinit; compinit -u -d ${(q)1}/zcd"
zpty -w z 'compadd () {
  if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then builtin compadd "$@"; return $?; fi
  typeset -a __hits; builtin compadd -A __hits "$@"; local ret=$?
  (( $#__hits )) && print -r -- "HIT ${(j:|:)__hits}" >&2
  return ret
}'
# Tab completes, then prints a marker, so each line is read only once its completion has finished (typed
# ahead keys change what completion does); the marker is written as TAB''END so its echo does not match
zpty -w z "tabend() { zle complete-word; print -r -- TAB''END >&2 }; zle -N tabend"
zpty -w z 'bindkey -e; bindkey "^I" tabend; zstyle ":completion:*" menu no'
local out
# the marker is typed as RE''ADY so only its output matches
zpty -w z "print -r -- RE''ADY"
zpty -r z out '*READY*'
local line
for line in ${@[2,-1]}; do
  zpty -w -n z "$line"$'\t'
  zpty -r z out '*TABEND*'
  print -r -- "== $line"
  print -rl -- ${${(M)${(f)out//$'\r'/}:#*HIT *}/#*HIT /HIT }
  # clear the line and wait for the prompt to settle before the next one
  zpty -w -n z $'\C-u'
  zpty -w z "print -r -- DO''NE"
  zpty -r z out '*DONE*'
done
zpty -d z
