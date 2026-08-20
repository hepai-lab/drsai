import * as React from "react";
import { message } from "antd";
import { getServerUrl } from "../../../../components/utils";
import { fetchHigrafGroupSkills, skillsAPI } from "@/components/views/api";
import type { HepaiSkillPickRow } from "../types";

const PUBLIC_SKILLS_TOKEN =
  "sk-oXCqlvdsZXQMnMpSjZGrVqpoIQETdhOrZYVngTBkVkTulha";

function mapPublicSkillsToRows(
  rows: Array<{ slug: string; name: string }>
): HepaiSkillPickRow[] {
  const baseUrl = getServerUrl();
  return rows.map((r) => ({
    id: r.slug,
    filename: r.name,
    url: `${baseUrl}/skills/${encodeURIComponent(r.slug)}/download?type=public`,
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
    if (skillModalTagFilter === tag) {
      setSkillModalTagFilter(null);
      void loadPublicSkills().finally(() => {
        setSkillModalLoading(false);
      });
      return;
    }
    setSkillModalTagFilter(tag);
    setSkillModalLoading(true);
    void fetchHigrafGroupSkills(tag)
      .then((items) => {
        setSkillModalRows(mapPublicSkillsToRows(items));
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
