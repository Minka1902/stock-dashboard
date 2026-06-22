from app.sources import gdelt

SAMPLE = {
    "articles": [
        {
            "url": "https://example.com/a",
            "title": "Fed holds rates",
            "domain": "example.com",
            "seendate": "20260622T124500Z",
            "sourcecountry": "United States",
            "socialimage": "https://example.com/a.jpg",
        },
        {
            "url": "https://example.com/a",  # duplicate url -> deduped
            "title": "dup",
            "domain": "example.com",
            "seendate": "20260622T130000Z",
            "sourcecountry": "United States",
            "socialimage": "",
        },
        {
            "url": "https://news.de/b",
            "title": "Sanctions update",
            "domain": "news.de",
            "seendate": "20260621T080000Z",
            "sourcecountry": "Germany",
            # no socialimage key
        },
    ]
}


def test_parse_normalizes_and_dedupes():
    arts = gdelt.parse_response(SAMPLE)
    assert len(arts) == 2  # duplicate url removed
    first = arts[0]
    assert first.url == "https://example.com/a"
    assert first.title == "Fed holds rates"
    assert first.seendate == "2026-06-22T12:45:00Z"  # normalized
    assert first.image == "https://example.com/a.jpg"


def test_parse_handles_missing_image():
    arts = gdelt.parse_response(SAMPLE)
    assert arts[1].image == ""


def test_parse_empty():
    assert gdelt.parse_response({"articles": []}) == []
    assert gdelt.parse_response({}) == []
