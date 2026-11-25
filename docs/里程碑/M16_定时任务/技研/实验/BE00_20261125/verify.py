"""Re-check only the synthetic BE00 screenshot files and reported click counts."""
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys

from PIL import Image


def verify(root: Path) -> dict:
    rows = [json.loads(line) for line in (root / "comparison.jsonl").read_text().splitlines()]
    if not rows or rows[0].get("event") != "environment" or rows[-1].get("event") != "complete":
        raise ValueError("Missing experiment start/end record")
    groups = defaultdict(lambda: [0, 0, 0])
    results = []
    for row in rows:
        if row["event"] != "phase":
            continue
        capture = row.get("capture", {})
        clicked = row.get("clickDelta") == 1
        pixel = None
        valid = False
        if "file" in capture:
            name = capture["file"]
            if not name.startswith("comparison-") or Path(name).name != name:
                raise ValueError("Unexpected screenshot file")
            file = root / name
            with Image.open(file) as source:
                im = source.convert("RGB")
                width, height = im.size
                pixel = im.getpixel((round(width * 300 / 440), round(height * 200 / 300)))
                expected = tuple(bytes.fromhex(capture["expected"][1:]))
                valid = (
                    im.size == (440, 300)
                    and sha256(file.read_bytes()).hexdigest() == capture["sha256"]
                    and all(
                        got >= 140 if want >= 140 else got <= 100
                        for got, want in zip(pixel, expected)
                    )
                )
        counts = groups[row["carrier"]]
        counts[0] += 1
        counts[1] += int(clicked)
        counts[2] += int(valid)
        results.append({
            "carrier": row["carrier"],
            "state": row["state"],
            "clickVerified": clicked,
            "captureVerified": valid,
            "screenshotMs": capture.get("ms"),
            "pixelRGB": pixel,
            "expected": capture.get("expected"),
            "windowVisible": row.get("windowVisible"),
            "windowMinimized": row.get("windowMinimized"),
            "layers": row.get("order"),
            "error": capture.get("error"),
        })
    return {"environment": rows[0], "rows": results, "counts": dict(groups)}


if __name__ == "__main__":
    directory = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
    print(json.dumps(verify(directory), ensure_ascii=False, indent=2))
