import type { ProjectSection } from "./types";

// Ordem padrao da pagina do projeto: Kanban completo em cima, fluxos e checklists embaixo.
export const PROJECT_SECTIONS: ProjectSection[] = ["kanbans", "fluxos", "checklists"];

export const PROJECT_SECTION_LABEL: Record<ProjectSection, string> = {
  kanbans: "Kanbans",
  fluxos: "Fluxos",
  checklists: "Checklists",
};

/** As 3 secoes, cada uma uma vez (mesma regra do check projects_section_order_check). */
export function isSectionOrder(order: readonly string[]): order is ProjectSection[] {
  return (
    order.length === PROJECT_SECTIONS.length && PROJECT_SECTIONS.every((s) => order.includes(s))
  );
}

/** Ordem salva no projeto; qualquer coisa inesperada volta pra ordem padrao. */
export function sectionOrderOf(saved: readonly string[] | null | undefined): ProjectSection[] {
  return saved && isSectionOrder(saved) ? [...saved] : [...PROJECT_SECTIONS];
}
