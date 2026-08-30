// AUTO-GERADO por genRoutes() — não editar.
import { route as r0 } from "./views/activity.view";
import { route as r1 } from "./views/agora.view";
import { route as r2 } from "./views/equipe.view";
import { route as r3 } from "./views/guide.view";
import { route as r4 } from "./views/historico.view";
import { route as r5 } from "./views/settings.view";
// biome-ignore lint/suspicious/noExplicitAny: array is untyped until Task 8+ defines the Route/view contract
export const routes: any[] = [r0, r1, r2, r3, r4, r5].sort((a: any, b: any) => a.nav.order - b.nav.order);
