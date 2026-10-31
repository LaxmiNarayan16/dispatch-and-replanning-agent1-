// Explicit Vercel entry point for every versioned API endpoint.
// Keeping this route alongside api/[...path].ts makes /api/v1/* resolution
// unambiguous for Vercel's Vite deployment output.
export { default } from "../index.js";
