"""Verify only the archived fixed local fixture results, not overall BE01/02 acceptance."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parent
EXPECTED = ("cold-after-shell", "cold-idle-reacquire")


def check(directory):
    events = [json.loads(line) for line in (directory / "cold-host.jsonl").read_text().splitlines()]
    assert events[0]["event"] == "environment" and events[0]["fixtureOnly"]
    assert events[-1] == {"event": "complete", "remainingWindows": 0}
    assert events[0]["electron"] == "42.11.14" and events[0]["arch"] == "arm64"
    scenarios = [event for event in events if event["event"] == "scenario"]
    assert tuple(event["name"] for event in scenarios) == EXPECTED
    assert len(events) == 4
    results = []
    for event in scenarios:
        name = event["name"]
        assert not any(key in event for key in ("driverError", "inputError", "captureError", "cleanupError")), name
        assert event["everShown"] is False and event["layerCorrect"]
        assert event["pageFocusEmulation"] is True
        host, final = event["host"], event["final"]
        for frame in (host, final):
            assert frame["visible"] is False and frame["focused"] is False
            assert frame["baseWindowCount"] == 1 and frame["browserWindowCount"] == 0
        assert final["layerOrder"] == ["page", "shell"]
        assert host["shellLoadObserved"] and host["baseIdResolves"]
        assert host["hasWindowWebContents"] is False
        assert host["browserWindowFromShell"] == host["id"]
        assert [host["shellBounds"][k] for k in ("width", "height")] == [host["contentBounds"][k] for k in ("width", "height")]
        assert final["pageWCId"] != final["shellWCId"]
        assert event["clickDelta"] == 1 and event["after"]["clicks"] == event["before"]["clicks"] + 1
        assert (event["before"]["width"], event["before"]["height"]) == (440, 300)
        assert (event["after"]["width"], event["after"]["height"]) == (440, 300)
        capture = event["capture"]
        image_file = directory / capture["file"]
        assert hashlib.sha256(image_file.read_bytes()).hexdigest() == capture["sha256"]
        with Image.open(image_file) as image:
            image = image.convert("RGB")
            w, h = image.size
            assert w * 300 == h * 440 and w >= 440 and h >= 300
            x, y = int(292 * w / 440), int(202 * h / 300)
            region = [image.getpixel((xx, yy)) for xx in range(x-4, x+5) for yy in range(y-4, y+5)]
            red_fraction = sum(r > 190 and g < 70 and b < 70 for r, g, b in region) / len(region)
            assert red_fraction >= 0.9
            marker = list(image.getpixel((x, y)))
        if name == "cold-idle-reacquire":
            assert event["idle"]["after"]["ticks"] > event["idle"]["before"]["ticks"]
        assert event["cleanup"] == {"shellDestroyed": True, "pageDestroyed": True, "windowDestroyed": True, "remainingWindows": 0}
        owner = event.get("ownerLookup")
        if directory.name == "run2":
            assert owner["shellAndPageAreDifferentWebContents"] and owner["browserWindowFromId"] is None
            for key in ("shell", "page", "baseWindowFromId"):
                result = owner[key]
                assert result["id"] == host["id"] and result["sameObject"]
                assert result["constructor"] == "BaseWindow" and result["isBaseWindow"] and not result["isBrowserWindow"] and not result["hasOwnWebContents"]
        results.append({"run":directory.name,"scenario":name,"clickDelta":event["clickDelta"],"inputMs":event["inputMs"],"captureMs":capture["ms"],"imageSize":[w,h],"redPixel":marker,"redFraction":red_fraction,"windowNeverShown":True,"ownerLookupVerified":owner is not None,"idleTickVerified":name=="cold-idle-reacquire","passedFixedFixture":True})
    return results


if __name__ == "__main__":
    results = [result for name in ("run1", "run2") for result in check(ROOT / name)]
    print(json.dumps({"scope":"BE01/BE02 E-layer subprobes; not product or gate acceptance","fixedFixturePasses":len(results),"results":results},ensure_ascii=False,indent=2))
