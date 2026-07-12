import { signal, type Signal } from "@preact/signals";

export type Lang = "en" | "pt";

export const STR: Record<Lang, Record<string, string>> = {
  en: {
    nav_overview:"Overview", nav_org:"Org chart", nav_pipeline:"Pipeline", nav_workers:"Team", nav_toolbox:"Toolbox", nav_activity:"Activity", collapse:"Collapse",
    nav_monitor:"Monitor", mon_sub:"What each active specialist is doing, live — one lane per specialist", mon_empty:"No specialist is active right now. A lane appears here the moment a subagent is dispatched.", mon_stream:"Working", mon_files:"Files changing", mon_nofiles:"No file changes yet", mon_active_only:"Active only", mon_all:"All", mon_hidden:"{n} finished — show all", mon_reason:"reasoning", mon_cmd:"command", mon_active:"active", mon_idle:"idle",
    search:"Search or run a command", live:"live",
    ok_h:"All systems nominal", ok_p:"Every dispatch is progressing. Nothing is blocked.",
    warn_h:"{n} escalation needs you", warn_p:"{who} escalated a change on {repo} — review and approve the next wave.", warn_p0:"A specialist raised an escalation — review it and approve the next wave.",
    review:"Review escalation →", viewact:"View activity →",
    k_specialists:"specialists", k_active:"active", k_available:"available", k_delivered:"delivered", k_escalated:"escalated", k_journeys:"journeys", k_repos:"repos",
    pipeline:"Pipeline", openboard:"Open board", liveact:"Live activity",
    needs_attention:"Needs your attention", att_critical:"CRITICAL", att_warning:"REVIEW",
    s_dispatched:"Dispatched", s_delivered:"Delivered", s_verified:"Verified", s_escalated:"Escalated", s_merged:"Merged",
    org_sub:"Coordinator → repo · monorepo → package → specialist", t_repo:"repo", t_monorepo:"monorepo", t_module:"package", t_group:"group", nospec:"no specialists yet",
    org_search_ph:"Filter by repo or specialist…", org_zoom:"Zoom", org_zoom_in:"Zoom in", org_zoom_out:"Zoom out", org_reset:"Reset view", org_fullscreen:"Fullscreen", org_nomatch:"No repo or specialist matches the filter.",
    legend:"Legend", lg_coord:"Coordinator — plans journeys & authors the spec", lg_repo:"Repo — a single-package repository", lg_monorepo:"Monorepo — a repo split into packages", lg_module:"Package — a unit of work inside a monorepo", lg_group:"Group — packages hired together", lg_specialist:"Specialist — a hired dev/QA persona", lg_relation:"Relation — a dependency between units",
    pipe_sub:"{a} journeys · {b} dispatches", filter:"Filter",
    work_sub:"{h} hired · {a} active · {i} available", all:"All", dispatch:"+ Dispatch",
    cv_competences:"Competences", cv_delivered:"delivered", cv_inprog:"in progress", cv_total:"dispatches",
    f_repo:"repo", f_monorepo:"monorepo", f_package:"package", f_type:"type", f_worktree:"worktree",
    tb_sub:"Frameworks & MCP servers the team can reach for", skillpkgs:"Skill packages", mcps:"MCP servers",
    act_sub:"Every state change, live", streaming:"streaming",
    conn_wait:"connecting", conn_down:"offline",
    d_status:"status", d_journey:"journey", d_stage:"stage", d_pr:"pull request", d_branch:"branch",
    files:"Files in progress", relations:"Unit relations", openspec:"Open orientation spec", worktree:"Worktree", none:"none",
    cmd_ph:"Jump to a worker, repo, package… or run a command", g_views:"Views", g_actions:"Actions", g_workers:"Workers", nomatch:"No matches",
    c_goto:"Go to", c_writespec:"Write orientation spec", c_theme:"Toggle theme",
    st_active:"active", st_idle:"idle", st_available:"available", st_delivered:"delivered", st_verified:"verified", st_failed:"QA failed", st_escalated:"escalated", st_merged:"merged", st_dispatched:"dispatched", st_removed:"removed",
    nav_settings:"Settings", set_notif:"Notifications", set_notif_sub:"Get alerted when work advances or needs you.",
    set_enable:"Enable notifications", set_enable_sub:"Master switch for sound and desktop alerts.",
    set_desktop:"Desktop notifications", set_desktop_sub:"Chrome/Windows toasts — they show even when the browser isn't focused.",
    set_grant:"Grant permission", set_granted:"Permission granted", set_denied:"Blocked — allow it in the browser's site settings.",
    set_sound:"Sound alerts", set_sound_sub:"A short chime on each notification.",
    set_events:"Notify me about", ev_dispatch:"New dispatch", ev_delivered:"Delivered · PR opened", ev_escalated:"Escalation — needs you", ev_merged:"Merged",
    set_test:"Send a test notification", set_appearance:"Appearance", set_theme:"Theme", set_lang:"Language",
    th_auto:"Auto", th_light:"Light", th_dark:"Dark",
    rel_now:"now",
  },
  pt: {
    nav_overview:"Visão geral", nav_org:"Organograma", nav_pipeline:"Pipeline", nav_workers:"Especialistas", nav_toolbox:"Ferramentas", nav_activity:"Atividade", collapse:"Recolher",
    nav_monitor:"Monitor", mon_sub:"O que cada especialista ativo está fazendo, ao vivo — uma lane por especialista", mon_empty:"Nenhum especialista ativo agora. Uma lane aparece aqui assim que um subagente é despachado.", mon_stream:"Trabalhando", mon_files:"Arquivos mudando", mon_nofiles:"Nenhuma alteração de arquivo ainda", mon_active_only:"Só ativos", mon_all:"Todos", mon_hidden:"{n} concluídos — mostrar todos", mon_reason:"raciocínio", mon_cmd:"comando", mon_active:"ativo", mon_idle:"ocioso",
    search:"Buscar ou rodar um comando", live:"ao vivo",
    ok_h:"Tudo sob controle", ok_p:"Todo dispatch progredindo. Nada bloqueado.",
    warn_h:"{n} escalação precisa de você", warn_p:"{who} escalou uma mudança em {repo} — revise e aprove a próxima wave.", warn_p0:"Um especialista abriu uma escalação — revise e aprove a próxima wave.",
    review:"Revisar escalação →", viewact:"Ver atividade →",
    k_specialists:"especialistas", k_active:"ativos", k_available:"disponíveis", k_delivered:"entregues", k_escalated:"escalados", k_journeys:"jornadas", k_repos:"repos",
    pipeline:"Pipeline", openboard:"Abrir quadro", liveact:"Atividade ao vivo",
    needs_attention:"Precisa da sua atenção", att_critical:"CRÍTICO", att_warning:"REVISAR",
    s_dispatched:"Despachado", s_delivered:"Entregue", s_verified:"Verificado", s_escalated:"Escalado", s_merged:"Integrado",
    org_sub:"Coordenador → repo · monorepo → pacote → especialista", t_repo:"repo", t_monorepo:"monorepo", t_module:"pacote", t_group:"grupo", nospec:"nenhum especialista ainda",
    org_search_ph:"Filtrar por repo ou especialista…", org_zoom:"Zoom", org_zoom_in:"Aproximar", org_zoom_out:"Afastar", org_reset:"Restaurar visão", org_fullscreen:"Tela cheia", org_nomatch:"Nenhum repo ou especialista corresponde ao filtro.",
    legend:"Legenda", lg_coord:"Coordenador — planeja jornadas e escreve a spec", lg_repo:"Repo — repositório de um único pacote", lg_monorepo:"Monorepo — repo dividido em pacotes", lg_module:"Pacote — unidade de trabalho dentro de um monorepo", lg_group:"Grupo — pacotes contratados juntos", lg_specialist:"Especialista — persona dev/QA contratada", lg_relation:"Relação — dependência entre unidades",
    pipe_sub:"{a} jornadas · {b} dispatches", filter:"Filtrar",
    work_sub:"{h} contratados · {a} ativos · {i} disponíveis", all:"Todos", dispatch:"+ Despachar",
    cv_competences:"Competências", cv_delivered:"entregues", cv_inprog:"em andamento", cv_total:"dispatches",
    f_repo:"repo", f_monorepo:"monorepo", f_package:"pacote", f_type:"tipo", f_worktree:"worktree",
    tb_sub:"Frameworks e servidores MCP que o time pode usar", skillpkgs:"Pacotes de skill", mcps:"Servidores MCP",
    act_sub:"Cada mudança de estado, ao vivo", streaming:"transmitindo",
    conn_wait:"conectando", conn_down:"offline",
    d_status:"status", d_journey:"jornada", d_stage:"etapa", d_pr:"pull request", d_branch:"branch",
    files:"Arquivos em andamento", relations:"Relações da unidade", openspec:"Abrir spec de orientação", worktree:"Worktree", none:"nenhuma",
    cmd_ph:"Ir para um especialista, repo, pacote… ou rodar um comando", g_views:"Telas", g_actions:"Ações", g_workers:"Especialistas", nomatch:"Sem resultados",
    c_goto:"Ir para", c_writespec:"Escrever spec de orientação", c_theme:"Alternar tema",
    st_active:"ativo", st_idle:"ocioso", st_available:"disponível", st_delivered:"entregue", st_verified:"verificado", st_failed:"QA reprovou", st_escalated:"escalado", st_merged:"integrado", st_dispatched:"despachado", st_removed:"removido",
    nav_settings:"Configurações", set_notif:"Notificações", set_notif_sub:"Seja avisado quando o trabalho avança ou precisa de você.",
    set_enable:"Ativar notificações", set_enable_sub:"Chave geral para alertas sonoros e no desktop.",
    set_desktop:"Notificações no desktop", set_desktop_sub:"Toasts do Chrome/Windows — aparecem mesmo com o navegador fora de foco.",
    set_grant:"Conceder permissão", set_granted:"Permissão concedida", set_denied:"Bloqueado — libere nas configurações do site no navegador.",
    set_sound:"Alertas sonoros", set_sound_sub:"Um som curto a cada notificação.",
    set_events:"Avisar sobre", ev_dispatch:"Novo dispatch", ev_delivered:"Entregue · PR aberto", ev_escalated:"Escalação — precisa de você", ev_merged:"Integrado",
    set_test:"Enviar notificação de teste", set_appearance:"Aparência", set_theme:"Tema", set_lang:"Idioma",
    th_auto:"Automático", th_light:"Claro", th_dark:"Escuro",
    rel_now:"agora",
  },
};

const stored = (typeof localStorage !== "undefined" && localStorage.getItem("aipe-lang")) as Lang | null;
export const lang: Signal<Lang> = signal(stored === "pt" || stored === "en" ? stored : "en");

export function t(k: string): string {
  return STR[lang.value]?.[k] ?? STR.en[k] ?? k;
}
export function stt(st: string): string {
  return t("st_" + st) || st;
}
export function setLang(l: Lang): void {
  lang.value = l;
  try { localStorage.setItem("aipe-lang", l); } catch {}
}
export function interpolate(str: string, vars: Record<string, string | number>): string {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
