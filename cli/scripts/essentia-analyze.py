#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["essentia-tensorflow==2.1b6.dev1438", "numpy"]
# ///
"""Analyses mp3 files with Essentia for musicman analyze: reads file paths from stdin (one per line) and
writes one JSON line per file to stdout, as each is done:

  {"file", "bpm", "key", "scale", "danceability", "moods": {"happy": 0.82, ...},
   "styles": [["Blues Rock", 0.41], ...]}
  or {"file", "error"}

A line is a path, for every part, or path<TAB>parts, a comma list of rhythm (bpm, key, danceability),
moods, and styles, for only those; the result then has only their fields.

bpm (RhythmExtractor2013, the faster degara method), key and scale (KeyExtractor, EDMA profile),
danceability (Essentia's, 0 to about 3), and the moods from the discogs-effnet embeddings and Essentia's
mood classifiers: the probability of the mood, 0 to 1, from 90 seconds in the middle of the track (the
embeddings take most of the time, in proportion to the length). The styles are the best STYLE_COUNT of
the 400 Discogs styles of Essentia's genre_discogs400 classifier, from the same embeddings: each a
score of its own, 0 to 1 (a sigmoid, so a song can score high on several), by its style name alone,
the best one where two genres share a style name (Pop---Ballad and Rock---Ballad). Loudness is left
to beets' ReplayGain.
The models are downloaded on first use into $XDG_CACHE_HOME/musicman/essentia-models. Progress and
errors of the script itself go to stderr.

Run by musicman through uv, which builds the environment above on the first run.
"""

import json
import os
import sys
import urllib.request

MODELS_URL = "https://essentia.upf.edu/models"
EMBEDDINGS = "feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"
MOODS = ["happy", "sad", "relaxed", "aggressive", "party"]
STYLES = "classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1"
STYLE_COUNT = 5
PARTS = ("rhythm", "moods", "styles")
# seconds of the track the moods are taken from, in its middle
MOOD_EXCERPT = 90


def cache_directory():
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "musicman", "essentia-models")


def model_file(relative):
    """The local copy of a model file, downloaded first when missing."""
    target = os.path.join(cache_directory(), os.path.basename(relative))
    if not os.path.exists(target):
        os.makedirs(os.path.dirname(target), exist_ok=True)
        print(f"downloading {relative}", file=sys.stderr, flush=True)
        partial = f"{target}.partial"
        urllib.request.urlretrieve(f"{MODELS_URL}/{relative}", partial)
        os.replace(partial, target)
    return target


def load_models():
    import essentia.standard as es

    embeddings = es.TensorflowPredictEffnetDiscogs(
        graphFilename=model_file(EMBEDDINGS), output="PartitionedCall:1"
    )
    moods = {}
    for mood in MOODS:
        base = f"classification-heads/mood_{mood}/mood_{mood}-discogs-effnet-1"
        with open(model_file(f"{base}.json"), encoding="utf-8") as handle:
            classes = json.load(handle)["classes"]
        moods[mood] = (
            es.TensorflowPredict2D(graphFilename=model_file(f"{base}.pb"), output="model/Softmax"),
            classes.index(mood),
        )
    with open(model_file(f"{STYLES}.json"), encoding="utf-8") as handle:
        names = [label.split("---", 1)[-1] for label in json.load(handle)["classes"]]
    styles = (
        es.TensorflowPredict2D(
            graphFilename=model_file(f"{STYLES}.pb"),
            input="serving_default_model_Placeholder",
            output="PartitionedCall:0",
        ),
        names,
    )
    return embeddings, moods, styles


def best_styles(scores, names):
    """The best STYLE_COUNT [name, score] pairs, a style name shared by two genres at its best score."""
    best = {}
    for name, score in zip(names, scores):
        best[name] = max(best.get(name, 0.0), float(score))
    ranked = sorted(best.items(), key=lambda item: -item[1])[:STYLE_COUNT]
    return [[name, round(score, 3)] for name, score in ranked]


def analyse(path, embeddings, moods, styles, parts=PARTS):
    import essentia.standard as es

    result = {"file": path}
    if "rhythm" in parts:
        audio = es.MonoLoader(filename=path, sampleRate=44100)()
        bpm = es.RhythmExtractor2013(method="degara")(audio)[0]
        key, scale, _strength = es.KeyExtractor(profileType="edma")(audio)
        danceability = es.Danceability()(audio)[0]
        result.update(
            bpm=round(float(bpm), 1),
            key=key,
            scale=scale,
            danceability=round(float(danceability), 3),
        )
    if "moods" in parts or "styles" in parts:
        audio16 = es.MonoLoader(filename=path, sampleRate=16000, resampleQuality=4)()
        excerpt = MOOD_EXCERPT * 16000
        if len(audio16) > excerpt:
            start = (len(audio16) - excerpt) // 2
            audio16 = audio16[start : start + excerpt]
        patches = embeddings(audio16)
        if "moods" in parts:
            result["moods"] = {
                mood: round(float(model(patches).mean(axis=0)[index]), 3)
                for mood, (model, index) in moods.items()
            }
        if "styles" in parts:
            model, names = styles
            result["styles"] = best_styles(model(patches).mean(axis=0), names)
    return result


def parse_line(line):
    """The path and the parts of one stdin line: path, or path<TAB>part,part."""
    path, _tab, wanted = line.rstrip("\n").partition("\t")
    parts = tuple(part for part in wanted.split(",") if part in PARTS) if wanted else PARTS
    return path, parts or PARTS


def main():
    import essentia

    essentia.log.infoActive = False
    essentia.log.warningActive = False
    embeddings, moods, styles = load_models()
    for line in sys.stdin:
        path, parts = parse_line(line)
        if not path:
            continue
        try:
            print(json.dumps(analyse(path, embeddings, moods, styles, parts)), flush=True)
        except Exception as err:  # one bad file must not stop the run
            print(json.dumps({"file": path, "error": str(err)}), flush=True)


if __name__ == "__main__":
    main()
