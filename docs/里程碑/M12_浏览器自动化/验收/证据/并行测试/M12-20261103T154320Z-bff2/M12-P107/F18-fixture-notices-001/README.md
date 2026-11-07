# F18 test fixture sources and notices

These files accompany the versioned F18 evidence only; no runtime dependency or application input changes.

- `SimpleMacro.xlsm` is an unchanged Apache POI public test sample: https://github.com/apache/poi/blob/trunk/test-data/spreadsheet/SimpleMacro.xlsm . SHA256 f76c986f4ebc25c2cc57c088b2511a1269f4bd61d6223a2ab58db351da348ba6, 13796 bytes. No macro execution. The accompanying Apache project license/notice texts are copied unchanged from the existing packaged POI component; its component version is 5.5.1, distinct from the public sample's trunk location.
- The synthetic v2 XLSX generator follows the original project rich-workbook definition plus the original F18 CJK merge. New ZIP bytes are explicitly versioned.
- Frozen pure Python files from openpyxl 3.1.5 and et_xmlfile 2.0.0 are retained for fixture reproduction, not bundled into App035. Their original distribution license files accompany this evidence.

The source metadata and checksums in the F18 recovery and actual-run manifests remain unchanged.
