# Run report

Result: **PASS**

- Orders entered: 6/6
- Retries after server errors: 1
- Failed orders: 0
- Seeded orders: 18
- Orders in portal: 24
- Rows exported: 24
- Table pages read: 3

## Verification

| Check | Result |
| --- | --- |
| `allOrdersEntered` | PASS |
| `exportMatchesSite` | PASS |
| `newOrdersInExport` | PASS |
| `csvAndJsonMatch` | PASS |

## Log

- Signed in
- Order 1 attempt 1 failed. HTTP 500
- Retrying in 250 ms
- Order 1/6 saved as #19 on attempt 2
- Order 2/6 saved as #20 on attempt 1
- Order 3/6 saved as #21 on attempt 1
- Order 4/6 saved as #22 on attempt 1
- Order 5/6 saved as #23 on attempt 1
- Order 6/6 saved as #24 on attempt 1
- Read table page 1 (10 rows so far)
- Read table page 2 (20 rows so far)
- Read table page 3 (24 rows so far)
- Wrote export.csv and export.json (24 rows each)
- PASS
