// AUTO-GERADO por genRoutes() — não editar.
import { route as r0 } from "./views/activity.view";
import { route as r1 } from "./views/monitor.view";
import { route as r2 } from "./views/org.view";
import { route as r3 } from "./views/overview.view";
import { route as r4 } from "./views/pipeline.view";
import { route as r5 } from "./views/settings.view";
import { route as r6 } from "./views/team.view";
import { route as r7 } from "./views/toolbox.view";
// biome-ignore lint/suspicious/noExplicitAny: array is untyped until Task 8+ defines the Route/view contract
export const routes: any[] = [r0, r1, r2, r3, r4, r5, r6, r7].sort((a: any, b: any) => a.nav.order - b.nav.order);
