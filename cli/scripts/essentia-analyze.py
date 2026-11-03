#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["essentia-tensorflow==2.1b6.dev1438", "numpy"]
# ///
"""Analyses mp3 files with Essentia for musicman analyze: reads file paths from stdin (one per line) and
writes one JSON line per file to stdout, as each is done:

  {"file", "bpm", "key", "scale", "danceability", "moods": {"happy": 0.82, ...}}
  or {"file", "error"}

bpm (RhythmExtractor2013, the faster degara method), key and scale (KeyExtractor, EDMA profile),
danceability (Essentia's, 0 to about 3), and the moods from the discogs-effnet embeddings and Essentia's
mood classifiers: the probability of the mood, 0 to 1, from 90 seconds in the middle of the track (the
embeddings take most of the time, in proportion to the length). Loudness is left to beets' ReplayGain.
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
    return embeddings, moods


def analyse(path, embeddings, moods):
    import essentia.standard as es

    audio = es.MonoLoader(filename=path, sampleRate=44100)()
    bpm = es.RhythmExtractor2013(method="degara")(audio)[0]
    key, scale, _strength = es.KeyExtractor(profileType="edma")(audio)
    danceability = es.Danceability()(audio)[0]
    audio16 = es.MonoLoader(filename=path, sampleRate=16000, resampleQuality=4)()
    excerpt = MOOD_EXCERPT * 16000
    if len(audio16) > excerpt:
        start = (len(audio16) - excerpt) // 2
        audio16 = audio16[start : start + excerpt]
    patches = embeddings(audio16)
    result = {}
    for mood, (model, index) in moods.items():
        result[mood] = round(float(model(patches).mean(axis=0)[index]), 3)
    return {
        "file": path,
        "bpm": round(float(bpm), 1),
        "key": key,
        "scale": scale,
        "danceability": round(float(danceability), 3),
        "moods": result,
    }


def main():
    import essentia

    essentia.log.infoActive = False
    essentia.log.warningActive = False
    embeddings, moods = load_models()
    for line in sys.stdin:
        path = line.rstrip("\n")
        if not path:
            continue
        try:
            print(json.dumps(analyse(path, embeddings, moods)), flush=True)
        except Exception as err:  # one bad file must not stop the run
            print(json.dumps({"file": path, "error": str(err)}), flush=True)


if __name__ == "__main__":
    main()
