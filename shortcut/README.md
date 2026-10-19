# The Siri shortcut

`build.py` generates `Ask Q.unsigned.shortcut`: no URL or token inside; it asks for both when installed.

To publish a new version (maintainers, on a Mac):

```bash
python3 shortcut/build.py
shortcuts sign --mode anyone --input "shortcut/Ask Q.unsigned.shortcut" --output "shortcut/Ask Q.shortcut"
open "shortcut/Ask Q.shortcut"   # add it, leave both questions empty
```

Then in Shortcuts: right click **Ask Q** → Share → **Copy iCloud Link**, and put that link in place of the current link
in the README and docs. Check that the shared shortcut has no URL or token before publishing.
