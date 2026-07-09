import { GlobalRegistrator } from "@happy-dom/global-registrator";

// A real URL (not happy-dom's default `location.origin === "null"`, which
// breaks preact-iso's `new URL(url, location.origin)` — see runtime/router.ts
// and the App integration test). Benefits every view test that navigates.
GlobalRegistrator.register({ url: "http://localhost/" });
