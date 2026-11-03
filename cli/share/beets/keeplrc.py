"""keeplrc: beets never writes over the timed (LRC) lyrics sleeve put in a file's USLT frame.

beets writes every field of its own database whenever it writes a file (import with write, modify, write,
replaygain, ftintitle, lyrics --force, ...), and its copy of the lyrics is the plain text it fetched on
import, or nothing: sleeve writes the file directly, which beets does not notice. Just before each write
(the write event, whose tags are what is written), this plugin reads the file's lyrics, and when they
are LRC and beets would write something else, takes the lyrics out of the write and sets beets' copy to
the file's, so it shows them too. Everything else beets writes goes through.

It cannot protect lyrics from `beet scrub`, which deletes the tags before it writes.

Part of musicman (cli/share/beets), loaded through pluginpath from the installed build; the contract
between musicman, sleeve and beets is in musicman's docs/09-contract.md.
"""

import re

from beets.plugins import BeetsPlugin
from beets.util import displayable_path, syspath
from mediafile import MediaFile, UnreadableFileError

# an LRC line: [mm:ss], [mm:ss.xx] or [mm:ss:xx] at the start of a line
LRC_LINE = re.compile(r"^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]", re.MULTILINE)


def is_lrc(text):
    """Whether lyrics text is timed: LRC lines, as sleeve writes them."""
    return bool(text) and bool(LRC_LINE.search(text))


class KeepLrcPlugin(BeetsPlugin):
    def __init__(self):
        super().__init__()
        self.register_listener("write", self.keep_lrc)

    def keep_lrc(self, item, path, tags):
        if "lyrics" not in tags:
            return
        try:
            current = MediaFile(syspath(path)).lyrics or ""
        except (UnreadableFileError, OSError):
            return
        if not is_lrc(current) or (tags["lyrics"] or "") == current:
            return
        del tags["lyrics"]
        # beets' copy follows the file, stored with the item when the caller stores it
        item.lyrics = current
        self._log.info("kept the timed lyrics of {}", displayable_path(path))
