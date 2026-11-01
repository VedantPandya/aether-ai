"""Bounded lexical retrieval over the same curated topics served to the UI."""
import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path
TOPICS = json.loads((Path(__file__).resolve().parent.parent / "knowledge/topics.json").read_text(encoding="utf-8"))
STOP_WORDS = frozenset("a an and are as at be by can could do does for from how i in is it me my of on or our please should tell than that the their them these this to us use was we what when where which why will with would you your physics explain mission need using".split())
ALIASES = {
    "blackhole": "black hole", "blackholes": "black hole", "swingby": "flyby", "swing by": "flyby",
    "jettison": "separation staging", "gr": "general relativity", "sr": "special relativity",
    "6dof": "six degree freedom", "hcw": "hill clohessy wiltshire", "tvc": "thrust vector control",
    "rcs": "reaction control", "mpc": "model predictive control", "ekf": "kalman filter",
}

def _normalize(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKD", text).lower()))

def _tokens(text: str) -> list[str]:
    return [w for w in _normalize(text).split() if w not in STOP_WORDS and len(w) > 1]

def _document(topic: dict) -> Counter:
    # Exclude source URLs, implementation boilerplate and graph edges from ranking.
    fields = [(topic['title'], 5), (" ".join(topic.get('keywords', [])), 4),
              (topic['id'].replace('-', ' '), 3), (topic['category'], 2),
              (topic['summary'], 2), (topic['details'], 1)]
    return sum((Counter({w: n * weight for w, n in Counter(_tokens(text)).items()})
                for text, weight in fields), Counter())

DOCUMENTS = [_document(t) for t in TOPICS]
DOCUMENT_FREQUENCY = Counter(w for d in DOCUMENTS for w in d)
AVERAGE_LENGTH = sum(sum(d.values()) for d in DOCUMENTS) / max(1, len(DOCUMENTS))

def search_physics(query: str):
    normalized = _normalize(query[:300])
    expanded = normalized
    for alias, replacement in ALIASES.items():
        if re.search(r"\b" + re.escape(alias) + r"\b", normalized):
            expanded += " " + replacement
    terms = set(_tokens(expanded))
    def score(index: int) -> float:
        doc = DOCUMENTS[index]
        length = sum(doc.values())
        value = 0.0
        for term in sorted(terms):
            frequency = doc[term]
            if not frequency:
                continue
            idf = math.log(1 + (len(TOPICS) - DOCUMENT_FREQUENCY[term] + .5) / (DOCUMENT_FREQUENCY[term] + .5))
            value += idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * length / AVERAGE_LENGTH))
        title = _normalize(TOPICS[index]['title'])
        if normalized and (normalized == title or normalized == _normalize(TOPICS[index]['id'])):
            value += 25
        return value
    ranked = sorted(((score(i), i) for i in range(len(TOPICS))), key=lambda pair: (-pair[0], pair[1]))
    matches = [TOPICS[i] for relevance, i in ranked if relevance > 0][:4]
    return {
        "topics": matches,
        "source": "Local curated physics knowledge graph",
        "coverage_notice": "Topics describe implemented, simplified, or reference-only knowledge. Read regime, assumptions, limitations and simulation_notes; reference-only topics do not enable new executable mission types.",
        **({"notice": "No matching topics. Try a specific concept such as staging, rotating docking, or Kerr flyby."} if not matches else {}),
    }
