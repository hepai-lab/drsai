import { message, Modal } from "antd";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACADEMIC_GROUP_TAGS,
  fetchHigrafGroupSkills,
  skillTagAPI,
  skillsAPI,
  userAPI,
  type SkillTagItem,
  type SkillsPublicDetail,
  type SkillsPublicItem,
  type SkillsUserItem,
} from "../../components/views/api";
import { appContext } from "../../hooks/provider";
import { useLocation, useNavigate } from "../../hooks/useRouter";
import { useLang } from "../../i18n/useLang";
import { useConfigStore } from "../../hooks/store";
import { getModelApiKeyFromSettings } from "../../utils/modelApiKey";
import { HEPAI_MAX_ZIP_BYTES, PUBLIC_PAGE_SIZE } from "./constants";
import { Globe, LayoutGrid, Download, Heart } from "lucide-react";
import { type StatsCardItem } from "./StatsCards";
import { renderSkillIcon } from "./icons";
import {
  listFolderFileEntries,
  listZipFileEntries,
  sanitizeChangelog,
  splitArchiveName,
  zipFolderFileListToZipFile,
  type PackPreviewEntry,
} from "./utils";

type FileWithRelativePath = File & { webkitRelativePath?: string };

export function useSkillsSquarePage(skillsSubTab?: string) {
  const { user } = React.useContext(appContext);
  const { t, lang } = useLang();
  const isZh = lang === "zh";
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);

  const urlTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    return tab === "private" ? "private" : "public";
  }, [location.search]);
  const [activeTab, setActiveTab] = useState<"private" | "public">(urlTab);
  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  // 从左侧菜单子页签控制状态
  useEffect(() => {
    if (!skillsSubTab) return;
    switch (skillsSubTab) {
      case "skills_public":
        setActiveTab("public");
        setSkillUploadOpen(false);
        break;
      case "skills_my_creations":
        setActiveTab("private");
        setPrivateFilter("created");
        setSkillUploadOpen(false);
        break;
      case "skills_my_collections":
        setActiveTab("private");
        setPrivateFilter("collected");
        setSkillUploadOpen(false);
        break;
      case "skills_my_skills":
        setActiveTab("private");
        setPrivateFilter("created");
        setSkillUploadOpen(false);
        break;
      case "skills_publish":
        setSkillUploadOpen(true);
        break;
    }
  }, [skillsSubTab]);

  const [activeCategory, setActiveCategory] = useState("");
  const skillSlugFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("skill") || "";
  }, [location.search]);
  const [skillDetail, setSkillDetail] = useState<SkillsPublicDetail | null>(
    null,
  );
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);

  // Sync breadcrumbs in top bar when viewing a skill
  const setBreadcrumbs = useConfigStore((s) => s.setBreadcrumbs);
  useEffect(() => {
    if (skillDetail && skillSlugFromUrl) {
      setBreadcrumbs([
        { name: skillDetail.name, current: true },
      ]);
    } else {
      setBreadcrumbs([]);
    }
  }, [skillDetail, skillSlugFromUrl, setBreadcrumbs]);

  const [publicRows, setPublicRows] = useState<SkillsPublicItem[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicLoadingMore, setPublicLoadingMore] = useState(false);
  const [publicHasNext, setPublicHasNext] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const publicScrollRef = useRef<HTMLDivElement>(null);
  const publicSentinelRef = useRef<HTMLDivElement>(null);
  const publicFetchGenRef = useRef(0);
  const publicHasNextRef = useRef(false);
  const publicLoadingMoreRef = useRef(false);
  const publicPageRef = useRef(1);
  const [publicApiKey, setPublicApiKey] = useState("");
  const [publicApiKeyLoading, setPublicApiKeyLoading] = useState(true);
  const publicApiKeyRef = useRef(publicApiKey);
  publicApiKeyRef.current = publicApiKey;

  useEffect(() => {
    if (!user?.email) {
      setPublicApiKeyLoading(false);
      return;
    }
    let cancelled = false;
    setPublicApiKeyLoading(true);
    getModelApiKeyFromSettings(user.email)
      .then((key) => {
        if (!cancelled) {
          setPublicApiKey(key || "");
          setPublicApiKeyLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setPublicApiKeyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const [skillUploadOpen, setSkillUploadOpen] = useState(false);
  const [skillUploading, setSkillUploading] = useState(false);
  const [isPublicSkill, setIsPublicSkill] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const hepaiZipInputRef = useRef<HTMLInputElement | null>(null);
  const hepaiFolderInputRef = useRef<HTMLInputElement | null>(null);
  const setFolderInputRef = useCallback((el: HTMLInputElement | null) => {
    hepaiFolderInputRef.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      try {
        el.setAttribute("mozdirectory", "");
      } catch {
        /* ignore */
      }
      el.multiple = true;
    }
  }, []);
  const [hepaiPackingFolder, setHepaiPackingFolder] = useState(false);
  const [hepaiZipFile, setHepaiZipFile] = useState<File | null>(null);
  const [packPreviewEntries, setPackPreviewEntries] = useState<PackPreviewEntry[]>([]);
  const [publishSlug, setPublishSlug] = useState("");
  const [publishDisplayName, setPublishDisplayName] = useState("");
  const [publishIcon, setPublishIcon] = useState<string>("");
  const [publishVersion, setPublishVersion] = useState("1.0.0");
  const [publishChangelog, setPublishChangelog] = useState("");
  const [publishTags, setPublishTags] = useState<string[]>([]);
  const [publicProfileFile, setPublicProfileFile] = useState<File | null>(null);
  const publicProfileInputRef = useRef<HTMLInputElement | null>(null);
  const [publicProfilePreview, setPublicProfilePreview] = useState<
    string | null
  >(null);
  const [hepaiRows, setHepaiRows] = useState<SkillsUserItem[]>([]);
  const [hepaiLoading, setHepaiLoading] = useState(false);
  const [privateFilter, setPrivateFilter] = useState<"created" | "collected">(
    "created",
  );
  const [importingSlug, setImportingSlug] = useState<string | null>(null);
  const [hepaiRefreshKey, setHepaiRefreshKey] = useState(0);

  const [shareSkillSlug, setShareSkillSlug] = useState<string | null>(null);
  const [shareSkillName, setShareSkillName] = useState<string>("");
  const [sortBy, setSortBy] = useState<"name" | "time" | "downloads" | "collects">("time");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagRows, setTagRows] = useState<SkillTagItem[]>([]);
  const [tagLoading, setTagLoading] = useState(false);
  const [editingTag, setEditingTag] = useState<SkillTagItem | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagOrder, setEditTagOrder] = useState(0);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    if (sortOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  const collectedSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const r of hepaiRows) {
      if (r.uskills_type === "imported" && r.slug) slugs.add(r.slug);
    }
    return slugs;
  }, [hepaiRows]);

  const hepaiPickPreview = useMemo(
    () =>
      hepaiZipFile
        ? { name: hepaiZipFile.name, size: hepaiZipFile.size }
        : null,
    [hepaiZipFile],
  );

  const filteredHepaiRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sourceFiltered = hepaiRows.filter((r) =>
      privateFilter === "collected"
        ? r.uskills_type === "imported"
        : r.uskills_type !== "imported",
    );
    const tagFiltered = activeCategory
      ? sourceFiltered.filter((r) =>
          (r.tags || []).includes(activeCategory),
        )
      : sourceFiltered;
    const searchFiltered = !q
      ? tagFiltered
      : tagFiltered.filter((r) => {
          const desc = (r.description ?? "").toLowerCase();
          const by = (r.owner ?? "").toLowerCase();
          const title = (r.name ?? "").toLowerCase();
          return (
            title.includes(q) ||
            desc.includes(q) ||
            (by.length > 0 && by.includes(q))
          );
        });
    return [...searchFiltered].sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      return (
        new Date(b.updated_at || 0).getTime() -
        new Date(a.updated_at || 0).getTime()
      );
    });
  }, [hepaiRows, search, privateFilter, activeCategory, sortBy]);

  const availableCategories = useMemo(
    () =>
      [...tagRows]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((row) => row.name),
    [tagRows],
  );

  const statsItems: StatsCardItem[] = useMemo(() => {
    const totalPublic = publicRows.length;
    const totalPrivate = hepaiRows.length;
    const totalDownloads = publicRows.reduce((sum, r) => sum + (r.downloads || 0), 0);
    const totalCollects = publicRows.reduce((sum, r) => sum + (r.collects || 0), 0);
    return [
      {
        title: t("skillSquare.statsTotalSkills") || "技能总数",
        value: totalPublic + totalPrivate,
        change: 0,
        changeLabel: "较上月",
        icon: LayoutGrid,
      },
      {
        title: t("skillSquare.statsPublicSkills") || "公开技能",
        value: totalPublic,
        change: 0,
        changeLabel: "较上月",
        icon: Globe,
      },
      {
        title: t("skillSquare.statsTotalDownloads") || "总下载量",
        value: totalDownloads,
        change: 0,
        changeLabel: "较上月",
        icon: Download,
      },
      {
        title: t("skillSquare.statsTotalCollects") || "总收藏量",
        value: totalCollects,
        change: 0,
        changeLabel: "较上月",
        icon: Heart,
      },
    ];
  }, [publicRows.length, hepaiRows.length, t]);

  const resetPublishForm = () => {
    setHepaiZipFile(null);
    setPackPreviewEntries([]);
    setPublishSlug("");
    setPublishDisplayName("");
    setPublishIcon("");
    setPublishVersion("1.0.0");
    setPublishChangelog("");
    setPublishTags([]);
    setPublicProfileFile(null);
    setPublicProfilePreview(null);
    setIsPublicSkill(false);
    setEditingSkillId(null);
    if (hepaiZipInputRef.current) hepaiZipInputRef.current.value = "";
    if (hepaiFolderInputRef.current) hepaiFolderInputRef.current.value = "";
    if (publicProfileInputRef.current) publicProfileInputRef.current.value = "";
  };

  const syncPickFromFile = (f: File | null, entries?: PackPreviewEntry[]) => {
    if (f && f.size > HEPAI_MAX_ZIP_BYTES) {
      message.warning(t("skillSquare.zipTooLargeToast"));
      return;
    }
    setHepaiZipFile(f);
    if (entries) {
      setPackPreviewEntries(entries);
    } else if (f) {
      setPackPreviewEntries([]);
      void listZipFileEntries(f)
        .then(setPackPreviewEntries)
        .catch(() => setPackPreviewEntries([]));
    } else {
      setPackPreviewEntries([]);
    }
    if (f?.name) {
      const stem = splitArchiveName(f.name).stem;
      setPublishDisplayName((prev) => (prev.trim() ? prev : stem));
    }
  };

  const handleFolderInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const list = e.target.files;
    if (!list?.length) return;
    const first = list[0] as FileWithRelativePath;
    if (!first.webkitRelativePath) {
      message.error(t("skillSquare.zipPickError"));
      e.target.value = "";
      return;
    }
    setHepaiPackingFolder(true);
    try {
      const zipFile = await zipFolderFileListToZipFile(list);
      syncPickFromFile(zipFile, listFolderFileEntries(list));
      message.success(t("skillSquare.zipPacked"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setHepaiPackingFolder(false);
      e.target.value = "";
    }
  };

  useEffect(() => {
    if (activeTab !== "private") return;
    const userId = user?.email || "";
    if (!userId) {
      setHepaiLoading(false);
      return;
    }
    if (publicApiKeyLoading) return;
    let cancelled = false;
    setHepaiLoading(true);
    (async () => {
      try {
        const rows = await skillsAPI.listUserSkills(
          userId,
          publicApiKey || undefined,
        );
        if (cancelled) return;
        setHepaiRows(rows);
      } catch (e) {
        console.error("[list] listUserSkills failed", e);
      } finally {
        if (!cancelled) setHepaiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    user?.email,
    hepaiRefreshKey,
    publicApiKeyLoading,
    publicApiKey,
  ]);

  useEffect(() => {
    const uid = user?.email;
    if (!uid) return;
    let cancelled = false;
    userAPI
      .getAccess(uid)
      .then((a) => {
        if (!cancelled) setIsPlatformAdmin(Boolean(a?.is_platform_admin));
      })
      .catch(() => {
        /* not admin */
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  useEffect(() => {
    const uid = user?.email;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await skillTagAPI.listTags(uid);
        if (!cancelled) setTagRows(rows);
      } catch {
        /* tags not available yet or not admin */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const loadTags = useCallback(async () => {
    const uid = user?.email;
    if (!uid) return;
    setTagLoading(true);
    try {
      const rows = await skillTagAPI.listTags(uid);
      setTagRows(rows);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "加载标签失败");
    } finally {
      setTagLoading(false);
    }
  }, [user?.email]);

  const openTagEditor = useCallback((tag: SkillTagItem | null) => {
    setEditingTag(tag);
    setEditTagName(tag?.name || "");
    setEditTagOrder(tag?.sort_order ?? 0);
  }, []);

  const saveTag = useCallback(async () => {
    const uid = user?.email;
    if (!uid) return;
    const name = editTagName.trim();
    if (!name) {
      message.warning("标签名不能为空");
      return;
    }
    try {
      if (editingTag) {
        await skillTagAPI.updateTag(uid, editingTag.id, {
          name,
          sort_order: editTagOrder,
        });
      } else {
        await skillTagAPI.createTag(uid, name, editTagOrder);
      }
      openTagEditor(null);
      await loadTags();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "保存标签失败");
    }
  }, [
    user?.email,
    editTagName,
    editTagOrder,
    editingTag,
    loadTags,
    openTagEditor,
  ]);

  const deleteTag = useCallback(
    async (tagId: number) => {
      const uid = user?.email;
      if (!uid) return;
      try {
        await skillTagAPI.deleteTag(uid, tagId);
        await loadTags();
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : "删除标签失败");
      }
    },
    [user?.email, loadTags],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadPublicFirstPage = useCallback(async () => {
    const gen = ++publicFetchGenRef.current;
    setPublicLoading(true);
    setPublicLoadingMore(false);
    publicLoadingMoreRef.current = false;
    setPublicRows([]);
    publicPageRef.current = 1;
    setPublicHasNext(false);
    publicHasNextRef.current = false;

    // Branch: if the selected category is an academic group, fetch from Higraf proxy
    if (activeCategory && ACADEMIC_GROUP_TAGS.has(activeCategory.toLowerCase())) {
      try {
        const items = await fetchHigrafGroupSkills(activeCategory);
        if (gen !== publicFetchGenRef.current) return;
        setPublicRows(items);
        setPublicHasNext(false);
        publicHasNextRef.current = false;
      } catch {
        if (gen !== publicFetchGenRef.current) return;
        setPublicRows([]);
      } finally {
        if (gen === publicFetchGenRef.current) setPublicLoading(false);
      }
      return;
    }

    try {
      const result = await skillsAPI.listPublicSkillsPage(
        1,
        PUBLIC_PAGE_SIZE,
        publicApiKeyRef.current || undefined,
        { q: debouncedSearch, tags: activeCategory, sort: sortBy },
      );
      if (gen !== publicFetchGenRef.current) return;
      setPublicRows(result.data);
      const hasNext = Boolean(result.pagination?.has_next);
      setPublicHasNext(hasNext);
      publicHasNextRef.current = hasNext;
    } catch {
      if (gen !== publicFetchGenRef.current) return;
      setPublicRows([]);
    } finally {
      if (gen === publicFetchGenRef.current) setPublicLoading(false);
    }
  }, [debouncedSearch, activeCategory, sortBy]);

  const loadPublicNextPage = useCallback(async () => {
    if (publicLoadingMoreRef.current || !publicHasNextRef.current) return;
    publicLoadingMoreRef.current = true;
    setPublicLoadingMore(true);
    const gen = publicFetchGenRef.current;
    const nextPage = publicPageRef.current + 1;
    try {
      const result = await skillsAPI.listPublicSkillsPage(
        nextPage,
        PUBLIC_PAGE_SIZE,
        publicApiKeyRef.current || undefined,
        { q: debouncedSearch, tags: activeCategory, sort: sortBy },
      );
      if (gen !== publicFetchGenRef.current) return;
      setPublicRows((prev) => {
        const seen = new Set(prev.map((r) => r.slug));
        const extra = result.data.filter((r) => r.slug && !seen.has(r.slug));
        return extra.length ? [...prev, ...extra] : prev;
      });
      publicPageRef.current = nextPage;
      const hasNext = Boolean(result.pagination?.has_next);
      setPublicHasNext(hasNext);
      publicHasNextRef.current = hasNext;
    } catch {
      /* keep hasNext so scrolling can retry */
    } finally {
      if (gen === publicFetchGenRef.current) {
        publicLoadingMoreRef.current = false;
        setPublicLoadingMore(false);
      }
    }
  }, [debouncedSearch, activeCategory, sortBy]);

  useEffect(() => {
    if (activeTab !== "public") return;
    if (publicApiKeyLoading) return;
    void loadPublicFirstPage();
  }, [activeTab, publicApiKeyLoading, loadPublicFirstPage]);

  useEffect(() => {
    if (
      activeTab !== "public" ||
      publicLoading ||
      skillUploadOpen ||
      skillSlugFromUrl
    )
      return;
    const sentinel = publicSentinelRef.current;
    const root = publicScrollRef.current;
    if (!sentinel || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadPublicNextPage();
      },
      { root, rootMargin: "160px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [
    activeTab,
    publicLoading,
    publicHasNext,
    publicRows.length,
    skillUploadOpen,
    skillSlugFromUrl,
    loadPublicNextPage,
  ]);

  const hepaiRowsRef = useRef(hepaiRows);
  hepaiRowsRef.current = hepaiRows;
  useEffect(() => {
    if (!skillSlugFromUrl) {
      setSkillDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSkillDetailLoading(true);
      const row =
        privateFilter === "collected"
          ? hepaiRowsRef.current.find(
              (r) => r.slug === skillSlugFromUrl && r.uskills_type === "imported",
            ) || hepaiRowsRef.current.find((r) => r.slug === skillSlugFromUrl)
          : hepaiRowsRef.current.find(
              (r) => r.slug === skillSlugFromUrl && r.uskills_type === "created",
            ) || hepaiRowsRef.current.find((r) => r.slug === skillSlugFromUrl);
      const userId = user?.email || "";

      try {
        if (activeTab === "private" && row && userId) {
          try {
            const md = await skillsAPI.getUserSkillMd(
              skillSlugFromUrl,
              userId,
              publicApiKey || undefined,
            );
            const pub = publicRows.find((r) => r.slug === skillSlugFromUrl);
            const imported = row.uskills_type === "imported";
            if (!cancelled) {
              setSkillDetail({
                slug: skillSlugFromUrl,
                name: row.name || pub?.name || skillSlugFromUrl,
                description: row.description || pub?.description || "",
                icon:
                  (imported && (!row.icon || row.icon === "package")
                    ? pub?.icon || row.icon
                    : row.icon) || "package",
                version: row.version || pub?.version || "0.0.0",
                owner: imported
                  ? pub?.owner || row.owner || ""
                  : row.owner || "",
                body: md.content,
                changelog: sanitizeChangelog(row.changelog),
                profile: row.profile || pub?.profile || "",
                created_at: row.created_at
                  ? new Date(row.created_at).toISOString()
                  : new Date().toISOString(),
                updated_at: row.updated_at
                  ? new Date(row.updated_at).toISOString()
                  : new Date().toISOString(),
                downloads: row.downloads ?? pub?.downloads ?? 0,
                can_edit: !imported,
                tags: row.tags || pub?.tags,
              });
            }
            return;
          } catch {
            // User ZIP missing — fall back to public catalog body.
          }
        }

        const detail = await skillsAPI.getPublicSkill(
          skillSlugFromUrl,
          publicApiKey || undefined,
        );
        if (cancelled) return;
        if (activeTab === "private" && row) {
          setSkillDetail({
            ...detail,
            name: row.name || detail.name,
            description: row.description || detail.description,
            icon: row.icon || detail.icon,
            version: row.version || detail.version,
            owner:
              row.uskills_type === "imported"
                ? detail.owner || row.owner
                : row.owner || detail.owner,
            changelog: sanitizeChangelog(row.changelog) || detail.changelog,
            profile: row.profile || detail.profile,
            created_at: row.created_at
              ? new Date(row.created_at).toISOString()
              : detail.created_at,
            updated_at: row.updated_at
              ? new Date(row.updated_at).toISOString()
              : detail.updated_at,
            downloads: row.downloads ?? detail.downloads,
            can_edit: row.uskills_type !== "imported",
          });
        } else {
          setSkillDetail(detail);
        }
      } catch {
        if (!cancelled) setSkillDetail(null);
      } finally {
        if (!cancelled) setSkillDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    skillSlugFromUrl,
    publicApiKey,
    user?.email,
    hepaiRows,
    activeTab,
    privateFilter,
    publicRows,
  ]);

  const openSkillDetail = useCallback(
    (slug: string) => {
      const params = new URLSearchParams(location.search);
      params.set("skill", slug);
      navigate(`?${params.toString()}`, { replace: false });
    },
    [location.search, navigate],
  );

  const closeSkillDetail = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete("skill");
    navigate(`?${params.toString()}`, { replace: false });
  }, [location.search, navigate]);

  const switchTab = useCallback(
    (tab: "public" | "private") => {
      setActiveTab(tab);
      setSearch("");
      setSearchExpanded(false);
      setActiveCategory("");
      setSkillUploadOpen(false);
      const params = new URLSearchParams(location.search);
      params.set("tab", tab);
      params.delete("skill");
      navigate(`?${params.toString()}`, { replace: true });
    },
    [location.search, navigate],
  );

  const openSkillPublishModal = (
    prefill?: SkillsUserItem | SkillsPublicDetail,
    isPublic?: boolean,
  ) => {
    resetPublishForm();
    if (!prefill) {
      if (isPublic !== undefined) setIsPublicSkill(isPublic);
      setSkillUploadOpen(true);
      return;
    }
    const resolvedPublic =
      isPublic !== undefined ? isPublic : "body" in prefill;
    setIsPublicSkill(resolvedPublic);
    setEditingSkillId(prefill.slug);
    setPublishDisplayName(prefill.name || "");
    setPublishIcon(prefill.icon || "");
    setPublishVersion(prefill.version || "1.0.0");
    setPublishChangelog(sanitizeChangelog(prefill.changelog));
    setPublishTags(
      prefill.tags
        ? prefill.tags
        : [],
    );
    if (resolvedPublic) {
      if (prefill.profile) setPublicProfilePreview(prefill.profile);
    } else {
      setPublishSlug(prefill.slug || "");
    }
    setSkillUploadOpen(true);
  };

  const submitSkillUpload = async () => {
    const isEdit = !!editingSkillId;
    const file = hepaiZipFile;
    if (!isEdit && !file) {
      message.warning(t("skillSquare.selectZipPack"));
      return;
    }
    if (file) {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        message.warning(t("skillSquare.zipFormatError"));
        return;
      }
      if (file.size > HEPAI_MAX_ZIP_BYTES) {
        message.warning(t("skillSquare.zipFileTooLarge"));
        return;
      }
    }
    const dn = publishDisplayName.trim();
    if (!dn) {
      message.warning(t("skillSquare.publishNameRequired"));
      return;
    }
    if (
      publishIcon === "__profile__" &&
      !publicProfileFile &&
      !publicProfilePreview
    ) {
      message.warning(t("skillSquare.selectCover"));
      return;
    }
    const version = publishVersion.trim();
    if (!version) {
      message.warning(t("skillSquare.versionRequired"));
      return;
    }
    if (isPublicSkill && !publicApiKey.trim()) {
      message.warning(t("skillSquare.noApiKey"));
      return;
    }
    if (!isPublicSkill) {
      const userId = user?.email || "";
      if (!userId) {
        message.error(t("skillSquare.notLoggedIn"));
        return;
      }
      const slugTrim = publishSlug.trim();
      if (
        slugTrim &&
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugTrim.toLowerCase())
      ) {
        message.warning(t("skillSquare.publishSlugHint"));
        return;
      }
    }

    setSkillUploading(true);
    try {
      if (isPublicSkill) {
        if (isEdit) {
          await skillsAPI.updatePublicSkill(
            editingSkillId!,
            publicApiKey.trim(),
            {
              file: file || undefined,
              name: dn || undefined,
              icon: publishIcon.trim() || undefined,
              version: publishVersion.trim() || undefined,
              changelog: publishChangelog.trim() || undefined,
              profile: publicProfileFile || undefined,
              tags:
                publishTags.length > 0
                  ? publishTags.join(", ")
                  : undefined,
            },
          );
          if (skillSlugFromUrl === editingSkillId) {
            const detail = await skillsAPI.getPublicSkill(
              editingSkillId!,
              publicApiKey.trim(),
            );
            setSkillDetail(detail);
          }
        } else {
          await skillsAPI.uploadPublicSkill(
            file!,
            publishSlug.trim() || undefined,
            publicApiKey.trim(),
            {
              display_name: dn || undefined,
              icon: publishIcon.trim() || undefined,
              version: publishVersion.trim() || undefined,
              changelog: publishChangelog.trim() || undefined,
              profile: publicProfileFile || undefined,
              tags:
                publishTags.length > 0
                  ? publishTags.join(", ")
                  : undefined,
            },
          );
        }
        await loadPublicFirstPage();
        setHepaiRefreshKey((k) => k + 1);
        setActiveTab("public");
      } else {
        const userId = user?.email || "";
        if (isEdit) {
          await skillsAPI.updateUserSkill(
            editingSkillId!,
            userId,
            {
              file: file ?? undefined,
              display_name: dn,
              icon: publishIcon.trim() || undefined,
              version: publishVersion.trim() || "1.0.0",
              changelog: publishChangelog.trim() || undefined,
              profile: publicProfileFile || undefined,
              tags:
                publishTags.length > 0
                  ? publishTags.join(", ")
                  : undefined,
            },
            publicApiKey || undefined,
          );
        } else {
          await skillsAPI.uploadUserSkill(
            userId,
            file!,
            {
              slug: publishSlug.trim() || undefined,
              display_name: dn,
              icon: publishIcon.trim() || undefined,
              version: publishVersion.trim() || "1.0.0",
              changelog: publishChangelog.trim() || undefined,
              source: "created",
              profile: publicProfileFile || undefined,
              tags:
                publishTags.length > 0
                  ? publishTags.join(", ")
                  : undefined,
            },
            publicApiKey || undefined,
          );
        }
        const rows = await skillsAPI.listUserSkills(
          userId,
          publicApiKey || undefined,
        );
        setHepaiRows(rows);
      }
      message.success(
        isEdit
          ? t("skillSquare.skillUpdated")
          : isPublicSkill
            ? t("skillSquare.publicPublished")
            : t("skillSquare.publishSuccess"),
      );
      setSkillUploadOpen(false);
      resetPublishForm();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSkillUploading(false);
    }
  };

  const importPublicSkill = async (slug: string, displayName: string) => {
    if (collectedSlugs.has(slug)) {
      message.info(t("skillSquare.alreadyCollected"));
      return;
    }
    const userId = user?.email || "";
    if (!userId) {
      message.error(t("skillSquare.notLoggedInShort"));
      return;
    }
    setImportingSlug(slug);
    try {
      const src =
        (skillDetail?.slug === slug ? skillDetail : null) ||
        publicRows.find((r) => r.slug === slug);
      message.loading({ content: t("skillSquare.collecting"), key: "import" });
      await skillsAPI.importPublicSkill(
        slug,
        userId,
        {
          display_name: displayName,
          icon: src?.icon,
          description: src?.description,
          version: src?.version,
          tags: src?.tags?.join(", "),
          owner: src?.owner,
          origin: src?.source,
          changelog: src?.changelog,
        },
        publicApiKey || undefined,
      );
      message.success({ content: t("skillSquare.imported"), key: "import" });
      // Optimistic update: increment collects on the public skill
      setPublicRows((prev) =>
        prev.map((r) =>
          r.slug === slug ? { ...r, collects: (r.collects || 0) + 1 } : r,
        ),
      );
      setHepaiRows((prev) => {
        if (prev.some((r) => r.slug === slug && r.uskills_type === "imported"))
          return prev;
        return [
          ...prev,
          {
            slug,
            name: displayName,
            description: src?.description || "",
            icon: src?.icon || "package",
            version: src?.version || "0.0.0",
            owner: src?.owner || "",
            owner_id: src?.owner_id || "",
            source: "user",
            uskills_type: "imported",
            public: false,
            unlisted: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            download_url: "",
            profile: src?.profile || "",
            changelog: src?.changelog || "",
            downloads: src?.downloads ?? 0,
            collects: src?.collects ?? 0,
            tags: src?.tags,
          },
        ];
      });
      setHepaiRefreshKey((k) => k + 1);
    } catch (e) {
      message.error({
        content: e instanceof Error ? e.message : String(e),
        key: "import",
      });
    } finally {
      setImportingSlug(null);
    }
  };

  const downloadPublicSkill = async (slug: string) => {
    try {
      await skillsAPI.downloadPublicSkill(slug);
      message.success(t("skillSquare.downloadStartedToast"));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCreateShare = useCallback(
    async (
      slug: string,
      userId: string,
      password: string,
      expiresInHours: number,
    ) => {
      return skillsAPI.createSkillShare(slug, userId, password, expiresInHours);
    },
    [],
  );
  const handleRevokeShare = useCallback(
    async (slug: string, userId: string, shareId: string) => {
      await skillsAPI.revokeSkillShare(slug, userId, shareId);
    },
    [],
  );
  const handleListShares = useCallback(async (slug: string, userId: string) => {
    return skillsAPI.listSkillShares(slug, userId);
  }, []);

  const deleteUserSkill = async (slug: string, displayName: string) => {
    const userId = user?.email || "";
    if (!userId) {
      message.error(t("skillSquare.notLoggedInShort"));
      return;
    }
    Modal.confirm({
      title: t("skillSquare.deleteUserSkillTitle"),
      content: t("skillSquare.deleteUserSkillContent", displayName),
      okText: t("skillSquare.deleteOk"),
      okButtonProps: { danger: true },
      cancelText: t("skillSquare.deleteCancel"),
      onOk: async () => {
        try {
          await skillsAPI.deleteUserSkill(
            slug,
            userId,
            publicApiKey || undefined,
          );
          setHepaiRows((prev) => prev.filter((r) => r.slug !== slug));
          if (skillDetail?.slug === slug) closeSkillDetail();
          message.success(t("skillSquare.skillDeletedToast", displayName));
        } catch (e) {
          message.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const uncollectSkill = async (slug: string, displayName: string) => {
    const userId = user?.email || "";
    if (!userId) {
      message.error(t("skillSquare.notLoggedInShort"));
      return;
    }
    Modal.confirm({
      title: t("skillSquare.uncollectTitle"),
      content: t("skillSquare.uncollectContent", displayName),
      okText: t("skillSquare.uncollectOk"),
      okButtonProps: { danger: true },
      cancelText: t("skillSquare.deleteCancel"),
      onOk: async () => {
        try {
          await skillsAPI.deleteUserSkill(
            slug,
            userId,
            publicApiKey || undefined,
          );
          // Optimistic update: decrement collects on the public skill
          setPublicRows((prev) =>
            prev.map((r) =>
              r.slug === slug ? { ...r, collects: Math.max(0, (r.collects || 0) - 1) } : r,
            ),
          );
          setHepaiRows((prev) => prev.filter((r) => r.slug !== slug));
          if (skillDetail?.slug === slug) closeSkillDetail();
          message.success(t("skillSquare.uncollectedToast", displayName));
        } catch (e) {
          message.error(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const toggleSkillPublic = async (slug: string, makePublic: boolean) => {
    const userId = user?.email || "";
    if (!userId) return;
    try {
      await skillsAPI.toggleSkillVisibility(
        slug,
        userId,
        makePublic,
        publicApiKey || undefined,
      );
      setHepaiRows((prev) =>
        prev.map((r) =>
          r.slug === slug
            ? { ...r, public: makePublic, unlisted: !makePublic }
            : r,
        ),
      );
      message.success(
        makePublic
          ? t("skillSquare.published", slug)
          : t("skillSquare.hidden", slug),
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const detailPanelProps = useMemo(() => {
    if (!skillDetail) return null;
    const isOwner = !!(user?.email && skillDetail.owner_id === user.email);
    const isPublicTab = activeTab === "public";
    const row =
      hepaiRows.find(
        (r) => r.slug === skillDetail.slug && r.uskills_type === "created",
      ) || hepaiRows.find((r) => r.slug === skillDetail.slug);
    const source: "created" | "imported" | undefined =
      row?.uskills_type === "imported" ? "imported" : row ? "created" : undefined;
    const isCreated = source === "created";
    const canEdit = isCreated && !isPublicTab;
    return {
      skillDetail,
      loading: skillDetailLoading,
      onClose: closeSkillDetail,
      onDownload: downloadPublicSkill,
      renderSkillIcon,
      t,
      onEdit: canEdit
        ? () => openSkillPublishModal(skillDetail, false)
        : undefined,
      onTogglePublic: canEdit ? toggleSkillPublic : undefined,
      showToggleButton: canEdit ? row?.public === true : undefined,
      onShare:
        isCreated && !isPublicTab
          ? () => {
              setShareSkillSlug(skillDetail.slug);
              setShareSkillName(skillDetail.name);
            }
          : undefined,
      source,
      onDelete: isCreated && !isPublicTab ? deleteUserSkill : undefined,
      onUncollect:
        source === "imported" && !isPublicTab ? uncollectSkill : undefined,
      isCollected: isPublicTab
        ? collectedSlugs.has(skillDetail.slug)
        : undefined,
      isImporting: isPublicTab ? importingSlug === skillDetail.slug : false,
      onImport: isPublicTab && !isOwner ? importPublicSkill : undefined,
    };
  }, [
    activeTab,
    skillDetail,
    skillDetailLoading,
    user,
    hepaiRows,
    collectedSlugs,
    importingSlug,
    closeSkillDetail,
    downloadPublicSkill,
    renderSkillIcon,
    t,
    openSkillPublishModal,
    toggleSkillPublic,
    setShareSkillSlug,
    setShareSkillName,
    deleteUserSkill,
    uncollectSkill,
    importPublicSkill,
  ]);

  return {
    user,
    t,
    isZh,
    search,
    setSearch,
    searchExpanded,
    setSearchExpanded,
    activeTab,
    privateFilter,
    setPrivateFilter,
    activeCategory,
    setActiveCategory,
    skillSlugFromUrl,
    skillDetail,
    skillDetailLoading,
    publicRows,
    publicLoading,
    publicLoadingMore,
    publicHasNext,
    debouncedSearch,
    publicScrollRef,
    publicSentinelRef,
    skillUploadOpen,
    setSkillUploadOpen,
    skillUploading,
    isPublicSkill,
    setIsPublicSkill,
    editingSkillId,
    hepaiZipInputRef,
    hepaiFolderInputRef,
    setFolderInputRef,
    hepaiPackingFolder,
    publishSlug,
    setPublishSlug,
    publishDisplayName,
    setPublishDisplayName,
    publishIcon,
    setPublishIcon,
    publishVersion,
    setPublishVersion,
    publishChangelog,
    setPublishChangelog,
    publishTags,
    setPublishTags,
    publicProfileInputRef,
    publicProfilePreview,
    setPublicProfileFile,
    setPublicProfilePreview,
    hepaiRows,
    hepaiLoading,
    shareSkillSlug,
    setShareSkillSlug,
    shareSkillName,
    sortBy,
    setSortBy,
    sortOpen,
    setSortOpen,
    sortRef,
    tagModalOpen,
    setTagModalOpen,
    tagRows,
    tagLoading,
    editingTag,
    setEditingTag,
    editTagName,
    setEditTagName,
    editTagOrder,
    setEditTagOrder,
    isPlatformAdmin,
    collectedSlugs,
    hepaiPickPreview,
    packPreviewEntries,
    filteredHepaiRows,
    availableCategories,
    availableTags: availableCategories,
    statsItems,
    resetPublishForm,
    syncPickFromFile,
    handleFolderInputChange,
    loadTags,
    openTagEditor,
    saveTag,
    deleteTag,
    openSkillDetail,
    closeSkillDetail,
    switchTab,
    openSkillPublishModal,
    submitSkillUpload,
    handleCreateShare,
    handleRevokeShare,
    handleListShares,
    detailPanelProps,
  };
}
