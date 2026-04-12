#!/bin/bash
set -e

SKILL_ARG="${1:-}"
SKILLS_ROOT="${2:-}"

if [ -z "$SKILL_ARG" ]; then
  echo "Usage: validate-skill.sh <skill-dir> [skills-root]" >&2
  exit 1
fi

# Resolve the skill directory
if [ -d "$SKILL_ARG" ]; then
  SKILL_DIR="$SKILL_ARG"
else
  # Try to find it relative to a skills/ directory
  if [ -n "$SKILLS_ROOT" ] && [ -d "$SKILLS_ROOT/$SKILL_ARG" ]; then
    SKILL_DIR="$SKILLS_ROOT/$SKILL_ARG"
  elif [ -d "skills/$SKILL_ARG" ]; then
    SKILL_DIR="skills/$SKILL_ARG"
  else
    echo "Error: skill directory not found: $SKILL_ARG" >&2
    exit 1
  fi
fi

SKILL_NAME=$(basename "$SKILL_DIR")
SKILL_PARENT=$(dirname "$SKILL_DIR")

echo "[VALIDATE] Checking: $SKILL_DIR" >&2

ISSUES=""
CHECKS_SKILL_MD="fail"
CHECKS_SKILL_JSON="fail"
CHECKS_SCRIPTS="fail"
CHECKS_ZIP="fail"

# Check 1: SKILL.md
if [ -f "$SKILL_DIR/SKILL.md" ]; then
  # Validate frontmatter
  if grep -q "^name:" "$SKILL_DIR/SKILL.md" && grep -q "^description:" "$SKILL_DIR/SKILL.md"; then
    CHECKS_SKILL_MD="pass"
    echo "[VALIDATE] ✅ SKILL.md present and has required frontmatter" >&2
  else
    CHECKS_SKILL_MD="fail"
    ISSUES="${ISSUES}|SKILL.md is missing 'name:' or 'description:' in frontmatter"
    echo "[VALIDATE] ❌ SKILL.md missing required frontmatter (name/description)" >&2
  fi
else
  ISSUES="${ISSUES}|SKILL.md not found — create it following the template in AGENTS.md"
  echo "[VALIDATE] ❌ SKILL.md not found" >&2
fi

# Check 2: skill.json
if [ -f "$SKILL_DIR/skill.json" ]; then
  REQUIRED_FIELDS="name category description triggers required_tools required_commands supports_fix timeout_seconds"
  MISSING_FIELDS=""
  for field in $REQUIRED_FIELDS; do
    if ! python3 -c "import json; d=json.load(open('$SKILL_DIR/skill.json')); exit(0 if '$field' in d else 1)" 2>/dev/null; then
      MISSING_FIELDS="$MISSING_FIELDS $field"
    fi
  done
  if [ -z "$MISSING_FIELDS" ]; then
    CHECKS_SKILL_JSON="pass"
    echo "[VALIDATE] ✅ skill.json present and valid" >&2
  else
    CHECKS_SKILL_JSON="fail"
    ISSUES="${ISSUES}|skill.json missing required fields:$MISSING_FIELDS"
    echo "[VALIDATE] ❌ skill.json missing required fields:$MISSING_FIELDS" >&2
  fi
else
  ISSUES="${ISSUES}|skill.json not found — create it with: name, category, description, triggers, required_tools, required_commands, supports_fix, timeout_seconds"
  echo "[VALIDATE] ❌ skill.json not found" >&2
fi

# Check 3: scripts directory with at least one executable script
if [ -d "$SKILL_DIR/scripts" ]; then
  SCRIPT_COUNT=$(find "$SKILL_DIR/scripts" -name "*.sh" | wc -l)
  if [ "$SCRIPT_COUNT" -gt 0 ]; then
    NON_EXEC=""
    while IFS= read -r script; do
      if [ ! -x "$script" ]; then
        NON_EXEC="$NON_EXEC $script"
      fi
    done < <(find "$SKILL_DIR/scripts" -name "*.sh")
    if [ -z "$NON_EXEC" ]; then
      CHECKS_SCRIPTS="pass"
      echo "[VALIDATE] ✅ scripts/ present with $SCRIPT_COUNT executable script(s)" >&2
    else
      CHECKS_SCRIPTS="fail"
      ISSUES="${ISSUES}|Non-executable scripts found:$NON_EXEC — run: chmod +x$NON_EXEC"
      echo "[VALIDATE] ❌ Non-executable scripts found:$NON_EXEC" >&2
    fi
  else
    ISSUES="${ISSUES}|scripts/ directory exists but contains no .sh files"
    echo "[VALIDATE] ❌ scripts/ has no .sh files" >&2
  fi
else
  ISSUES="${ISSUES}|scripts/ directory not found — create it and add at least one .sh script"
  echo "[VALIDATE] ❌ scripts/ directory not found" >&2
fi

# Check 4: matching zip file
ZIP_PATH="$SKILL_PARENT/${SKILL_NAME}.zip"
if [ -f "$ZIP_PATH" ]; then
  CHECKS_ZIP="pass"
  echo "[VALIDATE] ✅ ${SKILL_NAME}.zip present" >&2
else
  ISSUES="${ISSUES}|${SKILL_NAME}.zip missing — run: cd $SKILL_PARENT && zip -r ${SKILL_NAME}.zip ${SKILL_NAME}/"
  echo "[VALIDATE] ❌ ${SKILL_NAME}.zip missing — run: cd $SKILL_PARENT && zip -r ${SKILL_NAME}.zip ${SKILL_NAME}/" >&2
fi

# Determine overall validity
VALID=true
if [ "$CHECKS_SKILL_MD" != "pass" ] || [ "$CHECKS_SKILL_JSON" != "pass" ] || [ "$CHECKS_SCRIPTS" != "pass" ] || [ "$CHECKS_ZIP" != "pass" ]; then
  VALID=false
fi

ISSUE_COUNT=$(echo "$ISSUES" | tr '|' '\n' | grep -c '.' 2>/dev/null || echo 0)

if $VALID; then
  echo "[VALIDATE] ✅ Result: PASS" >&2
else
  echo "[VALIDATE] ❌ Result: FAIL ($ISSUE_COUNT issue(s))" >&2
fi

python3 -c "
import json, sys

skill = sys.argv[1]
valid = sys.argv[2] == 'true'
skill_md = sys.argv[3]
skill_json = sys.argv[4]
scripts = sys.argv[5]
zip_check = sys.argv[6]
issues_raw = sys.argv[7]

issues = [i.strip() for i in issues_raw.split('|') if i.strip()]

print(json.dumps({
  'skill': skill,
  'valid': valid,
  'checks': {
    'skill_md': skill_md,
    'skill_json': skill_json,
    'scripts': scripts,
    'zip': zip_check
  },
  'issues': issues
}, indent=2))
" "$SKILL_NAME" "$($VALID && echo true || echo false)" \
  "$CHECKS_SKILL_MD" "$CHECKS_SKILL_JSON" "$CHECKS_SCRIPTS" "$CHECKS_ZIP" \
  "$ISSUES"
