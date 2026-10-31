# V009-G003 published asset audit

Passed: 12/12 local SHA-256 and sizes against original GitHub asset metadata; 7/7 installer SHA256SUMS entries; 4/4 schemaVersion2 producer manifests and exact 1/1/2/3 installer allocation; 9/9 original Actions jobs successful at a6bfc60873a0c68e8ac630e2c9b951db04db82c8. Total downloaded bytes: 1,889,643,464.

The initial task description conflated verifyArtifacts.files (11) with SHA256SUMS installer rows (7). The coordinator corrected that before the final contract audit; the original description, observed coverage and source rationale remain in task-scope-correction.json. No input was modified or hash rerun to resolve this task-description error.

Release: [v0.0.9](https://github.com/uprxiao/SmartDD/releases/tag/v0.0.9), ID 430185555, prerelease=true/draft=false/12 uploaded assets. Actions: [41238778285](https://github.com/uprxiao/SmartDD/actions/runs/41238778285). Producer verification labels remain exactly packaged-electron-sqlite-pty; this file audit does not extend those labels into Windows/Linux business acceptance. No installer was executed and no M10 whole case was added.

All 12 original files remained mode0400 with identical size/mtime. Input manifest and original Release/Actions API mode/mtime/size/hash remained unchanged. No network or build/App/UI/model was started. Owned audit processes exited.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| SHA256SUMS.txt | 665 | `a99edf4a8b9e3534fe9d5eca0ae45923d5d2fbd34385815cfc672b14bdaa75b9` |
| WillYou-0.0.9-linux-amd64.deb | 121016992 | `e7171ffd7c101672594424d7147a57d396ddfa5e60835e6cf8ac27aa1e164b48` |
| WillYou-0.0.9-linux-x86_64.AppImage | 154852474 | `30d8d7156d606819b3322b8f5e7d077d34c33b873ead823a8325548780e00da5` |
| WillYou-0.0.9-linux-x86_64.rpm | 100296333 | `5aa423f339cfad61b963a2defe415480e835e7dc080c645dbeeefcc28a9669b4` |
| WillYou-0.0.9-mac-arm64.dmg | 609261838 | `f9186e1326ba67e9135cd1c49d75375febcef37f09d90862c6ea904b9960e9da` |
| WillYou-0.0.9-mac-x64.dmg | 621713316 | `f6d9738bf99f99b47d61883044fa9df875c7954a6e23ad1d933d3b12174c8361` |
| WillYou-0.0.9-win-x64.exe | 134513427 | `18e665337defa9a1f93cfdda1c21929d3ca628ddb7803bee0edbeefd3949ed1f` |
| WillYou-0.0.9-win-x64.msi | 147986266 | `358075e9008d18402ebfe3f60667ba543c4d5c87046644187260e64605d87e5a` |
| manifest-linux-x64.json | 758 | `4e895bc8f17454db9db292a19bfb377e8d7cfd6c16b1e4099b219d9e4358147c` |
| manifest-mac-arm64.json | 413 | `888da3c1e143803355e69f8bc35181f1d43aea30cedccced18cc3054e3f87b7c` |
| manifest-mac-x64.json | 409 | `69212a222dee30704dd0196c08223feb8d28b601bbdab58b4ff83cb0df4b0f26` |
| manifest-win-x64.json | 573 | `279beea852e53e125fcdf2b98ccdf1391817e29f315581235c8cd1b5b00fd56d` |
