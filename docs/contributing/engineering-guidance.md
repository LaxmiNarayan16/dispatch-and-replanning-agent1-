# Engineering Guidance

## Non-negotiable rules

- Keep scheduling constraints in pure deterministic TypeScript. Do not invoke AI from the scheduling module.
- Validate incoming data with Zod and validate assignments both before saving and after planning.
- Use half-open UTC intervals and the configured operational timezone. Never compare naive local timestamps.
- Preserve completed and in-progress assignments during replanning.
- Insert schedule versions and assignment snapshots; never mutate historical versions.
- Treat preferred windows as soft unless a separately named hard-window field is introduced.
- Do not generate notifications before schedule approval succeeds.
- AI output is untrusted: schema-validate it, re-validate every assignment with the deterministic hard constraints, and never let it approve or bypass the approval endpoint.
- Reject any proposal that double-books a technician, even if the client bypassed the planner.
- Do not expose secrets, provider responses containing sensitive data, or server stack traces.

## Quality gates by phase

- Run focused Vitest tests after each domain or engine change.
- Run API integration tests after endpoint or persistence changes.
- Run the production build after frontend changes and before handing off.
- Update the implementation checklist and architecture docs whenever delivered behavior changes.

## Style

- Prefer explicit types and small pure functions for time and constraint logic.
- Give validation failures stable codes and contextual messages.
- Use stable sort keys in the engine so identical inputs produce identical outputs.
- Log structured event names and request IDs; do not log credentials.
