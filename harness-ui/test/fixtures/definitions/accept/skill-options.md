---
name: skill-options
description: skill with triggers and references and passthrough
triggers: when the user says foo
references:
  - references/a.md
  - references/b.md
customField: preserved-through-passthrough
nested:
  deep: value
  list:
    - one
    - two
---
# Skill body
Some markdown.
