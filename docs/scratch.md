
  The custom mp3 fields will have to be especially monitored for sync changes.  These will
always be initially defined by the local config.  If it's not defined in local config, musicrater won't
know what to do with it, a fatal misconfiguration (process should immediately quit).  The 'tags'
config base property defines those extra fields along with attributes that determine how that field
is displayed and will be saved in the database. Create a new config property 'library.tags' with
these defaults:
  ['popularity', 'volume', 'artist', 'title', 'year', 'genre', 'album'],

  assign the current values there to my config (it includes two custom tags).  These fields are
  combined with the tags.json data, and are the tags that can be viewed and manipulated with by the
  program, so they should only be the tags that someone would care about for making playlists or
  basic info. There will also be a 'views' base property that has 'views.default', 'views.edit',
  'views.playlist', and 'views.stats'.  Assign to configDefaults those values but only include
  'name' if it is different than the name assigned in tags.json, and remove viewIndex because we
  will dterermine display order by the fields.  The 'views.default' will be used by the rest of the
  views unless overridden.  If any of the other viewsis different than the default, assign those to
  my config file.  Add config descriptions and any necessary tests, next we will work on the
  database.

---------------_

Modify the logger.colors from rgb to hex color codes, matching this format.

fatal:
  bg:  '#FFFFFF'
  fg:  '#666666'
  gui: 'italic'

  Wherever these values are used make sure the new format is properly handled.

When it comes to custom fields validation, don't worry about throwing any errors until we have the database built.  We
only want to throw errors if the already existing definition of a custom field changes.
