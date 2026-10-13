# This repository's composition. It is self-hosted: the gates are the kit library it
# edits, imported in place (kit/common), never a copy under .dev/kit that could drift.
# The installer never writes this file — it is not a consuming repo.

set allow-duplicate-recipes
set allow-duplicate-variables

import 'kit/common/gate.just'

# The library defaults to an installed copy and to origin/main as the trunk.
kit  := "kit/common"
base := "origin/next"

# The local loop. CI runs the same suite (npm test) per job.
check: test adr-check docs-check

test:
    npm test
