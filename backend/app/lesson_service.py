"""lesson_service: the structured curriculum (levels 1-6).

IPA is given for **General American** (to match the default en_US reference
voice). Each lesson carries: objective, IPA, articulation description,
reference text, worked examples, and exercises (production + discrimination).

The data here is expert-authored and static. It is *content*, not model output.
If a field is uncertain for a variety we set it to None rather than guess.
"""
from __future__ import annotations

from .schemas import Lesson, Exercise

# --------------------------------------------------------------------------- #
# Level 1 — letters and the alphabet
# --------------------------------------------------------------------------- #
# We teach the *letter name* separately from the *sound(s)* it makes in words,
# and never conflate the two.
_ALPHABET = [
    ("A a", "eɪ", "æ, eɪ", "apple, cake (æ) / table, rain (eɪ)"),
    ("B b", "biː", "b", "ball, bed, book"),
    ("C c", "siː", "k, s", "cat, cup (k) / city, dance (s)"),
    ("D d", "diː", "d", "dog, day, red"),
    ("E e", "iː", "ɛ, iː, ə", "egg, bed (ɛ) / me, see (iː) / about (ə)"),
    ("F f", "ɛf", "f", "fish, fine, often"),
    ("G g", "dʒiː", "dʒ, ɡ", "girl, go (ɡ) / gym, give (dʒ)"),
    ("H h", "eɪtʃ", "h, (silent)", "hat, home / hour, honest (silent)"),
    ("I i", "aɪ", "ɪ, aɪ", "in, sit (ɪ) / time, ice (aɪ)"),
    ("J j", "dʒeɪ", "dʒ", "jump, job, enjoy"),
    ("K k", "keɪ", "k", "kite, king, park"),
    ("L l", "ɛl", "l", "leg, lake, milk"),
    ("M m", "ɛm", "m", "man, moon, swim"),
    ("N n", "ɛn", "n", "no, nose, think"),
    ("O o", "oʊ", "ɑ, ɔː, ʊ, ə", "open (oʊ) / hot (ɑ) / off (ɔː) / about (ə)"),
    ("P p", "piː", "p", "pen, apple, cup"),
    ("Q q", "kjuː", "k", "queen, quiet, question"),
    ("R r", "ɑː", "ɹ", "red, run, car"),
    ("S s", "ɛs", "s", "sun, sea, is"),
    ("T t", "tiː", "t, (ɾ)", "ten, top / water (flap ɾ)"),
    ("U u", "juː", "ʊ, aɪ, uː", "up, full (ʊ) / use, cute (juː) / do, you (uː)"),
    ("V v", "viː", "v", "very, voice, five"),
    ("W w", "ˈdʌbəl juː", "w", "we, wet, window"),
    ("X x", "ɛks", "ks, z", "box, six (ks) / xylophone (z)"),
    ("Y y", "waɪ", "j, i", "yes, you (j) / happy, city (i)"),
    ("Z z", "ziː", "z", "zebra, zoo, buzz"),
]


def _level1_lessons() -> list[Lesson]:
    lessons = []
    # One lesson per 4-5 letters to keep cards digestible
    groups = [_ALPHABET[i:i + 5] for i in range(0, len(_ALPHABET), 5)]
    for gi, group in enumerate(groups, 1):
        exercises = []
        for letter, name_ipa, sounds, examples in group:
            exercises.append(Exercise(
                id=f"l1-{letter.strip()[0].lower()}-name",
                type="produce",
                text=letter.strip().upper(),
                ipa=f"/{name_ipa}/",
                gloss="the NAME of the letter",
                target_phoneme=None,
                instruction=f"Say the NAME of the letter {letter.strip().upper()} "
                            f"(not a word it appears in).",
            ))
        lessons.append(Lesson(
            id=f"l1-{gi}",
            level=1,
            level_name="Letters & the alphabet",
            title=f"Letters {group[0][0].strip().upper()}–{group[-1][0].strip().upper()}",
            objective="Learn the names of the letters and the sounds each can make "
                      "in words. The NAME of a letter is different from the SOUND it "
                      "makes inside a word — keep them separate.",
            ipa=None,
            articulation=None,
            variety="en_US",
            reference_text="A B C D E F G H I J K L M N O P Q R S T U V W X Y Z",
            examples=[e for (_, _, _, e) in group],
            exercises=exercises,
            tips=[
                "A letter can have several sounds: C is /k/ in 'cat' but /s/ in 'city'.",
                "The letter NAME is a short word you spell (A is 'ay'); the SOUND is "
                "the part of a real word you hear (A in 'apple' is /æ/).",
            ],
            order=gi,
        ))
    return lessons


# --------------------------------------------------------------------------- #
# Level 2 — vowels and their contrasts
# --------------------------------------------------------------------------- #
_VOWELS = [
    ("ɪ", "iː", "ship / sheep", "Lax /ɪ/ vs tense /iː/. Short + relaxed vs long + smile.",
     "Tongue mid-front for /ɪ/, high-front for /iː/."),
    ("ʊ", "uː", "book / boot", "Lax /ʊ/ vs tense /uː/. Short + less rounded vs long + rounded.",
     "Slight rounding for /ʊ/, strong rounding + push forward for /uː/."),
    ("æ", "ʌ", "cat / cut", "Front-low /æ/ vs central /ʌ/. Wide open vs relaxed central.",
     "Drop the jaw wide for /æ/; keep the tongue mid-centre for /ʌ/."),
    ("ɑː", "ɔː", "father / door (US often 'dɔːr')", "Open /ɑː/ vs rounded /ɔː/.",
     "Jaw low + back for /ɑː/; round the lips for /ɔː/."),
    ("ɛ", "eɪ", "bed / day", "Short /ɛ/ vs diphthong /eɪ/.",
     "Mouth mid for /ɛ/; /eɪ/ glides from /ɛ/ toward /ɪ/."),
    ("ə", "eɪ", "the / day", "The schwa /ə/ — the shortest, laziest, central vowel.",
     "Relax everything; a quick central 'uh'. Never fully open."),
    ("aɪ", "oʊ", "my / go", "Diphthongs: glide from one vowel to another.",
     "/aɪ/ glides open→close; /oʊ/ glides round→close. Let it move."),
    ("eɪ", "ɛ", "say / bed", "Diphthong /eɪ/ vs monophthong /ɛ/.",
     "Let /eɪ/ glide; keep /ɛ/ steady."),
    ("ɔː", "ɑː", "door / father", "Rounded long /ɔː/ vs open /ɑː/.",
     "Round the lips for /ɔː/, open the jaw for /ɑː/."),
]


def _level2_lessons() -> list[Lesson]:
    lessons = []
    for i, (v1, v2, pair, expl, artic) in enumerate(_VOWELS, 1):
        lessons.append(Lesson(
            id=f"l2-{i}",
            level=2,
            level_name="Vowels",
            title=f"Vowel contrast: /{v1}/ vs /{v2}/",
            objective=f"Distinguish the vowel pair /{v1}/ and /{v2}/. First tell them "
                      f"apart by ear (discrimination), then produce each one.",
            ipa=f"/{v1}/  /{v2}/",
            articulation=artic,
            variety="en_US",
            reference_text=pair,
            examples=pair.split(" / "),
            exercises=[
                Exercise(id=f"l2-{i}-disc", type="discriminate", text=pair,
                         ipa=f"/{v1}/ · /{v2}/", target_phoneme=v1,
                         instruction=f"Listen to two sounds. Decide which one you hear: "
                                     f"/{v1}/ or /{v2}/.",
                         contrast=[f"/{v1}/", f"/{v2}/"]),
                Exercise(id=f"l2-{i}-p1", type="produce", text=pair.split(" / ")[0],
                         ipa=f"/{v1}/", target_phoneme=v1,
                         instruction=f"Now PRODUCE /{v1}/ — the first sound. {expl}"),
                Exercise(id=f"l2-{i}-p2", type="produce", text=pair.split(" / ")[1],
                         ipa=f"/{v2}/", target_phoneme=v2,
                         instruction=f"Now PRODUCE /{v2}/ — the second sound. {expl}"),
            ],
            tips=[f"Minimal pair: {pair}.", "Exaggerate the difference when practising, "
                  "then bring it back to natural."],
            order=i,
        ))
    return lessons


# --------------------------------------------------------------------------- #
# Level 3 — consonants and their contrasts
# --------------------------------------------------------------------------- #
_CONSONANTS = [
    ("θ", "s", "think / sink", "Voiceless /θ/ (tongue between teeth) vs /s/ (air behind teeth).",
     "Tongue tip between the teeth, blow air, no buzz. /s/ keeps the tongue behind the teeth."),
    ("ð", "d", "this / did", "Voiced /ð/ vs /d/.",
     "Tongue between the teeth WITH vibration for /ð/. /d/ is a full stop behind the teeth."),
    ("v", "b", "very / berry", "Fricative /v/ (teeth+lip, air flows) vs stop /b/ (lips close).",
     "Upper teeth on lower lip + vibration for /v/. Both lips close + release for /b/."),
    ("ʃ", "tʃ", "she / che", "Fricative /ʃ/ vs affricate /tʃ/.",
     "Rounded lips + hissing for /ʃ/. A /t/ that melts into /ʃ/ for /tʃ/."),
    ("ɹ", "l", "red / led", "English /ɹ/ (tongue curls, no contact) vs /l/ (tongue touches ridge).",
     "Curl the tongue back WITHOUT touching the roof for /ɹ/. Touch the ridge for /l/."),
]
_FINAL = [
    ("Final consonants", "The last sound of a word must be *released*, not swallowed.",
     "stop, rest, cold, hope, time, nose",
     "/p t k b d g ɹ s z/",
     "Don't drop the ending: 'stopped' has all three sounds /s t ɒ ʊ p t/."),
    ("Clusters", "Consonant clusters at the end of words.",
     "texts, nights, asks, asked",
     "/kst/ · /nts/ · /skts/",
     "Say the whole cluster; don't add a vowel after it (say 'asks', not 'ask-uh')."),
    ("Aspiration", "Aspirated /p t k/ at the start of a stressed syllable.",
     "pin, tin, kick",
     "/pʰ/ · /tʰ/ · /kʰ/",
     "A small puff of air before /p t k/ at word start: feel it on your hand."),
]


def _level3_lessons() -> list[Lesson]:
    lessons = []
    n = 0
    for c1, c2, pair, expl, artic in _CONSONANTS:
        n += 1
        lessons.append(Lesson(
            id=f"l3-{n}",
            level=3,
            level_name="Consonants",
            title=f"Consonant contrast: /{c1}/ vs /{c2}/",
            objective=f"Distinguish and produce /{c1}/ and /{c2}/ in initial position, "
                      f"then in real words.",
            ipa=f"/{c1}/  /{c2}/",
            articulation=artic,
            variety="en_US",
            reference_text=pair,
            examples=pair.split(" / "),
            exercises=[
                Exercise(id=f"l3-{n}-disc", type="discriminate", text=pair,
                         ipa=f"/{c1}/ · /{c2}/", target_phoneme=c1,
                         instruction=f"Which sound do you hear, /{c1}/ or /{c2}/?",
                         contrast=[f"/{c1}/", f"/{c2}/"]),
                Exercise(id=f"l3-{n}-p1", type="produce", text=pair.split(" / ")[0],
                         ipa=f"/{c1}/", target_phoneme=c1,
                         instruction=f"PRODUCE /{c1}/. {expl}"),
                Exercise(id=f"l3-{n}-p2", type="produce", text=pair.split(" / ")[1],
                         ipa=f"/{c2}/", target_phoneme=c2,
                         instruction=f"PRODUCE /{c2}/. {expl}"),
            ],
            tips=[f"Minimal pair: {pair}."],
            order=n,
        ))
    for title, expl, examples_str, ipa, tip in _FINAL:
        n += 1
        examples = examples_str.split(", ")
        lessons.append(Lesson(
            id=f"l3-{n}",
            level=3,
            level_name="Consonants",
            title=title,
            objective=expl,
            ipa=ipa,
            articulation=None,
            variety="en_US",
            reference_text=examples[0],
            examples=examples,
            exercises=[
                Exercise(id=f"l3-{n}-{i}", type="produce", text=w.strip(),
                         instruction=f"Produce '{w.strip()}' with {title.lower()} done correctly.",
                         min_score=None) for i, w in enumerate(examples, 1)
            ],
            tips=[tip],
            order=n,
        ))
    return lessons


# --------------------------------------------------------------------------- #
# Level 4 — words
# --------------------------------------------------------------------------- #
_WORDS = [
    ("think", "θɪŋk", "to consider", "I think it will work."),
    ("sheep", "ʃiːp", "a woolly animal", "The sheep is in the field."),
    ("ship", "ʃɪp", "a boat", "We took the ship across."),
    ("light", "laɪt", "not dark", "Turn on the light."),
    ("right", "raɪt", "correct / not left", "You are right."),
    ("very", "vɛɹi", "to a great degree", "Thank you very much."),
    ("book", "bʊk", "pages of text", "I read a book."),
    ("boot", "buːt", "footwear", "My boot is wet."),
    ("water", "wɔːtɚ", "the clear liquid", "Can I have some water?"),
    ("teacher", "tiːtʃɚ", "a person who teaches", "My teacher is kind."),
]


def _level4_lessons() -> list[Lesson]:
    lessons = []
    for i, (w, ipa, meaning, sentence) in enumerate(_WORDS, 1):
        lessons.append(Lesson(
            id=f"l4-{i}",
            level=4,
            level_name="Words",
            title=f"Word: {w}",
            objective=f"Produce the word '{w}' accurately. {meaning}.",
            ipa=f"/{ipa}/",
            articulation=None,
            variety="en_US",
            reference_text=w,
            examples=[w, sentence],
            exercises=[
                Exercise(id=f"l4-{i}-word", type="produce", text=w, ipa=f"/{ipa}/",
                         gloss=meaning,
                         instruction=f"Say the word '{w}'. Compare it with the reference."),
                Exercise(id=f"l4-{i}-sentence", type="produce", text=sentence,
                         gloss=f"'{w}' in a sentence",
                         instruction=f"Now say the whole sentence: \"{sentence}\""),
            ],
            tips=[f"In context: \"{sentence}\"."],
            order=i,
        ))
    return lessons


# --------------------------------------------------------------------------- #
# Level 5 — phrases, rhythm and intonation
# --------------------------------------------------------------------------- #
_PHRASES = [
    ("How are you today?", "haʊ ɑɹ juː təˈdeɪ",
     "Sentence stress falls on the content words (are, you, to-day). Reduce 'you' "
     "and 'to' toward schwa. Fall in pitch at the end for a statement/question.",
     "Rhythm: reduce function words; stress content words."),
    ("I would like a cup of tea.", "aɪ wʊd laɪk ə kʌp əv tiː",
     "Lots of schwas: 'would' → /wʊd/, 'a' → /ə/, 'of' → /əv/. Stress 'like' and 'tea'.",
     "Reduction: 'a', 'of', 'would' all reduce. Link 'cup of' → 'cupəv'."),
    ("Could you open the window please?", "kʊd juː ˈoʊpən ðə ˈwɪndoʊ pliːz",
     "Rising intonation for a polite request. Link 'could you' → 'kʊdjuː'.",
     "Intonation rises for polite requests; link across words."),
    ("See you later, no worries.", "siː juː ˈleɪtɚ noʊ ˈwɜːriz",
     "Casual linkings: 'see you' → 'siːjuː'. Flat, relaxed rhythm.",
     "Linking + a relaxed, flat intonation for small talk."),
]


def _level5_lessons() -> list[Lesson]:
    lessons = []
    for i, (phrase, ipa, expl, rhythm) in enumerate(_PHRASES, 1):
        lessons.append(Lesson(
            id=f"l5-{i}",
            level=5,
            level_name="Phrases & conversation",
            title=f"Phrase: {phrase}",
            objective=f"Say this phrase with natural rhythm, reduction and intonation. "
                      f"Notice that 'errors' here are often about rhythm and linking, "
                      f"not individual sounds.",
            ipa=f"/{ipa}/",
            articulation=expl,
            variety="en_US",
            reference_text=phrase,
            examples=[phrase],
            exercises=[
                Exercise(id=f"l5-{i}-phrase", type="produce", text=phrase, ipa=f"/{ipa}/",
                         instruction="Say the whole phrase at a natural speed. Watch the "
                                     "pitch curve in the advanced panel."),
                Exercise(id=f"l5-{i}-repeat", type="repeat", text=phrase,
                         instruction="Repeat after the reference several times, imitating "
                                     "the rhythm (shadowing)."),
            ],
            tips=[rhythm,
                  "Don't pronounce every vowel fully — connected speech reduces them. "
                  "A 'wrong' accent that is still clear is fine; focus on intelligibility."],
            order=i,
        ))
    return lessons


# --------------------------------------------------------------------------- #
# Level 6 — adaptive practice (generated from the learner's weak phonemes)
# --------------------------------------------------------------------------- #
# A pool of words/phrases grouped by the phoneme they drill. The lesson_service
# builds a personalised level-6 lesson from the phonemes the learner keeps
# getting wrong (see progress_service.recommendations).
_ADAPTIVE_POOL: dict[str, list[dict]] = {
    "θ": [
        {"text": "think", "ipa": "θɪŋk"}, {"text": "three", "ipa": "θɹiː"},
        {"text": "breathe", "ipa": "bɹiːð"}, {"text": "thanks", "ipa": "θæŋks"},
    ],
    "ð": [
        {"text": "this", "ipa": "ðɪs"}, {"text": "that", "ipa": "ðæt"},
        {"text": "mother", "ipa": "mʌðɚ"}, {"text": "breathe", "ipa": "bɹiːð"},
    ],
    "ɪ": [
        {"text": "ship", "ipa": "ʃɪp"}, {"text": "sit", "ipa": "sɪt"},
        {"text": "fish", "ipa": "fɪʃ"}, {"text": "giving", "ipa": "ɡɪvɪŋ"},
    ],
    "iː": [
        {"text": "sheep", "ipa": "ʃiːp"}, {"text": "see", "ipa": "siː"},
        {"text": "green", "ipa": "ɡɹiːn"}, {"text": "people", "ipa": "piːpəl"},
    ],
    "ʊ": [
        {"text": "book", "ipa": "bʊk"}, {"text": "good", "ipa": "ɡʊd"},
        {"text": "put", "ipa": "pʊt"}, {"text": "could", "ipa": "kʊd"},
    ],
    "uː": [
        {"text": "boot", "ipa": "buːt"}, {"text": "food", "ipa": "fuːd"},
        {"text": "blue", "ipa": "bluː"}, {"text": "too", "ipa": "tuː"},
    ],
    "æ": [
        {"text": "cat", "ipa": "kæt"}, {"text": "cat", "ipa": "kæt"},
        {"text": "bad", "ipa": "bæd"}, {"text": "apple", "ipa": "æpəl"},
    ],
    "ʌ": [
        {"text": "cup", "ipa": "kʌp"}, {"text": "full", "ipa": "fʊl"},
        {"text": "love", "ipa": "lʌv"}, {"text": "under", "ipa": "ʌndɚ"},
    ],
    "ʃ": [
        {"text": "she", "ipa": "ʃiː"}, {"text": "shoe", "ipa": "ʃuː"},
        {"text": "fish", "ipa": "fɪʃ"}, {"text": "wish", "ipa": "wɪʃ"},
    ],
    "tʃ": [
        {"text": "cheese", "ipa": "tʃiːz"}, {"text": "church", "ipa": "tʃɜɹtʃ"},
        {"text": "teacher", "ipa": "tiːtʃɚ"}, {"text": "watch", "ipa": "wɑtʃ"},
    ],
    "v": [
        {"text": "very", "ipa": "vɛɹi"}, {"text": "voice", "ipa": "vɔɪs"},
        {"text": "five", "ipa": "faɪv"}, {"text": "love", "ipa": "lʌv"},
    ],
    "b": [
        {"text": "boy", "ipa": "bɔɪ"}, {"text": "book", "ipa": "bʊk"},
        {"text": "baby", "ipa": "beɪbi"}, {"text": "about", "ipa": "əˈbaʊt"},
    ],
    "ɹ": [
        {"text": "red", "ipa": "ɹɛd"}, {"text": "run", "ipa": "ɹʌn"},
        {"text": "car", "ipa": "kɑɹ"}, {"text": "very", "ipa": "vɛɹi"},
    ],
}


def adaptive_lesson(weak_phonemes: list[str], max_items: int = 8) -> Lesson | None:
    """Build a level-6 practice lesson from the learner's weak phonemes.

    Only includes sounds we have a pool for, and only up to ``max_items``
    exercises. Returns None if there is nothing to practise (which the UI treats
    as "no weak phonemes detected — keep going").
    """
    items: list[Exercise] = []
    covered: list[str] = []
    for ph in weak_phonemes:
        pool = _ADAPTIVE_POOL.get(ph) or _ADAPTIVE_POOL.get(ph.rstrip("ː"))
        if not pool:
            continue
        for word in pool:
            items.append(Exercise(
                id=f"l6-{ph}-{word['text']}",
                type="produce",
                text=word["text"],
                ipa=f"/{word['ipa']}/",
                target_phoneme=ph,
                instruction=f"Practise /{ph}/ in the word '{word['text']}'.",
            ))
        covered.append(ph)
        if len(items) >= max_items:
            break
    if not items:
        return None
    return Lesson(
        id="l6-adaptive",
        level=6,
        level_name="Adaptive practice",
        title="Your personalised practice",
        objective=f"These exercises target the sounds you've been struggling with: "
                  f"{', '.join('/'+p+'/' for p in covered)}. Work through them slowly, "
                  f"then at speed.",
        ipa=None,
        articulation=None,
        variety="en_US",
        reference_text=items[0].text,
        examples=[i.text for i in items],
        exercises=items,
        tips=["Repeat each word 3-5 times. If you're consistently wrong, slow down "
              "and exaggerate the target sound, then bring it back to normal."],
        order=1,
    )


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #
def _all_lessons() -> list[Lesson]:
    lessons: list[Lesson] = []
    lessons += _level1_lessons()
    lessons += _level2_lessons()
    lessons += _level3_lessons()
    lessons += _level4_lessons()
    lessons += _level5_lessons()
    lessons.sort(key=lambda l: (l.level, l.order))
    return lessons


_CACHE: list[Lesson] | None = None


def get_lessons() -> list[Lesson]:
    global _CACHE
    if _CACHE is None:
        _CACHE = _all_lessons()
    return _CACHE


def get_lesson(lesson_id: str) -> Lesson | None:
    for l in get_lessons():
        if l.id == lesson_id:
            return l
    return None


def levels() -> list[dict]:
    """Summary of the levels for the sidebar/progress view."""
    out: list[dict] = []
    for level in sorted({l.level for l in get_lessons()}):
        ls = [l for l in get_lessons() if l.level == level]
        out.append({
            "level": level,
            "name": ls[0].level_name,
            "count": len(ls),
            "first": ls[0].id,
            "last": ls[-1].id,
        })
    return out
