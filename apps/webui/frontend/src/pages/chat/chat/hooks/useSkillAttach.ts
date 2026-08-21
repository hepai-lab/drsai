import * as React from "react";
import { message } from "antd";
import { fetchHigrafGroupSkills, skillsAPI } from "@/components/views/api";
import type { SkillsPublicItem } from "@/components/views/api/skills";
import type { HepaiSkillPickRow } from "../types";

const PUBLIC_SKILLS_TOKEN =
  "sk-oXCqlvdsZXQMnMpSjZGrVqpoIQETdhOrZYVngTBkVkTulha";

function mapPublicSkillsToRows(rows: SkillsPublicItem[]): HepaiSkillPickRow[] {
  return rows.map((r) => ({
    id: r.slug,
    filename: r.name,
    source: r.source || "public",
  }));
}

function mapHigrafSkillsToRows(
  rows: Array<{ slug: string; name: string }>
): HepaiSkillPickRow[] {
  return rows.map((r) => ({
    id: r.slug,
    filename: r.name,
    source: "higraf",
  }));
}

interface UseSkillAttachOptions {
  isInputDisabled: boolean;
}

export function useSkillAttach({ isInputDisabled }: UseSkillAttachOptions) {
  const [skillModalOpen, setSkillModalOpen] = React.useState(false);
  const [skillModalLoading, setSkillModalLoading] = React.useState(false);
  const [skillModalRows, setSkillModalRows] = React.useState<HepaiSkillPickRow[]>([]);
  const [skillModalSearch, setSkillModalSearch] = React.useState("");
  const [skillModalTagFilter, setSkillModalTagFilter] = React.useState<string | null>(
    null
  );
  const [skillModalSelectedIds, setSkillModalSelectedIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const [attachedSkills, setAttachedSkills] = React.useState<HepaiSkillPickRow[]>([]);

  const filteredSkillModalRows = React.useMemo(() => {
    const q = skillModalSearch.trim().toLowerCase();
    if (!q) return skillModalRows;
    return skillModalRows.filter((r) => r.filename.toLowerCase().includes(q));
  }, [skillModalRows, skillModalSearch]);

  const loadPublicSkills = React.useCallback(() => {
    return skillsAPI
      .listPublicSkills(PUBLIC_SKILLS_TOKEN)
      .then((rows) => {
        setSkillModalRows(mapPublicSkillsToRows(rows));
      })
      .catch((e) => {
        message.error(e instanceof Error ? e.message : String(e));
        setSkillModalRows([]);
      });
  }, []);

  const openSkillAttachModal = () => {
    if (isInputDisabled) return;

    setSkillModalOpen(true);
    setSkillModalSearch("");
    setSkillModalTagFilter(null);
    setSkillModalLoading(true);
    void loadPublicSkills()
      .then(() => {
        setSkillModalSelectedIds(new Set(attachedSkills.map((s) => s.id)));
      })
      .finally(() => {
        setSkillModalLoading(false);
      });
  };

  const confirmSkillPicker = () => {
    const next = skillModalRows.filter((r) => skillModalSelectedIds.has(r.id));
    setAttachedSkills(next);
    setSkillModalOpen(false);
  };

  const removeAttachedSkill = (id: string) => {
    setAttachedSkills((prev) => prev.filter((s) => s.id !== id));
  };

  const clearAttachedSkills = () => {
    setAttachedSkills([]);
  };

  const handleSkillModalTagFilter = (tag: string) => {
    // 点击"全部"或当前已选中标签再次点击 → 清除筛选，显示公共技能
    if (!tag || skillModalTagFilter === tag) {
      setSkillModalTagFilter(null);
      setSkillModalLoading(true);
      void loadPublicSkills().finally(() => {
        setSkillModalLoading(false);
      });
      return;
    }
    // 点击新标签 → 加载对应组的技能
    setSkillModalTagFilter(tag);
    setSkillModalLoading(true);
    void fetchHigrafGroupSkills(tag)
      .then((items) => {
        setSkillModalRows(mapHigrafSkillsToRows(items));
      })
      .catch((e) => {
        message.error(e instanceof Error ? e.message : String(e));
        setSkillModalRows([]);
      })
      .finally(() => {
        setSkillModalLoading(false);
      });
  };

  return {
    skillModalOpen,
    setSkillModalOpen,
    skillModalLoading,
    skillModalRows,
    skillModalSearch,
    setSkillModalSearch,
    skillModalTagFilter,
    skillModalSelectedIds,
    setSkillModalSelectedIds,
    attachedSkills,
    filteredSkillModalRows,
    openSkillAttachModal,
    confirmSkillPicker,
    removeAttachedSkill,
    clearAttachedSkills,
    handleSkillModalTagFilter,
  };
}
