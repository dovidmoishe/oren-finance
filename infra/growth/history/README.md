# Recovered visit observations

These files are sanitized reports from chat, finalized 7 Nov 2026. They were not rechecked against the raw Caddy logs. They are not visits, people, or a baseline.

| File | What it is |
| --- | --- |
| `RECOVERY-NOTES.md` | Caveats, including the laptop gaps and the retention limit |
| `recovery-observations.csv` | The same observations in a flat table |
| `api/src/admin/reporting/fixtures/recovery-observations.json` | The source used by the importer and the tests |

## How the importer treats them

- Oct 29 full day: 2,219 IP+browser pairs and 4,163 pageviews. Earlier Oct 29 figures are running snapshots, not extra days.
- Oct 30: 772 and 2,234.
- Oct 31 through Nov 4 have no daily report. The morning runs on Nov 2, Nov 3, Nov 4, and Nov 5 were skipped because the laptop was offline, and no Oct 31 daily run was found. Those days stay `unavailable`.
- Nov 5 through 17:25 WAT is a partial 354 / 713. The rest of that day is unknown.
- The 16,425 pageviews figure is one window reading. It is not the sum of the known days.
- 5,764 visitors is unresolved: it may be the script's total row, which adds daily uniques. It is not a lifetime distinct count.
- 7,145 is any-hit IP+browser pairs and includes assets and API requests. It is not people and it is not pageviews.
- 36,930 pageviews on the Oct 31 report is kept and excluded. It is not comparable with the later 16,425 window.
- There is no traffic before 29 Oct 2026. The start minute is reported as 01:23, 01:25, and 01:27 WAT, so the exact minute stays unresolved.
- Database snapshots are point-in-time row counts. "Trades" in most of them means execution rows. The one confirmed-trade reading is 3 and is not written into the trade ledger.
- Caddy may already have deleted raw logs. Retention is 10 files of 50 MB and 90 days. A missing raw day is not zero.

Do not add these figures to new telemetry when the same day or window is covered by both. The report marks that overlap `unavailable`.

Deploy does not import this file. See `infra/growth/operations.md` for the manual command.
