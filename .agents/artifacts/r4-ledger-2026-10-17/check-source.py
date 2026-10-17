from pathlib import Path
import subprocess

base = subprocess.check_output(
    ["git", "show", "fix/agent-mistakes-r3-identities:services/tools/money/money-repository.ts"], text=True
)
current = Path("services/tools/money/money-repository.ts").read_text()
ledger = Path("services/tools/money/money-ledger-sql.ts").read_text()


def section(source, start, end):
    begin = source.index(start)
    return source[begin:source.index(end, begin)].rstrip()


assert section(base, "export function effectiveTransactions", "\nexport interface MoneyRepository") == section(
    ledger, "export function effectiveTransactions", "\nexport function ledgerContributions"
)
assert section(base, '        needs("monthlyCashFlow")', '        needs("categoryTotals")') == section(
    current, '        needs("monthlyCashFlow")', '        needs("categoryTotals")'
)
market_base = subprocess.check_output(
    ["git", "show", "fix/agent-mistakes-r3-identities:services/tools/money/money-market-data-repository.ts"], text=True
)
market = Path("services/tools/money/money-market-data-repository.ts").read_text()
assert market == market_base.replace('from "./money-repository.js"', 'from "./money-ledger-sql.js"')
assert current.count("ledgerContributions(sql)") == 4
print("PASS source comparison. Effective rows and monthly cash flow are unchanged. Market data has only an import change. Four spending consumers use the derived relation.")
