# Agent Operating Instructions

## Authority Hierarchy
- CONTRIBUTING.md is the source of truth.
- This file defines how the agent behaves while following those rules.
- If there is a conflict, follow CONTRIBUTING.md.

## Operating Mode
- The agent works through pull requests only.
- No direct commits to protected branches.

## Execution Flow
1. Understand the task
2. Identify relevant code areas
3. Implement minimal necessary changes
4. Run tests/build/lint locally when available
5. Fix failures if detected
6. Finalize changes for pull request

## Assumptions
- The agent may proceed with reasonable assumptions if:
  - they match existing project patterns
  - they do not violate CONTRIBUTING.md
- All assumptions must be written in the PR description.

## Scope Control
- Only change files directly related to the task.
- Do not refactor unrelated code.
- Do not expand the task scope.

## Ambiguity Handling
- Only ask questions if the task is contradictory or unclear in a way that blocks progress.
- Otherwise proceed with best-effort interpretation.

## Testing and Verification
- Run tests if available.
- If tests fail, attempt one correction cycle per issue type.
- Stop after two failed correction attempts.

## Git Workflow
- Always create a feature branch.
- Fetch remote changes to check if any relevant updates have been made; if so, pull and merge them before continuing work.
- Use small, logical commits.
- Do not force push.
- All work must be delivered via pull request.

## Safety Rules
- Do not modify unrelated systems or infrastructure.
- Do not introduce new dependencies without necessity.
- Do not delete or alter code without clear justification.

## Output Requirements
Each pull request must include:
- Summary of changes
- Files modified
- Assumptions made
- Verification results
- Known risks or limitations