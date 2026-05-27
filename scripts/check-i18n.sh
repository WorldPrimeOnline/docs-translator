#!/bin/bash
echo "=== Unhardcoded strings in [locale] pages ==="
grep -rn '>[A-Z][a-z][^<{]*[a-z]<' src/app/\[locale\]/ \
  --include="*.tsx" | grep -v "t('" | grep -v "//"
echo "=== Unhardcoded strings in components (modals) ==="
grep -rn '>[A-Z][a-z][^<{]*[a-z]<' src/components/ \
  --include="*.tsx" | grep -v "t('" | grep -v "//"
echo "=== Done ==="
