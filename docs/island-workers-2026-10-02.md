# Haven Island: PC Tiny Agents

Support fills the main section with the optimized Three.js village. Its residents are the existing PC workers created on the Tiny Agents page. The mistakenly added AI research worker tab, IPC, and background runner have been removed.

Create a Tiny Agent with its existing conditions or selected changes, schedule, and PC actions. Choose **Island work area** in the rule builder, or leave it automatic. Save for review, then approve the rule through the existing approval flow. Editing continues to disable a rule until reviewed again. Districts change village placement and never change the rule's PC behavior.

The island shows each worker's assigned conditions/change watches, PC actions, live monitoring or action status, and recent action history. Notification pending, failed actions, unavailable sensors, snooze, drafts, and pause have separate labels. Selecting **Manage PC worker** opens that exact rule in Tiny Agents. Pause/resume controls use the existing PC rule IPC. Drafts cannot be enabled from the island.

Workers continue independently in Electron's existing PC rule engine while Orvix runs. The scene subscribes to that engine; it does not run a separate AI process. The engine exposes an ephemeral execution flag so the scene can distinguish monitoring from an action in progress. Completed/failed results still come from the existing action history. Scenery pause affects animation only.

Rendering retains static and moving-body instancing, a 30 fps cap, capped pixel density, slower shadow refresh, hidden-page and idle-paused render skipping, and GPU resource disposal on navigation. The island displays up to 64 PC residents; every rule remains in the roster. Browser-only scenery is labeled a demo.

Validation commands: `npm run build`, `npm run check:tiny-agents`, `npm run check:tiny-agents:ui`, `npm run check:island:pc`, and `npm run check:island`. The PC island test runs the production rule engine, real Electron preload/IPC and renderer with injected OS actions in an isolated store. It verifies action in progress/completion, monitoring, pause/resume, PC-only creation and area placement, draft approval protection, page navigation, layout, and mobile. It does not execute real OS actions or validate the entire repository.
