# __NAME__

__DESCRIPTION__

## Functions

| Function | What it does | Needs "yes" |
|---|---|---|
| `ping` | Checks the tool works | No |

## Secrets

None yet. If this tool needs any, set them with `askq secret set __NAME__ KEY` (never commit them).

## Test

```bash
askq tool test __NAME__              # list functions
askq tool test __NAME__ ping '{}'    # call one
```
