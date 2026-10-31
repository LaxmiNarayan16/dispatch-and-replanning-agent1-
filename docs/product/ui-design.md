# UI Design

## Dispatch console

The React/Vite frontend lives in `src/web`. It provides an enterprise-oriented dispatch board with:

- Deep navy workspace navigation and light operational workspace.
- Version and pending-approval visibility at the top of every board.
- Single-day Technician Schedule dashboard with ten aligned hourly slots from 08:00–18:00. Each header cell labels its interval (for example, 08:00–09:00); availability and assignment bars use the same timestamp-derived slot geometry.
- Technician identity, skill, active status, availability, role, and workload distribution with scan-friendly hierarchy.
- Unassigned-request queue with decision reasons.
- Keyboard-native assignment selection, visible focus state, and assignment detail panel.
- Replanning trigger selection, AI plan proposal review, approval, and persisted change-summary entry points.
- A validated manual-override form in the request detail drawer; overrides become approval-required proposals.

## Current data boundary

The live workbench now has browser flows for first-admin setup/login, technicians (including operational status), requests, deterministic schedule generation, replan change summaries, validated manual overrides, AI plan review, and approval. It calls versioned API endpoints; browser code never schedules, validates, or approves assignments on its own. A Neon database and `AUTH_SECRET` are required for these persistent workflows.

The schedule dashboard is presentation-only: its availability bars, time ruler, hover states, current-time indicator, and assignment-card styling do not change the scheduling engine, assignment interval, click behavior, or approval workflow.

## Verification

`tsconfig.web.json` type-check passes and the Vite production build succeeds. Accessibility interaction review against production API data remains a release gate.
