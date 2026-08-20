import { create } from 'zustand';

/** 单个云文件 / 目录 */
export interface CloudFile {
  name: string;
  path: string;
  size: number;
  /** file | directory */
  type: 'file' | 'directory';
  /** 文件扩展名 (不含.) */
  suffix?: string;
  /** 同步状态 */
  syncStatus: 'synced' | 'syncing' | 'modified' | 'cloud-only' | 'error';
  /** 最后修改时间 ISO */
  updatedAt?: string;
  children?: CloudFile[];
}

/** 模板条目 */
export interface CloudTemplate {
  name: string;
  path: string;
  description?: string;
  /** 模板文件扩展名 */
  suffix: string;
}

/** 连接状态 */
export type ConnectionStatusValue = 'connected' | 'disconnected' | 'checking' | 'error';

interface CloudFilesState {
  // ── 连接 ──
  connectionStatus: ConnectionStatusValue;
  connectionError: string | null;
  mountPath: string;
  lastSyncTime: string | null;

  // ── 文件列表 ──
  files: CloudFile[];
  filesLoading: boolean;
  /** 当前浏览路径 (相对 mountPath) */
  currentPath: string;

  // ── 多选 ──
  selectedFilePaths: Set<string>;

  // ── 模板 ──
  templates: CloudTemplate[];
  templatesLoading: boolean;
  selectedTemplatePaths: Set<string>;

  // ── 收藏 ──
  recentFiles: CloudFile[];
  recentFilesLoading: boolean;

  // ── 所有分区展开/折叠 ──
  sectionExpanded: {
    connection: boolean;
    files: boolean;
    templates: boolean;
    guanlianyewu: boolean;
  };

  // ── Actions ──
  setConnectionStatus: (status: ConnectionStatusValue) => void;
  setConnectionError: (error: string | null) => void;
  setMountPath: (path: string) => void;
  setLastSyncTime: (time: string | null) => void;

  setFiles: (files: CloudFile[]) => void;
  setFilesLoading: (loading: boolean) => void;
  setCurrentPath: (path: string) => void;

  toggleFileSelection: (path: string) => void;
  selectAllFiles: () => void;
  clearFileSelection: () => void;

  setTemplates: (templates: CloudTemplate[]) => void;
  setTemplatesLoading: (loading: boolean) => void;
  toggleTemplateSelection: (path: string) => void;
  clearTemplateSelection: () => void;

  toggleSection: (section: 'connection' | 'files' | 'templates' | 'guanlianyewu') => void;

  setRecentFiles: (files: CloudFile[]) => void;
  setRecentFilesLoading: (loading: boolean) => void;
  addRecentFile: (file: CloudFile) => void;
  removeRecentFile: (path: string) => void;
}

export const useCloudFilesStore = create<CloudFilesState>((set, get) => ({
  // ── 初始状态 ──
  connectionStatus: 'disconnected',
  connectionError: null,
  mountPath: '',
  lastSyncTime: null,

  files: [],
  filesLoading: false,
  currentPath: '',

  selectedFilePaths: new Set(),

  templates: [],
  templatesLoading: false,
  selectedTemplatePaths: new Set(),

  recentFiles: [],
  recentFilesLoading: false,

  sectionExpanded: {
    connection: true,
    files: true,
    templates: true,
    guanlianyewu: true,
  },

  // ── Actions ──
  setConnectionStatus: (status) => set({ connectionStatus: status, ...(status !== 'error' ? { connectionError: null } : {}) }),
  setConnectionError: (err) => set({ connectionError: err }),
  setMountPath: (path) => set({ mountPath: path }),
  setLastSyncTime: (time) => set({ lastSyncTime: time }),

  setFiles: (files) => set({ files }),
  setFilesLoading: (loading) => set({ filesLoading: loading }),
  setCurrentPath: (path) => set({ currentPath: path }),

  toggleFileSelection: (path) =>
    set((state) => {
      const next = new Set(state.selectedFilePaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { selectedFilePaths: next };
    }),

  selectAllFiles: () =>
    set((state) => {
      const collectPaths = (files: CloudFile[]): string[] => {
        const paths: string[] = [];
        for (const f of files) {
          paths.push(f.path);
          if (f.children) paths.push(...collectPaths(f.children));
        }
        return paths;
      };
      return { selectedFilePaths: new Set(collectPaths(state.files)) };
    }),

  clearFileSelection: () => set({ selectedFilePaths: new Set() }),

  setTemplates: (templates) => set({ templates }),
  setTemplatesLoading: (loading) => set({ templatesLoading: loading }),

  toggleTemplateSelection: (path) =>
    set((state) => {
      const next = new Set(state.selectedTemplatePaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { selectedTemplatePaths: next };
    }),

  clearTemplateSelection: () => set({ selectedTemplatePaths: new Set() }),

  setRecentFiles: (files) => set({ recentFiles: files }),
  setRecentFilesLoading: (loading) => set({ recentFilesLoading: loading }),

  toggleSection: (section) =>
    set((state) => ({
      sectionExpanded: {
        ...state.sectionExpanded,
        [section]: !state.sectionExpanded[section as keyof typeof state.sectionExpanded],
      },
    })),

  addRecentFile: (file) =>
    set((state) => {
      // Dedup by path — remove existing entry with same path, then prepend
      const filtered = state.recentFiles.filter((f) => f.path !== file.path);
      return { recentFiles: [file, ...filtered].slice(0, 50) };
    }),

  removeRecentFile: (path) =>
    set((state) => ({
      recentFiles: state.recentFiles.filter((f) => f.path !== path),
    })),
}));
