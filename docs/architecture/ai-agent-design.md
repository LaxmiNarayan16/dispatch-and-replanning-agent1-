# AI Agent Design

## Authority boundary

The AI agent is advisory until a dispatcher explicitly approves a persisted version. It may propose assignments, but it cannot confirm work, approve versions, alter deterministic constraints, or overwrite completed/in-progress assignments. The deterministic engine, the version transaction, and the dispatcher approval are authoritative.

## Two capabilities

### 1. Plan proposal and analysis

`proposeDispatchPlan` runs the deterministic planner first, then optionally asks a configured model for an alternative assignment plan. The model receives only a compact factual snapshot: technicians, skills, regions, working hours, availability, requests, protected assignments, and the deterministic result.

The model response must pass a strict Zod schema. Every suggested row is then checked by `validateManualAssignment`, the same hard-constraint validator used by the dispatcher override flow:

- technician and request IDs must exist;
- technician must be ACTIVE, skill-matched, and region-matched;
- the request must be schedulable;
- interval must fit working hours and one availability window;
- duration must equal the request estimate;
- workload cap must not be exceeded;
- no overlap with protected or previously accepted suggestions;
- no request can be assigned twice.

Rejected suggestions are returned with their machine-readable reasons. If every suggestion fails, the validated deterministic plan is returned instead.

The response also contains:

- trade-offs (coverage, priority, preferred windows, workload balance, protected work);
- risky assignments (emergencies, preferred-window misses, high utilization);
- unassigned requests with severity and rejection reasons;
- missing-information notes and dispatcher questions;
- `requiresApproval: true` and `persisted: false`.

### 2. Explanations

`explainSchedule` remains an explanation-only path for an existing engine result. It also validates that every referenced assignment/request pair appears in the deterministic result.

## Approval flow

1. `POST /ai/plan` returns an advisory plan. Nothing is persisted.
2. `POST /ai/plan/propose` stores the reviewed plan as a new immutable `PROPOSED` schedule version. When the client sends the reviewed assignments, the server re-validates exactly those rows instead of trusting the client or running a second, possibly different AI proposal. This is still not a confirmation.
3. The dispatcher reviews the change set and calls `POST /schedule-versions/{id}/approve`.
4. Approval is transactional and writes audit rows plus mocked notifications.

If a model is not configured, the agent returns the deterministic validated plan with a warning. A provider timeout, malformed response, invalid reference, or hard-constraint failure never blocks planning.

## Provider integration

`AiPlanProvider` is injectable. `createGeminiPlanProvider` posts the factual DTO with a JSON schema and treats the returned text as untrusted. Gemini structured output is not trusted by itself: the application-side Zod schema and hard-constraint validators decide what enters a proposal.
