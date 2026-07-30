import React, { useCallback, useContext, useEffect, useState } from 'react';
import { FileText, Code, File, Plus } from 'lucide-react';
import { useCloudFilesStore, type CloudTemplate } from '../../../store/cloudFiles';
import { cloudAPI } from '../../views/api';
import { useLang } from '../../../i18n/useLang';
import { appContext } from '../../../hooks/provider';

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  md:   <FileText className="w-4 h-4 text-blue-400" />,
  py:   <Code className="w-4 h-4 text-blue-400" />,
  js:   <Code className="w-4 h-4 text-yellow-400" />,
  ts:   <Code className="w-4 h-4 text-blue-400" />,
  docx: <FileText className="w-4 h-4 text-blue-500" />,
  pptx: <FileText className="w-4 h-4 text-orange-500" />,
};

const TemplateLibrary: React.FC = () => {
  const { t } = useLang();
  const { user } = useContext(appContext);
  const userId = user?.email ?? '';
  const templates = useCloudFilesStore((s) => s.templates);
  const templatesLoading = useCloudFilesStore((s) => s.templatesLoading);
  const setTemplates = useCloudFilesStore((s) => s.setTemplates);
  const setTemplatesLoading = useCloudFilesStore((s) => s.setTemplatesLoading);

  const [applying, setApplying] = useState<string | null>(null);

  // 加载模板
  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    cloudAPI.listTemplates(userId || undefined)
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [setTemplates, setTemplatesLoading, userId]);

  const handleApply = useCallback(async (template: CloudTemplate) => {
    setApplying(template.path);
    try {
      await cloudAPI.applyTemplate({ templatePath: template.path, sessionId: '', userId: userId || undefined });
      // 成功后提示（可在后续迭代中改用 toast）
    } catch {
      // 静默
    } finally {
      setApplying(null);
    }
  }, [userId]);

  const handleNewTemplate = useCallback(() => {
    // 用自定义协议打开本地编辑器创建模板
    // 先获取挂载路径，然后跳转到 _templates/ 目录
    cloudAPI.checkStatus(userId || undefined).then((status: { mountPath: string }) => {
      if (status.mountPath) {
        const dir = `${status.mountPath}/_templates`;
        window.open(`drsai://open?path=${encodeURIComponent(dir)}`, '_blank');
      }
    }).catch(() => {});
  }, [userId]);

  return (
    <div className="space-y-1.5">
      {templatesLoading ? (
        <div className="text-center py-3 text-[11px] text-tertiary">加载中…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-3 text-[11px] text-tertiary">
          {t('operation.noTemplates')}
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
          {templates.map((tmpl) => {
            const ext = tmpl.suffix?.toLowerCase() ?? '';
            const icon = TEMPLATE_ICONS[ext] ?? <File className="w-4 h-4 text-gray-400" />;
            return (
              <div
                key={tmpl.path}
                className="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-tertiary/10 transition-colors group"
              >
                <span className="flex-shrink-0">{icon}</span>
                <span className="flex-1 min-w-0 text-xs text-primary truncate" title={tmpl.name}>
                  {tmpl.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleApply(tmpl)}
                  disabled={applying === tmpl.path}
                  className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[11px] font-medium rounded-md bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 transition-all"
                >
                  {applying === tmpl.path ? '⋯' : t('operation.applyToChat')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 新建模板按钮 */}
      <button
        type="button"
        onClick={handleNewTemplate}
        className="flex items-center gap-1.5 px-2 py-1.5 w-full text-[11px] text-tertiary hover:text-secondary rounded-md hover:bg-tertiary/10 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('operation.newTemplate')}
      </button>
    </div>
  );
};

export default TemplateLibrary;
