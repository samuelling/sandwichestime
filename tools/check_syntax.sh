#!/bin/sh
# Parse every browser module with node; exits non-zero on the first syntax error.
cd "$(dirname "$0")/.." && rc=0
for f in $(find src -name '*.js'); do node --check --input-type=module < "$f" 2>/tmp/syn.err || { echo "SYNTAX ERROR in $f"; head -5 /tmp/syn.err; rc=1; }; done
[ $rc = 0 ] && echo "all modules parse"; exit $rc
